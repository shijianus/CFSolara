// Sonic Gateway — Nexus Lyrics Aggregation Endpoint
// GET /api/sonic/lyrics/nexus
// Brand: Sonic (声波 / Sonic Lyrics Nexus)

import type { AppEnv } from '../../../_lib/types';
import type { SonicLyricsResponse } from '../../../_lib/sonic/types';
import { jsonResponse, errorResponse } from '../../../_lib/http';
import { parseLyricsParams, sonicError, handleOptions } from '../../../_lib/sonic/route-helpers';
import { resolveNexusLyrics } from '../../../_lib/sonic/nexus-lyrics';

export async function handleNexusLyricsRequest(
  request: Request,
  env: AppEnv,
  waitUntil?: (promise: Promise<any>) => void,
): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(request.url);
  const params = parseLyricsParams(url);

  // Validate: at least one identifier required
  const hasId = params.ncmMusicId || params.qqMusicId || params.appleMusicId || params.spotifyId || params.isrc || params.platformId;
  if (!params.title && !params.artist && !hasId) {
    return sonicError(
      'MISSING_PARAMS',
      'At least one of: title, artist, or a platform ID (platformId/ncmMusicId/qqMusicId) is required',
      400,
    );
  }

  // Cloudflare Cache API
  const cache = typeof caches !== 'undefined' ? (caches as any).default : null;
  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.searchParams.sort();
  cacheKeyUrl.searchParams.set('_sonic_cache_v', '5.1');
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

  if (cache && !params.nocache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const body = (await cached.json()) as SonicLyricsResponse;
        body.meta.cached = true;
        body.meta.cacheLevel = 'cf-cache';
        return jsonResponse(body, {
          status: 200,
          headers: {
            'Cache-Control': 'public, max-age=86400, s-maxage=86400',
            'X-Sonic-Cache': 'HIT',
            'X-Sonic-Provider': String(body.data?.provider || 'nexus'),
          },
        });
      }
    } catch {}
  }

  const startTime = Date.now();

  try {
    const result = await resolveNexusLyrics(params, env);
    const latencyMs = Date.now() - startTime;

    const response: SonicLyricsResponse = {
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
        provider: result.provider,
        attempts: result.attempts,
      },
    };

    const cacheHeaders = {
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'X-Sonic-Cache': 'MISS',
      'X-Sonic-Provider': String(result.provider),
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
    console.error('[Sonic Nexus Lyrics Error]', err);
    return sonicError('INTERNAL_ERROR', err?.message || 'Failed to resolve nexus lyrics', 502, {
      latencyMs: Date.now() - startTime,
      provider: 'nexus',
    });
  }
}

export async function onRequest({
  request,
  env,
  waitUntil,
}: {
  request: Request;
  env: AppEnv;
  waitUntil?: (promise: Promise<any>) => void;
}): Promise<Response> {
  return handleNexusLyricsRequest(request, env, waitUntil);
}
