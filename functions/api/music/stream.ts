import { corsHeaders, errorResponse, handleOptions, jsonResponse } from '../../_lib/http';
import { resolvePlayableStream } from '../../_lib/sonic/native-protocols';
import { getLocalEngineCircuitSnapshot } from '../../_lib/sonic/local-engine';
import { checkEngineAccess, evaluateGatewayRateLimit, buildRateLimitErrorResponse } from '../../_lib/sonic/security';
import { isHostAllowed, safeFetch, sanitizeErrorForClient, validateOutboundUrl } from '../../_lib/sonic/net-guard';
import { getSonicConfig } from '../../_lib/sonic/config';
import type { AppEnv } from '../../_lib/types';

// Explicit allow-list for caller-supplied stream targets. Exact host or a
// dotted subdomain matches; `includes()` is never used for security decisions.
const STREAM_TARGET_HOSTS = ['kuwo.cn', 'music.126.net', '163.com', 'qq.com', 'kugou.com'];

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse('Method not allowed', 405);
  }

  const engineDenied = checkEngineAccess(request, env);
  if (engineDenied) return engineDenied;
  const rl = await evaluateGatewayRateLimit(request, env, 'music-stream');
  if (!rl.allowed) return buildRateLimitErrorResponse(rl);

  const url = new URL(request.url);
  const targetParam = url.searchParams.get('target');
  const streamMode = (url.searchParams.get('mode') || '').toLowerCase();
  let targetUrl: URL | null = null;
  let resolvedProvider = 'proxy-target';
  let resolvedVia = 'direct-param';
  let resolvedTrial = false;
  let resolvedReferer = '';
  let resolvedCorsSafe = false;
  let degraded = false;
  let degradedReason: string | undefined;
  let circuitState: string | undefined;

  if (targetParam) {
    const validation = validateOutboundUrl(targetParam, env, { allowedHosts: STREAM_TARGET_HOSTS });
    if (!validation.ok || !validation.url) {
      return errorResponse('Invalid target URL', 400);
    }
    targetUrl = validation.url;
    if (isHostAllowed(targetUrl.hostname, ['kuwo.cn'])) resolvedReferer = 'https://www.kuwo.cn/';
    if (isHostAllowed(targetUrl.hostname, ['qq.com'])) resolvedReferer = 'https://y.qq.com/';
  } else {
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
      return errorResponse('缺少歌曲标识 (Parameter id or title is required)', 400);
    }

    try {
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
        const snap = getLocalEngineCircuitSnapshot(env);
        const cfg = getSonicConfig(env);
        const isEngineDegraded = cfg.enableLocalEngine && (snap.state !== 'CLOSED' || Boolean(snap.lastError));

        if (isEngineDegraded) {
          return jsonResponse(
            {
              brand: 'Sonic',
              error: {
                code: 'STREAM_UNAVAILABLE_DEGRADED',
                message: '本地解析引擎暂不可用，边缘降级模式无法获取该曲目音频流',
              },
              degraded: true,
              meta: {
                cached: false,
                cacheLevel: 'none',
                provider: 'none',
                degraded: true,
                degradedReason: snap.lastError || 'local_engine_unavailable',
                circuitState: snap.state,
              },
            },
            {
              status: 503,
              headers: {
                'Cache-Control': 'no-store',
                'X-Sonic-Degraded': '1',
                'X-Sonic-Circuit': snap.state,
                'Access-Control-Expose-Headers': 'X-Sonic-Degraded, X-Sonic-Circuit, X-Sonic-Provider',
              },
            },
          );
        }

        return jsonResponse(
          {
            brand: 'Sonic',
            error: {
              code: 'STREAM_NOT_FOUND',
              message: '无法解析可播放音频流（该曲目可能受版权或地区限制）',
            },
            degraded: false,
            meta: {
              cached: false,
              cacheLevel: 'none',
              provider: 'none',
            },
          },
          { status: 404, headers: { 'Cache-Control': 'no-store' } },
        );
      }

      const resolvedValidation = validateOutboundUrl(resolved.url, env);
      if (!resolvedValidation.ok || !resolvedValidation.url) {
        return errorResponse('解析到的音频流地址无效', 502);
      }
      targetUrl = resolvedValidation.url;

      resolvedProvider = resolved.provider;
      resolvedVia = resolved.via;
      resolvedTrial = resolved.isTrial;
      resolvedReferer = resolved.referer || '';
      resolvedCorsSafe = resolved.corsSafe;
      degraded = resolved.degraded;
      degradedReason = resolved.degradedReason;
      circuitState = resolved.circuitState;
    } catch (err: any) {
      return errorResponse(sanitizeErrorForClient(err, '解析音频流失败'), 502);
    }
  }

  if (!targetUrl) {
    return errorResponse('无法解析音频目标地址', 500);
  }

  // Optional Direct 302 Redirect Mode (when caller explicitly passes `?mode=redirect` AND CDN is HTTPS + CORS/Referer-safe)
  if (streamMode === 'redirect' && targetUrl.protocol === 'https:' && resolvedCorsSafe) {
    const redirectHeaders = corsHeaders();
    redirectHeaders.set('Location', targetUrl.toString());
    redirectHeaders.set('Cache-Control', 'private, max-age=300');
    redirectHeaders.set('X-Sonic-Provider', resolvedProvider);
    redirectHeaders.set('X-Sonic-Via', resolvedVia);
    if (resolvedTrial) redirectHeaders.set('X-Sonic-Stream-Trial', '1');
    if (degraded) redirectHeaders.set('X-Sonic-Degraded', '1');
    return new Response(null, { status: 302, headers: redirectHeaders });
  }

  // Default: Same-Origin Byte-Range Stream Proxy (preserves CORS `Content-Range`, anti-hotlink `Referer`, and HTTPS)
  try {
    const requestHeaders: Record<string, string> = {
      'User-Agent':
        request.headers.get('User-Agent') ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };
    if (resolvedReferer) {
      requestHeaders.Referer = resolvedReferer;
    } else if (isHostAllowed(targetUrl.hostname, ['kuwo.cn'])) {
      requestHeaders.Referer = 'https://www.kuwo.cn/';
    } else if (isHostAllowed(targetUrl.hostname, ['qq.com'])) {
      requestHeaders.Referer = 'https://y.qq.com/';
    }

    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      requestHeaders.Range = rangeHeader;
    }

    const upstream = await safeFetch(
      targetUrl,
      {
        method: request.method,
        headers: requestHeaders,
      },
      env,
      { maxRedirects: 3, timeoutMs: 60_000, maxBytes: 256 * 1024 * 1024 },
    );

    const headers = corsHeaders();
    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
    forwardHeaders.forEach((key) => {
      const val = upstream.headers.get(key);
      if (val) headers.set(key, val);
    });

    if (!headers.has('Accept-Ranges')) {
      headers.set('Accept-Ranges', 'bytes');
    }
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'audio/mpeg');
    }
    headers.set('Cache-Control', 'public, max-age=600');
    headers.set('X-Sonic-Provider', resolvedProvider);
    headers.set('X-Sonic-Via', resolvedVia);
    if (resolvedTrial) headers.set('X-Sonic-Stream-Trial', '1');
    if (degraded) {
      headers.set('X-Sonic-Degraded', '1');
      if (degradedReason) headers.set('X-Sonic-Degraded-Reason', encodeURIComponent(degradedReason));
    }
    if (circuitState) headers.set('X-Sonic-Circuit', circuitState);
    headers.set(
      'Access-Control-Expose-Headers',
      'Content-Range, Content-Length, Accept-Ranges, Content-Type, X-Sonic-Provider, X-Sonic-Via, X-Sonic-Stream-Trial, X-Sonic-Degraded, X-Sonic-Circuit',
    );

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (err: any) {
    console.error('[Sonic Stream] upstream proxy error', err instanceof Error ? err.name : 'unknown');
    return errorResponse('音频数据流传输错误', 502);
  }
}
