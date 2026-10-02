// Sonic Provider — NetEase Cloud Music (网易云音乐)
// Direct YRC syllable word-level lyrics & search

import type { AppEnv } from '../../types';
import type {
  SonicQueryParams,
  SonicLyricsData,
  SonicSearchTrack,
  SonicSearchOptions,
  SonicMatchLevel,
} from '../types';
import type { SonicProviderAdapter, ProviderLyricResult } from './adapter';
import { getSonicConfig, SONIC_UA } from '../config';
import { internalLinesToSonicLines, extractPlainLyrics, computeQualityScore, normalizeArtistString } from '../utils';
import {
  fetchDirectNetEaseLyrics,
  parseHighPrecisionLyrics,
  interpolateWordTimestamps,
  isValidLyric,
  searchTracks,
} from '../../music';

export const neteaseProvider: SonicProviderAdapter = {
  name: 'netease',
  isEnabled(env?: AppEnv): boolean {
    return getSonicConfig(env).enableNetease;
  },

  async getLyrics(params: SonicQueryParams, options?: { env?: AppEnv; signal?: AbortSignal }): Promise<ProviderLyricResult | null> {
    const config = getSonicConfig(options?.env);
    const songId = params.platformId || params.ncmMusicId;

    let rawLyric = '';
    let resolvedId = songId || '';

    if (songId) {
      rawLyric = await fetchDirectNetEaseLyrics(songId);
    }

    // Fallback: search NetEase if no explicit songId was provided
    if (!rawLyric && !songId && (params.title || params.artist)) {
      const q = [params.title, params.artist].filter(Boolean).join(' ').trim();
      try {
        const results = await searchTracks(options?.env || {}, q, 'netease', 3, 1);
        if (results && results.length > 0 && results[0].id) {
          resolvedId = String(results[0].id);
          rawLyric = await fetchDirectNetEaseLyrics(resolvedId);
        }
      } catch {}
    }

    if (!rawLyric || !isValidLyric(rawLyric)) return null;

    const { lines, syncType } = parseHighPrecisionLyrics(rawLyric, params.title, params.artist);
    if (lines.length === 0) return null;

    const isReal = syncType === 'word';
    // Interpolate word timestamps for line-level lyrics
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
    const count = options?.count || 20;
    const page = options?.page || 1;

    try {
      // 1. First try searchTracks (GDStudio or configured base)
      const songs = await searchTracks(env, query, 'netease', count, page);
      if (Array.isArray(songs) && songs.length > 0) {
        return songs.map((s) => {
          const platformId = String(s.id);
          const duration = typeof s.duration === 'number' ? s.duration : 0;
          return {
            id: `netease:${platformId}`,
            title: s.name || '未知歌曲',
            name: s.name || '未知歌曲',
            artist: normalizeArtistString(s.artist),
            album: s.album || '',
            duration,
            cover: s.coverUrl || '',
            coverUrl: s.coverUrl || '',
            platform: 'netease',
            platformId,
            sources: [
              {
                platform: 'netease',
                platformId,
                duration,
              },
            ],
            picId: s.picId,
            lyricId: s.lyricId || platformId,
            urlId: s.urlId || platformId,
            source: 'netease',
          };
        });
      }
    } catch {}

    // 2. Direct NetEase mobile web fallback if GDStudio is unavailable
    try {
      const sUrl = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&offset=${(page - 1) * count}&total=true&limit=${count}`;
      const res = await fetch(sUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://music.163.com/',
        },
        signal: options?.signal || AbortSignal.timeout(getSonicConfig(env).timeoutMs),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as any;
      const songs = json?.result?.songs;
      if (!Array.isArray(songs)) return [];

      return songs.map((item: any) => {
        const platformId = String(item.id);
        const durationSec = typeof item.duration === 'number' ? Math.round(item.duration / 1000) : 0;
        const artist = Array.isArray(item.artists) ? item.artists.map((a: any) => a.name).join(' / ') : '';
        const album = item.album?.name || '';
        const cover = item.album?.picUrl || '';
        return {
          id: `netease:${platformId}`,
          title: item.name || '未知歌曲',
          name: item.name || '未知歌曲',
          artist: artist || '未知歌手',
          album,
          duration: durationSec,
          cover,
          coverUrl: cover,
          platform: 'netease',
          platformId,
          sources: [
            {
              platform: 'netease',
              platformId,
              duration: durationSec,
            },
          ],
          source: 'netease',
          lyricId: platformId,
        };
      });
    } catch {
      return [];
    }
  },
};
