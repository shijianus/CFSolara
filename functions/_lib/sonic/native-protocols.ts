// Sonic Gateway — Shared Native Protocol Engine (NetEase / QQ / Kugou / Kuwo)
// Shared 100% between Linux Local Engine (`server/`) and Cloudflare Pages Functions (`functions/`).
// Zero third-party aggregation API reliance by default; VIP paywall circumvention disabled by default.

import type { AppEnv, SongItem } from '../types';
import type { SonicAttempt, SonicSearchTrack } from './types';
import { getSonicConfig } from './config';
import { buildNeteaseEapiParams, buildNeteaseLinuxApiParams } from './crypto';
import { normalizeArtistString, normalizeText, normalizeCjkText, calcLevenshteinSimilarity } from './utils';
import { getSonicCachedJson, putSonicCachedJson } from './cache';
import { callLocalEngineJson, getLocalEngineCircuitSnapshot, type CircuitState } from './local-engine';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

function providerLabel(base: string, env?: AppEnv): string {
  return getSonicConfig(env).runtime === 'linux-engine' ? `local-${base}` : base;
}

function viaLabel(env?: AppEnv, sub?: string): string {
  const base = getSonicConfig(env).runtime === 'linux-engine' ? 'local-engine' : 'cf-direct';
  return sub ? `${base}:${sub}` : base;
}

function toHttpsIfSafe(rawUrl: string): string {
  if (!rawUrl) return '';
  if (
    rawUrl.startsWith('http://') &&
    /(music\.126\.net|gtimg\.cn|kugou\.com|qqmusic\.qq\.com|kuwo\.cn)/i.test(rawUrl)
  ) {
    return rawUrl.replace(/^http:\/\//i, 'https://');
  }
  return rawUrl;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. NETEASE NATIVE PROTOCOLS (`ncm-api` internal container + `linuxapi` + `eapi`)
// ═══════════════════════════════════════════════════════════════════════

export async function callNeteaseLinuxApi(
  innerPayload: Record<string, any>,
  env?: AppEnv,
  signal?: AbortSignal,
): Promise<any> {
  const cfg = getSonicConfig(env);
  const eparams = buildNeteaseLinuxApiParams(innerPayload);
  const cookieParts = ['os=linux', 'appver=1.2.1.198277'];
  if (env?.NETEASE_COOKIE) {
    cookieParts.push(String(env.NETEASE_COOKIE).trim());
  }

  const resp = await fetch('https://music.163.com/api/linux/forward', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Referer: 'https://music.163.com/',
      'X-Real-IP': cfg.realIp,
      'X-Forwarded-For': cfg.realIp,
      Cookie: cookieParts.join('; '),
    },
    body: `eparams=${eparams}`,
    signal: signal || AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!resp.ok) {
    throw new Error(`NetEase linuxapi HTTP ${resp.status}`);
  }
  return resp.json();
}

export async function callNeteaseEapi(
  apiPath: string,
  payload: Record<string, any>,
  env?: AppEnv,
  signal?: AbortSignal,
): Promise<any> {
  const cfg = getSonicConfig(env);
  const fullPayload = {
    ...payload,
    header: JSON.stringify({
      os: 'pc',
      appver: '2.9.7',
      requestId: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    }),
  };
  const params = buildNeteaseEapiParams(apiPath, fullPayload);
  const cookieParts = ['os=pc', 'appver=2.9.7'];
  if (env?.NETEASE_COOKIE) {
    cookieParts.push(String(env.NETEASE_COOKIE).trim());
  }

  const eapiEndpoint = `https://interface3.music.163.com/eapi${apiPath.replace(/^\/api/, '')}`;
  const resp = await fetch(eapiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': `${DESKTOP_UA} NeteaseMusicDesktop/2.9.7.199711`,
      Referer: 'https://music.163.com/',
      'X-Real-IP': cfg.realIp,
      'X-Forwarded-For': cfg.realIp,
      Cookie: cookieParts.join('; '),
    },
    body: `params=${params}`,
    signal: signal || AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!resp.ok) {
    throw new Error(`NetEase eapi HTTP ${resp.status}`);
  }
  return resp.json();
}

function mapNeteaseSongToSonicTrack(item: any): SonicSearchTrack {
  const platformId = String(item.id || '');
  const rawDt = item.dt ?? item.duration ?? 0;
  const durationSec = typeof rawDt === 'number' ? (rawDt > 1000 ? Math.round(rawDt / 1000) : Math.round(rawDt)) : 0;
  const artistsArr = item.ar || item.artists || [];
  const artist = Array.isArray(artistsArr)
    ? normalizeArtistString(artistsArr.map((a: any) => a?.name).filter(Boolean).join(' / '))
    : normalizeArtistString(String(item.artist || '未知歌手'));
  const albumObj = item.al || item.album || {};
  const album = String(albumObj.name || '');
  const rawCover = albumObj.picUrl ? toHttpsIfSafe(String(albumObj.picUrl)) : '';
  const rawArtistPic = artistsArr?.[0]?.img1v1Url || artistsArr?.[0]?.picUrl || '';
  const artistPic = rawArtistPic ? toHttpsIfSafe(String(rawArtistPic)) : '';
  const picId = String(albumObj.pic_str || albumObj.pic || albumObj.id || platformId);
  const cover =
    rawCover ||
    artistPic ||
    (platformId ? `/api/music/cover?id=${encodeURIComponent(platformId)}&source=netease&artist=${encodeURIComponent(artist)}` : '');

  return {
    id: `netease:${platformId}`,
    title: String(item.name || '未知歌曲'),
    name: String(item.name || '未知歌曲'),
    artist: artist || '未知歌手',
    album,
    duration: durationSec,
    cover,
    coverUrl: cover,
    artistPic: artistPic || cover,
    platform: 'netease',
    platformId,
    sources: [
      {
        platform: 'netease',
        platformId,
        duration: durationSec,
      },
    ],
    picId,
    lyricId: platformId,
    urlId: platformId,
    source: 'netease',
  };
}

export async function searchNeteaseNative(
  query: string,
  count = 20,
  page = 1,
  env?: AppEnv,
  signal?: AbortSignal,
): Promise<{ tracks: SonicSearchTrack[]; via: string }> {
  const cfg = getSonicConfig(env);
  const offset = Math.max(0, (page - 1) * count);

  // 1. On Linux VPS with internal NeteaseCloudMusicApiEnhanced container (`ncm-api`)
  if (cfg.ncmApiUrl) {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (env?.NETEASE_COOKIE) headers.Cookie = String(env.NETEASE_COOKIE).trim();
      const u = `${cfg.ncmApiUrl}/cloudsearch?keywords=${encodeURIComponent(query)}&type=1&limit=${count}&offset=${offset}&realIP=${encodeURIComponent(cfg.realIp)}`;
      const res = await fetch(u, {
        headers,
        signal: signal || AbortSignal.timeout(cfg.timeoutMs),
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        const songs = json?.result?.songs;
        if (Array.isArray(songs) && songs.length > 0) {
          return {
            tracks: songs.map(mapNeteaseSongToSonicTrack),
            via: viaLabel(env, 'ncm-api'),
          };
        }
      }
    } catch {}
  }

  // 2. Pure-TS encrypted `linuxapi` (`cloudsearch/pc`) — works identically on Linux & Cloudflare Workers
  const lJson = await callNeteaseLinuxApi(
    {
      method: 'POST',
      url: 'http://music.163.com/api/cloudsearch/pc',
      params: { s: query, type: 1, limit: count, offset },
    },
    env,
    signal,
  );
  const songs = lJson?.result?.songs;
  if (Array.isArray(songs) && songs.length > 0) {
    return {
      tracks: songs.map(mapNeteaseSongToSonicTrack),
      via: viaLabel(env, 'linuxapi'),
    };
  }

  return { tracks: [], via: viaLabel(env, 'linuxapi') };
}

