import { corsHeaders, handleOptions } from '../../_lib/http';
import { fetchMusicProvider } from '../../_lib/music';
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

function svgResponse(): Response {
  return new Response(DEFAULT_COVER_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml;charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

function getRefererForHost(hostname: string): string {
  const h = hostname.toLowerCase();
  if (h.includes('gtimg.cn') || h.includes('qq.com')) return 'https://y.qq.com/';
  if (h.includes('126.net') || h.includes('163.com')) return 'https://music.163.com/';
  if (h.includes('kugou.com')) return 'https://www.kugou.com/';
  if (h.includes('kuwo.cn')) return 'https://www.kuwo.cn/';
  return '';
}

async function proxyImage(imageUrl: string): Promise<Response | null> {
  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    };
    const referer = getRefererForHost(parsed.hostname);
    if (referer) {
      headers.Referer = referer;
    }

    const upstream = await fetch(parsed.toString(), {
      headers,
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
    });

    if (!upstream.ok) return null;

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const respHeaders = new Headers();
    respHeaders.set('Content-Type', contentType);
    respHeaders.set('Access-Control-Allow-Origin', '*');
    respHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    respHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800');

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

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url') || url.searchParams.get('target');
  const id = url.searchParams.get('id') || '';
  const source = (url.searchParams.get('source') || 'netease').toLowerCase();
  const artist = url.searchParams.get('artist') || '';
  const cleanId = id.trim();

  // 1. Direct URL Proxy Mode (bypasses CORS & anti-hotlinking referer restrictions)
  if (targetUrl) {
    const proxied = await proxyImage(targetUrl);
    if (proxied) return proxied;
  }

  // 2. ID-based Resolution
  if (cleanId) {
    // 2.1 If id is already a full URL, proxy directly
    if (cleanId.startsWith('http://') || cleanId.startsWith('https://')) {
      const proxied = await proxyImage(cleanId);
      if (proxied) return proxied;
    }

    // 2.2 Source: NetEase
    if (source === 'netease' || source === 'gdstudio') {
      try {
        // First try GDStudio/Meting types=pic
        const picData = await fetchMusicProvider(env, {
          types: 'pic',
          id: cleanId,
          source: 'netease',
        });
        if (picData && typeof picData === 'object' && picData.url && typeof picData.url === 'string') {
          const proxied = await proxyImage(picData.url);
          if (proxied) return proxied;
        }
      } catch {}

      // Fallback: NetEase song/detail by id
      try {
        const detailRes = await fetch(
          `https://music.163.com/api/song/detail/?id=${encodeURIComponent(cleanId)}&ids=[${encodeURIComponent(cleanId)}]`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Referer: 'https://music.163.com/',
            },
            signal: AbortSignal.timeout(4000),
          }
        );
        if (detailRes.ok) {
          const detailJson: any = await detailRes.json();
          const song = detailJson?.songs?.[0];
          const picUrl = song?.album?.picUrl || song?.artists?.[0]?.img1v1Url;
          if (picUrl) {
            const proxied = await proxyImage(picUrl);
            if (proxied) return proxied;
          }
        }
      } catch {}
    }

    // 2.3 Source: QQ Music
    if (source === 'qq' || source === 'tencent') {
      // Album cover attempt
      const albumCoverUrl = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${cleanId}.jpg`;
      const proxiedAlbum = await proxyImage(albumCoverUrl);
      if (proxiedAlbum) return proxiedAlbum;

      // Singer photo attempt
      const singerPhotoUrl = `https://y.gtimg.cn/music/photo_new/T001R300x300M000${cleanId}.jpg`;
      const proxiedSinger = await proxyImage(singerPhotoUrl);
      if (proxiedSinger) return proxiedSinger;
    }

    // 2.4 Source: Kugou (Hash)
    if (source === 'kugou') {
      try {
        const kgRes = await fetch(
          `http://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${encodeURIComponent(cleanId)}`,
          {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(4000),
          }
        );
        if (kgRes.ok) {
          const kgJson: any = await kgRes.json();
          const rawCover = kgJson?.album_img || kgJson?.imgUrl;
          if (rawCover) {
            const cleanKgCover = rawCover.replace('{size}', '400').replace('http://', 'https://');
            const proxied = await proxyImage(cleanKgCover);
            if (proxied) return proxied;
          }
        }
      } catch {}
    }
  }

  // 3. Artist Avatar Fallback
  if (artist && artist.trim()) {
    try {
      const artRes = await fetch(
        `https://music.163.com/api/search/get/web?s=${encodeURIComponent(artist.trim())}&type=100&limit=1`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            Referer: 'https://music.163.com/',
          },
          signal: AbortSignal.timeout(4000),
        }
      );
      if (artRes.ok) {
        const artJson: any = await artRes.json();
        const aItem = artJson?.result?.artists?.[0];
        const artPic = aItem?.img1v1Url || aItem?.picUrl;
        if (artPic) {
          const proxied = await proxyImage(artPic.replace('http://', 'https://'));
          if (proxied) return proxied;
        }
      }
    } catch {}
  }

  // 4. Guaranteed Beautiful Fallback (never broken 404 image icon)
  return svgResponse();
}

export const onRequestGet = onRequest;
