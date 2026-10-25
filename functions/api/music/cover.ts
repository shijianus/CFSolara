import { handleOptions } from '../../_lib/http';
import { fetchMusicProvider } from '../../_lib/music';
import { getSonicConfig } from '../../_lib/sonic/config';
import {
  callNeteaseLinuxApi,
  resolveKugouCoverUrl,
  resolveNeteaseCoverUrl,
  resolveQQCoverUrl,
} from '../../_lib/sonic/native-protocols';
import { checkEngineAccess, evaluateGatewayRateLimit, buildRateLimitErrorResponse } from '../../_lib/sonic/security';
import { isHostAllowed, safeFetch, validateOutboundUrl } from '../../_lib/sonic/net-guard';
import type { AppEnv } from '../../_lib/types';

const DEFAULT_COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <defs>
    <linearGradient id="sonicCoverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8b5cf6"/>
      <stop offset="50%" stop-color="#ec4899"/>
      <stop offset="100%" stop-color="#3b82f6"/>
    </linearGradient>
  </defs>
  <rect width="300" height="300" rx="28" fill="url(#sonicCoverGrad)"/>
  <circle cx="150" cy="150" r="54" fill="rgba(255,255,255,0.18)"/>
  <path d="M142 118v46a18 18 0 1 0 12 17v-40l24-7v-16z" fill="#ffffff"/>
