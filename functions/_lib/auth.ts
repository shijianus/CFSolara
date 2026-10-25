import type { AppEnv, UserSession } from './types';
import { sha256Hex } from './sonic/hash';
import { isEnvEnabled } from './sonic/config';
import { getSigningSecrets, MIN_SECRET_LENGTH } from './secrets';

const DEFAULT_EPOMAIL_BASE = 'https://mail.epocanvas.com';

export const API_KEY_PREFIX = 'sonic_live_';
const API_KEY_VERSION = 'v1';
const API_KEY_MAX_LENGTH = 8192;
const PAYLOAD_MAX_BYTES = 4096;
const SIGNATURE_BYTES = 32;
const SESSION_TTL_SEC = 30 * 24 * 3600;
const MAX_SESSION_TTL_SEC = SESSION_TTL_SEC + 3600;
const VERIFIED_CACHE_MAX = 1024;
const VERIFIED_CACHE_TTL_MS = 5 * 60_000;

const encoder = new TextEncoder();

export class AuthConfigError extends Error {
  readonly code: string;
  readonly status = 503;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthConfigError';
    this.code = code;
  }
}

export class AuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  if (email.length === 0 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || local.length > 64 || !domain || domain.length > 253) return false;
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;
  return (
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) &&
    /^[A-Za-z0-9.-]+$/.test(domain)
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  if (value.length % 4 === 1) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacSign(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return new Uint8Array(signature);
}

async function hmacVerify(secret: string, message: string, signature: Uint8Array): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, signature.buffer as ArrayBuffer, encoder.encode(message));
}

export function deriveKeyId(secret: string): string {
  return sha256Hex(secret).slice(0, 16);
}

interface ApiKeyPayload {
  v: 1;
  email: string;
  exp: number;
  kid: string;
}

interface ParsedApiKey {
  payload: ApiKeyPayload;
  message: string;
  signature: Uint8Array;
}

function parseApiKey(apiKey: string): ParsedApiKey | null {
  if (!apiKey.startsWith(API_KEY_PREFIX) || apiKey.length > API_KEY_MAX_LENGTH) return null;
  const rest = apiKey.slice(API_KEY_PREFIX.length);
  const parts = rest.split('.');
  if (parts.length !== 3) return null;

  const [version, payloadB64, signatureB64] = parts;
  if (version !== API_KEY_VERSION) return null;
  if (!payloadB64 || !signatureB64) return null;

  const payloadBytes = base64UrlToBytes(payloadB64);
  if (!payloadBytes || payloadBytes.length === 0 || payloadBytes.length > PAYLOAD_MAX_BYTES) return null;

  const signature = base64UrlToBytes(signatureB64);
  if (!signature || signature.length !== SIGNATURE_BYTES) return null;

  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (payload.v !== 1) return null;
  if (typeof payload.email !== 'string' || !isValidEmail(payload.email)) return null;
  if (typeof payload.exp !== 'number' || !Number.isInteger(payload.exp) || payload.exp <= 0) return null;
  if (typeof payload.kid !== 'string' || payload.kid.length < 8 || payload.kid.length > 64) return null;

  return {
    payload: {
      v: 1,
      email: payload.email.trim().toLowerCase(),
      exp: payload.exp,
      kid: payload.kid,
    },
    message: `${version}.${payloadB64}`,
    signature,
  };
}

/**
 * Issue a signed key. Exported for tests and for createSession. A signing
 * failure is always thrown — there is no weak random fallback.
 */
