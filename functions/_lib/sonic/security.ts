// Sonic Gateway — Inter-Service Authentication & Tiered Rate Limiter
// Enforces:
// 1. Constant-time X-Sonic-Engine-Key verification on engine paths/configs
// 2. Tiered rate limiting at Edge (Pages -> Engine hop) and Engine layers
//
// Trust rules:
// - Only CF-Connecting-IP is trusted for public callers.
// - X-Sonic-Client-IP is trusted only behind a valid engine secret.

import type { AppEnv } from '../types';
import { verifyAuth } from '../auth';
import { isEnvEnabled } from './config';
import { jsonResponse } from '../http';
import { constantTimeEqualStrings, sha256Hex } from './hash';
import { isValidSecret } from '../secrets';
import { isIpLiteral } from './net-guard';

export { isBlockedSsrfHost } from './net-guard';

export function timingSafeEqualStr(a: string, b: string): boolean {
  // Hash both sides first so unequal lengths do not leak through timing.
  return constantTimeEqualStrings(a, b);
}

export function hasValidEngineSecret(request: Request, env?: AppEnv): boolean {
  const configured = env?.SONIC_ENGINE_SECRET ? String(env.SONIC_ENGINE_SECRET).trim() : '';
  if (!isValidSecret(configured)) return false;
  const headerKey = request.headers.get('X-Sonic-Engine-Key')?.trim() || '';
  if (!headerKey) return false;
  return timingSafeEqualStr(headerKey, configured);
}

export function requiresEngineAuth(request: Request, env?: AppEnv): boolean {
  if (isEnvEnabled(env?.SONIC_REQUIRE_ENGINE_AUTH, false)) return true;

  // Configuration-based, never derived from Host / X-Forwarded-Host headers.
  if (String(env?.SONIC_RUNTIME || '') === 'linux-engine') return true;

  const url = new URL(request.url);
  return (
    url.pathname.startsWith('/api/sonic/engine/') ||
    url.pathname.startsWith('/api/sonic/resolve/')
  );
}

export function checkEngineAccess(request: Request, env?: AppEnv): Response | null {
  if (!requiresEngineAuth(request, env)) {
    return null;
  }

  const configured = env?.SONIC_ENGINE_SECRET ? String(env.SONIC_ENGINE_SECRET).trim() : '';
  if (!isValidSecret(configured)) {
    // Never include the secret (or its length) in the log or response.
    console.error('[Sonic Security] engine secret is missing or shorter than 32 characters');
    return jsonResponse(
      {
        brand: 'Sonic',
        error: {
          code: 'ENGINE_MISCONFIGURED',
          message: 'Engine secret is not configured; anonymous access to engine endpoint is forbidden',
        },
      },
      { status: 503 },
    );
  }

  if (!hasValidEngineSecret(request, env)) {
    return jsonResponse(
      {
        brand: 'Sonic',
        error: {
          code: 'ENGINE_UNAUTHORIZED',
          message: 'Valid X-Sonic-Engine-Key header is required to access Sonic Local Engine',
        },
      },
      {
        status: 401,
        headers: {
          'WWW-Authenticate': 'SonicEngineKey realm="sonic-local-engine"',
        },
      },
    );
  }

  return null;
}

// ── Client IP trust ──

/**
 * Public clients: the only trusted source is CF-Connecting-IP, which
 * Cloudflare overwrites at the edge. Missing or malformed values share the
 * strict "unknown" bucket. X-Forwarded-For and X-Sonic-Client-IP are ignored.
 */
export function getPublicClientIp(request: Request): string {
  const raw = request.headers.get('CF-Connecting-IP')?.trim() || '';
  if (!raw || !isIpLiteral(raw)) return 'unknown';
  return raw;
}

/**
 * Internal Pages -> Engine hop: trust X-Sonic-Client-IP only after the caller
 * proves possession of SONIC_ENGINE_SECRET. Invalid values fall back to
 * "unknown" so they cannot be used to escape a rate-limit bucket.
 */
export function getForwardedClientIp(request: Request, env?: AppEnv): string {
  if (!hasValidEngineSecret(request, env)) return 'unknown';
  const raw = request.headers.get('X-Sonic-Client-IP')?.trim() || '';
  if (!raw || !isIpLiteral(raw)) return 'unknown';
  return raw;
}

/** @deprecated Use getPublicClientIp() or getForwardedClientIp(). */
export function extractClientIp(request: Request): string {
  return getPublicClientIp(request);
}

// ── Sliding-Window Rate Limiter ──

interface WindowCounter {
  count: number;
  resetAt: number;
}

interface RateLimitDecision {
  allowed: boolean;
  tier: 'engine' | 'api-key' | 'anonymous';
  limit: number;
  remaining: number;
  resetSec: number;
}

