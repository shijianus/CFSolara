import { corsHeaders, errorResponse, handleOptions } from '../../_lib/http';
import { getTrackStreamUrl, isAllowedKuwoHost } from '../../_lib/music';
import type { AppEnv } from '../../_lib/types';

function sanitizeTargetUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(request.url);
  const targetParam = url.searchParams.get('target');
  let targetUrl: URL | null = null;

  if (targetParam) {
    targetUrl = sanitizeTargetUrl(targetParam);
    if (!targetUrl || (!isAllowedKuwoHost(targetUrl.hostname) && !targetUrl.hostname.includes('music'))) {
      return errorResponse('Invalid target URL', 400);
    }
  } else {
    const id = url.searchParams.get('id');
    const source = url.searchParams.get('source') || 'netease';
    const quality = url.searchParams.get('quality') || url.searchParams.get('br') || '320';

    if (!id) {
      return errorResponse('缺少歌曲 ID (Parameter id is required)', 400);
    }

    try {
      const streamUrl = await getTrackStreamUrl(env, id, source, quality);
      if (!streamUrl) {
        return errorResponse('无法解析可播放音频流 (No stream found)', 404);
      }
      targetUrl = sanitizeTargetUrl(streamUrl);
      if (!targetUrl) {
        return errorResponse('解析到的音频流地址无效', 502);
      }
    } catch (err: any) {
      console.error('[CFSolara Music Stream Error]', err);
      return errorResponse(err?.message || '解析音频流失败', 502);
    }
  }

  // Proxy the audio stream
  try {
    const requestHeaders: Record<string, string> = {
      'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    };
    if (targetUrl.hostname.includes('kuwo.cn')) {
      requestHeaders['Referer'] = 'https://www.kuwo.cn/';
    }

    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      requestHeaders['Range'] = rangeHeader;
    }

    const upstream = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: requestHeaders,
    });

    const headers = corsHeaders();
    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
    forwardHeaders.forEach((key) => {
      const val = upstream.headers.get(key);
      if (val) headers.set(key, val);
    });

    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'audio/mpeg');
    }
    if (!headers.has('Cache-Control')) {
      headers.set('Cache-Control', 'public, max-age=3600');
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (err: any) {
    return errorResponse(`音频数据流传输错误: ${err?.message || 'Proxy error'}`, 502);
  }
}
