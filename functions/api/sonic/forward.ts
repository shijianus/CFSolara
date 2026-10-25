// GET /api/sonic/forward
// Sonic Gateway — Unified Aggregation Forwarding Gateway
// Supports multi-type forwarding: lyrics sync, search aggregation, and external asset proxying.

import { parseLyricsParams, parseSearchParams, sonicError, handleOptions } from '../../_lib/sonic/route-helpers';
import { resolveNexusLyrics } from '../../_lib/sonic/nexus-lyrics';
import { searchNexus } from '../../_lib/sonic/nexus-search';
import { jsonResponse } from '../../_lib/http';
import { sonicLinesToLrc, sonicLinesToTtml } from '../../_lib/sonic/utils';
import { SONIC_UA } from '../../_lib/sonic/config';
import {
  checkEngineAccess,
  evaluateGatewayRateLimit,
  buildRateLimitErrorResponse,
} from '../../_lib/sonic/security';
import { OutboundError, isHostAllowed, safeFetch, sanitizeErrorForClient, validateOutboundUrl } from '../../_lib/sonic/net-guard';

const SAFE_FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
  'expires',
  'cache-control',
];

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse(
      { brand: 'Sonic', error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } },
      { status: 405 },
    );
  }

  const engineDenied = checkEngineAccess(request, env);
  if (engineDenied) return engineDenied;
  const rl = await evaluateGatewayRateLimit(request, env, 'sonic-forward');
  if (!rl.allowed) return buildRateLimitErrorResponse(rl);

  const url = new URL(request.url);
  const type = (url.searchParams.get('type') || '').toLowerCase();
  const targetUrl = url.searchParams.get('url') || url.searchParams.get('target');

  // Case 1: External URL Proxy / Forwarding (e.g. lyrics URL, audio stream, covers)
  if (targetUrl) {
    const validation = validateOutboundUrl(targetUrl, env);
    if (!validation.ok || !validation.url) {
      return sonicError('INVALID_TARGET', 'Only public https URLs are permitted', 400, { provider: 'forward' });
    }

    const parsedTarget = validation.url;
    try {
      const forwardHeaders = new Headers();
      forwardHeaders.set('User-Agent', SONIC_UA);
      const host = parsedTarget.hostname.toLowerCase();
      if (isHostAllowed(host, ['gtimg.cn', 'qq.com'])) forwardHeaders.set('Referer', 'https://y.qq.com/');
      else if (isHostAllowed(host, ['126.net', '163.com'])) forwardHeaders.set('Referer', 'https://music.163.com/');
      else if (isHostAllowed(host, ['kugou.com'])) forwardHeaders.set('Referer', 'https://www.kugou.com/');
      else if (isHostAllowed(host, ['kuwo.cn'])) forwardHeaders.set('Referer', 'https://www.kuwo.cn/');

      const range = request.headers.get('Range');
      if (range) forwardHeaders.set('Range', range);

      // safeFetch revalidates every redirect, refuses HTTPS downgrades and
      // strips caller cookies/authorization before contacting the target.
      const upstreamResp = await safeFetch(
        parsedTarget,
        {
          method: request.method === 'HEAD' ? 'HEAD' : 'GET',
          headers: forwardHeaders,
        },
        env,
        { maxRedirects: 3, timeoutMs: 15_000, maxBytes: 64 * 1024 * 1024 },
      );

      const responseHeaders = new Headers();
      for (const name of SAFE_FORWARD_RESPONSE_HEADERS) {
        const value = upstreamResp.headers.get(name);
        if (value) responseHeaders.set(name, value);
      }
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      responseHeaders.set('X-Sonic-Forwarded', 'true');
      if (!responseHeaders.has('Cache-Control')) {
        responseHeaders.set('Cache-Control', 'public, max-age=300');
      }

      return new Response(upstreamResp.body, {
        status: upstreamResp.status,
        statusText: upstreamResp.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      if (err instanceof OutboundError) {
        return sonicError('INVALID_TARGET', 'Target URL or redirect was rejected', 400, {
          provider: 'forward',
        });
      }
      console.error('[Sonic Forward] proxy error', err instanceof Error ? err.name : 'unknown');
      return sonicError('FORWARD_ERROR', 'Failed to forward request to target', 502, {
        provider: 'forward',
      });
    }
  }

  // Case 2: Search Forwarding (type=search or q is present without lyrics identifiers)
  const query = url.searchParams.get('q') || url.searchParams.get('keyword');
  if (type === 'search' || (query && !url.searchParams.has('title') && !url.searchParams.has('platformId'))) {
    const { page, count, nocache } = parseSearchParams(url);
    if (!query) {
      return sonicError('MISSING_QUERY', 'Search keyword (q or keyword) is required', 400, {
        provider: 'forward',
      });
    }

    const startTime = Date.now();
    try {
      const result = await searchNexus(query, { page, count }, env);
      const latencyMs = Date.now() - startTime;

      return jsonResponse(
        {
          brand: 'Sonic',
          data: result.data,
          meta: {
            cached: false,
            cacheLevel: 'none',
            latencyMs,
            provider: 'nexus',
            forwarded: true,
            attempts: result.attempts,
          },
        },
        {
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Cache-Control': 'public, max-age=3600',
            'X-Sonic-Cache': 'MISS',
            'X-Sonic-Provider': 'nexus',
          },
        },
      );
    } catch (err: any) {
      return sonicError('SEARCH_ERROR', sanitizeErrorForClient(err, 'Search forward failed'), 502, {
        provider: 'forward',
      });
    }
  }

  // Case 3: Lyrics Synchronization Forwarding (Default mode)
  const lyricsParams = parseLyricsParams(url);
  const format = (url.searchParams.get('format') || 'sonic').toLowerCase();

  const hasId = lyricsParams.ncmMusicId || lyricsParams.qqMusicId || lyricsParams.appleMusicId || lyricsParams.spotifyId || lyricsParams.isrc || lyricsParams.platformId;
  if (!lyricsParams.title && !lyricsParams.artist && !hasId) {
    return sonicError('MISSING_PARAMS', 'At least one of: title, artist, or platformId is required for lyrics forward', 400, {
      provider: 'forward',
    });
  }

  // Cloudflare Cache API
  const cache = typeof caches !== 'undefined' ? (caches as any).default : null;
  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.searchParams.sort();
  cacheKeyUrl.searchParams.set('_sonic_cache_v', '2.0');
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

  if (cache && !lyricsParams.nocache) {
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
    const result = await resolveNexusLyrics(lyricsParams, env);
    const latencyMs = Date.now() - startTime;

    const baseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'X-Sonic-Cache': 'MISS',
      'X-Sonic-Provider': result.provider,
      'X-Sonic-Level': result.data.level,
      'X-Sonic-Forwarded': 'true',
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
      if (cache && !lyricsParams.nocache && result.data.level !== 'none') {
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
      if (cache && !lyricsParams.nocache && result.data.level !== 'none') {
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
      if (cache && !lyricsParams.nocache && result.data.level !== 'none') {
        const cachePromise = cache.put(cacheKey, resp.clone());
        if (typeof waitUntil === 'function') waitUntil(cachePromise);
        else cachePromise.catch(() => {});
      }
      return resp;
    }

    // Default: 'sonic' format
    const response = {
      brand: 'Sonic',
      data: result.data,
      meta: {
        cached: false,
        cacheLevel: 'none',
        qualityScore: result.qualityScore,
        matchLevel: result.matchLevel,
        matchScore: result.matchScore,
        latencyMs,
        requested: lyricsParams.prefer || 'auto',
        provider: result.provider,
        attempts: result.attempts,
        forwarded: true,
      },
    };

    const resp = jsonResponse(response, { status: 200, headers: baseHeaders });

    if (cache && !lyricsParams.nocache && result.data.level !== 'none') {
      const cachePromise = cache.put(cacheKey, resp.clone());
      if (typeof waitUntil === 'function') waitUntil(cachePromise);
      else cachePromise.catch(() => {});
    }

    return resp;
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return sonicError('FORWARD_LYRICS_ERROR', sanitizeErrorForClient(err, 'Lyrics forward failed'), 500, {
      provider: 'forward',
      latencyMs,
    });
  }
}
