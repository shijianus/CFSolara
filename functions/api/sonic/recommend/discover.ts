// GET /api/sonic/recommend/discover
// Style, Language & Temperature-Controlled Music Discovery Radar

import type { AppEnv } from '../../../_lib/types';
import { jsonResponse, handleOptions } from '../../../_lib/http';
import { getSonicConfig } from '../../../_lib/sonic/config';
import { callLocalEngineJson } from '../../../_lib/sonic/local-engine';
import { buildGatewayHeaders, guardGatewayRequest, sonicError } from '../../../_lib/sonic/route-helpers';
import {
  buildPrivacySafeCacheHeaders,
  getDiscoverRecommendations,
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

  const start = Date.now();
  const url = new URL(request.url);
  const genre = url.searchParams.get('genre')?.trim() || undefined;
  const language = url.searchParams.get('language')?.trim() || undefined;
  const mood = url.searchParams.get('mood')?.trim() || undefined;
  const count = Math.min(40, Math.max(1, parseInt(url.searchParams.get('count') || '16', 10) || 16));
  const tempParsed = parseFloat(url.searchParams.get('temperature') || '0.55');
  const temperature = Number.isFinite(tempParsed) ? tempParsed : 0.55;

  const identity = await resolveUserIdentity(request, env);
  const { headers: privacyHeaders } = buildPrivacySafeCacheHeaders(request, identity, env, 60);
  const config = getSonicConfig(env);

  let degraded = false;
  let degradedReason: string | undefined;
  let circuitState: string | undefined;

  if (config.enableLocalEngine) {
    const engineRes = await callLocalEngineJson<any>(
      `/api/sonic/recommend/discover${url.search}`,
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
          { ...privacyHeaders, 'X-Sonic-Provider': 'recommend-discover' },
          false,
          'CLOSED',
        ),
      });
    }
    degraded = true;
    degradedReason = engineRes.error || 'local_engine_unavailable';
  }

  try {
    const data = await getDiscoverRecommendations(
      identity,
      { genre, language, mood, temperature, count },
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
          provider: 'recommend-discover',
          runtime: config.runtime,
          degraded,
          ...(degraded ? { degradedReason, circuitState } : {}),
        },
      },
      {
        status: 200,
        headers: buildGatewayHeaders(
          { ...privacyHeaders, 'X-Sonic-Provider': 'recommend-discover' },
          degraded,
          circuitState,
        ),
      },
    );
  } catch (err: any) {
    return sonicError('DISCOVER_ERROR', err?.message || 'Failed to compute discovery tracks', 500, {
      provider: 'recommend-discover',
      latencyMs: Date.now() - start,
      degraded,
      circuitState: circuitState as any,
    });
  }
}
