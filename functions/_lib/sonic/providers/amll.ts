// Sonic Provider — AMLL TTML (api.amll.dev)
// High-precision Timed Text Markup Language Word-Level Lyrics

import type { AppEnv } from '../../types';
import type { SonicQueryParams, SonicTtmlMetadata, SonicMatchLevel, SonicLyricsData } from '../types';
import type { SonicProviderAdapter, ProviderLyricResult } from './adapter';
import { getSonicConfig, SONIC_UA } from '../config';
import { internalLinesToSonicLines, extractPlainLyrics, computeQualityScore } from '../utils';
import { parseTtmlLyrics, interpolateWordTimestamps } from '../../music';

interface AmllGetResponse {
  status?: number;
  data?: {
    lyrics?: string;
    ttml?: string;
    musicNames?: string[];
    artistNames?: string[];
    albumNames?: string[];
    ncmMusicIds?: string[];
    qqMusicIds?: string[];
    spotifyIds?: string[];
    appleMusicIds?: string[];
    isrcs?: string[];
    id?: number;
    filename?: string;
    [key: string]: any;
  };
  error?: string;
}

interface AmllSearchItem {
  id: number;
  filename: string;
  musicNames?: string[];
  artistNames?: string[];
  albumNames?: string[];
  ncmMusicIds?: string[];
  qqMusicIds?: string[];
  spotifyIds?: string[];
  appleMusicIds?: string[];
  isrcs?: string[];
  [key: string]: any;
}

interface AmllSearchResponse {
  status?: number;
  data?: {
    items?: AmllSearchItem[];
    pagination?: any;
  } | AmllSearchItem[];
  error?: string;
}

