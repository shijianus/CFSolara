// Sonic Provider — Kugou Music (酷狗音乐)
// True word-level KRC decryption & search

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
  parseHighPrecisionLyrics,
  interpolateWordTimestamps,
  isValidLyric,
  getUniversalLyrics,
} from '../../music';

export const kugouProvider: SonicProviderAdapter = {
  name: 'kugou',
  isEnabled(env?: AppEnv): boolean {
    return getSonicConfig(env).enableKugou;
  },

  async getLyrics(params: SonicQueryParams, options?: { env?: AppEnv; signal?: AbortSignal }): Promise<ProviderLyricResult | null> {
    const config = getSonicConfig(options?.env);
    const q = [params.title, params.artist].filter(Boolean).join(' ').trim();
    if (!q && !params.platformId) return null;

    try {
      // Use Kugou KRC search & decode pipeline from universal lyrics engine
      const uResult = await getUniversalLyrics(options?.env || {}, {
        id: params.platformId || '',
        source: 'kugou',
        title: params.title || '',
        artist: params.artist || '',
        q,
        duration: params.duration,
      });

      if (!uResult || !uResult.lines || uResult.lines.length === 0) return null;

      const isReal = uResult.syncType === 'word';
      for (const line of uResult.lines) {
        if (!line.words || line.words.length === 0) {
          line.words = interpolateWordTimestamps(line.text, line.time, line.duration || 3000);
        }
      }

      const sonicLines = internalLinesToSonicLines(uResult.lines);
      const avgWords = sonicLines.length > 0
        ? sonicLines.reduce((sum, l) => sum + l.words.length, 0) / sonicLines.length
        : 0;

      const level = 'word';
      const sourceQuality = isReal ? 'real' : 'interpolated';
      const qualityScore = computeQualityScore(level, sonicLines.length, avgWords);

      const data: SonicLyricsData = {
        provider: 'kugou',
        level,
        sourceQuality,
        track: {
          title: uResult.title || params.title || '',
          artist: uResult.artist || params.artist || '',
          album: params.album || '',
          isrc: params.isrc || '',
        },
        plainLyrics: extractPlainLyrics(sonicLines),
        syncedLyrics: sonicLines,
        rawTtml: uResult.ttml || '',
        ttmlMetadata: {},
        instrumental: Boolean(uResult.isPureMusic),
        sourceId: uResult.id || params.platformId || '',
        sourceUrl: '',
      };

      const matchLevel: SonicMatchLevel = isReal ? 'HIGH_CONFIDENCE' : 'MEDIUM';
      return {
        data,
        matchLevel,
        matchScore: isReal ? 90 : 55,
        provider: 'kugou',
        qualityScore,
      };
    } catch {
      return null;
    }
  },

  async search(query: string, options?: SonicSearchOptions & { env?: AppEnv }): Promise<SonicSearchTrack[]> {
    const config = getSonicConfig(options?.env);
    const count = options?.count || 20;
    const page = options?.page || 1;

    try {
      const sUrl = `http://mobilecdn.kugou.com/api/v3/search/song?keyword=${encodeURIComponent(query)}&page=${page}&pagesize=${count}`;
      const sRes = await fetch(sUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sonic/2.1.0' },
        signal: options?.signal || AbortSignal.timeout(config.timeoutMs),
      });
      if (!sRes.ok) return [];
      const sJson = (await sRes.json()) as any;
      const items = Array.isArray(sJson.data?.info) ? sJson.data.info : [];
      if (!Array.isArray(items)) return [];

      return items.map((item: any) => {
        const platformId = String(item.hash || item.FileHash || '');
        const durationSec = typeof item.duration === 'number' ? item.duration : 0;
        const songName = item.songname || item.SongName || '未知歌曲';
        const singerName = item.singername || item.SingerName || '未知歌手';

        return {
          id: `kugou:${platformId}`,
          title: songName,
          name: songName,
          artist: singerName,
          album: item.album_name || '',
          duration: durationSec,
          cover: '',
          coverUrl: '',
          platform: 'kugou',
          platformId,
          sources: [
            {
              platform: 'kugou',
              platformId,
              duration: durationSec,
            },
          ],
          source: 'kugou',
          lyricId: platformId,
        };
      });
    } catch {
      return [];
    }
  },
};
