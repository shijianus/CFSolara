// GET /api/sonic/recommend/trending
// Station Popularity, 24h / 7d Trends, Surging Songs, New Songs & Genre Hot
// Strictly separates `cfsolara-internal` real station listens from `external-chart` reference.

import type { AppEnv } from '../../../_lib/types';
import { jsonResponse, handleOptions } from '../../../_lib/http';
import { getSonicConfig } from '../../../_lib/sonic/config';
import { getSonicCachedJson, putSonicCachedJson } from '../../../_lib/sonic/cache';
import { callLocalEngineJson } from '../../../_lib/sonic/local-engine';
import { buildGatewayHeaders, guardGatewayRequest, sonicError } from '../../../_lib/sonic/route-helpers';
import {
  buildPrivacySafeCacheHeaders,
  getTrendingRecommendations,
  resolveUserIdentity,
  type TrendingWindow,
} from '../../../_lib/sonic/recommend';

export async function onRequest({
  request,
  env,
  waitUntil,
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
  const windowRaw = (url.searchParams.get('window') || '7d').trim().toLowerCase();
  const validWindows = new Set(['24h', '7d', 'all', 'surging', 'new']);
  const window = (validWindows.has(windowRaw) ? windowRaw : '7d') as TrendingWindow;
  const genre = url.searchParams.get('genre')?.trim() || undefined;
  const count = Math.min(50, Math.max(1, parseInt(url.searchParams.get('count') || '20', 10) || 20));
  const personalizedParam = url.searchParams.get('personalized') === '1' || url.searchParams.get('personalized') === 'true';
  const nocache = url.searchParams.has('nocache') || url.searchParams.has('_t');

  const identity = await resolveUserIdentity(request, env);
  const effectivePersonalized = personalizedParam && identity.personalizationEnabled;
  const { headers: privacyHeaders, allowSharedCache } = buildPrivacySafeCacheHeaders(
    request,
    effectivePersonalized ? identity : { ...identity, personalizationEnabled: false, subjectKey: null },
    env,
    effectivePersonalized ? 0 : 120,
  );

  const cacheKey = `win=${window}:g=${genre || 'all'}:c=${count}`;
  if (allowSharedCache && !nocache) {
    const hit = await getSonicCachedJson<any>('rec-trending-v1', cacheKey, env);
    if (hit?.value) {
      const cachedBody = {
        ...hit.value,
        meta: { ...hit.value.meta, cached: true, cacheLevel: hit.cacheLevel },
      };
      return jsonResponse(cachedBody, {
        status: 200,
        headers: buildGatewayHeaders({
          ...privacyHeaders,
          'X-Sonic-Cache': 'HIT',
          'X-Sonic-Provider': 'recommend-trending',
        }),
      });
    }
  }

  const config = getSonicConfig(env);
  let degraded = false;
  let degradedReason: string | undefined;
  let circuitState: string | undefined;

  if (config.enableLocalEngine) {
    const engineRes = await callLocalEngineJson<any>(
      `/api/sonic/recommend/trending${url.search}`,
      env,
      { request, timeoutMs: Math.min(config.engineTimeoutMs, config.timeoutMs) },
    );
    circuitState = engineRes.circuitState;
    if (engineRes.ok && engineRes.data?.brand === 'Sonic' && engineRes.data?.data) {
      const body = {
        ...engineRes.data,
        meta: {
          ...engineRes.data.meta,
          cached: false,
          cacheLevel: 'none',
          latencyMs: Date.now() - start,
          via: 'local-engine',
          circuitState: 'CLOSED',
        },
      };
      if (allowSharedCache && !nocache) {
        await putSonicCachedJson('rec-trending-v1', cacheKey, body, 120, 1800, env, waitUntil);
      }
      return jsonResponse(body, {
        status: 200,
        headers: buildGatewayHeaders(
          { ...privacyHeaders, 'X-Sonic-Cache': 'MISS', 'X-Sonic-Provider': 'recommend-trending' },
          false,
          'CLOSED',
        ),
      });
    }
    degraded = true;
    degradedReason = engineRes.error || 'local_engine_unavailable';
  }

  try {
    const data = await getTrendingRecommendations(
      identity,
      { window, genre, count, personalized: effectivePersonalized },
      env,
    );

    const responseBody = {
      brand: 'Sonic',
      data,
      meta: {
        cached: false,
        cacheLevel: 'none',
        latencyMs: Date.now() - start,
        provider: 'recommend-trending',
        runtime: config.runtime,
        degraded,
        ...(degraded ? { degradedReason, circuitState } : {}),
      },
    };

    if (allowSharedCache && !nocache && data.tracks.length > 0) {
      await putSonicCachedJson('rec-trending-v1', cacheKey, responseBody, 120, 1800, env, waitUntil);
    }

    return jsonResponse(responseBody, {
      status: 200,
      headers: buildGatewayHeaders(
        { ...privacyHeaders, 'X-Sonic-Cache': 'MISS', 'X-Sonic-Provider': 'recommend-trending' },
        degraded,
        circuitState,
      ),
    });
  } catch (err: any) {
    return sonicError('TRENDING_ERROR', err?.message || 'Failed to compute trending tracks', 500, {
      provider: 'recommend-trending',
      latencyMs: Date.now() - start,
      degraded,
      circuitState: circuitState as any,
    });
  }
}
