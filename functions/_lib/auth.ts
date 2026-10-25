import type { AppEnv, UserSession } from './types';

const DEFAULT_EPOMAIL_BASE = 'https://mail.epocanvas.com';
const DEFAULT_CLIENT_ID = 'sonic_music_platform';
// NOTE: no default client secret / signing secret. A missing secret must fail
// closed (verification returns unauthenticated, issuance throws) — see audit
// finding #1: hardcoded fallbacks made issued keys forgeable.

const KEY_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days
const SIGNATURE_HEX_CHARS = 32; // 128-bit truncation of HMAC-SHA256

function getSigningSecret(env: AppEnv): string {
  const secret = (env.SONIC_SECRET || env.SOLARA_SECRET || '').trim();
  return secret;
}

const encoder = new TextEncoder();

/** Length-safe constant-time comparison for equal-purpose string secrets. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}

function b64urlEncode(input: string): string {
  return btoa(input).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

async function hmacSignatureHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, SIGNATURE_HEX_CHARS);
}

export function getEpomailConfig(env: AppEnv, requestOrigin?: string) {
  const baseUrl = (env.EPOMAIL_BASE_URL || DEFAULT_EPOMAIL_BASE).replace(/\/+$/, '');
  const clientId = env.EPOMAIL_CLIENT_ID || DEFAULT_CLIENT_ID;
  const clientSecret = (env.EPOMAIL_CLIENT_SECRET || '').trim();
  const redirectUri = env.EPOMAIL_REDIRECT_URI || (requestOrigin ? `${requestOrigin}/api/auth/callback` : `${DEFAULT_EPOMAIL_BASE}/api/auth/callback`);

  return {
    baseUrl,
    clientId,
    clientSecret,
    redirectUri,
    authorizeUrl: `${baseUrl}/oauth/authorize`,
    tokenUrl: `${baseUrl}/oauth/token`,
    userInfoUrl: `${baseUrl}/oauth/userinfo`,
  };
}

export function buildAuthorizeUrl(env: AppEnv, origin: string, state?: string): string {
  const config = getEpomailConfig(env, origin);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid profile email',
    state: state || 'sonic_auth',
  });
  return `${config.authorizeUrl}?${params.toString()}`;
}

export async function exchangeCode(env: AppEnv, origin: string, code: string): Promise<{ accessToken: string; idToken?: string }> {
  const config = getEpomailConfig(env, origin);
  if (!config.clientSecret) {
    throw new Error('EPOMAIL_CLIENT_SECRET is not configured; OAuth token exchange refused (no source default)');
  }
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Epomail token exchange failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { access_token: string; id_token?: string };
  return {
    accessToken: data.access_token,
    idToken: data.id_token,
  };
}

export async function fetchUserInfo(env: AppEnv, accessToken: string): Promise<{ email: string; name: string; avatar: string; role?: string; id?: string }> {
  const config = getEpomailConfig(env);
  const response = await fetch(config.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Epomail userInfo request failed (${response.status})`);
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

// In-memory sessions store for demo/stateless verification
const memorySessions = new Map<string, UserSession>();
const memoryKeyToSession = new Map<string, UserSession>();

/**
 * Issue a signed API key: sonic_live_<b64url(email)>_<b64url(expiresAtISO)>_<hmacHex>.
 * Signature = HMAC-SHA256(secret, `${email}|${expiresAtISO}`), truncated to 128 bits.
 * Throws when no signing secret is configured — never falls back to a default.
 */
