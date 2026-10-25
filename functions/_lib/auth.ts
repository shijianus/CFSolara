import type { AppEnv, UserSession } from './types';
import { isEnvEnabled } from './sonic/config';

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getEpomailConfig(env: AppEnv, requestOrigin?: string) {
  const baseUrl = (env.EPOMAIL_BASE_URL || '').replace(/\/+$/, '');
  const clientId = env.EPOMAIL_CLIENT_ID ? String(env.EPOMAIL_CLIENT_ID).trim() : '';
  const clientSecret = env.EPOMAIL_CLIENT_SECRET ? String(env.EPOMAIL_CLIENT_SECRET).trim() : '';

  let redirectUri = env.EPOMAIL_REDIRECT_URI ? String(env.EPOMAIL_REDIRECT_URI).trim() : '';
  if (!redirectUri && requestOrigin) {
    const allowedOrigins = (env.SONIC_ALLOWED_ORIGINS || '')
      .split(',')
      .map((o) => o.trim().toLowerCase())
      .filter(Boolean);
    const originLower = requestOrigin.toLowerCase();
    if (allowedOrigins.includes(originLower)) {
      redirectUri = `${requestOrigin}/api/auth/callback`;
    }
  }

  return {
    baseUrl,
    clientId,
    clientSecret,
    redirectUri,
    authorizeUrl: baseUrl ? `${baseUrl}/oauth/authorize` : '',
    tokenUrl: baseUrl ? `${baseUrl}/oauth/token` : '',
    userInfoUrl: baseUrl ? `${baseUrl}/oauth/userinfo` : '',
  };
}

export function buildAuthorizeUrl(
  env: AppEnv,
  origin: string,
  state: string,
  codeChallenge?: string,
): string {
  const config = getEpomailConfig(env, origin);
  if (!config.baseUrl || !config.clientId || !config.redirectUri) {
    throw new Error('OAuth configuration missing (EPOMAIL_BASE_URL, EPOMAIL_CLIENT_ID, or valid redirectUri)');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid profile email',
    state,
  });

  if (codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }

  return `${config.authorizeUrl}?${params.toString()}`;
}

export async function exchangeCode(
  env: AppEnv,
  origin: string,
  code: string,
  codeVerifier?: string,
): Promise<{ accessToken: string; idToken?: string }> {
  const config = getEpomailConfig(env, origin);
  if (!config.baseUrl || !config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new Error('OAuth configuration incomplete for token exchange');
  }

  const bodyPayload: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  };

  if (codeVerifier) {
    bodyPayload.code_verifier = codeVerifier;
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Sonic OAuth Error] Epomail token exchange failed (${response.status}): ${errorText}`);
    throw new Error('Epomail token exchange failed');
  }

  const data = (await response.json()) as { access_token: string; id_token?: string };
  return {
    accessToken: data.access_token,
    idToken: data.id_token,
  };
}

export async function fetchUserInfo(
  env: AppEnv,
  accessToken: string,
): Promise<{ email: string; name: string; avatar: string; role?: string; id?: string }> {
  const config = getEpomailConfig(env);
  if (!config.userInfoUrl) {
    throw new Error('OAuth userInfo URL not configured');
  }

  const response = await fetch(config.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    console.error(`[Sonic OAuth Error] Epomail userInfo request failed (${response.status})`);
    throw new Error('Epomail userInfo request failed');
  }

  const user = (await response.json()) as Record<string, any>;
  return {
    id: String(user.id || user.sub || user.email || ''),
    email: String(user.email || '').trim().toLowerCase(),
    name: String(user.name || user.username || user.nickname || user.email || 'Epomail User'),
    avatar: String(user.avatar || user.picture || ''),
    role: String(user.role || 'user'),
  };
}

// ── Base64URL Helpers (UTF-8 safe) ──

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function stringToBase64Url(str: string): string {
  return base64UrlEncode(new TextEncoder().encode(str));
}

export function base64UrlToString(str: string): string {
  return new TextDecoder().decode(base64UrlDecode(str));
}

// ── Bounded Auth Cache with TTL ──

interface CachedAuth {
  user: UserSession;
  exp: number; // Unix timestamp in seconds
  cachedAt: number; // Date.now() in milliseconds
}

const authCache = new Map<string, CachedAuth>();
const MAX_AUTH_CACHE = 1000;
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

export function resetAuthCacheForTest(): void {
  authCache.clear();
}

export function getAuthSecrets(env: AppEnv): { primary: string; prev?: string } | null {
  const primary = (env.SONIC_SECRET || env.SOLARA_SECRET || '').trim();
  if (!primary || primary.length < 32) {
    return null;
  }
  const prev = env.SONIC_SECRET_PREV ? String(env.SONIC_SECRET_PREV).trim() : undefined;
  const validPrev = prev && prev.length >= 32 ? prev : undefined;
  return { primary, prev: validPrev };
}

export async function createSession(
  env: AppEnv,
  userInfo: { email: string; name: string; avatar: string; role?: string; id?: string },
): Promise<UserSession> {
  const secrets = getAuthSecrets(env);
  if (!secrets) {
    console.error(
      '[Sonic Auth] Cannot issue API Key: SONIC_SECRET / SOLARA_SECRET is missing or shorter than 32 characters',
    );
    throw new Error('SONIC_SECRET is not configured or shorter than 32 characters');
  }

  const email = String(userInfo.email || '').trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    throw new Error('Invalid email format for user session');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + 30 * 86400; // 30 days
  const expiresAt = new Date(expSec * 1000).toISOString();
  const id = userInfo.id || crypto.randomUUID();

  const payloadObj = {
    v: 1,
    email,
    exp: expSec,
    kid: 'current',
  };
  const payloadB64url = stringToBase64Url(JSON.stringify(payloadObj));
  const dataToSign = `v1.${payloadB64url}`;

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secrets.primary),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(dataToSign));
  const sigB64url = base64UrlEncode(new Uint8Array(signatureBuffer));

  const apiKey = `sonic_live_v1.${payloadB64url}.${sigB64url}`;

  const session: UserSession = {
    id,
    email,
    name: userInfo.name || email.split('@')[0],
    avatar: userInfo.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(email)}`,
    role: userInfo.role || 'user',
    apiKey,
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  authCache.set(apiKey, { user: session, exp: expSec, cachedAt: Date.now() });
  return session;
}