</svg>`;

function svgResponse(degraded = false): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'image/svg+xml;charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
    'X-Sonic-Cover-Fallback': 'svg',
  };
  if (degraded) headers['X-Sonic-Degraded'] = '1';
  return new Response(DEFAULT_COVER_SVG, { status: 200, headers });
}

function getRefererForHost(hostname: string): string {
  const h = hostname.toLowerCase();
  if (isHostAllowed(h, ['gtimg.cn', 'qq.com'])) return 'https://y.qq.com/';
  if (isHostAllowed(h, ['126.net', '163.com'])) return 'https://music.163.com/';
  if (isHostAllowed(h, ['kugou.com'])) return 'https://www.kugou.com/';
  if (isHostAllowed(h, ['kuwo.cn'])) return 'https://www.kuwo.cn/';
  return '';
}

async function proxyImage(imageUrl: string, providerTag = 'direct', env?: AppEnv): Promise<Response | null> {
  try {
    const validation = validateOutboundUrl(imageUrl, env);
    if (!validation.ok || !validation.url) return null;
    const parsed = validation.url;

    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    };
    const referer = getRefererForHost(parsed.hostname);
    if (referer) headers.Referer = referer;

    const upstream = await safeFetch(
      parsed,
      { headers },
      env,
      { maxRedirects: 3, timeoutMs: 15_000, maxBytes: 20 * 1024 * 1024 },
    );

    if (!upstream.ok) return null;

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!contentType.includes('image/')) return null;

    const respHeaders = new Headers();
    respHeaders.set('Content-Type', contentType);
    const cl = upstream.headers.get('content-length');
    if (cl) respHeaders.set('Content-Length', cl);
    respHeaders.set('Access-Control-Allow-Origin', '*');
    respHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    respHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    respHeaders.set('X-Sonic-Provider', providerTag);

    return new Response(upstream.body, {
      status: 200,
      headers: respHeaders,
    });
  } catch {
    return null;
  }
}

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const engineDenied = checkEngineAccess(request, env);
  if (engineDenied) return engineDenied;
  const rl = await evaluateGatewayRateLimit(request, env, 'music-cover');
  if (!rl.allowed) return buildRateLimitErrorResponse(rl);

  const cfg = getSonicConfig(env);
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url') || url.searchParams.get('target');
  const id = url.searchParams.get('id') || '';
  const source = (url.searchParams.get('source') || 'netease').toLowerCase();
  const artist = url.searchParams.get('artist') || '';
  const cleanId = id.trim();
  const pPrefix = cfg.runtime === 'linux-engine' ? 'local-' : '';

  // 1. Direct URL Proxy Mode (bypasses CORS & anti-hotlinking referer restrictions)
  if (targetUrl) {
    const proxied = await proxyImage(targetUrl, `${pPrefix}proxy`, env);
    if (proxied) return proxied;
  }

  // 2. ID-based Native Resolution
  if (cleanId) {
    if (cleanId.startsWith('http://') || cleanId.startsWith('https://')) {
      const proxied = await proxyImage(cleanId, `${pPrefix}url`, env);
      if (proxied) return proxied;
    }

    // 2.1 NetEase Native (`ncm-api` / `linuxapi` song detail)
    if (source === 'netease' || source === 'ncm' || source === 'sonic' || (source === 'gdstudio' && /^\d+$/.test(cleanId))) {
      const picUrl = await resolveNeteaseCoverUrl(cleanId, env);
      if (picUrl) {
        const proxied = await proxyImage(picUrl, `${pPrefix}netease`, env);
        if (proxied) return proxied;
      }

      if (cfg.enableGdstudio) {
        try {
          const picData = await fetchMusicProvider(env, { types: 'pic', id: cleanId, source: 'netease' });
          if (picData?.url && typeof picData.url === 'string') {
            const proxied = await proxyImage(picData.url, 'gdstudio', env);
            if (proxied) return proxied;
          }
        } catch {}
      }
    }

    // 2.2 QQ Music Native (`albummid` direct + `songmid` -> `albummid` lookup)
    if (source === 'qq' || source === 'tencent') {
      const qqPicUrl = await resolveQQCoverUrl(cleanId, env);
      if (qqPicUrl) {
        const proxied = await proxyImage(qqPicUrl, `${pPrefix}qq`, env);
        if (proxied) return proxied;
      }
      const singerPhotoUrl = `https://y.gtimg.cn/music/photo_new/T001R300x300M000${cleanId}.jpg`;
      const proxiedSinger = await proxyImage(singerPhotoUrl, `${pPrefix}qq-singer`, env);
      if (proxiedSinger) return proxiedSinger;
    }

    // 2.3 Kugou Native (`getSongInfo` hash lookup)
    if (source === 'kugou') {
      const kgPicUrl = await resolveKugouCoverUrl(cleanId, env);
      if (kgPicUrl) {
        const proxied = await proxyImage(kgPicUrl, `${pPrefix}kugou`, env);
        if (proxied) return proxied;
      }
    }
  }

  // 3. Artist Avatar Native Resolution (`ncm-api` or encrypted `linuxapi` type=100)
  if (artist && artist.trim()) {
    const cleanArtist = artist.trim().split(/[/&,、]/)[0]?.trim() || artist.trim();
    if (cfg.ncmApiUrl) {
      try {
        const aRes = await fetch(
          `${cfg.ncmApiUrl}/cloudsearch?keywords=${encodeURIComponent(cleanArtist)}&type=100&limit=1&realIP=${encodeURIComponent(cfg.realIp)}`,
          { signal: AbortSignal.timeout(4000) },
        );
        if (aRes.ok) {
          const aJson = (await aRes.json()) as any;
          const aItem = aJson?.result?.artists?.[0];
          const artPic = aItem?.img1v1Url || aItem?.picUrl;
          if (artPic) {
            const proxied = await proxyImage(String(artPic).replace('http://', 'https://'), `${pPrefix}netease-artist`, env);
            if (proxied) return proxied;
          }
        }
      } catch {}
    }

    try {
      const artJson = await callNeteaseLinuxApi(
        {
          method: 'POST',
          url: 'http://music.163.com/api/cloudsearch/pc',
          params: { s: cleanArtist, type: 100, limit: 1, offset: 0 },
        },
        env,
        AbortSignal.timeout(4500),
      );
      const aItem = artJson?.result?.artists?.[0];
      const artPic = aItem?.img1v1Url || aItem?.picUrl;
      if (artPic) {
        const proxied = await proxyImage(String(artPic).replace('http://', 'https://'), `${pPrefix}netease-artist`, env);
        if (proxied) return proxied;
      }
    } catch {}
  }

  // 4. Guaranteed SVG Fallback (never broken 404 image icon)
  return svgResponse();
}

export const onRequestGet = onRequest;
