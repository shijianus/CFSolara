// GET /api/sonic/recommend/for-you
// Personalized & Context-Aware Music Recommendations (`for-you`, `recent`, `favorites`, `next` Auto-DJ, `radio`)

import type { AppEnv } from '../../../_lib/types';
import { jsonResponse, handleOptions } from '../../../_lib/http';
import { getSonicConfig } from '../../../_lib/sonic/config';
import { callLocalEngineJson } from '../../../_lib/sonic/local-engine';
import { buildGatewayHeaders, guardGatewayRequest, sonicError } from '../../../_lib/sonic/route-helpers';
import {
  buildPrivacySafeCacheHeaders,
  getRecommendationsForYou,
  resolveUserIdentity,
  type ForYouOptions,
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

  const start = Date.now();
  const url = new URL(request.url);
  const identity = await resolveUserIdentity(request, env);
  const { headers: privacyHeaders } = buildPrivacySafeCacheHeaders(request, identity, env, 0);
  const config = getSonicConfig(env);

  let degraded = false;
  let degradedReason: string | undefined;
  let circuitState: string | undefined;

  // Primary Hop: Linux VPS Sonic Engine (SQLite persistent store)
  if (config.enableLocalEngine) {
    const engineRes = await callLocalEngineJson<any>(
      `/api/sonic/recommend/for-you${url.search}`,
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
          { ...privacyHeaders, 'X-Sonic-Provider': 'recommend-engine' },
          false,
          'CLOSED',
        ),
      });
    }
    degraded = true;
    degradedReason = engineRes.error || 'local_engine_unavailable';
  }

  const modeRaw = (url.searchParams.get('mode') || 'for-you').trim().toLowerCase();
  const validModes = new Set(['for-you', 'recent', 'favorites', 'next', 'radio']);
  const mode = (validModes.has(modeRaw) ? modeRaw : 'for-you') as ForYouOptions['mode'];
  const count = Math.min(50, Math.max(1, parseInt(url.searchParams.get('count') || '18', 10) || 18));
  const diversity = url.searchParams.has('diversity')
    ? parseFloat(url.searchParams.get('diversity') || '0.28')
    : undefined;
  const temperature = url.searchParams.has('temperature')
    ? parseFloat(url.searchParams.get('temperature') || '0.25')
    : undefined;
  const excludeIds = (url.searchParams.get('exclude') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const data = await getRecommendationsForYou(
      identity,
      {
        mode,
        count,
        seedTrackId: url.searchParams.get('seedTrackId') || url.searchParams.get('trackId') || undefined,
        seedTitle: url.searchParams.get('seedTitle') || url.searchParams.get('title') || undefined,
        seedArtist: url.searchParams.get('seedArtist') || url.searchParams.get('artist') || undefined,
        excludeIds,
        diversity: Number.isFinite(diversity) ? diversity : undefined,
        temperature: Number.isFinite(temperature) ? temperature : undefined,
      },
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
          provider: 'recommend-for-you',
          runtime: config.runtime,
          degraded,
          ...(degraded ? { degradedReason, circuitState } : {}),
        },
      },
      {
        status: 200,
        headers: buildGatewayHeaders(
          { ...privacyHeaders, 'X-Sonic-Provider': 'recommend-for-you' },
          degraded,
          circuitState,
        ),
      },
    );
  } catch (err: any) {
    return sonicError('RECOMMEND_ERROR', err?.message || 'Failed to compute recommendations', 500, {
      provider: 'recommend-for-you',
      latencyMs: Date.now() - start,
      degraded,
      circuitState: circuitState as any,
    });
  }
}
