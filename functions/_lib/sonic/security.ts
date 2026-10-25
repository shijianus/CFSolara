// Sonic Gateway — Inter-Service Authentication & Tiered Rate Limiter
// Enforces:
// 1. Mandatory constant-time X-Sonic-Engine-Key verification on `engine-sonic.*` and internal engine endpoints
// 2. Sliding-window rate limiting at both Edge (Pages -> Engine hop protection) and Engine layers

import type { AppEnv } from '../types';
import { verifyAuth } from '../auth';
import { isEnvEnabled } from './config';
import { jsonResponse } from '../http';

const encoder = new TextEncoder();

export function timingSafeEqualStr(a: string, b: string): boolean {
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

export function hasValidEngineSecret(request: Request, env?: AppEnv): boolean {
  const configured = env?.SONIC_ENGINE_SECRET ? String(env.SONIC_ENGINE_SECRET).trim() : '';
  if (!configured) return false;
  const headerKey = request.headers.get('X-Sonic-Engine-Key')?.trim() || '';
  if (headerKey && timingSafeEqualStr(headerKey, configured)) {
    return true;
  }
  return false;
}

export function requiresEngineAuth(request: Request, env?: AppEnv): boolean {
  if (isEnvEnabled(env?.SONIC_REQUIRE_ENGINE_AUTH, false)) {
    return true;
  }
  const url = new URL(request.url);
  const hostHeader = (request.headers.get('x-forwarded-host') || request.headers.get('host') || url.hostname || '').toLowerCase();
  const cleanHost = hostHeader.split(':')[0];
  const expectedEngineHost = env?.SONIC_ENGINE_HOST ? String(env.SONIC_ENGINE_HOST).toLowerCase().trim() : '';

  if (cleanHost.startsWith('engine-sonic.') || (expectedEngineHost && cleanHost === expectedEngineHost)) {
    return true;
  }
  if (url.pathname.startsWith('/api/sonic/engine/') || url.pathname.startsWith('/api/sonic/resolve/')) {
    return true;
  }
  return false;
}

export function checkEngineAccess(request: Request, env?: AppEnv): Response | null {
  if (!requiresEngineAuth(request, env)) {
    return null;
  }

  const configured = env?.SONIC_ENGINE_SECRET ? String(env.SONIC_ENGINE_SECRET).trim() : '';
  if (!configured) {
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

// ── Sliding-Window Rate Limiter ──

interface WindowCounter {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, WindowCounter>();
const MAX_RATE_BUCKETS = 4096;

export interface RateLimitDecision {
  allowed: boolean;
  tier: 'engine' | 'api-key' | 'anonymous';
  limit: number;
  remaining: number;
  resetSec: number;
}

let warnedRateLimitFallback = false;

/**
 * Resolve the client IP used for rate-limit bucketing.
 *
 * Trust chain (audit fix #2 — client IP spoofing previously rotated buckets):
 * 1. `X-Sonic-Client-IP` is honoured ONLY when the caller presents a valid
 *    `X-Sonic-Engine-Key` (i.e. it is the authenticated Pages → Engine hop
 *    forwarding the terminal user IP).
 * 2. Otherwise `CF-Connecting-IP` (set by the Cloudflare edge, not client-writable).
 * 3. Never `X-Forwarded-For` — client-forgeable on every hop we serve.
 * 4. Fallback: one fixed shared bucket, logged once. Rate limiting is
 *    per-isolate in-memory state, not a global counter (see README).
 */
export function extractClientIp(request: Request, env?: AppEnv): string {
  if (hasValidEngineSecret(request, env)) {
    const forwarded = request.headers.get('X-Sonic-Client-IP')?.trim();
    if (forwarded) return forwarded;
  }
  const cfIp = request.headers.get('CF-Connecting-IP')?.trim();
  if (cfIp) return cfIp;
  if (!warnedRateLimitFallback) {
    warnedRateLimitFallback = true;
    console.warn(
      '[Sonic Security] No CF-Connecting-IP on request; rate limiting uses one fixed fallback bucket (per-isolate memory limiter, not global).',
    );
  }
  return 'fallback:no-terminal-ip';
}

export async function evaluateGatewayRateLimit(
  request: Request,
  env?: AppEnv,
  scope = 'api',
): Promise<RateLimitDecision> {
  const now = Date.now();
  const windowMs = 60_000;

  // Trusted inter-service hop (Pages -> Engine) gets high bucket keyed by forwarded end-user IP
  const isEngineCaller = hasValidEngineSecret(request, env);
  const ip = extractClientIp(request, env);

  let tier: 'engine' | 'api-key' | 'anonymous' = 'anonymous';
  let limit = Math.max(10, parseInt(String(env?.SONIC_RATE_LIMIT_ANON_RPM || '240'), 10) || 240);
  let subject = `anon:${ip}`;

  if (isEngineCaller) {
    tier = 'engine';
    limit = Math.max(limit * 2, 600);
    subject = `engine:${ip}`;
  } else {
    const authResult = await verifyAuth(request, env || {});
    if (authResult.authenticated && authResult.user) {
      tier = 'api-key';
      limit = Math.max(30, parseInt(String(env?.SONIC_RATE_LIMIT_AUTH_RPM || '600'), 10) || 600);
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
  let entry = rateBuckets.get(bucketKey);

  if (!entry || now >= entry.resetAt) {
    if (rateBuckets.size >= MAX_RATE_BUCKETS) {
      for (const [k, v] of rateBuckets) {
        if (now >= v.resetAt) rateBuckets.delete(k);
        if (rateBuckets.size < MAX_RATE_BUCKETS - 256) break;
      }
    }
    entry = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(bucketKey, entry);
  }

  entry.count += 1;
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

export function isBlockedSsrfHost(hostname: string): boolean {
  const h = (hostname || '').toLowerCase().trim().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.startsWith('engine-sonic.')
  ) {
    return true;
  }
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  const m172 = h.match(/^172\.(\d{1,3})\./);
  if (m172) {
    const second = parseInt(m172[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (/^(fc|fd|fe80):/i.test(h)) return true;
  return false;
}
