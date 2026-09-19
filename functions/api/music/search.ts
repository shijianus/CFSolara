import { errorResponse, handleOptions, jsonResponse } from '../../_lib/http';
import { searchTracks } from '../../_lib/music';
import type { AppEnv } from '../../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(request.url);
  const query = url.searchParams.get('q') || url.searchParams.get('keyword') || url.searchParams.get('name') || '';
  const source = url.searchParams.get('source') || 'netease';
  const count = Math.min(50, Math.max(1, parseInt(url.searchParams.get('count') || '20', 10)));
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));

  if (!query.trim()) {
    return errorResponse('缺少搜索关键词 (Parameter q is required)', 400);
  }

  try {
    const tracks = await searchTracks(env, query.trim(), source, count, page);
    return jsonResponse({
      ok: true,
      query: query.trim(),
      source,
      page,
      count: tracks.length,
      tracks,
    });
  } catch (err: any) {
    console.error('[CFSolara Music Search Error]', err);
    return errorResponse(err?.message || '搜索曲库失败', 502);
  }
}
