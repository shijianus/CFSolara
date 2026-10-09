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
  cacheKeyUrl.searchParams.set('_v', '2.5');
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });
  const bypassCache = url.searchParams.has('nocache') || url.searchParams.has('_t');

  if (cache && !bypassCache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch {}
  }

  let cleanId = id;
  let effectiveSource = source;
  if (cleanId?.startsWith('qq:')) {
    cleanId = cleanId.slice(3);
    effectiveSource = 'tencent';
  } else if (cleanId?.startsWith('kugou:')) {
    cleanId = cleanId.slice(6);
    effectiveSource = 'kugou';
  } else if (cleanId && /^00[a-zA-Z0-9]{12}$/.test(cleanId) && effectiveSource === 'netease') {
    effectiveSource = 'tencent';
  } else if (cleanId && /^[a-fA-F0-9]{32}$/.test(cleanId) && effectiveSource === 'netease') {
    effectiveSource = 'kugou';
  }

  try {
    const lyricPayload = await getUniversalLyrics(env, {
      id: cleanId,
      source: effectiveSource,
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
      let standardLrc = '';
      if (lyricPayload.lines && lyricPayload.lines.length > 0) {
        standardLrc = lyricPayload.lines
          .map((line) => {
            const totalSec = Math.max(0, (line.time || (line.timeSec ? line.timeSec * 1000 : 0)) / 1000);
            const mins = Math.floor(totalSec / 60);
            const secs = (totalSec % 60).toFixed(2);
            const timeStr = `${String(mins).padStart(2, '0')}:${secs.padStart(5, '0')}`;
            return `[${timeStr}]${line.text}`;
          })
          .join('\n');
      } else if (lyricPayload.rawLyric && !lyricPayload.rawLyric.startsWith('{')) {
        standardLrc = lyricPayload.rawLyric;
      }

      response = jsonResponse(
        {
          code: 200,
          ...lyricPayload,
          album: album || undefined,
          // Standard NetEase Cloud client compatibility
          lrc: {
            version: 1,
            lyric: standardLrc,
          },
          klyric: {
            version: 1,
            lyric: '',
          },
          tlyric: {
            version: 1,
            lyric: '',
          },
          romalrc: {
            version: 1,
            lyric: '',
          },
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
    console.error('[Sonic Music Lyric Error]', err);
    return errorResponse(err?.message || '获取歌词失败', 502, {
      'Cache-Control': 'public, max-age=30',
      'Access-Control-Allow-Origin': '*',
    });
  }
}

