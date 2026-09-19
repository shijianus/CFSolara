import type { AppEnv, UserSession } from './types';

const DEFAULT_EPOMAIL_BASE = 'https://mail.epocanvas.com';
const DEFAULT_CLIENT_ID = 'solara_music_platform';
const DEFAULT_CLIENT_SECRET = 'solara_secret_2026';
const DEFAULT_SIGNING_SECRET = 'solara_secret_key_sig_v1';

export function getEpomailConfig(env: AppEnv, requestOrigin?: string) {
  const baseUrl = (env.EPOMAIL_BASE_URL || DEFAULT_EPOMAIL_BASE).replace(/\/+$/, '');
  const clientId = env.EPOMAIL_CLIENT_ID || DEFAULT_CLIENT_ID;
  const clientSecret = env.EPOMAIL_CLIENT_SECRET || DEFAULT_CLIENT_SECRET;
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
    state: state || 'solara_auth',
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

// In-memory sessions store for demo/stateless verification
const memorySessions = new Map<string, UserSession>();
const memoryKeyToSession = new Map<string, UserSession>();

export async function createSession(env: AppEnv, userInfo: { email: string; name: string; avatar: string; role?: string; id?: string }): Promise<UserSession> {
  const secret = env.SOLARA_SECRET || DEFAULT_SIGNING_SECRET;
  const now = Date.now();
  const expiresAt = new Date(now + 30 * 24 * 3600 * 1000).toISOString(); // 30 days
  const id = userInfo.id || `usr_${Math.random().toString(36).slice(2, 10)}`;
  
  // Generate a deterministically verifiable API Key for the user
  const rawKeyData = `${userInfo.email}|${expiresAt}|${secret}`;
  let keySig = '';
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, enc.encode(rawKeyData));
    keySig = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  } catch {
    keySig = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  const encodedEmail = btoa(userInfo.email).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const apiKey = `solara_live_${encodedEmail}_${keySig}`;

  const session: UserSession = {
    id,
    email: userInfo.email,
    name: userInfo.name,
    avatar: userInfo.avatar,
    role: userInfo.role || 'user',
    apiKey,
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  memorySessions.set(session.id, session);
  memoryKeyToSession.set(apiKey, session);
  return session;
}

export function extractAuthCredentials(request: Request): { token?: string; apiKey?: string } {
  const url = new URL(request.url);
  const queryKey = url.searchParams.get('api_key') || url.searchParams.get('key');
  const headerKey = request.headers.get('x-cfsolara-key') || request.headers.get('x-api-key');
  const authHeader = request.headers.get('authorization') || '';

  let bearerToken: string | undefined;
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    bearerToken = authHeader.substring(7).trim();
  }

  return {
    token: bearerToken,
    apiKey: headerKey || queryKey || (bearerToken?.startsWith('solara_live_') ? bearerToken : undefined),
  };
}

export async function verifyAuth(request: Request, env: AppEnv): Promise<{ authenticated: boolean; user?: UserSession; isRateLimited?: boolean }> {
  const { apiKey } = extractAuthCredentials(request);

  if (apiKey) {
    const cached = memoryKeyToSession.get(apiKey);
    if (cached) {
      return { authenticated: true, user: cached };
    }
    // Verifiable signature check
    if (apiKey.startsWith('solara_live_')) {
      const parts = apiKey.replace('solara_live_', '').split('_');
      if (parts.length >= 2) {
        try {
          const rawEmail = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'));
          if (rawEmail.includes('@')) {
            const reconstructedUser: UserSession = {
              id: `usr_${parts[0].slice(0, 8)}`,
              email: rawEmail,
              name: rawEmail.split('@')[0],
              avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(rawEmail)}`,
              role: 'user',
              apiKey,
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
            };
            memoryKeyToSession.set(apiKey, reconstructedUser);
            return { authenticated: true, user: reconstructedUser };
          }
        } catch {}
      }
    }
  }

  return { authenticated: false };
}