export async function resolveNeteaseCoverUrl(id: string, env?: AppEnv, signal?: AbortSignal): Promise<string> {
  const cleanId = id.replace(/^netease:/i, '').trim();
  if (!/^\d+$/.test(cleanId)) return '';
  const cfg = getSonicConfig(env);

  if (cfg.ncmApiUrl) {
    try {
      const res = await fetch(`${cfg.ncmApiUrl}/song/detail?ids=${encodeURIComponent(cleanId)}&realIP=${encodeURIComponent(cfg.realIp)}`, {
        signal: signal || AbortSignal.timeout(4500),
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        const pic = json?.songs?.[0]?.al?.picUrl;
        if (pic) return toHttpsIfSafe(String(pic));
      }
    } catch {}
  }

  try {
    const numId = Number(cleanId);
    const json = await callNeteaseLinuxApi(
      {
        method: 'POST',
        url: 'http://music.163.com/api/v3/song/detail',
        params: {
          c: JSON.stringify([{ id: numId }]),
          ids: JSON.stringify([numId]),
        },
      },
      env,
      signal || AbortSignal.timeout(4500),
    );
    const pic = json?.songs?.[0]?.al?.picUrl || json?.songs?.[0]?.album?.picUrl;
    if (pic) return toHttpsIfSafe(String(pic));
  } catch {}

  try {
    const eJson = await callNeteaseEapi(
      '/api/v3/song/detail',
      {
        c: JSON.stringify([{ id: Number(cleanId) }]),
        ids: JSON.stringify([Number(cleanId)]),
      },
      env,
      signal || AbortSignal.timeout(4500),
    );
    const pic = eJson?.songs?.[0]?.al?.picUrl;
    if (pic) return toHttpsIfSafe(String(pic));
  } catch {}

  try {
    const dRes = await fetch(
      `https://music.163.com/api/song/detail/?id=${encodeURIComponent(cleanId)}&ids=%5B${encodeURIComponent(cleanId)}%5D`,
      {
        headers: {
          'User-Agent': DESKTOP_UA,
          Referer: 'https://music.163.com/',
        },
        signal: signal || AbortSignal.timeout(4500),
      },
    );
    if (dRes.ok) {
      const dJson = (await dRes.json()) as any;
      const pic = dJson?.songs?.[0]?.album?.picUrl || dJson?.songs?.[0]?.al?.picUrl || dJson?.songs?.[0]?.artists?.[0]?.picUrl;
      if (pic) return toHttpsIfSafe(String(pic));
    }
  } catch {}

  return '';
}

// ═══════════════════════════════════════════════════════════════════════
// 2. QQ MUSIC NATIVE PROTOCOLS (`musicu.fcg` Detail / Cover / `CgiGetVkey`)
// ═══════════════════════════════════════════════════════════════════════

export async function resolveQQCoverUrl(idOrMid: string, env?: AppEnv, signal?: AbortSignal): Promise<string> {
  const clean = idOrMid.replace(/^(qq|tencent):/i, '').trim();
  if (!clean) return '';

  // 1. Resolve `songmid` / `songid` -> `albummid` via `music.pf_song_detail_svr`
  try {
    const isNumeric = /^\d+$/.test(clean);
    const body = {
      comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
      songinfo: {
        method: 'get_song_detail_yqq',
        module: 'music.pf_song_detail_svr',
        param: isNumeric ? { song_id: Number(clean) } : { song_mid: clean },
      },
    };
    const res = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://y.qq.com/',
        Origin: 'https://y.qq.com',
        'User-Agent': DESKTOP_UA,
      },
      body: JSON.stringify(body),
      signal: signal || AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const json = (await res.json()) as any;
      const albumMid = json?.songinfo?.data?.track_info?.album?.mid;
      const singerMid = json?.songinfo?.data?.track_info?.singer?.[0]?.mid;
      if (albumMid && albumMid !== '00000000000000') {
        return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`;
      }
      if (singerMid) {
        return `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singerMid}.jpg`;
      }
    }
  } catch {}

  // 2. Fallback: treat `clean` itself as `albummid` (proxyImage GET will verify 200 image/*)
  if (/^[0-9A-Za-z]{10,20}$/.test(clean)) {
    return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${clean}.jpg`;
  }

  return '';
}

// ═══════════════════════════════════════════════════════════════════════
// 3. KUGOU & KUWO NATIVE PROTOCOLS
// ═══════════════════════════════════════════════════════════════════════

