// Sonic Provider — GDStudio / Meting HTTP API
// Multi-platform bridge (NetEase, Kuwo, JOOX)

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
import { internalLinesToSonicLines, extractPlainLyrics, computeQualityScore, normalizeArtistString } from '../utils';
import {
  fetchMusicProvider,
  parseHighPrecisionLyrics,
  interpolateWordTimestamps,
  isValidLyric,
  searchTracks,
} from '../../music';

export const gdstudioProvider: SonicProviderAdapter = {
  name: 'gdstudio',
  isEnabled(env?: AppEnv): boolean {
    return getSonicConfig(env).enableGdstudio;
  },

  async getLyrics(params: SonicQueryParams, options?: { env?: AppEnv; signal?: AbortSignal }): Promise<ProviderLyricResult | null> {
    const env = options?.env || {};
    const platformId = params.platformId || params.ncmMusicId || params.qqMusicId;
    if (!platformId) return null;

    const source = (params.platform || 'netease').toLowerCase();

    try {
      const u = await fetchMusicProvider(env, {
        types: 'lyric',
        id: platformId,
        source: source === 'qq' ? 'tencent' : source,
      });

      let rawLyric = '';
      if (typeof u === 'object' && u !== null && typeof u.lyric === 'string') {
        rawLyric = u.lyric;
      } else if (typeof u === 'string') {
        rawLyric = u;
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
        provider: 'gdstudio',
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
        ttmlMetadata: {},
        instrumental: false,
        sourceId: platformId,
        sourceUrl: '',
      };

      const matchLevel: SonicMatchLevel = 'HIGH_CONFIDENCE';
      return {
        data,
        matchLevel,
        matchScore: isReal ? 85 : 55,
        provider: 'gdstudio',
        qualityScore,
      };
    } catch {
      return null;
    }
  },

  async search(query: string, options?: SonicSearchOptions & { env?: AppEnv }): Promise<SonicSearchTrack[]> {
    const env = options?.env || {};
    const count = options?.count || 20;
    const page = options?.page || 1;
    const rawPlatform = options?.platform?.toLowerCase();
    const source = (rawPlatform && rawPlatform !== 'gdstudio') ? rawPlatform : 'netease';

    try {

      const songs = await searchTracks(env, query, source, count, page);
      if (!Array.isArray(songs) || songs.length === 0) return [];

      return songs.map((s) => {
        const platformId = String(s.id);
        const duration = typeof s.duration === 'number' ? s.duration : 0;
        return {
          id: `${s.source || source}:${platformId}`,
          title: s.name || '未知歌曲',
          name: s.name || '未知歌曲',
          artist: normalizeArtistString(s.artist),
          album: s.album || '',
          duration,
          cover: s.coverUrl || '',
          coverUrl: s.coverUrl || '',
          platform: s.source || source,
          platformId,
          sources: [
            {
              platform: s.source || source,
              platformId,
              duration,
            },
          ],
          picId: s.picId,
          lyricId: s.lyricId || platformId,
          urlId: s.urlId || platformId,
          source: s.source || source,
        };
      });
    } catch {
      return [];
    }
  },
};