export function extractAuthCredentials(
  request: Request,
  env?: AppEnv,
): { token?: string; apiKey?: string } {
  const url = new URL(request.url);
  const allowQueryKey = isEnvEnabled(env?.SONIC_ALLOW_QUERY_KEY, false);
  const queryKey = allowQueryKey
    ? url.searchParams.get('api_key') || url.searchParams.get('key')
    : null;

  const headerKey =
    request.headers.get('x-sonic-key') ||
    request.headers.get('x-cfsolara-key') ||
    request.headers.get('x-api-key');
  const authHeader = request.headers.get('authorization') || '';

  let bearerToken: string | undefined;
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    bearerToken = authHeader.substring(7).trim();
  }

  const apiKey = headerKey?.trim() || bearerToken || queryKey?.trim() || undefined;

  return {
    token: bearerToken,
    apiKey,
  };
}

export async function verifyAuth(
  request: Request,
  env: AppEnv,
): Promise<{ authenticated: boolean; user?: UserSession; isRateLimited?: boolean }> {
  const { apiKey } = extractAuthCredentials(request, env);
  if (!apiKey) {
    return { authenticated: false };
  }

  // 1. Verify secrets exist and meet length requirement (>= 32)
  const secrets = getAuthSecrets(env);
  if (!secrets) {
    console.error(
      '[Sonic Auth] SONIC_SECRET / SOLARA_SECRET is missing or shorter than 32 characters; rejecting authentication (fail closed)',
    );
    return { authenticated: false };
  }

  // 2. Check verified cache
  const cached = authCache.get(apiKey);
  if (cached) {
    const nowMs = Date.now();
    if (nowMs < cached.cachedAt + AUTH_CACHE_TTL_MS && Math.floor(nowMs / 1000) < cached.exp) {
      return { authenticated: true, user: cached.user };
    }
    authCache.delete(apiKey);
  }

  // 3. Reject legacy formats immediately
  if (!apiKey.startsWith('sonic_live_v1.')) {
    return { authenticated: false };
  }

  const parts = apiKey.split('.');
  if (parts.length !== 3 || parts[0] !== 'sonic_live_v1') {
    return { authenticated: false };
  }

  const [, payloadB64url, sigB64url] = parts;
  if (!payloadB64url || !sigB64url) {
    return { authenticated: false };
  }

  // 4. Verify signature using constant-time crypto.subtle.verify
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlDecode(sigB64url);
    if (sigBytes.length !== 32) {
      return { authenticated: false };
    }
  } catch {
    return { authenticated: false };
  }

  const enc = new TextEncoder();
  const dataToVerify = enc.encode(`v1.${payloadB64url}`);

  let isValid = false;
  try {
    const primaryKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(secrets.primary),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    isValid = await crypto.subtle.verify('HMAC', primaryKey, sigBytes as any, dataToVerify);

    // If primary secret verification fails, try rotation secret (SONIC_SECRET_PREV)
    if (!isValid && secrets.prev) {
      const prevKey = await crypto.subtle.importKey(
        'raw',
        enc.encode(secrets.prev),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      isValid = await crypto.subtle.verify('HMAC', prevKey, sigBytes as any, dataToVerify);
    }
  } catch {
    return { authenticated: false };
  }

  if (!isValid) {
    return { authenticated: false };
  }

  // 5. Parse and strictly validate payload
  try {
    const payloadStr = base64UrlToString(payloadB64url);
    const payload = JSON.parse(payloadStr);

    if (payload.v !== 1) {
      return { authenticated: false };
    }

    if (typeof payload.email !== 'string' || !EMAIL_REGEX.test(payload.email)) {
      return { authenticated: false };
    }

    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return { authenticated: false };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp <= nowSec) {
      return { authenticated: false };
    }

    const user: UserSession = {
      id: `usr_${payloadB64url.slice(0, 12)}`,
      email: payload.email.toLowerCase(),
      name: payload.email.split('@')[0],
      avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(payload.email)}`,
      role: 'user',
      apiKey,
      createdAt: new Date((payload.exp - 30 * 86400) * 1000).toISOString(),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };

    // Store verified session into cache
    if (authCache.size >= MAX_AUTH_CACHE) {
      const now = Date.now();
      for (const [k, v] of authCache) {
        if (now >= v.cachedAt + AUTH_CACHE_TTL_MS || Math.floor(now / 1000) >= v.exp) {
          authCache.delete(k);
        }
        if (authCache.size < MAX_AUTH_CACHE - 100) break;
      }
      if (authCache.size >= MAX_AUTH_CACHE) {
        const firstKey = authCache.keys().next().value;
        if (firstKey) authCache.delete(firstKey);
      }
    }
    authCache.set(apiKey, { user, exp: payload.exp, cachedAt: Date.now() });

    return { authenticated: true, user };
  } catch {
    return { authenticated: false };
  }
}