export async function resolveKugouCoverUrl(hash: string, env?: AppEnv, signal?: AbortSignal): Promise<string> {
  const cleanHash = hash.replace(/^kugou:/i, '').trim().toLowerCase();
  if (!cleanHash) return '';
  try {
    const headers: Record<string, string> = {
      Referer: 'https://m.kugou.com/',
      'User-Agent': MOBILE_UA,
    };
    if (env?.KUGOU_COOKIE) headers.Cookie = String(env.KUGOU_COOKIE).trim();
    const res = await fetch(`https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${encodeURIComponent(cleanHash)}`, {
      headers,
      signal: signal || AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const json = (await res.json()) as any;
      const rawImg = json?.album_img || json?.imgUrl || '';
      if (rawImg) {
        return toHttpsIfSafe(String(rawImg).replace('{size}', '400'));
      }
    }
  } catch {}
  return '';
}

export async function searchKuwoNative(
  query: string,
  count = 20,
  page = 1,
  signal?: AbortSignal,
): Promise<SonicSearchTrack[]> {
  try {
    const pn = Math.max(0, page - 1);
    const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(query)}&pn=${pn}&rn=${count}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sonic/2.2.0' },
      signal: signal || AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const rawText = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(rawText);
    } catch {
      json = JSON.parse(rawText.replace(/'/g, '"'));
    }
    const list = Array.isArray(json?.abslist) ? json.abslist : [];
    return list
      .map((it: any): SonicSearchTrack | null => {
        const rid = String(it.MUSICRID || it.DC_TARGETID || '').replace(/^MUSIC_/i, '').trim();
        if (!rid) return null;
        const title = String(it.SONGNAME || it.NAME || '未知歌曲').replace(/&nbsp;/g, ' ');
        const artist = normalizeArtistString(String(it.ARTIST || '未知歌手').replace(/&/g, ' / '));
        const album = String(it.ALBUM || '');
        const duration = parseInt(String(it.DURATION || '0'), 10) || 0;
        const htsPic = it.web_albumpic_short
          ? `https://img2.kuwo.cn/star/albumcover/${String(it.web_albumpic_short).replace(/^120\//, '500/')}`
          : '';
        const cover = htsPic || `/api/music/cover?artist=${encodeURIComponent(artist)}&source=kuwo`;
        return {
          id: `kuwo:${rid}`,
          title,
          name: title,
          artist,
          album,
          duration,
          cover,
          coverUrl: cover,
          platform: 'kuwo',
          platformId: rid,
          sources: [{ platform: 'kuwo', platformId: rid, duration }],
          source: 'kuwo',
          lyricId: rid,
          urlId: rid,
        };
      })
      .filter((x: SonicSearchTrack | null): x is SonicSearchTrack => Boolean(x));
  } catch {
    return [];
  }
}

export async function fetchKuwoLyricsNative(rid: string, signal?: AbortSignal): Promise<string> {
  const cleanRid = rid.replace(/^kuwo:/i, '').replace(/^MUSIC_/i, '').trim();
  if (!/^\d+$/.test(cleanRid)) return '';
  try {
    const res = await fetch(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(cleanRid)}`, {
      headers: { Referer: 'https://m.kuwo.cn/', 'User-Agent': MOBILE_UA },
      signal: signal || AbortSignal.timeout(5000),
    });
    if (!res.ok) return '';
    const json = (await res.json()) as any;
    const lrclist = json?.data?.lrclist;
    if (!Array.isArray(lrclist) || lrclist.length === 0) return '';
    return lrclist
      .map((line: any) => {
        const secNum = parseFloat(String(line.time || '0')) || 0;
        const mins = Math.floor(secNum / 60);
        const secs = (secNum % 60).toFixed(2).padStart(5, '0');
        return `[${String(mins).padStart(2, '0')}:${secs}]${String(line.lineLyric || '').trim()}`;
      })
      .join('\n');
  } catch {
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 4. UNIFIED STREAM RESOLUTION (`resolvePlayableStream`)
// ═══════════════════════════════════════════════════════════════════════

export interface ResolvedStreamInfo {
  url: string;
  provider: string;
  via: string;
  isTrial: boolean;
  streamType?: 'full' | 'trial' | 'unavailable';
  trialDuration?: number;
  br?: number;
  size?: number;
  contentType?: string;
  referer?: string;
  corsSafe: boolean;
  degraded: boolean;
  degradedReason?: string;
  circuitState?: CircuitState;
  attempts: SonicAttempt[];
}

function mapQualityToNeteaseLevel(quality: string): { level: string; encodeType: string } {
  const q = String(quality || '320').toLowerCase();
  if (q === 'flac' || q === 'lossless' || q === '999') {
    return { level: 'lossless', encodeType: 'flac' };
  }
  if (q === '320' || q === 'exhigh') {
    return { level: 'exhigh', encodeType: 'mp3' };
  }
  if (q === '192' || q === 'higher') {
    return { level: 'higher', encodeType: 'mp3' };
  }
  return { level: 'standard', encodeType: 'mp3' };
}

async function resolveNeteaseSingleStream(
  songId: string,
  quality: string,
  env?: AppEnv,
): Promise<{
  url: string;
  isTrial: boolean;
  br?: number;
  size?: number;
  contentType?: string;
  via: string;
} | null> {
  const cleanId = songId.replace(/^netease:/i, '').trim();
  if (!/^\d+$/.test(cleanId)) return null;
  const cfg = getSonicConfig(env);
  const { level, encodeType } = mapQualityToNeteaseLevel(quality);

  // 1. Try internal `ncm-api` container on Linux VPS first
  if (cfg.ncmApiUrl) {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (env?.NETEASE_COOKIE) headers.Cookie = String(env.NETEASE_COOKIE).trim();
      const u = `${cfg.ncmApiUrl}/song/url/v1?id=${encodeURIComponent(cleanId)}&level=${encodeURIComponent(level)}&realIP=${encodeURIComponent(cfg.realIp)}`;
      const res = await fetch(u, { headers, signal: AbortSignal.timeout(cfg.timeoutMs) });
      if (res.ok) {
        const json = (await res.json()) as any;
        const item = json?.data?.[0];
        if (item?.url && typeof item.url === 'string') {
          const type = String(item.type || '').toLowerCase();
          const isTrial = Boolean(item.freeTrialInfo);
          const trialDuration = isTrial && item.freeTrialInfo ? Math.max(0, (item.freeTrialInfo.end || 30) - (item.freeTrialInfo.start || 0)) : (isTrial ? 30 : undefined);
          return {
            url: toHttpsIfSafe(item.url),
            isTrial,
            trialDuration,
            br: typeof item.br === 'number' ? item.br : undefined,
            size: typeof item.size === 'number' ? item.size : undefined,
            contentType: type === 'flac' ? 'audio/flac' : 'audio/mpeg',
            via: viaLabel(env, 'ncm-api'),
          };
        }
      }
    } catch {}
  }

  // 2. Pure-TS `eapi` `/api/song/enhance/player/url/v1`
  const eJson = await callNeteaseEapi(
    '/api/song/enhance/player/url/v1',
    {
      ids: JSON.stringify([Number(cleanId)]),
      level,
      encodeType,
    },
    env,
  );
  const item = eJson?.data?.[0];
  if (item?.url && typeof item.url === 'string') {
    const type = String(item.type || '').toLowerCase();
    const isTrial = Boolean(item.freeTrialInfo);
    const trialDuration = isTrial && item.freeTrialInfo ? Math.max(0, (item.freeTrialInfo.end || 30) - (item.freeTrialInfo.start || 0)) : (isTrial ? 30 : undefined);
    return {
      url: toHttpsIfSafe(item.url),
      isTrial,
      trialDuration,
      br: typeof item.br === 'number' ? item.br : undefined,
      size: typeof item.size === 'number' ? item.size : undefined,
      contentType: type === 'flac' ? 'audio/flac' : 'audio/mpeg',
      via: viaLabel(env, 'eapi'),
    };
  }
  return null;
}

async function resolveQQSingleStream(
  mid: string,
  env?: AppEnv,
): Promise<{ url: string; via: string } | null> {
  const cleanMid = mid.replace(/^(qq|tencent):/i, '').trim();
  if (!cleanMid) return null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Referer: 'https://y.qq.com/',
    Origin: 'https://y.qq.com',
    'User-Agent': DESKTOP_UA,
  };
  if (env?.QQ_COOKIE) headers.Cookie = String(env.QQ_COOKIE).trim();

  const res = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          guid: '358840384',
          songmid: [cleanMid],
          songtype: [0],
          uin: '0',
          loginflag: 1,
          platform: '20',
        },
      },
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as any;
  const info = json?.req_0?.data?.midurlinfo?.[0];
  if (!info?.purl) return null;

  const sips: string[] = Array.isArray(json?.req_0?.data?.sip) ? json.req_0.data.sip : [];
  const httpsSip = sips.find((s) => s.startsWith('https://')) || 'https://ws.stream.qqmusic.qq.com/';
  return {
    url: `${httpsSip}${info.purl}`,
    via: viaLabel(env, 'qq-vkey'),
  };
}

async function resolveKugouSingleStream(
  hash: string,
  env?: AppEnv,
): Promise<{ url: string; size?: number; via: string } | null> {
  const cleanHash = hash.replace(/^kugou:/i, '').trim().toLowerCase();
  if (!cleanHash) return null;
  const headers: Record<string, string> = {
    Referer: 'https://m.kugou.com/',
    'User-Agent': MOBILE_UA,
  };
  if (env?.KUGOU_COOKIE) headers.Cookie = String(env.KUGOU_COOKIE).trim();

  const res = await fetch(`https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${encodeURIComponent(cleanHash)}`, {
    headers,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as any;
  if (!json?.url || typeof json.url !== 'string') return null;
  return {
    url: toHttpsIfSafe(json.url),
    size: typeof json.fileSize === 'number' ? json.fileSize : undefined,
    via: viaLabel(env, 'kugou-playinfo'),
  };
}

async function resolveKuwoSingleStream(
  rid: string,
  env?: AppEnv,
): Promise<{ url: string; size?: number; via: string } | null> {
  const cleanRid = rid.replace(/^kuwo:/i, '').replace(/^MUSIC_/i, '').trim();
  if (!/^\d+$/.test(cleanRid)) return null;

  const antiRes = await fetch(
    `http://antiserver.kuwo.cn/anti.s?type=convert_url&rid=${encodeURIComponent(cleanRid)}&format=mp3&response=url`,
    {
      headers: {
        'User-Agent': 'okhttp/3.10.0',
        Referer: 'https://www.kuwo.cn/',
      },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!antiRes.ok) return null;
  const rawUrl = (await antiRes.text()).trim();
  if (!rawUrl.startsWith('http')) return null;

  // Reject Kuwo's 181KB copyright/region voice prompt clip (`/nf/resource/.../588957081.mp3`)
  if (/\/nf\/resource\//i.test(rawUrl) || rawUrl.includes('588957081.mp3')) {
    return null;
  }

  const finalUrl = toHttpsIfSafe(rawUrl);
  // Verify byte length via 1-byte Range probe to guarantee full-length real audio (>= 350 KB)
  try {
    const probe = await fetch(finalUrl, {
      headers: { Range: 'bytes=0-0', Referer: 'https://www.kuwo.cn/', 'User-Agent': DESKTOP_UA },
      signal: AbortSignal.timeout(4000),
    });
    const cr = probe.headers.get('content-range') || '';
    const cl = probe.headers.get('content-length') || '';
    probe.body?.cancel?.().catch(() => {});
    const m = cr.match(/\/(\d+)$/);
    const totalBytes = m ? parseInt(m[1], 10) : parseInt(cl, 10) || 0;
    if ((probe.status !== 200 && probe.status !== 206) || totalBytes < 350_000) {
      return null;
    }
    return {
      url: finalUrl,
      size: totalBytes,
      via: viaLabel(env, 'kuwo-antiserver'),
    };
  } catch {
    return null;
  }
}

export function evaluateStreamTypeByRelativeBytes(
  totalBytes: number,
  expectedDurationSec?: number,
  nominalBitrateKbps = 320,
): { streamType: 'full' | 'trial' | 'unavailable'; ratio: number; baselineBytes: number } {
  if (!totalBytes || totalBytes <= 0) {
    return { streamType: 'unavailable', ratio: 0, baselineBytes: 0 };
  }
  // 1. Strict rejection of known fake prompt audio clips
  // Kuwo fake 11s prompt audio is exactly 181,521 bytes
  if (totalBytes === 181521) {
    return { streamType: 'unavailable', ratio: 0, baselineBytes: 0 };
  }

  // 2. Determine effective duration: fallback to 200s if unknown or suspiciously short
  const duration = expectedDurationSec && expectedDurationSec > 30 ? expectedDurationSec : 200;

  // 3. Lowest acceptable bitrate for full audio streaming
  // For requested/nominal bitrate (e.g. 320kbps), full track must deliver at least 55% of nominal bitrate,
  // and never below 96kbps (12 KB/s) absolute floor.
  const effBitrateKbps = Math.max(96, nominalBitrateKbps * 0.55);
  const baselineBytes = Math.round(duration * ((effBitrateKbps * 1000) / 8));

  const ratio = totalBytes / baselineBytes;

  // If actual bytes are >= 85% of baseline bytes, it is a full stream;
  // otherwise it is a trial preview.
  const isFull = ratio >= 0.85;

  return {
    streamType: isFull ? 'full' : 'trial',
    ratio,
    baselineBytes,
  };
}

// ── Physical stream quality: real MP3 frame-header bitrate + duration ratio ──
// Audit fix #3: the previous relative-bytes heuristic keyed on the *nominal*
// requested bitrate and misjudged short complete tracks, 48kbps full streams
// and lossless requests served as 320k MP3. We now read the actual MP3 frame
// header (via a small Range fetch) to get the real bitrate, derive the real
// duration from total bytes, and compare it against the expected duration.

const MPEG1_L3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG1_L2_KBPS = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0];
const MPEG1_L1_KBPS = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0];
const MPEG2_L1_KBPS = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0];
const MPEG2_L23_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

