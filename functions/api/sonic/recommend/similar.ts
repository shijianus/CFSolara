// GET /api/sonic/recommend/similar
// Content Metadata + Session Co-occurrence Similar Songs & Related Artists

import type { AppEnv } from '../../../_lib/types';
import { jsonResponse, handleOptions } from '../../../_lib/http';
import { getSonicConfig } from '../../../_lib/sonic/config';
import { callLocalEngineJson } from '../../../_lib/sonic/local-engine';
import { buildGatewayHeaders, guardGatewayRequest, sonicError } from '../../../_lib/sonic/route-helpers';
import {
  buildPrivacySafeCacheHeaders,
  getSimilarRecommendations,
  resolveUserIdentity,
} from '../../../_lib/sonic/recommend';

export async function onRequest({
  request,
  env,
}: {
  request: Request;
  env: AppEnv;
  waitUntil?: (promise: Promise<any>) => void;
}): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return sonicError('METHOD_NOT_ALLOWED', 'Only GET/HEAD allowed', 405);
  }

  const guardResp = await guardGatewayRequest(request, env, 'sonic-recommend');
  if (guardResp) return guardResp;

  const url = new URL(request.url);
  const trackId = url.searchParams.get('trackId')?.trim() || url.searchParams.get('id')?.trim() || undefined;
  const title = url.searchParams.get('title')?.trim() || url.searchParams.get('name')?.trim() || undefined;
  const artist = url.searchParams.get('artist')?.trim() || undefined;
  const album = url.searchParams.get('album')?.trim() || undefined;
  const genre = url.searchParams.get('genre')?.trim() || undefined;
  const count = Math.min(40, Math.max(1, parseInt(url.searchParams.get('count') || '12', 10) || 12));
  const includeSameArtist = url.searchParams.get('includeSameArtist') !== '0';

  if (!trackId && !title && !artist) {
    return sonicError('MISSING_SEED', 'At least one of trackId, title, or artist is required', 400, {
      provider: 'recommend-similar',
    });
  }

  const start = Date.now();
  const identity = await resolveUserIdentity(request, env);
  const { headers: privacyHeaders } = buildPrivacySafeCacheHeaders(request, identity, env, 180);
  const config = getSonicConfig(env);

  let degraded = false;
  let degradedReason: string | undefined;
  let circuitState: string | undefined;

  if (config.enableLocalEngine) {
    const engineRes = await callLocalEngineJson<any>(
      `/api/sonic/recommend/similar${url.search}`,
      env,
      { request, timeoutMs: Math.min(config.engineTimeoutMs, config.timeoutMs) },
    );
    circuitState = engineRes.circuitState;
    if (engineRes.ok && engineRes.data?.brand === 'Sonic' && engineRes.data?.data) {
      const body = {
        ...engineRes.data,
        meta: {
          ...engineRes.data.meta,
          latencyMs: Date.now() - start,
          via: 'local-engine',
          circuitState: 'CLOSED',
        },
      };
      return jsonResponse(body, {
        status: 200,
        headers: buildGatewayHeaders(
          { ...privacyHeaders, 'X-Sonic-Provider': 'recommend-similar' },
          false,
          'CLOSED',
        ),
      });
    }
    degraded = true;
    degradedReason = engineRes.error || 'local_engine_unavailable';
  }

  try {
    const data = await getSimilarRecommendations(
      identity,
      { trackId, title, artist, album, genre, count, includeSameArtist },
      env,
    );

    return jsonResponse(
      {
        brand: 'Sonic',
        data,
        meta: {
          cached: false,
          cacheLevel: 'none',
          latencyMs: Date.now() - start,
          provider: 'recommend-similar',
          runtime: config.runtime,
          degraded,
          ...(degraded ? { degradedReason, circuitState } : {}),
        },
      },
      {
        status: 200,
        headers: buildGatewayHeaders(
          { ...privacyHeaders, 'X-Sonic-Provider': 'recommend-similar' },
          degraded,
          circuitState,
        ),
      },
    );
  } catch (err: any) {
    return sonicError('SIMILAR_ERROR', err?.message || 'Failed to compute similar tracks', 500, {
      provider: 'recommend-similar',
      latencyMs: Date.now() - start,
      degraded,
      circuitState: circuitState as any,
    });
  }
}
