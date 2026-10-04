// GET /api/sonic/lyrics/sync
// Sonic Gateway — High-Precision Synchronized Lyrics Endpoint for Blogs & External Widgets
// Supports format: 'sonic' (default), 'lrc', 'ttml', 'json'

import type { SonicLyricsResponse } from '../../../_lib/sonic/types';
import { parseLyricsParams, sonicError, handleOptions } from '../../../_lib/sonic/route-helpers';
import { resolveNexusLyrics } from '../../../_lib/sonic/nexus-lyrics';
import { jsonResponse } from '../../../_lib/http';
import { sonicLinesToLrc, sonicLinesToTtml } from '../../../_lib/sonic/utils';

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse(
      { brand: 'Sonic', error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } },
      { status: 405 },
    );
  }

  const url = new URL(request.url);
  const params = parseLyricsParams(url);
  const format = (url.searchParams.get('format') || 'sonic').toLowerCase();

  const hasId = params.ncmMusicId || params.qqMusicId || params.appleMusicId || params.spotifyId || params.isrc || params.platformId;
  if (!params.title && !params.artist && !hasId) {
    return sonicError('MISSING_PARAMS', 'At least one of: title, artist, or platformId is required', 400, {
      provider: 'sync',
    });
  }

  // Cloudflare Cache API
  const cache = typeof caches !== 'undefined' ? (caches as any).default : null;
  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.searchParams.sort();
  cacheKeyUrl.searchParams.set('_sonic_cache_v', '3.0');
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

  if (cache && !params.nocache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const cachedResp = new Response(cached.body, cached);
        cachedResp.headers.set('X-Sonic-Cache', 'HIT');
        return cachedResp;
      }
    } catch {}
  }

  const startTime = Date.now();
  try {
    const result = await resolveNexusLyrics(params, env);
    const latencyMs = Date.now() - startTime;

    const baseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'X-Sonic-Cache': 'MISS',
      'X-Sonic-Provider': result.provider,
      'X-Sonic-Level': result.data.level,
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    };

    if (format === 'lrc') {
      const lrcText = result.data.plainLyrics && /\[\d{2}:\d{2}/.test(result.data.plainLyrics)
        ? result.data.plainLyrics
        : sonicLinesToLrc(result.data.syncedLyrics, result.data.track.title, result.data.track.artist);
      const resp = new Response(lrcText, {
        status: 200,
        headers: {
          ...baseHeaders,
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
      if (cache && !params.nocache && result.data.level !== 'none') {
        const cachePromise = cache.put(cacheKey, resp.clone());
        if (typeof waitUntil === 'function') waitUntil(cachePromise);
        else cachePromise.catch(() => {});
      }
      return resp;
    }

    if (format === 'ttml') {
      const ttmlContent = result.data.rawTtml || sonicLinesToTtml(result.data.syncedLyrics, result.data.track.title, result.data.track.artist);
      const resp = new Response(ttmlContent, {
        status: 200,
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/ttml+xml; charset=utf-8',
        },
      });
      if (cache && !params.nocache && result.data.level !== 'none') {
        const cachePromise = cache.put(cacheKey, resp.clone());
        if (typeof waitUntil === 'function') waitUntil(cachePromise);
        else cachePromise.catch(() => {});
      }
      return resp;
    }

    if (format === 'json') {
      const simplified = {
        title: result.data.track.title,
        artist: result.data.track.artist,
        album: result.data.track.album,
        instrumental: result.data.instrumental,
        provider: result.provider,
        level: result.data.level,
        lyrics: result.data.syncedLyrics.map((l) => ({
          time: l.startMs,
          duration: l.durationMs,
          text: l.text,
          words: l.words,
        })),
      };
      const resp = jsonResponse(simplified, { status: 200, headers: baseHeaders });
      if (cache && !params.nocache && result.data.level !== 'none') {
        const cachePromise = cache.put(cacheKey, resp.clone());
        if (typeof waitUntil === 'function') waitUntil(cachePromise);
        else cachePromise.catch(() => {});
      }
      return resp;
    }

    // Default: 'sonic' format
    const response: SonicLyricsResponse = {
      brand: 'Sonic',
      data: result.data,
      meta: {
        cached: false,
        cacheLevel: 'none',
        qualityScore: result.qualityScore,
        matchLevel: result.matchLevel,
        matchScore: result.matchScore,
        latencyMs,
        requested: params.prefer || 'auto',
        provider: result.provider,
        attempts: result.attempts,
      },
    };

    const resp = jsonResponse(response, { status: 200, headers: baseHeaders });

    if (cache && !params.nocache && result.data.level !== 'none') {
      const cachePromise = cache.put(cacheKey, resp.clone());
      if (typeof waitUntil === 'function') waitUntil(cachePromise);
      else cachePromise.catch(() => {});
    }

    return resp;
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return sonicError('SYNC_ERROR', err?.message || 'Failed to sync lyrics', 500, {
      provider: 'sync',
      latencyMs,
    });
  }
}