export interface Mp3HeaderInfo {
  bitrateKbps: number;
  sampleRateHz: number;
  mpegVersion: 1 | 2 | 25;
  layer: 1 | 2 | 3;
  frameOffset: number;
}

/** Parse the first MP3 frame header found in `bytes` (skipping a leading ID3v2 tag). */
export function parseMp3FrameHeader(bytes: Uint8Array): Mp3HeaderInfo | null {
  if (!bytes || bytes.length < 4) return null;
  let start = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    // ID3v2 header: syncsafe 28-bit size in bytes 6..9 (excludes the 10-byte header)
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    start = 10 + size;
    if (bytes[5] & 0x10) start += 10; // footer present
  }
  const end = Math.min(bytes.length - 3, start + 4096);
  for (let i = Math.max(0, start); i < end; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (bytes[i + 1] >> 3) & 0x03; // 00=2.5, 01=reserved, 10=2, 11=1
    const layerBits = (bytes[i + 1] >> 1) & 0x03; // 00=reserved, 01=III, 10=II, 11=I
    const brIdx = (bytes[i + 2] >> 4) & 0x0f;
    const srIdx = (bytes[i + 2] >> 2) & 0x03;
    if (versionBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    const mpegVersion = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25;
    const layer = layerBits === 1 ? 3 : layerBits === 2 ? 2 : 1;
    let table: number[];
    if (mpegVersion === 1) {
      table = layer === 3 ? MPEG1_L3_KBPS : layer === 2 ? MPEG1_L2_KBPS : MPEG1_L1_KBPS;
    } else {
      table = layer === 1 ? MPEG2_L1_KBPS : MPEG2_L23_KBPS;
    }
    const bitrateKbps = table[brIdx];
    const srBase = mpegVersion === 1 ? [44100, 48000, 32000] : mpegVersion === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
    const sampleRateHz = srBase[srIdx];
    if (!bitrateKbps || !sampleRateHz) continue;
    return { bitrateKbps, sampleRateHz, mpegVersion, layer, frameOffset: i };
  }
  return null;
}