export async function signApiKey(env: AppEnv, email: string, expSeconds: number): Promise<string> {
  const secrets = getSigningSecrets(env);
  if (!secrets.current) {
    throw new AuthConfigError(
      'AUTH_SECRET_MISSING',
      `SONIC_SECRET is not configured or shorter than ${MIN_SECRET_LENGTH} characters`,
    );
  }
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!isValidEmail(normalizedEmail)) {
    throw new AuthError('INVALID_EMAIL', 'A valid email address is required', 400);
  }
  if (!Number.isInteger(expSeconds) || expSeconds <= 0) {
    throw new AuthError('INVALID_EXPIRY', 'A positive integer expiry is required', 400);
  }

  const payload: ApiKeyPayload = {
    v: 1,
    email: normalizedEmail,
    exp: expSeconds,
    kid: deriveKeyId(secrets.current),
  };
  const payloadB64 = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const message = `${API_KEY_VERSION}.${payloadB64}`;
  const signature = await hmacSign(secrets.current, message);
  return `${API_KEY_PREFIX}${message}.${bytesToBase64Url(signature)}`;
}

interface CachedVerification {
  user: UserSession;
  expiresAtMs: number;
}

// Only keys whose HMAC has already been verified may enter this cache.
const verifiedKeyCache = new Map<string, CachedVerification>();

function cacheGet(key: string, nowMs: number): UserSession | null {
  const entry = verifiedKeyCache.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= nowMs) {
    verifiedKeyCache.delete(key);
    return null;
  }
  return entry.user;
}

function cacheSet(key: string, user: UserSession, expiresAtMs: number, nowMs: number): void {
  if (verifiedKeyCache.size >= VERIFIED_CACHE_MAX) {
    for (const [cachedKey, entry] of verifiedKeyCache) {
      if (entry.expiresAtMs <= nowMs) verifiedKeyCache.delete(cachedKey);
    }
    while (verifiedKeyCache.size >= VERIFIED_CACHE_MAX) {
      const oldest = verifiedKeyCache.keys().next().value;
      if (typeof oldest !== 'string') break;
      verifiedKeyCache.delete(oldest);
    }
  }
  verifiedKeyCache.set(key, { user, expiresAtMs });
}

export function clearVerifiedKeyCacheForTest(): void {
  verifiedKeyCache.clear();
}

