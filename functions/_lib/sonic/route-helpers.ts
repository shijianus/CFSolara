// Sonic Gateway — Route Helpers for Pages Functions & Linux Local Engine
// Unified HTTP handling, engine auth, rate-limiting, `sonic:` multi-tier caching, and graceful degradation

import type { SonicQueryParams, SonicMeta, SonicErrorResponse } from './types';
import { jsonResponse, handleOptions } from '../http';
import { getSonicConfig } from './config';
import { getSonicCachedJson, putSonicCachedJson } from './cache';
import { checkEngineAccess, evaluateGatewayRateLimit, buildRateLimitErrorResponse } from './security';
import { callLocalEngineJson } from './local-engine';

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

export function buildGatewayHeaders(extra: Record<string, string> = {}, degraded?: boolean, circuitState?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sonic-Key, X-CFSolara-Key, X-Api-Key, X-Sonic-Engine-Key, X-Sonic-Anon-Id, X-Sonic-Personalization, X-Sonic-Context, Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, X-Sonic-Cache, X-Sonic-Provider, X-Sonic-Degraded, X-Sonic-Circuit, X-Sonic-Stream-Trial, X-RateLimit-Limit, X-RateLimit-Remaining',
    ...extra,
  };
  if (degraded) {
    headers['X-Sonic-Degraded'] = '1';
  }
  if (circuitState) {
    headers['X-Sonic-Circuit'] = circuitState;
  }
  return headers;
}

export function sonicError(code: string, message: string, status = 400, meta?: Partial<SonicMeta>): Response {
  const degraded = Boolean(meta?.degraded);
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
    headers: buildGatewayHeaders({ 'Cache-Control': 'no-store' }, degraded, meta?.circuitState),
  });
}

