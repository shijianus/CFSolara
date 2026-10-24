// Sonic Gateway — Unified Multi-Tier Cache with `sonic:` Prefix & Stale-If-Error Support
// Works across Cloudflare Edge Cache API (`caches.default`), optional Workers KV (`env.KV`), and Linux Node 22 LRU memory.

import type { AppEnv } from '../types';
import type { SonicCacheLevel } from './types';

interface MemoryCacheEntry {
  json: string;
  freshUntil: number;
  staleUntil: number;
}

const MAX_MEMORY_ENTRIES = 1500;
const memoryLru = new Map<string, MemoryCacheEntry>();

function touchMemoryLru(key: string, entry: MemoryCacheEntry): void {
  if (memoryLru.has(key)) {
    memoryLru.delete(key);
  } else if (memoryLru.size >= MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryLru.keys().next().value;
    if (oldestKey !== undefined) {
      memoryLru.delete(oldestKey);
    }
  }
  memoryLru.set(key, entry);
}

export function buildSonicCacheKey(namespace: string, identifier: string): string {
  const cleanId = identifier.trim().replace(/\s+/g, '_');
  return `sonic:${namespace}:${cleanId}`;
}

function getEdgeCache(): any | null {
  try {
    return typeof caches !== 'undefined' ? (caches as any).default || null : null;
  } catch {
    return null;
  }
}

function toSyntheticCacheRequest(sonicKey: string, tier: 'fresh' | 'stale'): Request {
  const encoded = encodeURIComponent(sonicKey);
  return new Request(`https://sonic-cache.internal/${tier}/${encoded}`, { method: 'GET' });
}

export interface CacheHitResult<T> {
  value: T;
  cacheLevel: SonicCacheLevel;
  stale: boolean;
  key: string;
}

export async function getSonicCachedJson<T>(
  namespace: string,
  identifier: string,
  env?: AppEnv,
  options?: { allowStale?: boolean },
): Promise<CacheHitResult<T> | null> {
  const key = buildSonicCacheKey(namespace, identifier);
  const now = Date.now();
  const allowStale = Boolean(options?.allowStale);

  // 1. Fast in-memory LRU check (active on Linux Engine & warm Workers isolate)
  const mem = memoryLru.get(key);
  if (mem) {
    if (now <= mem.freshUntil) {
      touchMemoryLru(key, mem);
      try {
        return { value: JSON.parse(mem.json) as T, cacheLevel: 'memory', stale: false, key };
      } catch {
        memoryLru.delete(key);
      }
    } else if (allowStale && now <= mem.staleUntil) {
      try {
        return { value: JSON.parse(mem.json) as T, cacheLevel: 'memory-stale', stale: true, key };
      } catch {
        memoryLru.delete(key);
      }
    } else if (now > mem.staleUntil) {
      memoryLru.delete(key);
    }
  }

  // 2. Cloudflare Edge Cache API (`caches.default`)
  const edgeCache = getEdgeCache();
  if (edgeCache) {
    try {
      const freshHit = await edgeCache.match(toSyntheticCacheRequest(key, 'fresh'));
      if (freshHit) {
        const value = (await freshHit.json()) as T;
        return { value, cacheLevel: 'cf-cache', stale: false, key };
      }
      if (allowStale) {
        const staleHit = await edgeCache.match(toSyntheticCacheRequest(key, 'stale'));
        if (staleHit) {
          const value = (await staleHit.json()) as T;
          return { value, cacheLevel: 'cf-cache-stale', stale: true, key };
        }
      }
    } catch {}
  }

  // 3. Optional KV binding (`sonic:` prefix)
  if (env?.KV && typeof env.KV.get === 'function') {
    try {
      const raw = await env.KV.get(key);
      if (raw) {
        const parsed = JSON.parse(raw) as { v: T; f: number; s: number };
        if (parsed && now <= parsed.f) {
          return { value: parsed.v, cacheLevel: 'kv', stale: false, key };
        }
        if (allowStale && parsed && now <= parsed.s) {
          return { value: parsed.v, cacheLevel: 'kv', stale: true, key };
        }
      }
    } catch {}
  }

  return null;
}

export async function putSonicCachedJson<T>(
  namespace: string,
  identifier: string,
  value: T,
  freshTtlSec: number,
  staleTtlSec: number,
  env?: AppEnv,
  waitUntil?: (promise: Promise<any>) => void,
): Promise<void> {
  const key = buildSonicCacheKey(namespace, identifier);
  const now = Date.now();
  const effectiveStaleSec = Math.max(freshTtlSec, staleTtlSec);
  const json = JSON.stringify(value);

  // 1. Populate bounded in-memory LRU
  touchMemoryLru(key, {
    json,
    freshUntil: now + freshTtlSec * 1000,
    staleUntil: now + effectiveStaleSec * 1000,
  });

  const tasks: Promise<any>[] = [];

  // 2. Populate Cloudflare Edge Cache (fresh + stale backup)
  const edgeCache = getEdgeCache();
  if (edgeCache) {
    tasks.push(
      edgeCache
        .put(
          toSyntheticCacheRequest(key, 'fresh'),
          new Response(json, {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': `public, max-age=${freshTtlSec}, s-maxage=${freshTtlSec}`,
            },
          }),
        )
        .catch(() => {}),
    );
    if (effectiveStaleSec > freshTtlSec) {
      tasks.push(
        edgeCache
          .put(
            toSyntheticCacheRequest(key, 'stale'),
            new Response(json, {
              status: 200,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': `public, max-age=${effectiveStaleSec}, s-maxage=${effectiveStaleSec}`,
              },
            }),
          )
          .catch(() => {}),
      );
    }
  }

  // 3. Optional KV write
  if (env?.KV && typeof env.KV.put === 'function') {
    tasks.push(
      env.KV.put(
        key,
        JSON.stringify({ v: value, f: now + freshTtlSec * 1000, s: now + effectiveStaleSec * 1000 }),
        { expirationTtl: effectiveStaleSec },
      ).catch(() => {}),
    );
  }

  if (tasks.length > 0) {
    const all = Promise.allSettled(tasks);
    if (typeof waitUntil === 'function') {
      waitUntil(all);
    } else {
      await all;
    }
  }
}

export function clearSonicMemoryCacheForTest(): void {
  memoryLru.clear();
}
