// Sonic Provider — NetEase Cloud Music (网易云音乐)
// Shared Native Encrypted Protocol (`ncm-api` on Linux + pure-TS `linuxapi` & YRC word-level lyrics)

import type { AppEnv } from '../../types';
import type {
  SonicQueryParams,
  SonicLyricsData,
  SonicSearchTrack,
  SonicSearchOptions,
  SonicMatchLevel,
} from '../types';
import type { SonicProviderAdapter, ProviderLyricResult } from './adapter';
import { getSonicConfig } from '../config';
import { internalLinesToSonicLines, extractPlainLyrics, computeQualityScore } from '../utils';
import {
  fetchDirectNetEaseLyrics,
  parseHighPrecisionLyrics,
  interpolateWordTimestamps,
  isValidLyric,
  searchTracks,
} from '../../music';
import { searchNeteaseNative } from '../native-protocols';

async function fetchNeteaseLyricWithLocalFirst(songId: string, env?: AppEnv, signal?: AbortSignal): Promise<string> {
  const cfg = getSonicConfig(env);
  if (cfg.ncmApiUrl) {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (env?.NETEASE_COOKIE) headers.Cookie = String(env.NETEASE_COOKIE).trim();
      const res = await fetch(
        `${cfg.ncmApiUrl}/lyric/new?id=${encodeURIComponent(songId)}&realIP=${encodeURIComponent(cfg.realIp)}`,
        { headers, signal: signal || AbortSignal.timeout(cfg.timeoutMs) },
      );
      if (res.ok) {
        const json = (await res.json()) as any;
        if (json?.yrc?.lyric && isValidLyric(json.yrc.lyric)) return json.yrc.lyric;
        if (json?.lrc?.lyric && isValidLyric(json.lrc.lyric)) return json.lrc.lyric;
      }
    } catch {}
  }
  return fetchDirectNetEaseLyrics(songId);
}

export const neteaseProvider: SonicProviderAdapter = {
  name: 'netease',
  isEnabled(env?: AppEnv): boolean {
    return getSonicConfig(env).enableNetease;
  },

  async getLyrics(params: SonicQueryParams, options?: { env?: AppEnv; signal?: AbortSignal }): Promise<ProviderLyricResult | null> {
    const env = options?.env;
    const songId = (params.platformId || params.ncmMusicId || '').replace(/^netease:/i, '').trim();

    let rawLyric = '';
    let resolvedId = songId;

    if (songId) {
      rawLyric = await fetchNeteaseLyricWithLocalFirst(songId, env, options?.signal);
    }

    // Fallback: native encrypted NetEase search if no explicit songId was provided
    if (!rawLyric && !songId && (params.title || params.artist)) {
      const q = [params.title, params.artist].filter(Boolean).join(' ').trim();
      try {
        const nativeRes = await searchNeteaseNative(q, 3, 1, env, options?.signal);
        if (nativeRes.tracks.length > 0 && nativeRes.tracks[0].platformId) {
          resolvedId = nativeRes.tracks[0].platformId;
          rawLyric = await fetchNeteaseLyricWithLocalFirst(resolvedId, env, options?.signal);
        }
      } catch {}
    }

    if (!rawLyric || !isValidLyric(rawLyric)) return null;

    const { lines, syncType } = parseHighPrecisionLyrics(rawLyric, params.title, params.artist);
    if (lines.length === 0) return null;

    const isReal = syncType === 'word';
    for (const line of lines) {
      if (!line.words || line.words.length === 0) {
        line.words = interpolateWordTimestamps(line.text, line.time, line.duration || 3000);
      }
    }

    const sonicLines = internalLinesToSonicLines(lines);
    const avgWords = sonicLines.length > 0
      ? sonicLines.reduce((sum, l) => sum + l.words.length, 0) / sonicLines.length
      : 0;

    const level = 'word';
    const sourceQuality = isReal ? 'real' : 'interpolated';
    const qualityScore = computeQualityScore(level, sonicLines.length, avgWords);

    const data: SonicLyricsData = {
      provider: 'netease',
      level,
      sourceQuality,
      track: {
        title: params.title || '',
        artist: params.artist || '',
        album: params.album || '',
        isrc: params.isrc || '',
      },
      plainLyrics: extractPlainLyrics(sonicLines),
      syncedLyrics: sonicLines,
      rawTtml: '',
      ttmlMetadata: {
        ncmMusicId: resolvedId,
      },
      instrumental: false,
      sourceId: resolvedId,
      sourceUrl: resolvedId ? `https://music.163.com/#/song?id=${resolvedId}` : '',
    };

    const matchLevel: SonicMatchLevel = songId ? 'HIGH_CONFIDENCE' : 'MEDIUM';
    return {
      data,
      matchLevel,
      matchScore: isReal ? (songId ? 98 : 75) : (songId ? 60 : 45),
      provider: 'netease',
      qualityScore,
    };
  },

  async search(query: string, options?: SonicSearchOptions & { env?: AppEnv }): Promise<SonicSearchTrack[]> {
    const env = options?.env || {};
    const cfg = getSonicConfig(env);
    const count = options?.count || 20;
    const page = options?.page || 1;

    // 1. Primary: Native encrypted protocol (`ncm-api` on Linux VPS or pure-TS `linuxapi`)
    try {
      const native = await searchNeteaseNative(query, count, page, env, options?.signal);
      if (native.tracks.length > 0) {
        return native.tracks;
      }
    } catch (err) {
      if (options?.signal?.aborted) throw err;
    }

    // 2. Optional Last-Resort Fallback: GDStudio (ONLY when explicitly enabled via SONIC_ENABLE_GDSTUDIO=1)
    if (cfg.enableGdstudio) {
      try {
        const songs = await searchTracks(env, query, 'netease', count, page);
        if (Array.isArray(songs) && songs.length > 0) {
          return songs.map((s) => {
            const platformId = String(s.id);
            const duration = typeof s.duration === 'number' ? s.duration : 0;
            return {
              id: `netease:${platformId}`,
              title: s.name || '未知歌曲',
              name: s.name || '未知歌曲',
              artist: s.artist || '未知歌手',
              album: s.album || '',
              duration,
              cover: s.coverUrl || '',
              coverUrl: s.coverUrl || '',
              platform: 'netease',
              platformId,
              sources: [{ platform: 'netease', platformId, duration }],
              picId: s.picId,
              lyricId: s.lyricId || platformId,
              urlId: s.urlId || platformId,
              source: 'gdstudio',
            };
          });
        }
      } catch {}
    }

    return [];
  },
};
