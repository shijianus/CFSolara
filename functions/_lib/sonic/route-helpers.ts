// Sonic Gateway — Route Helpers for Pages Functions
// Unified HTTP handling, query parsing, and Cloudflare Cache API integration

import type { SonicQueryParams, SonicMeta, SonicErrorResponse } from './types';
import { jsonResponse, handleOptions } from '../http';

export { handleOptions };

export function parseLyricsParams(url: URL): SonicQueryParams {
  const title = url.searchParams.get('title')?.trim() || url.searchParams.get('name')?.trim() || undefined;
  const artist = url.searchParams.get('artist')?.trim() || url.searchParams.get('singer')?.trim() || undefined;
  const album = url.searchParams.get('album')?.trim() || undefined;
  const durationStr = url.searchParams.get('duration');
  const duration = durationStr ? parseFloat(durationStr) : undefined;
  const ncmMusicId = url.searchParams.get('ncmMusicId')?.trim() || undefined;
  const qqMusicId = url.searchParams.get('qqMusicId')?.trim() || undefined;
  const appleMusicId = url.searchParams.get('appleMusicId')?.trim() || undefined;
  const spotifyId = url.searchParams.get('spotifyId')?.trim() || undefined;
  const isrc = url.searchParams.get('isrc')?.trim() || undefined;
  const platform = url.searchParams.get('platform')?.trim() || undefined;
  const platformId = url.searchParams.get('platformId')?.trim() || undefined;
  const prefer = (url.searchParams.get('prefer')?.trim() || 'auto') as any;
  const nocache = url.searchParams.has('nocache') || url.searchParams.has('_t');

  return {
    title,
    artist,
    album,
    duration,
    ncmMusicId,
    qqMusicId,
    appleMusicId,
    spotifyId,
    isrc,
    platform,
    platformId,
    prefer,
    nocache,
  };
}

export function parseSearchParams(url: URL): {
  query: string;
  page: number;
  count: number;
  nocache: boolean;
} {
  const query = (
    url.searchParams.get('q') ||
    url.searchParams.get('keyword') ||
    url.searchParams.get('name') ||
    url.searchParams.get('s') ||
    ''
  ).trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const count = Math.min(50, Math.max(1, parseInt(url.searchParams.get('count') || url.searchParams.get('limit') || '20', 10) || 20));
  const nocache = url.searchParams.has('nocache') || url.searchParams.has('_t');

  return { query, page, count, nocache };
}