export async function guardGatewayRequest(request: Request, env: any, scope: string): Promise<Response | null> {
  const engineDenied = checkEngineAccess(request, env);
  if (engineDenied) return engineDenied;
  const rl = await evaluateGatewayRateLimit(request, env, scope);
  if (!rl.allowed) return buildRateLimitErrorResponse(rl);
  return null;
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

  const guardResp = await guardGatewayRequest(request, env, 'sonic-lyrics');
  if (guardResp) return guardResp;

  const p = providerName.toLowerCase();
  const url = new URL(request.url);
  const params = parseLyricsParams(url);
  const config = getSonicConfig(env);

  // Special handling for optional providers without credentials
  if (p === 'apple') {
    if (!config.enableApple || !env?.SONIC_APPLE_MUSIC_TOKEN) {
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
    if (!config.enableYtmusic) {
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

  // Disabled-by-default third-party providers (`lyriva` / `gdstudio`) return honest empty response without calling upstream
  if ((p === 'lyriva' && !config.enableLyriva) || (p === 'gdstudio' && !config.enableGdstudio)) {
    return jsonResponse(
      {
        brand: 'Sonic',
        data: {
          provider: p,
          level: 'none',
          sourceQuality: 'none',
          track: { title: params.title || '', artist: params.artist || '', album: params.album || '', isrc: params.isrc || '' },
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
          latencyMs: 0,
          provider: p,
          disabled: true,
          attempts: [
            {
              provider: p,
              via: 'third-party',
              ok: false,
              ms: 0,
              error: `Third-party provider '${p}' is disabled by default (set SONIC_ENABLE_${p.toUpperCase()}=1 to enable)`,
            },
          ],
        },
      },
      { status: 200, headers: buildGatewayHeaders({ 'Cache-Control': 'no-store' }) },
    );
  }

  const sortedQuery = new URLSearchParams(url.searchParams);
  sortedQuery.delete('nocache');
  sortedQuery.delete('_t');
  sortedQuery.sort();
  const cacheIdentifier = `${p}:${sortedQuery.toString()}`;

  if (!params.nocache) {
    const hit = await getSonicCachedJson<any>('lyrics-prov-v4', cacheIdentifier, env);
    if (hit?.value) {
      const body = { ...hit.value, meta: { ...hit.value.meta, cached: true, cacheLevel: hit.cacheLevel } };
      return jsonResponse(body, {
        status: 200,
        headers: buildGatewayHeaders({
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
          'X-Sonic-Cache': 'HIT',
          'X-Sonic-Provider': p,
        }),
      });
    }
  }

  // Try Linux Local Engine first when running on Cloudflare Pages
  let degraded = false;
  let degradedReason: string | undefined;
  let circuitState: string | undefined;
  const attemptsPrefix: any[] = [];

  if (config.enableLocalEngine && (p === 'netease' || p === 'qq' || p === 'kugou' || p === 'kuwo')) {
    const engineRes = await callLocalEngineJson<any>(`/api/sonic/lyrics/${p}?${sortedQuery.toString()}&nocache=1`, env, {
      request,
      timeoutMs: Math.min(config.engineTimeoutMs, config.timeoutMs),
    });
    circuitState = engineRes.circuitState;
    if (engineRes.ok && engineRes.data?.brand === 'Sonic' && engineRes.data?.data) {
      const body = engineRes.data;
      body.meta = {
        ...body.meta,
        cached: false,
        cacheLevel: 'none',
        provider: p,
        attempts: [
          { provider: 'local-engine', via: 'local-engine', ok: true, ms: engineRes.latencyMs },
          ...(body.meta?.attempts || []).map((a: any) => ({ ...a, via: a.via || 'local-engine' })),
        ],
      };
      if (!params.nocache && body.data.level !== 'none') {
        await putSonicCachedJson('lyrics-prov-v4', cacheIdentifier, body, 86400, 604800, env, waitUntil);
      }
      return jsonResponse(body, {
        status: 200,
        headers: buildGatewayHeaders({
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
          'X-Sonic-Cache': 'MISS',
          'X-Sonic-Provider': p,
        }),
      });
    }
    degraded = true;
    degradedReason = engineRes.error || 'local_engine_unavailable';
    attemptsPrefix.push({
      provider: 'local-engine',
      via: 'local-engine',
      ok: false,
      ms: engineRes.latencyMs,
      error: degradedReason,
    });
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
    const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
    const result = await adapter.getLyrics(params, { env, signal: timeoutSignal });
    const latencyMs = Date.now() - startTime;
    const via = config.runtime === 'linux-engine' ? 'local-engine' : 'cf-direct';

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
          ...(degraded ? { degraded: true, degradedReason, circuitState } : {}),
          attempts: [...attemptsPrefix, { provider: p, via, ok: false, ms: latencyMs, error: 'No lyrics found for this query' }],
        },
      };
      return jsonResponse(emptyResp, {
        status: 200,
        headers: buildGatewayHeaders({ 'Cache-Control': 'public, max-age=60' }, degraded, circuitState),
      });
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
        ...(degraded ? { degraded: true, degradedReason, circuitState } : {}),
        attempts: [...attemptsPrefix, { provider: p, via, ok: true, ms: latencyMs }],
      },
    };

    if (!params.nocache && result.data.level !== 'none') {
      await putSonicCachedJson('lyrics-prov-v4', cacheIdentifier, response, 86400, 604800, env, waitUntil);
    }

    return jsonResponse(response, {
      status: 200,
      headers: buildGatewayHeaders(
        {
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
          'X-Sonic-Cache': 'MISS',
          'X-Sonic-Provider': p,
          'X-Sonic-Level': result.data.level,
        },
        degraded,
        circuitState,
      ),
    });
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return sonicError('PROVIDER_ERROR', err?.message || `Failed to fetch lyrics from ${p}`, 502, {
      provider: p,
      latencyMs,
      ...(degraded ? { degraded: true, degradedReason, circuitState } : {}),
      attempts: [...attemptsPrefix, { provider: p, ok: false, ms: latencyMs, error: err?.message }],
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

  const guardResp = await guardGatewayRequest(request, env, 'sonic-search');
  if (guardResp) return guardResp;

  const url = new URL(request.url);
  const { query, page, count, nocache } = parseSearchParams(url);

  if (!query) {
    return sonicError('MISSING_QUERY', 'Missing search keyword (Parameter q or keyword is required)', 400, {
      provider: 'nexus',
    });
  }

  const cacheIdentifier = `q=${query.toLowerCase()}:p=${page}:c=${count}`;
  if (!nocache) {
    const hit = await getSonicCachedJson<any>('search-nexus-v4', cacheIdentifier, env);
    if (hit?.value) {
      const body = { ...hit.value, meta: { ...hit.value.meta, cached: true, cacheLevel: hit.cacheLevel } };
      return jsonResponse(body, {
        status: 200,
        headers: buildGatewayHeaders({
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
          'X-Sonic-Cache': 'HIT',
          'X-Sonic-Provider': 'nexus',
        }),
      });
    }
  }

  const startTime = Date.now();
  try {
    const { searchNexus } = await import('./nexus-search');
    const result = await searchNexus(query, { page, count, request }, env);
    const latencyMs = Date.now() - startTime;

    // If local engine was down AND CF fallback yielded 0 tracks, check stale cache before returning empty
    if (result.degraded && result.data.tracks.length === 0 && !nocache) {
      const staleHit = await getSonicCachedJson<any>('search-nexus-v4', cacheIdentifier, env, { allowStale: true });
      if (staleHit?.value) {
        const staleBody = {
          ...staleHit.value,
          meta: {
            ...staleHit.value.meta,
            cached: true,
            cacheLevel: staleHit.cacheLevel,
            degraded: true,
            degradedReason: `served_stale_cache (${result.degradedReason || 'engine_down'})`,
            circuitState: result.circuitState,
            attempts: result.attempts,
          },
        };
        return jsonResponse(staleBody, {
          status: 200,
          headers: buildGatewayHeaders({ 'Cache-Control': 'public, max-age=60', 'X-Sonic-Cache': 'STALE' }, true, result.circuitState),
        });
      }
    }

    const response = {
      brand: 'Sonic',
      data: result.data,
      meta: {
        cached: false,
        cacheLevel: 'none',
        latencyMs,
        provider: 'nexus',
        degraded: Boolean(result.degraded),
        ...(result.degraded
          ? { degradedReason: result.degradedReason, circuitState: result.circuitState }
          : result.circuitState
            ? { circuitState: result.circuitState }
            : {}),
        attempts: result.attempts,
      },
    };

    if (result.data.tracks.length > 0 && !nocache) {
      await putSonicCachedJson('search-nexus-v4', cacheIdentifier, response, 3600, 86400, env, waitUntil);
    }

    return jsonResponse(response, {
      status: 200,
      headers: buildGatewayHeaders(
        {
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
          'X-Sonic-Cache': 'MISS',
          'X-Sonic-Provider': 'nexus',
        },
        result.degraded,
        result.circuitState,
      ),
    });
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

  const guardResp = await guardGatewayRequest(request, env, 'sonic-search');
  if (guardResp) return guardResp;

  const p = providerName.toLowerCase();
  const url = new URL(request.url);
  const { query, page, count, nocache } = parseSearchParams(url);
  const config = getSonicConfig(env);

  if (!query) {
    return sonicError('MISSING_QUERY', 'Missing search keyword (Parameter q or keyword is required)', 400, {
      provider: p,
    });
  }

  // Disabled-by-default third-party provider (`gdstudio`) returns honest empty result without hitting upstream
  if (p === 'gdstudio' && !config.enableGdstudio) {
    return jsonResponse(
      {
        brand: 'Sonic',
        data: { query, page, count: 0, total: 0, tracks: [] },
        meta: {
          cached: false,
          cacheLevel: 'none',
          latencyMs: 0,
          provider: 'gdstudio',
          disabled: true,
          attempts: [
            {
              provider: 'gdstudio',
              via: 'third-party',
              ok: false,
              ms: 0,
              error: 'Third-party provider gdstudio is disabled by default (set SONIC_ENABLE_GDSTUDIO=1 to enable)',
            },
          ],
        },
      },
      { status: 200, headers: buildGatewayHeaders({ 'Cache-Control': 'no-store' }) },
    );
  }

  const cacheIdentifier = `${p}:q=${query.toLowerCase()}:p=${page}:c=${count}`;
  if (!nocache) {
    const hit = await getSonicCachedJson<any>('search-prov-v4', cacheIdentifier, env);
    if (hit?.value) {
      const body = { ...hit.value, meta: { ...hit.value.meta, cached: true, cacheLevel: hit.cacheLevel } };
      return jsonResponse(body, {
        status: 200,
        headers: buildGatewayHeaders({
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
          'X-Sonic-Cache': 'HIT',
          'X-Sonic-Provider': p,
        }),
      });
    }
  }

  // Try Linux Local Engine first when running on Cloudflare Pages
  let degraded = false;
  let degradedReason: string | undefined;
  let circuitState: string | undefined;
  const attemptsPrefix: any[] = [];

  if (config.enableLocalEngine && (p === 'netease' || p === 'qq' || p === 'kugou' || p === 'kuwo')) {
    const q = new URLSearchParams({ q: query, page: String(page), count: String(count), nocache: '1' });
    const engineRes = await callLocalEngineJson<any>(`/api/sonic/search/${p}?${q.toString()}`, env, {
      request,
      timeoutMs: Math.min(config.engineTimeoutMs, config.timeoutMs),
    });
    circuitState = engineRes.circuitState;
    if (engineRes.ok && engineRes.data?.brand === 'Sonic' && engineRes.data?.data) {
      const body = engineRes.data;
      body.meta = {
        ...body.meta,
        cached: false,
        cacheLevel: 'none',
        provider: p,
        attempts: [
          { provider: 'local-engine', via: 'local-engine', ok: true, ms: engineRes.latencyMs },
          ...(body.meta?.attempts || []).map((a: any) => ({ ...a, via: a.via || 'local-engine' })),
        ],
      };
      if (!nocache && Array.isArray(body.data.tracks) && body.data.tracks.length > 0) {
        await putSonicCachedJson('search-prov-v4', cacheIdentifier, body, 3600, 86400, env, waitUntil);
      }
      return jsonResponse(body, {
        status: 200,
        headers: buildGatewayHeaders({
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
          'X-Sonic-Cache': 'MISS',
          'X-Sonic-Provider': p,
        }),
      });
    }
    degraded = true;
    degradedReason = engineRes.error || 'local_engine_unavailable';
    attemptsPrefix.push({
      provider: 'local-engine',
      via: 'local-engine',
      ok: false,
      ms: engineRes.latencyMs,
      error: degradedReason,
    });
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
    const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
    const tracks = await adapter.search(query, { page, count, env, signal: timeoutSignal, platform: p });
    const latencyMs = Date.now() - startTime;
    const via = config.runtime === 'linux-engine' ? 'local-engine' : 'cf-direct';
    const attemptName = config.runtime === 'linux-engine' && (p === 'netease' || p === 'qq' || p === 'kugou' || p === 'kuwo')
      ? `local-${p}`
      : p;

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
        ...(degraded ? { degraded: true, degradedReason, circuitState } : {}),
        attempts: [...attemptsPrefix, { provider: attemptName, via, ok: tracks.length > 0, ms: latencyMs }],
      },
    };

    if (tracks.length > 0 && !nocache) {
      await putSonicCachedJson('search-prov-v4', cacheIdentifier, response, 3600, 86400, env, waitUntil);
    }

    return jsonResponse(response, {
      status: 200,
      headers: buildGatewayHeaders(
        {
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
          'X-Sonic-Cache': 'MISS',
          'X-Sonic-Provider': p,
        },
        degraded,
        circuitState,
      ),
    });
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return sonicError('PROVIDER_SEARCH_ERROR', err?.message || `Search failed on ${p}`, 502, {
      provider: p,
      latencyMs,
      ...(degraded ? { degraded: true, degradedReason, circuitState } : {}),
      attempts: [...attemptsPrefix, { provider: p, ok: false, ms: latencyMs, error: err?.message }],
    });
  }
}