// Fake "region prompt" clips observed in the wild are ~11s voice prompts around
// 181,521 bytes. Reject the exact signature fast, plus a bounded byte-range
// whose *derived duration* is implausibly short for any real track.
const FAKE_CLIP_EXACT_BYTES = 181_521;
const FAKE_CLIP_BYTES_LOW = 100_000;
const FAKE_CLIP_BYTES_HIGH = 300_000;
const FAKE_CLIP_MAX_DURATION_SEC = 15;

export interface StreamQualityAssessment {
  streamType: 'full' | 'trial' | 'unavailable';
  /** duration ratio (real-bitrate path) or byte ratio (fallback path) */
  ratio: number;
  realBitrateKbps?: number;
  estimatedDurationSec?: number;
  method: 'mp3-frame-header' | 'byte-ratio-fallback' | 'fake-clip-signature';
  confidence: 'high' | 'medium' | 'low';
  baselineBytes?: number;
}

/**
 * Duration-based stream quality evaluation.
 * - With a parsed MP3 frame header: realDuration = totalBytes*8/realBitrate;
 *   full when realDuration >= 90% of the expected duration.
 * - Without a parseable header (FLAC/other containers): conservative
 *   byte-ratio fallback (old heuristic) with confidence:'low'.
 * - Unknown/zero expected duration falls back to a 240s baseline at
 *   confidence:'medium'.
 */
export function evaluateStreamQuality(
  totalBytes: number,
  expectedDurationSec: number | undefined,
  headBytes?: Uint8Array | null,
  nominalBitrateKbps = 320,
): StreamQualityAssessment {
  if (!totalBytes || totalBytes <= 0) {
    return { streamType: 'unavailable', ratio: 0, method: 'byte-ratio-fallback', confidence: 'high' };
  }
  if (totalBytes === FAKE_CLIP_EXACT_BYTES) {
    return { streamType: 'unavailable', ratio: 0, method: 'fake-clip-signature', confidence: 'high' };
  }

  const header = headBytes ? parseMp3FrameHeader(headBytes) : null;
  if (header) {
    const estimatedDurationSec = (totalBytes * 8) / (header.bitrateKbps * 1000);
    // Bounded fake-clip rule: prompt-audio byte range + implausibly short runtime.
    if (totalBytes >= FAKE_CLIP_BYTES_LOW && totalBytes <= FAKE_CLIP_BYTES_HIGH && estimatedDurationSec < FAKE_CLIP_MAX_DURATION_SEC) {
      return {
        streamType: 'unavailable',
        ratio: 0,
        realBitrateKbps: header.bitrateKbps,
        estimatedDurationSec,
        method: 'mp3-frame-header',
        confidence: 'high',
      };
    }
    const hasExpected = Number.isFinite(expectedDurationSec) && (expectedDurationSec ?? 0) > 0;
    const expected = hasExpected ? (expectedDurationSec as number) : 240;
    const ratio = estimatedDurationSec / expected;
    return {
      streamType: ratio >= 0.9 ? 'full' : 'trial',
      ratio,
      realBitrateKbps: header.bitrateKbps,
      estimatedDurationSec,
      method: 'mp3-frame-header',
      confidence: hasExpected ? 'high' : 'medium',
    };
  }

  // Header unparseable (FLAC/AAC/short body): conservative byte-ratio fallback.
  const fallback = evaluateStreamTypeByRelativeBytes(totalBytes, expectedDurationSec, nominalBitrateKbps);
  return {
    streamType: fallback.streamType,
    ratio: fallback.ratio,
    method: 'byte-ratio-fallback',
    confidence: 'low',
    baselineBytes: fallback.baselineBytes,
  };
}

export interface ProbeStreamQualityResult {
  streamType: 'full' | 'trial' | 'unavailable';
  totalBytes: number;
  ratio: number;
  realBitrateKbps?: number;
  estimatedDurationSec?: number;
  method?: StreamQualityAssessment['method'];
  confidence?: StreamQualityAssessment['confidence'];
}

const PROBE_HEAD_RANGE_BYTES = 65_535; // covers typical ID3v2 tags + first frames

async function readHeadBytes(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  try {
    if (!res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
      }
      if (chunks.length >= 4) break; // first few TCP chunks carry the header
    }
    reader.cancel().catch(() => {});
    if (chunks.length === 0) return null;
    const head = new Uint8Array(Math.min(received, maxBytes));
    let offset = 0;
    for (const c of chunks) {
      if (offset >= head.length) break;
      head.set(c.subarray(0, Math.min(c.length, head.length - offset)), offset);
      offset += Math.min(c.length, head.length - offset);
    }
    return head;
  } catch {
    return null;
  }
}

export async function probeStreamPhysicalQuality(
  url: string,
  referer?: string,
  timeoutMs = 2000,
  expectedDurationSec?: number,
  nominalBitrateKbps = 320,
): Promise<ProbeStreamQualityResult> {
  try {
    const headers: Record<string, string> = {
      Range: `bytes=0-${PROBE_HEAD_RANGE_BYTES}`,
      'User-Agent': DESKTOP_UA,
    };
    if (referer) headers.Referer = referer;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const cr = res.headers.get('content-range') || '';
    const cl = res.headers.get('content-length') || '';
    const headBytes = await readHeadBytes(res, PROBE_HEAD_RANGE_BYTES + 1);

    if (res.status !== 200 && res.status !== 206) {
      return { streamType: 'unavailable', totalBytes: 0, ratio: 0 };
    }

    // A 206 without Content-Range tells us nothing about the total size.
    if (res.status === 206 && !cr.includes('/')) {
      return { streamType: 'unavailable', totalBytes: 0, ratio: 0, confidence: 'low' };
    }

    const m = cr.match(/\/(\d+)$/);
    const total = m ? parseInt(m[1], 10) : parseInt(cl, 10);
    const totalBytes = isNaN(total) ? 0 : total;

    const evaluation = evaluateStreamQuality(totalBytes, expectedDurationSec, headBytes, nominalBitrateKbps);
    return {
      streamType: evaluation.streamType,
      totalBytes,
      ratio: evaluation.ratio,
      realBitrateKbps: evaluation.realBitrateKbps,
      estimatedDurationSec: evaluation.estimatedDurationSec,
      method: evaluation.method,
      confidence: evaluation.confidence,
    };
  } catch {
    return { streamType: 'unavailable', totalBytes: 0, ratio: 0 };
  }
}

export function titlesMatchStrictly(targetTitle: string, candidateTitle: string): boolean {
  const tNorm = normalizeCjkText(targetTitle);
  const cNorm = normalizeCjkText(candidateTitle);
  if (!tNorm || !cNorm) return false;

  // Anti-mismatch keyword exclusions: candidate must not be live/remix/cover/accompaniment unless target was
  const negativeKeywords = ['live', '现场', 'remix', '伴奏', 'instrumental', 'cover', '翻唱', 'dj'];
  for (const kw of negativeKeywords) {
    if (!tNorm.includes(kw) && cNorm.includes(kw)) {
      return false;
    }
  }

  if (tNorm === cNorm) return true;
  if (cNorm.startsWith(tNorm) && cNorm.length <= tNorm.length + 4) return true;
  return false;
}

