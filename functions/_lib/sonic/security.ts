// Sonic Gateway — Inter-Service Authentication & Tiered Rate Limiter
// Enforces:
// 1. Mandatory constant-time X-Sonic-Engine-Key verification on `engine-sonic.*` and internal engine endpoints
// 2. Sliding-window rate limiting at both Edge (Pages -> Engine hop protection) and Engine layers
// 3. SSRF Triple Validation: Protocol (https only), Port (80/443), Host canonicalization (IPv4/IPv6/domain whitelist)

import type { AppEnv } from '../types';
import { verifyAuth } from '../auth';
import { isEnvEnabled } from './config';
import { jsonResponse } from '../http';
import { sha256Bytes } from './crypto';

export const SONIC_ALLOWED_MUSIC_DOMAINS = [
  'music.126.net',
  '163.com',
  'music.163.com',
  'qq.com',
  'y.qq.com',
  'gtimg.cn',
  'qpic.cn',
  'kugou.com',
  'kuwo.cn',
  'lrclib.net',
  'amll.dev',
  'lyriva.xyz',
  'gdstudio.xyz',
];

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) {
    return false;
  }
  // Pre-hash both strings to 32 bytes to ensure equal comparison length and avoid leaking string lengths
  const hashA = sha256Bytes(a);
  const hashB = sha256Bytes(b);
  let diff = 0;
  for (let i = 0; i < 32; i++) {
    diff |= hashA[i] ^ hashB[i];
  }
  return diff === 0 && a === b;
}