export function sonicError(code: string, message: string, status = 400, meta?: Partial<SonicMeta>): Response {
  const body: SonicErrorResponse = {
    brand: 'Sonic',
    error: {
      code,
      message,
    },
    meta: {
      cached: false,
      cacheLevel: 'none',
      latencyMs: 0,
      provider: 'none',
      attempts: [],
      ...meta,
    },
  };
  return jsonResponse(body, {
    status,
    headers: {
      'Cache-Control': 'public, max-age=30',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function handleSingleProviderLyricsRequest(
  providerName: string,
  request: Request,
  env: any,
  waitUntil?: (promise: Promise<any>) => void,
): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse({ brand: 'Sonic', error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }, { status: 405 });
  }

  const p = providerName.toLowerCase();
  const url = new URL(request.url);
  const params = parseLyricsParams(url);

  // Special handling for optional providers without credentials
  if (p === 'apple') {
    const isEnabled = env?.SONIC_ENABLE_APPLE === '1' || env?.SONIC_ENABLE_APPLE === 'true';
    if (!isEnabled || !env?.SONIC_APPLE_MUSIC_TOKEN) {
      return sonicError(
        'PROVIDER_DISABLED',
        'Apple Music lyrics provider is disabled or missing credentials (SONIC_ENABLE_APPLE=1 / SONIC_APPLE_MUSIC_TOKEN)',
        501,
        {
          provider: 'apple',
          attempts: [{ provider: 'apple', ok: false, ms: 0, error: 'Disabled or missing credentials' }],
        },
      );
    }
  }

  if (p === 'ytmusic' || p === 'youtube') {
    const isEnabled = env?.SONIC_ENABLE_YTMUSIC === '1' || env?.SONIC_ENABLE_YTMUSIC === 'true';
    if (!isEnabled) {
      return sonicError(
        'PROVIDER_DISABLED',
        'YouTube Music lyrics provider is disabled or missing credentials (SONIC_ENABLE_YTMUSIC=1)',
        501,
        {
          provider: 'ytmusic',
          attempts: [{ provider: 'ytmusic', ok: false, ms: 0, error: 'Disabled or missing credentials' }],
        },
      );
    }
  }

  // Validate parameters
  const hasId = params.ncmMusicId || params.qqMusicId || params.appleMusicId || params.spotifyId || params.isrc || params.platformId;
  if (!params.title && !params.artist && !hasId) {
    return sonicError('MISSING_PARAMS', 'At least one of: title, artist, or platformId is required', 400, {
      provider: p,
    });
  }

  // Caching
  const cache = typeof caches !== 'undefined' ? (caches as any).default : null;
  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.searchParams.sort();
  cacheKeyUrl.searchParams.set('_sonic_prov_v', `${p}_v3.0`);
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

  if (cache && !params.nocache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const body = (await cached.json()) as any;
        body.meta.cached = true;
        body.meta.cacheLevel = 'cf-cache';
        return jsonResponse(body, {
          status: 200,
          headers: {
            'Cache-Control': 'public, max-age=86400, s-maxage=86400',
            'X-Sonic-Cache': 'HIT',
            'X-Sonic-Provider': p,
          },
        });
      }
    } catch {}
  }

  const { getProvider } = await import('./providers');
  const adapter = getProvider(p);
  if (!adapter || !adapter.getLyrics) {
    return sonicError('UNSUPPORTED_PROVIDER', `Provider '${providerName}' is not supported`, 404, {
      provider: p,
    });
  }

  const startTime = Date.now();
  try {
    const { getSonicConfig } = await import('./config');
    const config = getSonicConfig(env);
    const timeoutSignal = AbortSignal.timeout(config.timeoutMs);

    const result = await adapter.getLyrics(params, { env, signal: timeoutSignal });
    const latencyMs = Date.now() - startTime;

    if (!result) {
      const emptyResp = {
        brand: 'Sonic',
        data: {
          provider: p,
          level: 'none',
          sourceQuality: 'none',
          track: {
            title: params.title || '',
            artist: params.artist || '',
            album: params.album || '',
            isrc: params.isrc || '',
          },
          plainLyrics: '',
          syncedLyrics: [],
          rawTtml: '',
          ttmlMetadata: {},
          instrumental: false,
          sourceId: params.platformId || '',
          sourceUrl: '',
        },
        meta: {
          cached: false,
          cacheLevel: 'none',
          qualityScore: 0,
          matchLevel: 'NONE',
          matchScore: 0,
          latencyMs,
          requested: params.prefer || 'auto',
          provider: p,
          attempts: [{ provider: p, ok: false, ms: latencyMs, error: 'No lyrics found for this query' }],
        },
      };
      return jsonResponse(emptyResp, { status: 200, headers: { 'Cache-Control': 'public, max-age=60' } });
    }

    const response = {
      brand: 'Sonic',
      data: result.data,
      meta: {
        cached: false,
        cacheLevel: 'none',
        qualityScore: result.qualityScore,
        matchLevel: result.matchLevel,
        matchScore: result.matchScore,
        latencyMs,
        requested: params.prefer || 'auto',
        provider: p,
        attempts: [{ provider: p, ok: true, ms: latencyMs }],
      },
    };

    const cacheHeaders = {
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'X-Sonic-Cache': 'MISS',
      'X-Sonic-Provider': p,
      'X-Sonic-Level': result.data.level,
    };

    const resp = jsonResponse(response, { status: 200, headers: cacheHeaders });

    if (cache && resp.status === 200 && result.data.level !== 'none' && !params.nocache) {
      try {
        const cachePromise = cache.put(cacheKey, resp.clone());
        if (typeof waitUntil === 'function') {
          waitUntil(cachePromise);
        } else {
          cachePromise.catch(() => {});
        }
      } catch {}
    }

    return resp;
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return sonicError('PROVIDER_ERROR', err?.message || `Failed to fetch lyrics from ${p}`, 502, {
      provider: p,
      latencyMs,
      attempts: [{ provider: p, ok: false, ms: latencyMs, error: err?.message }],
    });
  }
}

