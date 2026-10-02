// Sonic Provider — LRCLIB (lrclib.net)
// Community-driven synced LRC lyrics with instrumental detection & search

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
import { internalLinesToSonicLines, extractPlainLyrics, computeQualityScore } from '../utils';
import { parseHighPrecisionLyrics, interpolateWordTimestamps, isValidLyric } from '../../music';

interface LrclibTrackItem {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

export const lrclibProvider: SonicProviderAdapter = {
  name: 'lrclib',
  isEnabled(env?: AppEnv): boolean {
    return getSonicConfig(env).enableLrclib;
  },

  async getLyrics(params: SonicQueryParams, options?: { env?: AppEnv; signal?: AbortSignal }): Promise<ProviderLyricResult | null> {
    const config = getSonicConfig(options?.env);
    const baseUrl = config.upstreamLrclib;
    const signal = options?.signal;

    try {
      let url: string;
      if (params.title) {
        const parts = [`track_name=${encodeURIComponent(params.title)}`];
        if (params.artist) parts.push(`artist_name=${encodeURIComponent(params.artist)}`);
        if (params.album) parts.push(`album_name=${encodeURIComponent(params.album)}`);
        if (params.duration) parts.push(`duration=${Math.round(params.duration)}`);
        url = `${baseUrl}/api/get?${parts.join('&')}`;
      } else {
        const q = [params.title, params.artist].filter(Boolean).join(' ').trim();
        if (!q) return null;
        url = `${baseUrl}/api/search?q=${encodeURIComponent(q)}`;
      }

      const resp = await fetch(url, {
        headers: { 'User-Agent': SONIC_UA },
        signal: signal || AbortSignal.timeout(config.timeoutMs),
      });
      if (!resp.ok) return null;
      const json = (await resp.json()) as any;

      let item: LrclibTrackItem | null = null;
      if (Array.isArray(json)) {
        item =
          json.find((x: LrclibTrackItem) => x.syncedLyrics && isValidLyric(x.syncedLyrics)) ||
          json.find((x: LrclibTrackItem) => x.plainLyrics) ||
          json[0] ||
          null;
      } else {
        item = json;
      }
      if (!item) return null;

      const instrumental = Boolean(item.instrumental);
      const plainText = item.plainLyrics || '';

      if (instrumental) {
        const data: SonicLyricsData = {
          provider: 'lrclib',
          level: 'none',
          sourceQuality: 'none',
          track: {
            title: item.trackName || params.title || '',
            artist: item.artistName || params.artist || '',
            album: item.albumName || params.album || '',
            isrc: params.isrc || '',
          },
          plainLyrics: '',
          syncedLyrics: [],
          rawTtml: '',
          ttmlMetadata: {},
          instrumental: true,
          sourceId: String(item.id || ''),
          sourceUrl: item.id ? `${baseUrl}/api/get/${item.id}` : '',
        };
        return {
          data,
          matchLevel: 'HIGH_CONFIDENCE',
          matchScore: 90,
          provider: 'lrclib',
          qualityScore: 0,
        };
      }

      if (item.syncedLyrics && isValidLyric(item.syncedLyrics)) {
        const { lines, syncType } = parseHighPrecisionLyrics(item.syncedLyrics, item.trackName, item.artistName);
        if (lines.length === 0) return null;

        const isReal = syncType === 'word';
        // Interpolate words for line-level lyrics
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
          provider: 'lrclib',
          level,
          sourceQuality,
          track: {
            title: item.trackName || params.title || '',
            artist: item.artistName || params.artist || '',
            album: item.albumName || params.album || '',
            isrc: params.isrc || '',
          },
          plainLyrics: plainText || extractPlainLyrics(sonicLines),
          syncedLyrics: sonicLines,
          rawTtml: '',
          ttmlMetadata: {},
          instrumental: false,
          sourceId: String(item.id || ''),
          sourceUrl: item.id ? `${baseUrl}/api/get/${item.id}` : '',
        };

        const matchLevel: SonicMatchLevel = params.title ? (isReal ? 'HIGH_CONFIDENCE' : 'MEDIUM') : 'LOW';
        return {
          data,
          matchLevel,
          matchScore: isReal ? 85 : 50,
          provider: 'lrclib',
          qualityScore,
        };
      }

      if (plainText) {
        const data: SonicLyricsData = {
          provider: 'lrclib',
          level: 'none',
          sourceQuality: 'none',
          track: {
            title: item.trackName || params.title || '',
            artist: item.artistName || params.artist || '',
            album: item.albumName || params.album || '',
            isrc: params.isrc || '',
          },
          plainLyrics: plainText,
          syncedLyrics: [],
          rawTtml: '',
          ttmlMetadata: {},
          instrumental: false,
          sourceId: String(item.id || ''),
          sourceUrl: item.id ? `${baseUrl}/api/get/${item.id}` : '',
        };
        return {
          data,
          matchLevel: 'LOW',
          matchScore: 30,
          provider: 'lrclib',
          qualityScore: 10,
        };
      }

      return null;
    } catch {
      return null;
    }
  },

  async search(query: string, options?: SonicSearchOptions & { env?: AppEnv }): Promise<SonicSearchTrack[]> {
    const config = getSonicConfig(options?.env);
    const baseUrl = config.upstreamLrclib;
    const signal = options?.signal;

    try {
      const url = `${baseUrl}/api/search?q=${encodeURIComponent(query)}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': SONIC_UA },
        signal: signal || AbortSignal.timeout(config.timeoutMs),
      });
      if (!resp.ok) return [];
      const items = (await resp.json()) as LrclibTrackItem[];
      if (!Array.isArray(items)) return [];

      return items.slice(0, options?.count || 20).map((item) => {
        const platformId = String(item.id);
        const durationSec = typeof item.duration === 'number' ? Math.round(item.duration) : 0;
        return {
          id: `lrclib:${platformId}`,
          title: item.trackName || '未知歌曲',
          name: item.trackName || '未知歌曲',
          artist: item.artistName || '未知歌手',
          album: item.albumName || '',
          duration: durationSec,
          cover: '',
          coverUrl: '',
          platform: 'lrclib',
          platformId,
          sources: [
            {
              platform: 'lrclib',
              platformId,
              duration: durationSec,
            },
          ],
          source: 'lrclib',
          lyricId: platformId,
        };
      });
    } catch {
      return [];
    }
  },
};