export async function fetchAmllByIds(
  params: SonicQueryParams,
  signal?: AbortSignal,
  baseUrl = 'https://api.amll.dev',
): Promise<{
  ttml: string;
  metadata: SonicTtmlMetadata;
  sourceId: string;
  matchLevel: SonicMatchLevel;
} | null> {
  const queryParts: string[] = [];
  const ncmId = params.ncmMusicId || (params.platform === 'netease' ? params.platformId : undefined);
  const qqId = params.qqMusicId || (params.platform === 'qq' || params.platform === 'tencent' ? params.platformId : undefined);

  if (ncmId) queryParts.push(`ncmMusicId=${encodeURIComponent(ncmId)}`);
  if (qqId) queryParts.push(`qqMusicId=${encodeURIComponent(qqId)}`);
  if (params.appleMusicId) queryParts.push(`appleMusicId=${encodeURIComponent(params.appleMusicId)}`);
  if (params.spotifyId) queryParts.push(`spotifyId=${encodeURIComponent(params.spotifyId)}`);
  if (params.isrc) queryParts.push(`isrc=${encodeURIComponent(params.isrc)}`);

  if (queryParts.length === 0) return null;

  try {
    const url = `${baseUrl}/v1/lyrics/get?${queryParts.join('&')}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': SONIC_UA, Accept: 'application/json' },
      signal: signal || AbortSignal.timeout(6000),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as AmllGetResponse;
    const rawTtml = json.data?.lyrics || json.data?.ttml;
    if (!rawTtml) return null;

    const data = json.data || {};
    return {
      ttml: rawTtml,
      metadata: {
        songName: data.musicNames?.[0],
        artists: data.artistNames,
        ncmMusicId: data.ncmMusicIds?.[0],
        qqMusicId: data.qqMusicIds?.[0],
        spotifyId: data.spotifyIds?.[0],
        appleMusicId: data.appleMusicIds?.[0],
        isrc: data.isrcs?.[0],
      },
      sourceId: String(data.id || data.filename || ''),
      matchLevel: 'HIGH_CONFIDENCE',
    };
  } catch {
    return null;
  }
}

export async function fetchAmllBySearch(
  params: SonicQueryParams,
  signal?: AbortSignal,
  baseUrl = 'https://api.amll.dev',
): Promise<{
  ttml: string;
  metadata: SonicTtmlMetadata;
  sourceId: string;
  matchLevel: SonicMatchLevel;
} | null> {
  const query = [params.title, params.artist].filter(Boolean).join(' ').trim();
  if (!query) return null;

  try {
    const searchUrl = `${baseUrl}/v1/lyrics/search?q=${encodeURIComponent(query)}&pageSize=5`;
    const searchResp = await fetch(searchUrl, {
      headers: { 'User-Agent': SONIC_UA, Accept: 'application/json' },
      signal: signal || AbortSignal.timeout(6000),
    });
    if (!searchResp.ok) return null;
    const searchJson = (await searchResp.json()) as AmllSearchResponse;
    const results = Array.isArray(searchJson.data)
      ? searchJson.data
      : searchJson.data && Array.isArray((searchJson.data as any).items)
      ? (searchJson.data as any).items
      : [];
    const targetTitle = (params.title || '').trim().toLowerCase().replace(/[\s\-_—·.,!?'"()[\]{}<>《》「」【】]/g, '');
    const targetArtist = (params.artist || '').trim().toLowerCase().replace(/[\s\-_—·.,!?'"()[\]{}<>《》「」【】]/g, '');

    const matchingItem = results.find((item) => {
      const candidateTitles = (item.musicNames || []).map((n: string) =>
        n.toLowerCase().replace(/[\s\-_—·.,!?'"()[\]{}<>《》「」【】]/g, '')
      );
      const candidateArtists = (item.artistNames || []).map((a: string) =>
        a.toLowerCase().replace(/[\s\-_—·.,!?'"()[\]{}<>《》「」【】]/g, '')
      );

      if (targetTitle) {
        return candidateTitles.some((ct: string) =>
          ct === targetTitle || ct.includes(targetTitle) || (targetTitle.length >= 3 && targetTitle.includes(ct))
        );
      }
      if (targetArtist) {
        return candidateArtists.some((ca: string) =>
          ca === targetArtist || ca.includes(targetArtist) || (targetArtist.length >= 3 && targetArtist.includes(ca))
        );
      }
      return true;
    });

    if (!matchingItem || (!matchingItem.id && !matchingItem.filename)) return null;
    const best = matchingItem;

    const getParam = best.id ? `id=${best.id}` : `filename=${encodeURIComponent(best.filename)}`;
    const getUrl = `${baseUrl}/v1/lyrics/get?${getParam}`;
    const getResp = await fetch(getUrl, {
      headers: { 'User-Agent': SONIC_UA, Accept: 'application/json' },
      signal: signal || AbortSignal.timeout(6000),
    });
    if (!getResp.ok) return null;
    const getJson = (await getResp.json()) as AmllGetResponse;
    const rawTtml = getJson.data?.lyrics || getJson.data?.ttml;
    if (!rawTtml) return null;

    const data = getJson.data || {};
    return {
      ttml: rawTtml,
      metadata: {
        songName: data.musicNames?.[0] || best.musicNames?.[0],
        artists: data.artistNames || best.artistNames,
        ncmMusicId: data.ncmMusicIds?.[0] || best.ncmMusicIds?.[0],
        qqMusicId: data.qqMusicIds?.[0] || best.qqMusicIds?.[0],
        spotifyId: data.spotifyIds?.[0] || best.spotifyIds?.[0],
        appleMusicId: data.appleMusicIds?.[0] || best.appleMusicIds?.[0],
        isrc: data.isrcs?.[0] || best.isrcs?.[0],
      },
      sourceId: String(data.id || data.filename || best.id || best.filename || ''),
      matchLevel: 'MEDIUM',
    };
  } catch {
    return null;
  }
}

export const amllProvider: SonicProviderAdapter = {
  name: 'amll',
  isEnabled(env?: AppEnv): boolean {
    return getSonicConfig(env).enableAmll;
  },
  async getLyrics(params: SonicQueryParams, options?: { env?: AppEnv; signal?: AbortSignal }): Promise<ProviderLyricResult | null> {
    const config = getSonicConfig(options?.env);
    const baseUrl = config.upstreamAmll;
    const signal = options?.signal;

    // 1. Try by IDs first (high confidence)
    let amllResult = await fetchAmllByIds(params, signal, baseUrl);

    // 2. Try by search if not found
    if (!amllResult) {
      amllResult = await fetchAmllBySearch(params, signal, baseUrl);
    }

    if (!amllResult) return null;

    const lines = parseTtmlLyrics(amllResult.ttml);
    if (!lines || lines.length === 0) return null;

    const hasWords = lines.some((l) => l.words && l.words.length > 0);
    // Interpolate missing word timestamps if needed
    for (const line of lines) {
      if (!line.words || line.words.length === 0) {
        line.words = interpolateWordTimestamps(line.text, line.time, line.duration || 3000);
      }
    }

    const sonicLines = internalLinesToSonicLines(lines);
    const avgWords = sonicLines.length > 0
      ? sonicLines.reduce((sum, l) => sum + l.words.length, 0) / sonicLines.length
      : 0;

    const level = sonicLines.length > 0 ? 'word' : 'none';
    const sourceQuality = hasWords ? 'real' : 'interpolated';
    const qualityScore = computeQualityScore(level, sonicLines.length, avgWords);

    const data: SonicLyricsData = {
      provider: 'amll',
      level,
      sourceQuality,
      track: {
        title: amllResult.metadata.songName || params.title || '',
        artist: amllResult.metadata.artists?.join(' / ') || params.artist || '',
        album: params.album || '',
        isrc: amllResult.metadata.isrc || params.isrc || '',
      },
      plainLyrics: extractPlainLyrics(sonicLines),
      syncedLyrics: sonicLines,
      rawTtml: amllResult.ttml,
      ttmlMetadata: amllResult.metadata,
      instrumental: false,
      sourceId: amllResult.sourceId,
      sourceUrl: `${baseUrl}/v1/lyrics/get?id=${amllResult.sourceId}`,
    };

    return {
      data,
      matchLevel: amllResult.matchLevel,
      matchScore: hasWords ? 95 : 60,
      provider: 'amll',
      qualityScore,
    };
  },
};
