// Sonic Local Engine — Authenticated Stream URL Resolver Endpoint
// GET /api/sonic/resolve/stream
// Protected by mandatory `X-Sonic-Engine-Key` (rejects anonymous requests with 401)

import { handleOptions, jsonResponse } from '../../../_lib/http';
import { checkEngineAccess, evaluateGatewayRateLimit, buildRateLimitErrorResponse } from '../../../_lib/sonic/security';
import { resolvePlayableStream } from '../../../_lib/sonic/native-protocols';
import type { AppEnv } from '../../../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse({ brand: 'Sonic', error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }, { status: 405 });
  }

  // Always enforce X-Sonic-Engine-Key on `/api/sonic/resolve/*`
  const denied = checkEngineAccess(request, env);
  if (denied) return denied;

  const rl = await evaluateGatewayRateLimit(request, env, 'engine-resolve');
  if (!rl.allowed) return buildRateLimitErrorResponse(rl);

  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  const source = url.searchParams.get('source') || 'netease';
  const quality = url.searchParams.get('quality') || url.searchParams.get('br') || '320';
  const title = url.searchParams.get('title') || '';
  const artist = url.searchParams.get('artist') || '';
  const durationStr = url.searchParams.get('duration');
  const durationSec = durationStr ? parseFloat(durationStr) : undefined;
  const allowTrial = url.searchParams.get('allowTrial') !== '0';
  const nocache = url.searchParams.has('nocache');

  if (!id && !title) {
    return jsonResponse(
      { brand: 'Sonic', ok: false, error: { code: 'MISSING_PARAMS', message: 'id or title is required' } },
      { status: 400 },
    );
  }

  const resolved = await resolvePlayableStream(
    {
      id,
      source,
      quality,
      title,
      artist,
      durationSec,
      allowTrial,
      nocache,
      request,
    },
    env,
  );

  if (!resolved || !resolved.url) {
    return jsonResponse(
      {
        brand: 'Sonic',
        ok: false,
        error: { code: 'STREAM_NOT_FOUND', message: 'No playable stream resolved on local engine' },
        attempts: [],
      },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return jsonResponse(
    {
      brand: 'Sonic',
      ok: true,
      data: resolved,
      meta: {
        cached: false,
        cacheLevel: 'none',
        latencyMs: resolved.attempts.reduce((s, a) => s + (a.ms || 0), 0),
        provider: resolved.provider,
        attempts: resolved.attempts,
      },
    },
    { status: 200, headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
