// Sonic Gateway — Nexus Lyrics Aggregation Endpoint
// GET /api/sonic/lyrics/nexus
// Brand: Sonic (声波 / Sonic Lyrics Nexus)

import type { AppEnv } from '../../../_lib/types';
import type { SonicLyricsResponse } from '../../../_lib/sonic/types';
import { jsonResponse, errorResponse } from '../../../_lib/http';
import { parseLyricsParams, sonicError, handleOptions, buildGatewayHeaders } from '../../../_lib/sonic/route-helpers';
import { resolveNexusLyrics } from '../../../_lib/sonic/nexus-lyrics';
import { getSonicCachedJson, putSonicCachedJson } from '../../../_lib/sonic/cache';
import { checkEngineAccess, evaluateGatewayRateLimit, buildRateLimitErrorResponse } from '../../../_lib/sonic/security';

export async function handleNexusLyricsRequest(
  request: Request,
  env: AppEnv,
  waitUntil?: (promise: Promise<any>) => void,
): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse('Method not allowed', 405);
  }

  const engineDenied = checkEngineAccess(request, env);
  if (engineDenied) return engineDenied;
  const rl = await evaluateGatewayRateLimit(request, env, 'sonic-lyrics');
  if (!rl.allowed) return buildRateLimitErrorResponse(rl);

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

  const sortedQuery = new URLSearchParams(url.searchParams);
  sortedQuery.delete('nocache');
  sortedQuery.delete('_t');
  sortedQuery.sort();
  const cacheIdentifier = sortedQuery.toString();

  if (!params.nocache) {
    const hit = await getSonicCachedJson<SonicLyricsResponse>('lyrics-nexus-v6', cacheIdentifier, env);
    if (hit?.value) {
      const body: SonicLyricsResponse = {
        ...hit.value,
        meta: {
          ...hit.value.meta,
          cached: true,
          cacheLevel: hit.cacheLevel,
        },
      };
      return jsonResponse(body, {
        status: 200,
        headers: buildGatewayHeaders({
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
          'X-Sonic-Cache': 'HIT',
          'X-Sonic-Provider': String(body.data?.provider || 'nexus'),
        }),
      });
    }
  }

  const startTime = Date.now();

  try {
    const result = await resolveNexusLyrics(params, env, { request });
    const latencyMs = Date.now() - startTime;

    if (result.degraded && result.data.level === 'none' && !params.nocache) {
      const staleHit = await getSonicCachedJson<SonicLyricsResponse>('lyrics-nexus-v6', cacheIdentifier, env, { allowStale: true });
      if (staleHit?.value) {
        const staleBody: SonicLyricsResponse = {
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
          headers: buildGatewayHeaders(
            { 'Cache-Control': 'public, max-age=120', 'X-Sonic-Cache': 'STALE' },
            true,
            result.circuitState,
          ),
        });
      }
    }

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
        ...(result.degraded
          ? { degraded: true, degradedReason: result.degradedReason, circuitState: result.circuitState }
          : {}),
        attempts: result.attempts,
      },
    };

    if (result.data.level !== 'none' && !params.nocache) {
      await putSonicCachedJson('lyrics-nexus-v6', cacheIdentifier, response, 86400, 604800, env, waitUntil);
    }

    return jsonResponse(response, {
      status: 200,
      headers: buildGatewayHeaders(
        {
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
          'X-Sonic-Cache': 'MISS',
          'X-Sonic-Provider': String(result.provider),
          'X-Sonic-Level': result.data.level,
        },
        result.degraded,
        result.circuitState,
      ),
    });
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