export async function handleNexusSearchRequest(
  request: Request,
  env: any,
  waitUntil?: (promise: Promise<any>) => void,
): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse({ brand: 'Sonic', error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }, { status: 405 });
  }

  const url = new URL(request.url);
  const { query, page, count, nocache } = parseSearchParams(url);

  if (!query) {
    return sonicError('MISSING_QUERY', 'Missing search keyword (Parameter q or keyword is required)', 400, {
      provider: 'nexus',
    });
  }

  // Cloudflare Cache API
  const cache = typeof caches !== 'undefined' ? (caches as any).default : null;
  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.searchParams.sort();
  cacheKeyUrl.searchParams.set('_sonic_search_v', '2.0');
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

  if (cache && !nocache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const body = (await cached.json()) as any;
        body.meta.cached = true;
        body.meta.cacheLevel = 'cf-cache';
        return jsonResponse(body, {
          status: 200,
          headers: {
            'Cache-Control': 'public, max-age=3600, s-maxage=3600',
            'X-Sonic-Cache': 'HIT',
            'X-Sonic-Provider': 'nexus',
          },
        });
      }
    } catch {}
  }

  const startTime = Date.now();
  try {
    const { searchNexus } = await import('./nexus-search');
    const result = await searchNexus(query, { page, count }, env);
    const latencyMs = Date.now() - startTime;

    const response = {
      brand: 'Sonic',
      data: result.data,
      meta: {
        cached: false,
        cacheLevel: 'none',
        latencyMs,
        provider: 'nexus',
        attempts: result.attempts,
      },
    };

    const cacheHeaders = {
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'X-Sonic-Cache': 'MISS',
      'X-Sonic-Provider': 'nexus',
    };

    const resp = jsonResponse(response, { status: 200, headers: cacheHeaders });

    if (cache && resp.status === 200 && result.data.tracks.length > 0 && !nocache) {
      try {
        const cachePromise = cache.put(cacheKey, resp.clone());
        if (typeof waitUntil === 'function') {
          waitUntil(cachePromise);
        } else {
          cachePromise.catch(() => {});
        }
      } catch {}
    }

    return resp;
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return sonicError('SEARCH_ERROR', err?.message || 'Nexus search failed', 502, {
      provider: 'nexus',
      latencyMs,
    });
  }
}

export async function handleSingleProviderSearchRequest(
  providerName: string,
  request: Request,
  env: any,
  waitUntil?: (promise: Promise<any>) => void,
): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse({ brand: 'Sonic', error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }, { status: 405 });
  }

  const p = providerName.toLowerCase();
  const url = new URL(request.url);
  const { query, page, count, nocache } = parseSearchParams(url);

  if (!query) {
    return sonicError('MISSING_QUERY', 'Missing search keyword (Parameter q or keyword is required)', 400, {
      provider: p,
    });
  }

  // Caching
  const cache = typeof caches !== 'undefined' ? (caches as any).default : null;
  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.searchParams.sort();
  cacheKeyUrl.searchParams.set('_sonic_search_prov_v', p);
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

  if (cache && !nocache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const body = (await cached.json()) as any;
        body.meta.cached = true;
        body.meta.cacheLevel = 'cf-cache';
        return jsonResponse(body, {
          status: 200,
          headers: {
            'Cache-Control': 'public, max-age=3600, s-maxage=3600',
            'X-Sonic-Cache': 'HIT',
            'X-Sonic-Provider': p,
          },
        });
      }
    } catch {}
  }

  const { getProvider } = await import('./providers');
  const adapter = getProvider(p);
  if (!adapter || !adapter.search) {
    return sonicError('UNSUPPORTED_PROVIDER', `Search provider '${providerName}' is not supported`, 404, {
      provider: p,
    });
  }

  const startTime = Date.now();
  try {
    const { getSonicConfig } = await import('./config');
    const config = getSonicConfig(env);
    const timeoutSignal = AbortSignal.timeout(config.timeoutMs);

    const tracks = await adapter.search(query, { page, count, env, signal: timeoutSignal, platform: p });
    const latencyMs = Date.now() - startTime;

    const response = {
      brand: 'Sonic',
      data: {
        query,
        page,
        count: tracks.length,
        total: tracks.length,
        tracks,
      },
      meta: {
        cached: false,
        cacheLevel: 'none',
        latencyMs,
        provider: p,
        attempts: [{ provider: p, ok: true, ms: latencyMs }],
      },
    };

    const cacheHeaders = {
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'X-Sonic-Cache': 'MISS',
      'X-Sonic-Provider': p,
    };

    const resp = jsonResponse(response, { status: 200, headers: cacheHeaders });

    if (cache && resp.status === 200 && tracks.length > 0 && !nocache) {
      try {
        const cachePromise = cache.put(cacheKey, resp.clone());
        if (typeof waitUntil === 'function') {
          waitUntil(cachePromise);
        } else {
          cachePromise.catch(() => {});
        }
      } catch {}
    }

    return resp;
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return sonicError('PROVIDER_SEARCH_ERROR', err?.message || `Search failed on ${p}`, 502, {
      provider: p,
      latencyMs,
      attempts: [{ provider: p, ok: false, ms: latencyMs, error: err?.message }],
    });
  }
}


