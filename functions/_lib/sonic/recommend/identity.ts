// Sonic Intelligent Recommendation & Smart Search — Privacy-Safe Identity & Cache Isolation

import type { AppEnv } from '../../types';
import { base64UrlToString, extractAuthCredentials, verifyAuth } from '../../auth';
import type { ClientContextHints, UserIdentityContext } from './types';
import { deterministicHash16 } from './track-canonical';

const ANON_ID_REGEX = /^anon_[a-zA-Z0-9_-]{8,64}$/;

async function hashSubjectId(prefix: 'usr' | 'anon', raw: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(`sonic-subj-v1:${prefix}:${raw}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest))
      .slice(0, 12)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `${prefix}_${hex}`;
  } catch {
    return `${prefix}_${deterministicHash16(`${prefix}:${raw}`)}`;
  }
}

function sanitizeStringList(val: unknown, maxItems = 25, maxLen = 80): string[] | undefined {
  if (!Array.isArray(val)) return undefined;
  const out: string[] = [];
  for (const item of val) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, maxLen);
    if (trimmed) out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out.length > 0 ? out : undefined;
}

export function parseClientContextHints(request: Request): ClientContextHints | undefined {
  const raw = request.headers.get('x-sonic-context');
  if (!raw || raw.length > 4096) return undefined;
  try {
    const jsonStr = base64UrlToString(raw.trim());
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object') return undefined;
    return {
      recentArtists: sanitizeStringList(parsed.recentArtists, 20, 64),
      likedTrackIds: sanitizeStringList(parsed.likedTrackIds, 30, 64),
      likedArtists: sanitizeStringList(parsed.likedArtists, 20, 64),
      recentQueries: sanitizeStringList(parsed.recentQueries, 15, 64),
      dislikedTrackIds: sanitizeStringList(parsed.dislikedTrackIds, 40, 64),
      dislikedArtists: sanitizeStringList(parsed.dislikedArtists, 20, 64),
    };
  } catch {
    return undefined;
  }
}

export async function resolveUserIdentity(request: Request, env?: AppEnv): Promise<UserIdentityContext> {
  const url = new URL(request.url);
  const headerPref = (request.headers.get('x-sonic-personalization') || '').trim().toLowerCase();
  const queryPref = (url.searchParams.get('personalize') || url.searchParams.get('personalization') || '')
    .trim()
    .toLowerCase();

  // Explicit opt-out ALWAYS forces public zero-tracking mode, even if authenticated
  if (
    headerPref === 'off' ||
    headerPref === '0' ||
    headerPref === 'false' ||
    queryPref === 'off' ||
    queryPref === '0' ||
    queryPref === 'false'
  ) {
    return {
      mode: 'public',
      subjectKey: null,
      personalizationEnabled: false,
      isAuthenticated: false,
    };
  }

  const clientHints = parseClientContextHints(request);

  // 1. Check verified HMAC user session
  if (env) {
    const authRes = await verifyAuth(request, env);
    if (authRes.authenticated && authRes.user?.email) {
      const subjectKey = await hashSubjectId('usr', authRes.user.email.toLowerCase());
      return {
        mode: 'authenticated',
        subjectKey,
        personalizationEnabled: true,
        isAuthenticated: true,
        userId: authRes.user.id,
        clientHints,
      };
    }
  }

  // 2. Check anonymous opt-in pseudonymous device ID
  const anonId = (request.headers.get('x-sonic-anon-id') || '').trim();
  if (anonId && ANON_ID_REGEX.test(anonId)) {
    const subjectKey = await hashSubjectId('anon', anonId);
    return {
      mode: 'anonymous-opt-in',
      subjectKey,
      personalizationEnabled: true,
      isAuthenticated: false,
      clientHints,
    };
  }

  // 3. Default public mode (zero server event persistence)
  return {
    mode: 'public',
    subjectKey: null,
    personalizationEnabled: Boolean(clientHints),
    isAuthenticated: false,
    clientHints,
  };
}

export function requestHasIdentitySignals(request: Request, env?: AppEnv): boolean {
  const creds = extractAuthCredentials(request, env);
  if (creds.apiKey || creds.token) return true;
  if (request.headers.get('x-sonic-anon-id')) return true;
  if (request.headers.get('x-sonic-context')) return true;
  if (request.headers.get('x-sonic-personalization')) return true;
  return false;
}

export function buildPrivacySafeCacheHeaders(
  request: Request,
  identity: UserIdentityContext,
  env?: AppEnv,
  publicMaxAgeSec = 120,
): { headers: Record<string, string>; allowSharedCache: boolean } {
  const vary = 'Authorization, X-Sonic-Key, X-CFSolara-Key, X-Sonic-Anon-Id, X-Sonic-Personalization, X-Sonic-Context';
  const hasSignals = identity.personalizationEnabled || Boolean(identity.subjectKey) || requestHasIdentitySignals(request, env);

  if (hasSignals || publicMaxAgeSec <= 0) {
    return {
      allowSharedCache: false,
      headers: {
        'Cache-Control': 'private, no-store',
        Vary: vary,
      },
    };
  }

  return {
    allowSharedCache: true,
    headers: {
      'Cache-Control': `public, max-age=${publicMaxAgeSec}, s-maxage=${publicMaxAgeSec}`,
      Vary: vary,
    },
  };
}
