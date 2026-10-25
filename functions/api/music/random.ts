import { errorResponse, handleOptions, jsonResponse } from '../../_lib/http';
import { getRandomTracks } from '../../_lib/music';
import { checkEngineAccess, evaluateGatewayRateLimit, buildRateLimitErrorResponse } from '../../_lib/sonic/security';
import type { AppEnv } from '../../_lib/types';
import { sanitizeErrorForClient } from '../../_lib/sonic/net-guard';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse('Method not allowed', 405);
  }

  const engineDenied = checkEngineAccess(request, env);
  if (engineDenied) return engineDenied;
  const rl = await evaluateGatewayRateLimit(request, env, 'music-random');
  if (!rl.allowed) return buildRateLimitErrorResponse(rl);

  const url = new URL(request.url);
  const count = Math.min(30, Math.max(1, parseInt(url.searchParams.get('count') || '10', 10)));
  const genre = url.searchParams.get('genre') || undefined;

  try {
    const tracks = await getRandomTracks(env, count, genre);
    return jsonResponse({
      ok: true,
      count: tracks.length,
      genre: genre || 'random',
      tracks,
    });
  } catch (err: any) {
    console.error('[epocanvas sonic Music Random Error]', err);
    return errorResponse(sanitizeErrorForClient(err, '获取随机推荐曲库失败'), 502);
  }
}
