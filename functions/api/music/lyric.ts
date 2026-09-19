import { errorResponse, handleOptions, jsonResponse } from '../../_lib/http';
import { getTrackLyrics } from '../../_lib/music';
import type { AppEnv } from '../../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const source = url.searchParams.get('source') || 'netease';

  if (!id) {
    return errorResponse('缺少歌词 ID (Parameter id is required)', 400);
  }

  try {
    const { lyric, parsed } = await getTrackLyrics(env, id, source);
    return jsonResponse({
      ok: true,
      id,
      source,
      lyric,
      parsed,
      lineCount: parsed.length,
    });
  } catch (err: any) {
    console.error('[CFSolara Music Lyric Error]', err);
    return errorResponse(err?.message || '获取歌词失败', 502);
  }
}