export function hasValidEngineSecret(request: Request, env?: AppEnv): boolean {
  const configured = env?.SONIC_ENGINE_SECRET ? String(env.SONIC_ENGINE_SECRET).trim() : '';
  if (!configured || configured.length < 32) return false;
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
  // Do NOT rely on x-forwarded-host or host headers which can be forged by clients
  const cleanHost = url.hostname.toLowerCase();
  const expectedEngineHost = env?.SONIC_ENGINE_HOST
    ? String(env.SONIC_ENGINE_HOST).toLowerCase().trim()
    : '';

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
  if (!configured || configured.length < 32) {
    console.error(
      '[Sonic Engine Access] SONIC_ENGINE_SECRET is missing or shorter than 32 characters; rejecting access (fail closed)',
    );
    return jsonResponse(
      {
        brand: 'Sonic',
        error: {
          code: 'ENGINE_MISCONFIGURED',
          message: 'Engine secret is not configured or shorter than 32 characters; anonymous access to engine endpoint is forbidden',
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

// ── IP Extraction and Validation ──

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_REGEX = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/;

export function isValidIpLiteral(ip: string): boolean {
  const trimmed = ip.trim().replace(/^\[|\]$/g, '');
  return IPV4_REGEX.test(trimmed) || IPV6_REGEX.test(trimmed);
}

export function getPublicClientIp(request: Request): string {
  const cfIp = request.headers.get('CF-Connecting-IP')?.trim();
  if (cfIp && isValidIpLiteral(cfIp)) {
    return cfIp.replace(/^\[|\]$/g, '');
  }
  return 'unknown';
}

export function getForwardedClientIp(request: Request, env?: AppEnv): string {
  if (!hasValidEngineSecret(request, env)) {
    return 'unknown';
  }
  const forwarded = request.headers.get('X-Sonic-Client-IP')?.trim();
  if (forwarded && isValidIpLiteral(forwarded)) {
    return forwarded.replace(/^\[|\]$/g, '');
  }
  return 'unknown';
}

export function extractClientIp(request: Request, env?: AppEnv): string {
  return hasValidEngineSecret(request, env)
    ? getForwardedClientIp(request, env)
    : getPublicClientIp(request);
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

export async function evaluateGatewayRateLimit(
  request: Request,
  env?: AppEnv,
  scope = 'api',
): Promise<RateLimitDecision> {
  const now = Date.now();
  const windowMs = 60_000;

  const isEngineCaller = hasValidEngineSecret(request, env);
  const ip = isEngineCaller ? getForwardedClientIp(request, env) : getPublicClientIp(request);

  let tier: 'engine' | 'api-key' | 'anonymous' = 'anonymous';
  // Clamp configured limits to safe range [1, 10000]
  let limit = Math.min(
    10000,
    Math.max(1, parseInt(String(env?.SONIC_RATE_LIMIT_ANON_RPM || '240'), 10) || 240),
  );
  let subject = `anon:${ip}`;

  if (isEngineCaller) {
    tier = 'engine';
    limit = Math.min(20000, Math.max(limit * 2, 600));
    subject = `engine:${ip}`;
  } else {
    const authResult = await verifyAuth(request, env || {});
    if (authResult.authenticated && authResult.user) {
      tier = 'api-key';
      limit = Math.min(
        10000,
        Math.max(1, parseInt(String(env?.SONIC_RATE_LIMIT_AUTH_RPM || '600'), 10) || 600),
      );
      subject = `user:${authResult.user.email.toLowerCase()}`;
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

  // Optional Cloudflare KV Rate Limiting binding
  const kv = env?.RATE_LIMIT_KV || env?.KV;
  if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') {
    try {
      const windowMinute = Math.floor(now / windowMs);
      const kvKey = `rl:${bucketKey}:${windowMinute}`;
      const currentCount = parseInt((await kv.get(kvKey)) || '0', 10) || 0;
      const nextCount = currentCount + 1;
      const resetSec = Math.max(1, 60 - (Math.floor(now / 1000) % 60));
      await kv.put(kvKey, String(nextCount), { expirationTtl: 120 });
      return {
        allowed: nextCount <= limit,
        tier,
        limit,
        remaining: Math.max(0, limit - nextCount),
        resetSec,
      };
    } catch (kvErr) {
      console.warn('[Sonic RateLimit] KV rate limiter fallback to in-memory', kvErr);
    }
  }

  // Fallback: In-memory sliding window
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

// ── SSRF Triple Validation & Canonicalization ──

export function parseIpv4ToUint32(host: string): number | null {
  const clean = host.trim().replace(/\.+$/, '');
  const parts = clean.split('.');
  if (parts.length < 1 || parts.length > 4) return null;

  const parsedParts: number[] = [];
  for (const part of parts) {
    if (!part) return null;
    let n: number;
    if (/^0x[0-9a-fA-F]+$/i.test(part)) {
      n = parseInt(part, 16);
    } else if (/^0[0-7]+$/.test(part)) {
      n = parseInt(part, 8);
    } else if (/^[0-9]+$/.test(part)) {
      n = parseInt(part, 10);
    } else {
      return null;
    }
    if (!Number.isFinite(n) || n < 0) return null;
    parsedParts.push(n);
  }

  let ipInt = 0;
  if (parsedParts.length === 1) {
    if (parsedParts[0] > 0xffffffff) return null;
    ipInt = parsedParts[0] >>> 0;
  } else if (parsedParts.length === 2) {
    if (parsedParts[0] > 0xff || parsedParts[1] > 0xffffff) return null;
    ipInt = ((parsedParts[0] << 24) | parsedParts[1]) >>> 0;
  } else if (parsedParts.length === 3) {
    if (parsedParts[0] > 0xff || parsedParts[1] > 0xff || parsedParts[2] > 0xffff) return null;
    ipInt = ((parsedParts[0] << 24) | (parsedParts[1] << 16) | parsedParts[2]) >>> 0;
  } else if (parsedParts.length === 4) {
    if (
      parsedParts[0] > 0xff ||
      parsedParts[1] > 0xff ||
      parsedParts[2] > 0xff ||
      parsedParts[3] > 0xff
    )
      return null;
    ipInt =
      ((parsedParts[0] << 24) |
        (parsedParts[1] << 16) |
        (parsedParts[2] << 8) |
        parsedParts[3]) >>>
      0;
  } else {
    return null;
  }
  return ipInt;
}

export function isBlockedIpv4(ipInt: number): boolean {
  // 0.0.0.0/8 (Current network)
  if ((ipInt >>> 24) === 0) return true;
  // 10.0.0.0/8 (Private RFC1918)
  if ((ipInt >>> 24) === 10) return true;
  // 100.64.0.0/10 (Shared Address Space / CGNAT)
  if ((ipInt & 0xffc00000) >>> 0 === 0x64400000) return true;
  // 127.0.0.0/8 (Loopback)
  if ((ipInt >>> 24) === 127) return true;
  // 169.254.0.0/16 (Link Local / Cloud Metadata 169.254.169.254)
  if ((ipInt & 0xffff0000) >>> 0 === 0xa9fe0000) return true;
  // 172.16.0.0/12 (Private RFC1918)
  if ((ipInt & 0xfff00000) >>> 0 === 0xac100000) return true;
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if ((ipInt & 0xffffff00) >>> 0 === 0xc0000000) return true;
  // 192.0.2.0/24 (TEST-NET-1)
  if ((ipInt & 0xffffff00) >>> 0 === 0xc0000200) return true;
  // 192.88.99.0/24 (6to4 Relay Anycast)
  if ((ipInt & 0xffffff00) >>> 0 === 0xc0586300) return true;
  // 192.168.0.0/16 (Private RFC1918)
  if ((ipInt & 0xffff0000) >>> 0 === 0xc0a80000) return true;
  // 198.18.0.0/15 (Network Interconnect Benchmark Testing)
  if ((ipInt & 0xfffe0000) >>> 0 === 0xc6120000) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if ((ipInt & 0xffffff00) >>> 0 === 0xc6336400) return true;
  // 224.0.0.0/4 (Multicast 224-239) and 240.0.0.0/4 (Reserved / Broadcast 240-255)
  if ((ipInt >>> 28) >= 14) return true;

  return false;
}

export function isBlockedIpv6(host: string): boolean {
  const clean = host.toLowerCase().trim().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!clean || clean === '::' || clean === '::0') return true;
  if (clean === '::1' || clean === '0:0:0:0:0:0:0:1') return true;

  // IPv4-mapped IPv6: ::ffff:127.0.0.1 or 0:0:0:0:0:ffff:127.0.0.1
  const mappedIpv4Match = clean.match(/^(?:0*:){0,5}(?:ffff|0*ffff):([0-9a-fA-F.:]+)$/i);
  if (mappedIpv4Match) {
    const sub = mappedIpv4Match[1];
    if (sub.includes('.')) {
      const parsed = parseIpv4ToUint32(sub);
      if (parsed !== null) return isBlockedIpv4(parsed);
    } else if (sub.includes(':')) {
      const parts = sub.split(':');
      if (parts.length === 2) {
        const high = parseInt(parts[0], 16);
        const low = parseInt(parts[1], 16);
        if (Number.isFinite(high) && Number.isFinite(low)) {
          return isBlockedIpv4(((high << 16) | low) >>> 0);
        }
      }
    }
  }

  // fc00::/7 (Unique Local Address: fc00:: - fdff::)
  if (/^f[cd][0-9a-f]{2}:/i.test(clean) || clean.startsWith('fc') || clean.startsWith('fd')) return true;

  // fe80::/10 (Link-Local Unicast: fe80:: - febf::)
  if (/^fe[89ab][0-9a-f]:/i.test(clean) || clean.startsWith('fe80:')) return true;

  // ff00::/8 (Multicast)
  if (/^ff[0-9a-f]{2}:/i.test(clean)) return true;

  // 64:ff9b::/96 (IPv4/IPv6 translation)
  if (clean.startsWith('64:ff9b::')) {
    const after = clean.slice('64:ff9b::'.length);
    const parsed = parseIpv4ToUint32(after);
    if (parsed !== null) return isBlockedIpv4(parsed);
  }

  return false;
}

export function isBlockedSsrfHost(hostname: string): boolean {
  if (!hostname) return true;
  const h = hostname.toLowerCase().trim().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!h) return true;

  // 1. Hostname checks
  if (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.lan') ||
    h.endsWith('.corp') ||
    h.endsWith('.home') ||
    h.endsWith('.home.arpa') ||
    h.endsWith('.invalid') ||
    h.endsWith('.test') ||
    h.endsWith('.example') ||
    h.startsWith('engine-sonic.')
  ) {
    return true;
  }

  // 2. Canonical IPv4 check
  const ipv4Int = parseIpv4ToUint32(h);
  if (ipv4Int !== null) {
    return isBlockedIpv4(ipv4Int);
  }

  // 3. IPv6 check
  if (h.includes(':')) {
    return isBlockedIpv6(h);
  }

  return false;
}

export function validateSafeUrl(
  urlInput: string | URL,
  options?: {
    allowHttp?: boolean;
    allowedDomains?: string[];
  },
): { valid: boolean; url?: URL; error?: string } {
  let url: URL;
  try {
    url = typeof urlInput === 'string' ? new URL(urlInput) : urlInput;
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // 1. Protocol: https only (unless explicit allowHttp option)
  const isHttps = url.protocol === 'https:';
  const isHttp = url.protocol === 'http:';
  if (!isHttps && (!isHttp || !options?.allowHttp)) {
    return { valid: false, error: 'Only https URLs are permitted' };
  }

  // 2. Userinfo: strictly reject user:pass@
  if (url.username || url.password) {
    return { valid: false, error: 'URL userinfo is strictly forbidden' };
  }

  // 3. Port: only 443 (https) or 80 (http)
  if (url.port) {
    const portNum = parseInt(url.port, 10);
    if (isHttps && portNum !== 443) {
      return { valid: false, error: 'Non-standard port is forbidden' };
    }
    if (isHttp && portNum !== 80) {
      return { valid: false, error: 'Non-standard port is forbidden' };
    }
  }

  // 4. Host canonical SSRF check
  const hostname = url.hostname.toLowerCase().trim().replace(/\.+$/, '');
  if (isBlockedSsrfHost(hostname)) {
    return { valid: false, error: 'Destination host is forbidden by SSRF policy' };
  }

  // 5. Whitelist suffix matching (if specified)
  if (options?.allowedDomains && options.allowedDomains.length > 0) {
    const matched = options.allowedDomains.some((d) => {
      const dom = d.toLowerCase().trim().replace(/^\.+|\.+$/g, '');
      return hostname === dom || hostname.endsWith('.' + dom);
    });
    if (!matched) {
      return { valid: false, error: 'Destination host is not in allowed domain whitelist' };
    }
  }

  return { valid: true, url };
}

export async function safeFetch(
  targetUrl: string | URL,
  init?: RequestInit,
  options?: {
    allowHttp?: boolean;
    allowedDomains?: string[];
    maxRedirects?: number;
    timeoutMs?: number;
  },
): Promise<Response> {
  const maxRedirects = options?.maxRedirects ?? 3;
  const timeoutMs = options?.timeoutMs ?? 15000;
  let currentUrl = typeof targetUrl === 'string' ? targetUrl : targetUrl.toString();

  let redirectsRemaining = maxRedirects;

  while (true) {
    const valResult = validateSafeUrl(currentUrl, {
      allowHttp: options?.allowHttp,
      allowedDomains: options?.allowedDomains,
    });
    if (!valResult.valid || !valResult.url) {
      throw new Error(`SSRF check rejected: ${valResult.error}`);
    }

    // Header security: never forward client cookie or authorization to external target
    const headers = new Headers(init?.headers);
    headers.delete('cookie');
    headers.delete('authorization');
    headers.delete('x-sonic-engine-key');
    headers.delete('x-sonic-key');
    headers.delete('x-cfsolara-key');

    const signal = options?.timeoutMs
      ? AbortSignal.timeout(timeoutMs)
      : init?.signal || AbortSignal.timeout(15000);

    const resp = await fetch(valResult.url.toString(), {
      ...init,
      headers,
      redirect: 'manual',
      signal,
    });

    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const location = resp.headers.get('location');
      if (!location) {
        return resp;
      }
      if (redirectsRemaining <= 0) {
        throw new Error('Too many redirects');
      }
      redirectsRemaining--;

      const nextUrl = new URL(location, valResult.url);
      if (valResult.url.protocol === 'https:' && nextUrl.protocol === 'http:') {
        throw new Error('Protocol downgrade from https to http during redirect is forbidden');
      }
      currentUrl = nextUrl.toString();
      continue;
    }

    return resp;
  }
}