export function getEpomailConfig(env: AppEnv, requestOrigin?: string) {
  const baseUrl = (env.EPOMAIL_BASE_URL || DEFAULT_EPOMAIL_BASE).replace(/\/+$/, '');
  const clientId = String(env.EPOMAIL_CLIENT_ID || '').trim();
  const clientSecret = String(env.EPOMAIL_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new AuthConfigError(
      'OAUTH_MISCONFIGURED',
      'EPOMAIL_CLIENT_ID and EPOMAIL_CLIENT_SECRET are required',
    );
  }
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

export async function createSession(env: AppEnv, userInfo: { email: string; name: string; avatar: string; role?: string; id?: string }): Promise<UserSession> {
  const secrets = getSigningSecrets(env);
  if (!secrets.current) {
    throw new AuthConfigError(
      'AUTH_SECRET_MISSING',
      `SONIC_SECRET is not configured or shorter than ${MIN_SECRET_LENGTH} characters`,
    );
  }

  const email = String(userInfo.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    throw new AuthError('INVALID_EMAIL', 'A valid email address is required', 400);
  }

  const now = Date.now();
  const expiresAtSec = Math.floor(now / 1000) + SESSION_TTL_SEC;
  const expiresAt = new Date(expiresAtSec * 1000).toISOString();
  const id = userInfo.id ? String(userInfo.id) : `usr_${crypto.randomUUID()}`;
  const apiKey = await signApiKey(env, email, expiresAtSec);

  const session: UserSession = {
    id,
    email,
    name: userInfo.name || email.split('@')[0],
    avatar: userInfo.avatar || '',
    role: userInfo.role || 'user',
    apiKey,
    createdAt: new Date(now).toISOString(),
    expiresAt,
  };

  const fingerprint = `${deriveKeyId(secrets.current)}:${secrets.previous ? deriveKeyId(secrets.previous) : '-'}`;
  const ttlMs = Math.min(VERIFIED_CACHE_TTL_MS, expiresAtSec * 1000 - now);
  if (ttlMs > 0) {
    cacheSet(`${fingerprint}:${apiKey}`, session, now + ttlMs, now);
  }
  return session;
}

export function extractAuthCredentials(request: Request, env?: AppEnv): { token?: string; apiKey?: string } {
  const headerKey =
    request.headers.get('x-sonic-key') ||
    request.headers.get('x-cfsolara-key') ||
    request.headers.get('x-api-key');
  const authHeader = request.headers.get('authorization') || '';

  let bearerToken: string | undefined;
  if (/^bearer\s+/i.test(authHeader)) {
    bearerToken = authHeader.replace(/^bearer\s+/i, '').trim();
  }

  // Query-string credentials are opt-in only: they leak through logs and Referer.
  let queryKey: string | undefined;
  if (isEnvEnabled(env?.SONIC_ALLOW_QUERY_KEY, false)) {
    const url = new URL(request.url);
    queryKey = url.searchParams.get('api_key') || url.searchParams.get('key') || undefined;
  }

  return {
    token: bearerToken,
    apiKey: (headerKey || '').trim() || bearerToken || queryKey,
  };
}

export async function verifyAuth(request: Request, env: AppEnv): Promise<{ authenticated: boolean; user?: UserSession; isRateLimited?: boolean }> {
  const secrets = getSigningSecrets(env);
  if (!secrets.current) {
    return { authenticated: false };
  }

  const { apiKey } = extractAuthCredentials(request, env);
  if (!apiKey) return { authenticated: false };

  // Legacy formats are intentionally rejected outright.
  if (apiKey.startsWith('solara_live_')) return { authenticated: false };
  if (!apiKey.startsWith(API_KEY_PREFIX)) return { authenticated: false };

  const parsed = parseApiKey(apiKey);
  if (!parsed) return { authenticated: false };

  const nowMs = Date.now();
  const expMs = parsed.payload.exp * 1000;
  if (expMs <= nowMs) return { authenticated: false };
  if (expMs > nowMs + MAX_SESSION_TTL_SEC * 1000) return { authenticated: false };

  const currentKid = deriveKeyId(secrets.current);
  const previousKid = secrets.previous ? deriveKeyId(secrets.previous) : null;
  const candidates: Array<{ secret: string; kid: string }> = [];
  if (parsed.payload.kid === currentKid) candidates.push({ secret: secrets.current, kid: currentKid });
  if (previousKid && parsed.payload.kid === previousKid) {
    candidates.push({ secret: secrets.previous as string, kid: previousKid });
  }
  if (candidates.length === 0) return { authenticated: false };

  const cacheKey = `${currentKid}:${previousKid || '-'}:${apiKey}`;
  const cached = cacheGet(cacheKey, nowMs);
  if (cached) return { authenticated: true, user: cached };

  let valid = false;
  for (const candidate of candidates) {
    try {
      if (await hmacVerify(candidate.secret, parsed.message, parsed.signature)) {
        valid = true;
        break;
      }
    } catch {
      // Treat any crypto failure as a verification failure.
    }
  }
  if (!valid) return { authenticated: false };

  const email = parsed.payload.email;
  const user: UserSession = {
    id: `usr_${sha256Hex(email).slice(0, 16)}`,
    email,
    name: email.split('@')[0],
    avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(email)}`,
    role: 'user',
    apiKey,
    createdAt: new Date(Math.max(0, expMs - SESSION_TTL_SEC * 1000)).toISOString(),
    expiresAt: new Date(expMs).toISOString(),
  };

  const ttlMs = Math.min(VERIFIED_CACHE_TTL_MS, expMs - nowMs);
  if (ttlMs > 0) {
    cacheSet(cacheKey, user, nowMs + ttlMs, nowMs);
  }
  return { authenticated: true, user };
}

export function describeAuthConfigError(error: unknown): string {
  if (error instanceof AuthConfigError) {
    return `Authentication is unavailable (${error.code})`;
  }
  return 'Authentication is unavailable';
}