export type { RateLimitDecision };

const rateBuckets = new Map<string, WindowCounter>();
const MAX_RATE_BUCKETS = 4096;
const RATE_WINDOW_MS = 60_000;
const MAX_RPM = 100_000;

function parseRpm(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(MAX_RPM, Math.max(1, parsed));
}

function incrementMemoryBucket(bucketKey: string, now: number): WindowCounter {
  let entry = rateBuckets.get(bucketKey);
  if (!entry || now >= entry.resetAt) {
    if (rateBuckets.size >= MAX_RATE_BUCKETS) {
      for (const [key, value] of rateBuckets) {
        if (now >= value.resetAt) rateBuckets.delete(key);
        if (rateBuckets.size < MAX_RATE_BUCKETS - 256) break;
      }
      while (rateBuckets.size >= MAX_RATE_BUCKETS) {
        const oldest = rateBuckets.keys().next().value;
        if (typeof oldest !== 'string') break;
        rateBuckets.delete(oldest);
      }
    }
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(bucketKey, entry);
  }
  entry.count += 1;
  return entry;
}

async function incrementKvBucket(
  kv: any,
  bucketKey: string,
  now: number,
): Promise<WindowCounter | null> {
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return null;
  const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  const key = `sonic:rl:${windowStart}:${sha256Hex(bucketKey).slice(0, 32)}`;
  try {
    const raw = await kv.get(key);
    const previous = Number.parseInt(String(raw ?? '0'), 10);
    const count = (Number.isFinite(previous) && previous > 0 ? previous : 0) + 1;
    await kv.put(key, String(count), {
      expirationTtl: Math.max(60, Math.ceil((RATE_WINDOW_MS * 2) / 1000)),
    });
    return { count, resetAt: windowStart + RATE_WINDOW_MS };
  } catch {
    // KV is best-effort; never fail open the request path, fall back to memory.
    return null;
  }
}

export async function evaluateGatewayRateLimit(
  request: Request,
  env?: AppEnv,
  scope = 'api',
): Promise<RateLimitDecision> {
  const now = Date.now();
  const isEngineCaller = hasValidEngineSecret(request, env);
  const ip = isEngineCaller ? getForwardedClientIp(request, env) : getPublicClientIp(request);

  let tier: 'engine' | 'api-key' | 'anonymous' = 'anonymous';
  let limit = parseRpm(env?.SONIC_RATE_LIMIT_ANON_RPM, 240);
  let subject = `anon:${ip}`;

  if (isEngineCaller) {
    tier = 'engine';
    limit = Math.min(MAX_RPM, Math.max(600, limit * 2));
    subject = `engine:${ip}`;
  } else {
    const authResult = await verifyAuth(request, env || {});
    if (authResult.authenticated && authResult.user) {
      tier = 'api-key';
      limit = parseRpm(env?.SONIC_RATE_LIMIT_AUTH_RPM, 600);
      // Use the email from the verified payload, never a caller-supplied value.
      subject = `user:${authResult.user.email}`;
    } else if (isEnvEnabled(env?.SONIC_REQUIRE_AUTH, false)) {
      return {
        allowed: false,
        tier: 'anonymous',
        limit: 0,
        remaining: 0,
        resetSec: 60,
      };
    }
  }

  const bucketKey = `${scope}:${subject}`;
  const kvCounter = await incrementKvBucket(env?.SONIC_RATE_LIMIT_KV, bucketKey, now);
  const entry = kvCounter || incrementMemoryBucket(bucketKey, now);
  const remaining = Math.max(0, limit - entry.count);
  const resetSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

  return {
    allowed: entry.count <= limit,
    tier,
    limit,
    remaining,
    resetSec,
  };
}

export function buildRateLimitErrorResponse(decision: RateLimitDecision): Response {
  const isAuthRequired = decision.limit === 0;
  return jsonResponse(
    {
      brand: 'Sonic',
      error: {
        code: isAuthRequired ? 'AUTH_REQUIRED' : 'RATE_LIMITED',
        message: isAuthRequired
          ? 'API key is required (pass X-Sonic-Key or X-CFSolara-Key or Authorization: Bearer)'
          : `Rate limit exceeded for tier '${decision.tier}' (${decision.limit} req/min)`,
      },
    },
    {
      status: isAuthRequired ? 401 : 429,
      headers: {
        'Retry-After': String(decision.resetSec),
        'X-RateLimit-Limit': String(decision.limit),
        'X-RateLimit-Remaining': String(decision.remaining),
        'X-RateLimit-Reset': String(decision.resetSec),
        'X-RateLimit-Tier': decision.tier,
      },
    },
  );
}

export function resetRateLimitsForTest(): void {
  rateBuckets.clear();
}
