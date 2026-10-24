// Sonic Providers — Registry & Exporter

export * from './adapter';
export * from './lyriva';
export * from './amll';
export * from './lrclib';
export * from './netease';
export * from './qq';
export * from './kugou';
export * from './gdstudio';
export * from './apple';
export * from './ytmusic';

import { lyrivaProvider } from './lyriva';
import { amllProvider } from './amll';
import { lrclibProvider } from './lrclib';
import { neteaseProvider } from './netease';
import { qqProvider } from './qq';
import { kugouProvider } from './kugou';
import { gdstudioProvider } from './gdstudio';
import { appleProvider } from './apple';
import { ytmusicProvider } from './ytmusic';
import type { SonicProviderAdapter } from './adapter';
import type { AppEnv } from '../../types';
import { getSonicConfig } from '../config';
import { fetchKuwoLyricsNative, searchKuwoNative } from '../native-protocols';
import { interpolateWordTimestamps, isValidLyric, parseHighPrecisionLyrics } from '../../music';
import { computeQualityScore, extractPlainLyrics, internalLinesToSonicLines } from '../utils';

export const kuwoProvider: SonicProviderAdapter = {
  name: 'kuwo',
  isEnabled(env?: AppEnv): boolean {
    return getSonicConfig(env).enableKuwo;
  },
  async getLyrics(params, options) {
    let rid = (params.platformId || '').replace(/^kuwo:/i, '').trim();
    if (!rid && (params.title || params.artist)) {
      const q = [params.title, params.artist].filter(Boolean).join(' ').trim();
      const tracks = await searchKuwoNative(q, 3, 1, options?.signal);
      if (tracks.length > 0) rid = tracks[0].platformId;
    }
    if (!rid) return null;
    const rawLrc = await fetchKuwoLyricsNative(rid, options?.signal);
    if (!rawLrc || !isValidLyric(rawLrc)) return null;
    const { lines, syncType } = parseHighPrecisionLyrics(rawLrc, params.title, params.artist);
    if (lines.length === 0) return null;
    for (const line of lines) {
      if (!line.words || line.words.length === 0) {
        line.words = interpolateWordTimestamps(line.text, line.time, line.duration || 3000);
      }
    }
    const sonicLines = internalLinesToSonicLines(lines);
    const avgWords = sonicLines.reduce((s, l) => s + l.words.length, 0) / Math.max(1, sonicLines.length);
    const isReal = syncType === 'word';
    return {
      data: {
        provider: 'kuwo',
        level: 'word',
        sourceQuality: isReal ? 'real' : 'interpolated',
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
        sourceId: rid,
        sourceUrl: '',
      },
      matchLevel: params.platformId ? 'HIGH_CONFIDENCE' : 'MEDIUM',
      matchScore: isReal ? 85 : 55,
      provider: 'kuwo',
      qualityScore: computeQualityScore('word', sonicLines.length, avgWords),
    };
  },
  async search(query, options) {
    return searchKuwoNative(query, options?.count || 20, options?.page || 1, options?.signal);
  },
};

export const jooxProvider: SonicProviderAdapter = {
  name: 'joox',
  isEnabled(env?: AppEnv): boolean {
    return getSonicConfig(env).enableGdstudio;
  },
  async getLyrics(params, options) {
    if (!getSonicConfig(options?.env).enableGdstudio) return null;
    return gdstudioProvider.getLyrics!({ ...params, platform: 'joox' }, options);
  },
  async search(query, options) {
    if (!getSonicConfig(options?.env).enableGdstudio) return [];
    return gdstudioProvider.search!(query, { ...options, platform: 'joox' });
  },
};

export const SONIC_PROVIDERS: Record<string, SonicProviderAdapter> = {
  lyriva: lyrivaProvider,
  amll: amllProvider,
  lrclib: lrclibProvider,
  netease: neteaseProvider,
  qq: qqProvider,
  kugou: kugouProvider,
  gdstudio: gdstudioProvider,
  kuwo: kuwoProvider,
  joox: jooxProvider,
  apple: appleProvider,
  ytmusic: ytmusicProvider,
};

export function getProvider(name: string): SonicProviderAdapter | undefined {
  const key = name.toLowerCase().trim();
  if (key === 'ncm') return SONIC_PROVIDERS.netease;
  if (key === 'tencent') return SONIC_PROVIDERS.qq;
  return SONIC_PROVIDERS[key];
}
