import { errorResponse, handleOptions, jsonResponse } from '../../_lib/http';
import { getUniversalLyrics } from '../../_lib/music';
import type { AppEnv } from '../../_lib/types';

export async function onRequest({ request, env, waitUntil }: { request: Request; env: AppEnv; waitUntil?: (promise: Promise<any>) => void }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.trim() || undefined;
  const source = url.searchParams.get('source')?.trim() || 'netease';
  const title = (url.searchParams.get('title') || url.searchParams.get('name'))?.trim() || undefined;
  const artist = (url.searchParams.get('artist') || url.searchParams.get('singer'))?.trim() || undefined;
  const album = url.searchParams.get('album')?.trim() || undefined;
  const q = (url.searchParams.get('q') || url.searchParams.get('keyword'))?.trim() || undefined;
  const durationStr = url.searchParams.get('duration');
  const duration = durationStr ? parseFloat(durationStr) : undefined;

  if (!id && !title && !artist && !q) {
    return errorResponse('缺少歌词查询参数 (Parameter id, title, artist or q is required)', 400);
  }

  const format = url.searchParams.get('format')?.toLowerCase() || 'json';

  // 1. 尝试从 Cloudflare Cache API 检索缓存
  const cache = typeof caches !== 'undefined' ? (caches as any).default : null;
  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.searchParams.sort();
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch {}
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

    const cacheHeaders = {
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    };

    let response: Response;

    if (format === 'ttml' || format === 'xml') {
      response = new Response(lyricPayload.ttml || '', {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          ...cacheHeaders,
        },
      });
    } else if (format === 'elrc' || format === 'lrc' || format === 'text') {
      response = new Response(lyricPayload.elrc || lyricPayload.rawLyric || '', {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          ...cacheHeaders,
        },
      });
    } else {
      response = jsonResponse(
        {
          ...lyricPayload,
          album: album || undefined,
          // 向前兼容历史字段与开放生态
          lyric: lyricPayload.rawLyric,
          parsed: lyricPayload.lines,
          elrc: lyricPayload.elrc,
          ttml: lyricPayload.ttml,
        },
        200,
        cacheHeaders,
      );
    }

    if (cache && response.status === 200) {
      try {
        const cachePromise = cache.put(cacheKey, response.clone());
        if (typeof waitUntil === 'function') {
          waitUntil(cachePromise);
        } else {
          cachePromise.catch(() => {});
        }
      } catch {}
    }

    return response;
  } catch (err: any) {
    console.error('[CFSolara Music Lyric Error]', err);
    return errorResponse(err?.message || '获取歌词失败', 502, {
      'Cache-Control': 'public, max-age=30',
      'Access-Control-Allow-Origin': '*',
    });
  }
}