export function artistsMatchStrictly(targetArtist: string, candidateArtist: string, minSimilarity = 0.85): boolean {
  if (!targetArtist) return true;
  const sim = calcLevenshteinSimilarity(targetArtist, candidateArtist);
  return sim >= minSimilarity;
}

export interface ResolveStreamOptions {
  id: string;
  source?: string;
  quality?: string;
  title?: string;
  artist?: string;
  durationSec?: number;
  allowTrial?: boolean;
  nocache?: boolean;
  request?: Request;
}

export async function resolvePlayableStream(
  opts: ResolveStreamOptions,
  env?: AppEnv,
): Promise<ResolvedStreamInfo | null> {
  const cfg = getSonicConfig(env);
  let cleanId = String(opts.id || '').trim();
  let cleanSource = String(opts.source || 'netease').toLowerCase().trim();
  if (cleanId.includes(':')) {
    const parts = cleanId.split(':');
    cleanSource = (parts[0] || cleanSource).toLowerCase();
    cleanId = parts.slice(1).join(':');
  }
  if (cleanSource === 'tencent') cleanSource = 'qq';
  if (cleanSource === 'ncm' || cleanSource === 'sonic') cleanSource = 'netease';

  const quality = String(opts.quality || '320').toLowerCase();
  const nominalBr = quality === '128' ? 128 : quality === 'flac' ? 800 : 320;
  const allowTrial = opts.allowTrial !== false;
  const cacheId = `${cleanSource}:${cleanId}:${quality}:${normalizeText(opts.title || '')}:${normalizeText(opts.artist || '')}`;

  // 1. Fresh cache check (8 minutes — well within signed CDN token TTL)
  if (!opts.nocache) {
    const cached = await getSonicCachedJson<ResolvedStreamInfo>('stream-url-v1', cacheId, env);
    if (cached && cached.value?.url) {
      return {
        ...cached.value,
        attempts: [
          ...(cached.value.attempts || []),
          { provider: cached.value.provider, via: `cache:${cached.cacheLevel}`, ok: true, ms: 0 },
        ],
      };
    }
  }

  const attempts: SonicAttempt[] = [];
  let degraded = false;
  let degradedReason: string | undefined;
  let circuitState: CircuitState | undefined;

  // 2. If running on Cloudflare Pages with Linux Local Engine configured: call VPS first!
  if (cfg.enableLocalEngine) {
    const q = new URLSearchParams({
      id: cleanId,
      source: cleanSource,
      quality,
    });
    if (opts.title) q.set('title', opts.title);
    if (opts.artist) q.set('artist', opts.artist);
    if (opts.durationSec) q.set('duration', String(opts.durationSec));
    if (!allowTrial) q.set('allowTrial', '0');
    if (opts.nocache) q.set('nocache', '1');

    const engineRes = await callLocalEngineJson<{ ok: boolean; data?: ResolvedStreamInfo; attempts?: SonicAttempt[]; error?: string }>(
      `/api/sonic/resolve/stream?${q.toString()}`,
      env,
      { request: opts.request, timeoutMs: cfg.engineTimeoutMs },
    );
    circuitState = engineRes.circuitState;

    if (engineRes.ok && engineRes.data?.data?.url) {
      const resolved = engineRes.data.data;
      const mergedAttempts: SonicAttempt[] = [
        { provider: 'local-engine', via: 'local-engine', ok: true, ms: engineRes.latencyMs },
        ...(resolved.attempts || []),
      ];
      const finalInfo: ResolvedStreamInfo = {
        ...resolved,
        degraded: false,
        circuitState: 'CLOSED',
        attempts: mergedAttempts,
      };
      if (!opts.nocache) {
        await putSonicCachedJson('stream-url-v1', cacheId, finalInfo, 480, 1200, env);
      }
      return finalInfo;
    }

    // Engine unreachable / 5xx / circuit OPEN -> enter explicit degraded mode!
    if (engineRes.skippedByCircuit || !engineRes.status || engineRes.status >= 500) {
      degraded = true;
      degradedReason = engineRes.error || 'local_engine_unavailable';
      attempts.push({
        provider: 'local-engine',
        via: 'local-engine',
        ok: false,
        ms: engineRes.latencyMs,
        error: degradedReason,
      });

      // Check stale cache (up to 20 min) before hitting CF direct fallback
      const staleHit = await getSonicCachedJson<ResolvedStreamInfo>('stream-url-v1', cacheId, env, { allowStale: true });
      if (staleHit?.value?.url) {
        return {
          ...staleHit.value,
          degraded: true,
          degradedReason: `served_stale_cache (${degradedReason})`,
          circuitState,
          attempts: [
            ...attempts,
            { provider: staleHit.value.provider, via: `stale-cache:${staleHit.cacheLevel}`, ok: true, ms: 0 },
          ],
        };
      }
    } else if (engineRes.data?.attempts) {
      // Engine responded 404 (genuinely unplayable track even on VPS) — preserve its honest attempts!
      attempts.push(...engineRes.data.attempts);
      return null;
    }
  }

  // 3. Local / Direct Native Protocol Resolution
  let trialCandidate: ResolvedStreamInfo | null = null;

  if (cleanId) {
    const pStart = Date.now();
    const pLabel = providerLabel(cleanSource, env);
    try {
      if (cleanSource === 'netease' && cfg.enableNetease) {
        const ne = await resolveNeteaseSingleStream(cleanId, quality, env);
        if (ne?.url && !ne.isTrial) {
          attempts.push({ provider: pLabel, via: ne.via, ok: true, ms: Date.now() - pStart });
          const out: ResolvedStreamInfo = {
            url: ne.url,
            provider: pLabel,
            via: ne.via,
            isTrial: false,
            streamType: 'full',
            br: ne.br,
            size: ne.size,
            contentType: ne.contentType,
            corsSafe: true,
            degraded,
            degradedReason,
            circuitState,
            attempts,
          };
          if (!opts.nocache) await putSonicCachedJson('stream-url-v1', cacheId, out, 480, 1200, env);
          return out;
        } else if (ne?.url && ne.isTrial) {
          attempts.push({
            provider: pLabel,
            via: ne.via,
            ok: allowTrial,
            ms: Date.now() - pStart,
            error: 'VIP/fee=1 track returned trial preview only (unblock disabled)',
          });
          if (allowTrial) {
            trialCandidate = {
              url: ne.url,
              provider: pLabel,
              via: ne.via,
              isTrial: true,
              streamType: 'trial',
              trialDuration: ne.trialDuration || 30,
              br: ne.br,
              size: ne.size,
              contentType: ne.contentType,
              corsSafe: true,
              degraded,
              degradedReason,
              circuitState,
              attempts: [...attempts],
            };
          }
        } else {
          attempts.push({ provider: pLabel, via: viaLabel(env), ok: false, ms: Date.now() - pStart, error: 'No direct URL returned' });
        }
      } else if (cleanSource === 'qq' && cfg.enableQq) {
        const qq = await resolveQQSingleStream(cleanId, env);
        if (qq?.url) {
          const probe = await probeStreamPhysicalQuality(qq.url, 'https://y.qq.com/', 2000, opts.durationSec, nominalBr);
          const isFull = probe.streamType === 'full';
          attempts.push({ provider: pLabel, via: qq.via, ok: true, ms: Date.now() - pStart });
          const out: ResolvedStreamInfo = {
            url: qq.url,
            provider: pLabel,
            via: qq.via,
            isTrial: !isFull,
            streamType: isFull ? 'full' : 'trial',
            trialDuration: isFull ? undefined : 30,
            contentType: 'audio/mp4',
            referer: 'https://y.qq.com/',
            corsSafe: false,
            degraded,
            degradedReason,
            circuitState,
            attempts,
          };
          if (isFull) {
            if (!opts.nocache) await putSonicCachedJson('stream-url-v1', cacheId, out, 480, 1200, env);
            return out;
          } else if (allowTrial) {
            trialCandidate = out;
          }
        }
        attempts.push({ provider: pLabel, via: viaLabel(env, 'qq-vkey'), ok: false, ms: Date.now() - pStart, error: 'Empty vkey purl (region or VIP restricted)' });
      } else if (cleanSource === 'kugou' && cfg.enableKugou) {
        const kg = await resolveKugouSingleStream(cleanId, env);
        if (kg?.url) {
          const probe = await probeStreamPhysicalQuality(kg.url, 'https://m.kugou.com/', 2000, opts.durationSec, nominalBr);
          const sizeEval = typeof kg.size === 'number' ? evaluateStreamTypeByRelativeBytes(kg.size, opts.durationSec, nominalBr) : null;
          const isFull = probe.streamType === 'full' || sizeEval?.streamType === 'full';
          attempts.push({ provider: pLabel, via: kg.via, ok: true, ms: Date.now() - pStart });
          const out: ResolvedStreamInfo = {
            url: kg.url,
            provider: pLabel,
            via: kg.via,
            isTrial: !isFull,
            streamType: isFull ? 'full' : 'trial',
            trialDuration: isFull ? undefined : 30,
            size: probe.totalBytes || kg.size,
            contentType: 'audio/mpeg',
            corsSafe: true,
            degraded,
            degradedReason,
            circuitState,
            attempts,
          };
          if (isFull) {
            if (!opts.nocache) await putSonicCachedJson('stream-url-v1', cacheId, out, 480, 1200, env);
            return out;
          } else if (allowTrial) {
            trialCandidate = out;
          }
        }
        attempts.push({ provider: pLabel, via: viaLabel(env, 'kugou-playinfo'), ok: false, ms: Date.now() - pStart, error: 'Empty playInfo url (VIP or region restricted)' });
      } else if (cleanSource === 'kuwo' && cfg.enableKuwo) {
        const kw = await resolveKuwoSingleStream(cleanId, env);
        if (kw?.url) {
          attempts.push({ provider: pLabel, via: kw.via, ok: true, ms: Date.now() - pStart });
          const out: ResolvedStreamInfo = {
            url: kw.url,
            provider: pLabel,
            via: kw.via,
            isTrial: false,
            streamType: 'full',
            size: kw.size,
            contentType: 'audio/mpeg',
            referer: 'https://www.kuwo.cn/',
            corsSafe: false,
            degraded,
            degradedReason,
            circuitState,
            attempts,
          };
          if (!opts.nocache) await putSonicCachedJson('stream-url-v1', cacheId, out, 480, 1200, env);
          return out;
        }
        attempts.push({ provider: pLabel, via: viaLabel(env, 'kuwo-antiserver'), ok: false, ms: Date.now() - pStart, error: 'Restricted or rejected 181KB region prompt' });
      }
    } catch (err: any) {
      attempts.push({ provider: pLabel, via: viaLabel(env), ok: false, ms: Date.now() - pStart, error: err?.message || 'Native stream error' });
    }
  }

  // 4. Legitimate Free-Catalog Cross-Platform Match (ONLY matches genuinely free full songs; never bypasses VIP DRM)
  const searchKeywords = [opts.title, opts.artist].filter(Boolean).join(' ').trim();
  if (cfg.enableFreeCrossMatch && searchKeywords && opts.title) {
    const budgetMs = cfg.crossMatchBudgetMs;
    const matchStart = Date.now();
    const isBudgetExceeded = () => Date.now() - matchStart >= budgetMs;

    // 4a. Try NetEase free catalog (`fee=0/8`, non-trial) if primary wasn't NetEase
    if (cleanSource !== 'netease' && cfg.enableNetease && !isBudgetExceeded()) {
      const sStart = Date.now();
      const label = providerLabel('netease', env);
      try {
        const neSearch = await searchNeteaseNative(searchKeywords, 5, 1, env);
        const match = neSearch.tracks.find(
          (t) =>
            titlesMatchStrictly(opts.title!, t.title) &&
            artistsMatchStrictly(opts.artist || '', t.artist, cfg.crossMatchArtistSimilarity) &&
            (!opts.durationSec || !t.duration || Math.abs(t.duration - opts.durationSec) <= cfg.crossMatchDurationToleranceSec),
        );
        if (match) {
          const neStream = await resolveNeteaseSingleStream(match.platformId, quality, env);
          if (neStream?.url && !neStream.isTrial) {
            const probe = await probeStreamPhysicalQuality(neStream.url, undefined, 2000, match.duration || opts.durationSec, nominalBr);
            if (probe.streamType === 'full') {
              attempts.push({ provider: label, via: `${neStream.via}:free-match`, ok: true, ms: Date.now() - sStart });
              const out: ResolvedStreamInfo = {
                url: neStream.url,
                provider: label,
                via: `${neStream.via}:free-match`,
                isTrial: false,
                streamType: 'full',
                br: neStream.br,
                size: probe.totalBytes || neStream.size,
                contentType: neStream.contentType,
                corsSafe: true,
                degraded,
                degradedReason,
                circuitState,
                attempts,
              };
              if (!opts.nocache) await putSonicCachedJson('stream-url-v1', cacheId, out, 480, 1200, env);
              return out;
            }
          }
        }
        attempts.push({ provider: label, via: viaLabel(env, 'free-match'), ok: false, ms: Date.now() - sStart, error: 'No verified free full-length match' });
      } catch (err: any) {
        attempts.push({ provider: label, via: viaLabel(env, 'free-match'), ok: false, ms: Date.now() - sStart, error: err?.message });
      }
    }

    // 4b. Try Kugou genuinely free (`privilege=0`) tracks
    if (cleanSource !== 'kugou' && cfg.enableKugou && !isBudgetExceeded()) {
      const sStart = Date.now();
      const label = providerLabel('kugou', env);
      try {
        const timeoutRemaining = Math.min(3000, Math.max(500, budgetMs - (Date.now() - matchStart)));
        const kgRes = await fetch(
          `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(searchKeywords)}&page=1&pagesize=5&showtype=1`,
          { headers: { 'User-Agent': DESKTOP_UA }, signal: AbortSignal.timeout(timeoutRemaining) },
        );
        if (kgRes.ok) {
          const kgJson = (await kgRes.json()) as any;
          const freeItem = (kgJson?.data?.info || []).find(
            (it: any) =>
              (it.privilege === 0 || it.privilege === 8) &&
              titlesMatchStrictly(opts.title!, String(it.songname || '')) &&
              artistsMatchStrictly(opts.artist || '', String(it.singername || ''), cfg.crossMatchArtistSimilarity) &&
              (!opts.durationSec || !it.duration || Math.abs(it.duration - opts.durationSec) <= cfg.crossMatchDurationToleranceSec),
          );
          if (freeItem?.hash) {
            const kgStream = await resolveKugouSingleStream(freeItem.hash, env);
            if (kgStream?.url) {
              const probe = await probeStreamPhysicalQuality(kgStream.url, 'https://m.kugou.com/', 2000, freeItem.duration || opts.durationSec, nominalBr);
              if (probe.streamType === 'full') {
                attempts.push({ provider: label, via: `${kgStream.via}:free-match`, ok: true, ms: Date.now() - sStart });
                const out: ResolvedStreamInfo = {
                  url: kgStream.url,
                  provider: label,
                  via: `${kgStream.via}:free-match`,
                  isTrial: false,
                  streamType: 'full',
                  size: probe.totalBytes || kgStream.size,
                  contentType: 'audio/mpeg',
                  corsSafe: true,
                  degraded,
                  degradedReason,
                  circuitState,
                  attempts,
                };
                if (!opts.nocache) await putSonicCachedJson('stream-url-v1', cacheId, out, 480, 1200, env);
                return out;
              }
            }
          }
        }
        attempts.push({ provider: label, via: viaLabel(env, 'free-match'), ok: false, ms: Date.now() - sStart, error: 'No verified free full-length match' });
      } catch (err: any) {
        attempts.push({ provider: label, via: viaLabel(env, 'free-match'), ok: false, ms: Date.now() - sStart, error: err?.message });
      }
    }

    // 4c. Try Kuwo verified free full-length tracks (rejects `/nf/resource/` 181KB clips!)
    if (cleanSource !== 'kuwo' && cfg.enableKuwo && !isBudgetExceeded()) {
      const sStart = Date.now();
      const label = providerLabel('kuwo', env);
      try {
        const kwTracks = await searchKuwoNative(searchKeywords, 4, 1);
        for (const kt of kwTracks) {
          if (isBudgetExceeded()) break;
          if (
            titlesMatchStrictly(opts.title!, kt.title) &&
            artistsMatchStrictly(opts.artist || '', kt.artist, cfg.crossMatchArtistSimilarity) &&
            (!opts.durationSec || !kt.duration || Math.abs(kt.duration - opts.durationSec) <= cfg.crossMatchDurationToleranceSec)
          ) {
            const kwStream = await resolveKuwoSingleStream(kt.platformId, env);
            if (kwStream?.url) {
              const probe = await probeStreamPhysicalQuality(kwStream.url, 'https://www.kuwo.cn/', 2000, kt.duration || opts.durationSec, nominalBr);
              if (probe.streamType === 'full') {
                attempts.push({ provider: label, via: `${kwStream.via}:free-match`, ok: true, ms: Date.now() - sStart });
                const out: ResolvedStreamInfo = {
                  url: kwStream.url,
                  provider: label,
                  via: `${kwStream.via}:free-match`,
                  isTrial: false,
                  streamType: 'full',
                  size: probe.totalBytes || kwStream.size,
                  contentType: 'audio/mpeg',
                  referer: 'https://www.kuwo.cn/',
                  corsSafe: false,
                  degraded,
                  degradedReason,
                  circuitState,
                  attempts,
                };
                if (!opts.nocache) await putSonicCachedJson('stream-url-v1', cacheId, out, 480, 1200, env);
                return out;
              }
            }
          }
        }
        attempts.push({ provider: label, via: viaLabel(env, 'free-match'), ok: false, ms: Date.now() - sStart, error: 'No verified full-length free stream' });
      } catch (err: any) {
        attempts.push({ provider: label, via: viaLabel(env, 'free-match'), ok: false, ms: Date.now() - sStart, error: err?.message });
      }
    }
  }

  // 5. Optional Last-Resort Third-Party GDStudio Fallback (DISABLED BY DEFAULT: SONIC_ENABLE_GDSTUDIO=false)
  if (cfg.enableGdstudio && cleanId) {
    const gdStart = Date.now();
    try {
      const gdUrl = new URL(cfg.upstreamGdstudio);
      gdUrl.searchParams.set('types', 'url');
      gdUrl.searchParams.set('id', cleanId);
      gdUrl.searchParams.set('source', cleanSource === 'qq' ? 'tencent' : cleanSource);
      gdUrl.searchParams.set('br', quality);
      const gdRes = await fetch(gdUrl.toString(), {
        headers: { 'User-Agent': DESKTOP_UA, Referer: 'https://music.gdstudio.xyz/' },
        signal: AbortSignal.timeout(4500),
      });
      if (gdRes.ok) {
        const gdData = (await gdRes.json()) as any;
        if (gdData?.url && typeof gdData.url === 'string' && gdData.url.startsWith('http')) {
          attempts.push({ provider: 'gdstudio', via: 'third-party', ok: true, ms: Date.now() - gdStart });
          return {
            url: toHttpsIfSafe(gdData.url),
            provider: 'gdstudio',
            via: 'third-party',
            isTrial: false,
            corsSafe: false,
            degraded: true,
            degradedReason: degradedReason || 'third_party_fallback',
            circuitState,
            attempts,
          };
        }
      }
      attempts.push({ provider: 'gdstudio', via: 'third-party', ok: false, ms: Date.now() - gdStart, error: `HTTP ${gdRes.status}` });
    } catch (err: any) {
      attempts.push({ provider: 'gdstudio', via: 'third-party', ok: false, ms: Date.now() - gdStart, error: err?.message });
    }
  }

  // 6. If only official NetEase trial clip exists and caller permits trial playback, return it honestly marked
  if (trialCandidate && allowTrial) {
    return {
      ...trialCandidate,
      streamType: 'trial',
      isTrial: true,
      trialDuration: trialCandidate.trialDuration || 30,
      attempts,
    };
  }

  return null;
}

export function sonicTrackToLegacySongItem(t: SonicSearchTrack): SongItem {
  return {
    id: t.platformId || t.id.replace(/^[a-z]+:/i, ''),
    name: t.name || t.title,
    artist: t.artist,
    album: t.album,
    source: t.platform === 'sonic' ? 'netease' : t.platform,
    picId: t.picId || t.platformId,
    lyricId: t.lyricId || t.platformId,
    urlId: t.urlId || t.platformId,
    coverUrl: t.coverUrl || t.cover,
    duration: t.duration,
    sources: t.sources,
    streamType: t.platform === 'netease' && (t as any).isVip ? 'trial' : 'full',
  };
}

export { getLocalEngineCircuitSnapshot };
