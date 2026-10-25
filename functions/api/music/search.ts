import { errorResponse, handleOptions, jsonResponse } from '../../_lib/http';
import { searchTracks } from '../../_lib/music';
import { getSonicConfig } from '../../_lib/sonic/config';
import { callLocalEngineJson, getLocalEngineCircuitSnapshot } from '../../_lib/sonic/local-engine';
import { checkEngineAccess, evaluateGatewayRateLimit, buildRateLimitErrorResponse } from '../../_lib/sonic/security';
import type { AppEnv } from '../../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse('Method not allowed', 405);
  }

  const engineDenied = checkEngineAccess(request, env);
  if (engineDenied) return engineDenied;
  const rl = await evaluateGatewayRateLimit(request, env, 'music-search');
  if (!rl.allowed) return buildRateLimitErrorResponse(rl);

  const url = new URL(request.url);
  const query = url.searchParams.get('q') || url.searchParams.get('keyword') || url.searchParams.get('name') || '';
  const source = url.searchParams.get('source') || 'netease';
  const count = Math.min(50, Math.max(1, parseInt(url.searchParams.get('count') || '20', 10)));
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));

  if (!query.trim()) {
    return errorResponse('缺少搜索关键词 (Parameter q is required)', 400);
  }

  const cfg = getSonicConfig(env);
  let degraded = false;

  // 1. Primary: Local Linux Engine when running on Cloudflare Edge
  if (cfg.enableLocalEngine && cfg.runtime !== 'linux-engine' && !request.headers.get('X-Sonic-Hop')) {
    const engineRes = await callLocalEngineJson<any>(
      `/api/music/search?q=${encodeURIComponent(query.trim())}&source=${encodeURIComponent(source)}&count=${count}&page=${page}`,
      env,
      { request },
    );
    if (engineRes.ok && engineRes.data && Array.isArray(engineRes.data.tracks)) {
      return jsonResponse(
        {
          ...engineRes.data,
          via: 'local-engine',
          degraded: false,
        },
        200,
        {
          'X-Sonic-Via': 'local-engine',
          'X-Sonic-Circuit': engineRes.circuitState,
        },
      );
    }
    degraded = true;
  }

  try {
    const tracks = await searchTracks(env, query.trim(), source, count, page);
    const circuit = getLocalEngineCircuitSnapshot(env);
    const headers: Record<string, string> = {
      'X-Sonic-Via': cfg.runtime === 'linux-engine' ? 'local-engine' : 'cf-direct',
      'X-Sonic-Circuit': circuit.state,
    };
    if (degraded) headers['X-Sonic-Degraded'] = '1';

    return jsonResponse(
      {
        ok: true,
        query: query.trim(),
        source,
        page,
        count: tracks.length,
        tracks,
        degraded,
      },
      200,
      headers,
    );
  } catch (err: any) {
    console.error('[Sonic Music Search Error]', err);
    return errorResponse(err?.message || '搜索曲库失败', 502);
  }
}