export async function createSession(env: AppEnv, userInfo: { email: string; name: string; avatar: string; role?: string; id?: string }): Promise<UserSession> {
  const secret = getSigningSecret(env);
  if (!secret) {
    throw new Error('SONIC_SECRET (or SOLARA_SECRET) is not configured; API key issuance refused');
  }
  const now = Date.now();
  const expiresAt = new Date(now + KEY_TTL_MS).toISOString();
  const id = userInfo.id || `usr_${Math.random().toString(36).slice(2, 10)}`;
  const email = userInfo.email.trim().toLowerCase();

  const signature = await hmacSignatureHex(secret, `${email}|${expiresAt}`);
  const apiKey = `sonic_live_${b64urlEncode(email)}_${b64urlEncode(expiresAt)}_${signature}`;

  const session: UserSession = {
    id,
    email,
    name: userInfo.name,
    avatar: userInfo.avatar,
    role: userInfo.role || 'user',
    apiKey,
    createdAt: new Date(now).toISOString(),
    expiresAt,
  };

  memorySessions.set(session.id, session);
  memoryKeyToSession.set(apiKey, session);
  return session;
}

export function extractAuthCredentials(request: Request): { token?: string; apiKey?: string } {
  const headerKey = request.headers.get('x-sonic-key') || request.headers.get('x-cfsolara-key') || request.headers.get('x-api-key');
  const authHeader = request.headers.get('authorization') || '';

  let bearerToken: string | undefined;
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    bearerToken = authHeader.substring(7).trim();
  }

  const isSonicBearer = bearerToken?.startsWith('sonic_live_') || bearerToken?.startsWith('solara_live_');

  // Deliberately no query-param (`?key=` / `?api_key=`) support: URLs leak into
  // access logs, upstream Referers and edge cache keys.
  return {
    token: bearerToken,
    apiKey: headerKey || (isSonicBearer ? bearerToken : undefined),
  };
}

/**
 * Verify an API key. Accepted formats:
 * - `sonic_live_<b64url(email)>_<b64url(expiresAtISO)>_<hmacHex>` (signed, unexpired, secret configured)
 * - any key present in the in-memory session store (server-side state, expiry still checked)
 * Legacy unsigned `sonic_live_<email>_<hex>` / `solara_live_...` keys are rejected.
 */
export async function verifyAuth(request: Request, env: AppEnv): Promise<{ authenticated: boolean; user?: UserSession; isRateLimited?: boolean }> {
  const { apiKey } = extractAuthCredentials(request);

  if (apiKey) {
    const secret = getSigningSecret(env);

    if (!secret) {
      // Fail closed: without a signing secret nothing off the session store can be trusted.
      return { authenticated: false };
    }

    const cached = memoryKeyToSession.get(apiKey);

    const prefix = apiKey.startsWith('sonic_live_') ? 'sonic_live_' : apiKey.startsWith('solara_live_') ? 'solara_live_' : '';
    if (prefix) {
      const parts = apiKey.slice(prefix.length).split('_');
      // Signed format: exactly email | expiresAt | signature. Legacy 2-part keys die here.
      if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
        try {
          const email = b64urlDecode(parts[0]).trim().toLowerCase();
          const expiresAtISO = b64urlDecode(parts[1]);
          const expiresAtMs = new Date(expiresAtISO).getTime();
          if (!email.includes('@') || !Number.isFinite(expiresAtMs)) {
            return { authenticated: false };
          }
          if (expiresAtMs <= Date.now()) {
            return { authenticated: false };
          }
          const expectedSig = await hmacSignatureHex(secret, `${email}|${expiresAtISO}`);
          if (!timingSafeEqualStr(parts[2].toLowerCase(), expectedSig)) {
            memoryKeyToSession.delete(apiKey);
            return { authenticated: false };
          }
          // Signature valid — a cached session only contributes richer user metadata.
          const user =
            cached && cached.expiresAt === expiresAtISO
              ? cached
              : {
                  id: `usr_${parts[0].slice(0, 8)}`,
                  email,
                  name: email.split('@')[0],
                  avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(email)}`,
                  role: 'user',
                  apiKey,
                  createdAt: new Date().toISOString(),
                  expiresAt: expiresAtISO,
                };
          memoryKeyToSession.set(apiKey, user);
          return { authenticated: true, user };
        } catch {
          return { authenticated: false };
        }
      }
    }
  }

  return { authenticated: false };
}
