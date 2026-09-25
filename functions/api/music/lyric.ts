import { errorResponse, handleOptions, jsonResponse } from '../../_lib/http';
import { getUniversalLyrics } from '../../_lib/music';
import type { AppEnv } from '../../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.trim() || undefined;
  const source = url.searchParams.get('source')?.trim() || 'netease';
  const title = (url.searchParams.get('title') || url.searchParams.get('name'))?.trim() || undefined;
  const artist = (url.searchParams.get('artist') || url.searchParams.get('singer'))?.trim() || undefined;
  const q = (url.searchParams.get('q') || url.searchParams.get('keyword'))?.trim() || undefined;
  const durationStr = url.searchParams.get('duration');
  const duration = durationStr ? parseFloat(durationStr) : undefined;

  if (!id && !title && !artist && !q) {
    return errorResponse('缺少歌词查询参数 (Parameter id, title, artist or q is required)', 400);
  }

  try {
    const lyricPayload = await getUniversalLyrics(env, {
      id,
      source,
      title,
      artist,
      q,
      duration,
    });
    return jsonResponse({
      ...lyricPayload,
      // 向前兼容历史字段
      lyric: lyricPayload.rawLyric,
      parsed: lyricPayload.lines,
    });
  } catch (err: any) {
    console.error('[CFSolara Music Lyric Error]', err);
    return errorResponse(err?.message || '获取歌词失败', 502);
  }
}

