// Linux engine only — DNS resolution guard for caller-supplied URLs.
// The shared SSRF validator rejects IP literals and private hostnames before
// any fetch. This module additionally resolves hostnames and rejects any
// result that points at a private/link-local/loopback address, which blunts
// DNS-rebinding style bypasses.

import dns from 'node:dns/promises';
import type { AppEnv } from '../functions/_lib/types';
import {
  isBlockedIpLiteral,
  normalizeHostname,
  validateOutboundUrl,
} from '../functions/_lib/sonic/net-guard';

interface DnsCacheEntry {
  expiresAt: number;
  blocked: boolean;
  reason?: string;
}

const dnsCache = new Map<string, DnsCacheEntry>();
const DNS_CACHE_TTL_MS = 60_000;
const DNS_CACHE_MAX = 512;

export interface EngineTargetValidation {
  ok: boolean;
  reason?: string;
}

export async function validateEngineOutboundTarget(
  rawUrl: string,
  env?: AppEnv,
): Promise<EngineTargetValidation> {
  const validation = validateOutboundUrl(rawUrl, env);
  if (!validation.ok || !validation.url) {
    return { ok: false, reason: validation.reason || 'invalid_url' };
  }

  const host = normalizeHostname(validation.url.hostname);
  const now = Date.now();
  const cached = dnsCache.get(host);
  if (cached && cached.expiresAt > now) {
    return cached.blocked ? { ok: false, reason: cached.reason } : { ok: true };
  }

  let blocked = false;
  let reason: string | undefined;

  try {
    const addresses = await dns.lookup(host, { all: true, verbatim: true });
    if (!addresses || addresses.length === 0) {
      blocked = true;
      reason = 'dns_lookup_empty';
    } else {
      for (const entry of addresses) {
        if (isBlockedIpLiteral(entry.address)) {
          blocked = true;
          reason = 'dns_private_ip';
          break;
        }
      }
    }
  } catch {
    // Fail closed: if we cannot prove the destination is public, reject it.
    blocked = true;
    reason = 'dns_lookup_failed';
  }

  if (dnsCache.size >= DNS_CACHE_MAX) {
    for (const [key, value] of dnsCache) {
      if (value.expiresAt <= now) dnsCache.delete(key);
    }
    while (dnsCache.size >= DNS_CACHE_MAX) {
      const oldest = dnsCache.keys().next().value;
      if (typeof oldest !== 'string') break;
      dnsCache.delete(oldest);
    }
  }
  dnsCache.set(host, { expiresAt: now + DNS_CACHE_TTL_MS, blocked, reason });

  return blocked ? { ok: false, reason } : { ok: true };
}

export function clearDnsGuardCacheForTest(): void {
  dnsCache.clear();
}
