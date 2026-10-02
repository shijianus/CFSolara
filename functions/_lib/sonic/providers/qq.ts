// Sonic Provider — QQ Music (QQ音乐)
// Direct QRC syllable word-level lyrics & search

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
  fetchDirectQQLyrics,
  parseHighPrecisionLyrics,
  interpolateWordTimestamps,
  isValidLyric,
} from '../../music';

export const qqProvider: SonicProviderAdapter = {
  name: 'qq',
  isEnabled(env?: AppEnv): boolean {
    return getSonicConfig(env).enableQq;
  },

  async getLyrics(params: SonicQueryParams, options?: { env?: AppEnv; signal?: AbortSignal }): Promise<ProviderLyricResult | null> {
    const config = getSonicConfig(options?.env);
    const songmid = params.platformId || params.qqMusicId;

    let rawLyric = '';
    let resolvedMid = songmid || '';

    if (songmid) {
      rawLyric = await fetchDirectQQLyrics(songmid);
    }

    // Fallback: search QQ if no lyrics by ID
    if (!rawLyric && (params.title || params.artist)) {
      const q = [params.title, params.artist].filter(Boolean).join(' ').trim();
      try {
        const sUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=3&w=${encodeURIComponent(q)}&format=json`;
        const sRes = await fetch(sUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Referer: 'https://y.qq.com/',
          },
          signal: options?.signal || AbortSignal.timeout(config.timeoutMs),
        });
        if (sRes.ok) {
          const sJson = (await sRes.json()) as any;
          const list = sJson.data?.song?.list;
          if (Array.isArray(list) && list.length > 0 && list[0].songmid) {
            resolvedMid = list[0].songmid;
            rawLyric = await fetchDirectQQLyrics(resolvedMid);
          }
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
      provider: 'qq',
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
        qqMusicId: resolvedMid,
      },
      instrumental: false,
      sourceId: resolvedMid,
      sourceUrl: resolvedMid ? `https://y.qq.com/n/ryqq/songDetail/${resolvedMid}` : '',
    };

    const matchLevel: SonicMatchLevel = songmid ? 'HIGH_CONFIDENCE' : 'MEDIUM';
    return {
      data,
      matchLevel,
      matchScore: isReal ? (songmid ? 98 : 75) : (songmid ? 60 : 45),
      provider: 'qq',
      qualityScore,
    };
  },

  async search(query: string, options?: SonicSearchOptions & { env?: AppEnv }): Promise<SonicSearchTrack[]> {
    const config = getSonicConfig(options?.env);
    const count = options?.count || 20;
    const page = options?.page || 1;

    // 1. Primary: search_for_qq_cp H5 API (fast, reliable, unblocked internationally)
    try {
      const h5Url = `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?g_tk=5381&uin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=h5&needNewCode=1&w=${encodeURIComponent(query)}&zhidaqu=1&catZhida=1&t=0&flag=1&ie=utf-8&sem=1&aggr=0&perpage=${count}&n=${count}&p=${page}`;
      const h5Res = await fetch(h5Url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
          Referer: 'https://y.qq.com/',
        },
        signal: options?.signal || AbortSignal.timeout(config.timeoutMs),
      });

      if (h5Res.ok) {
        const h5Json = (await h5Res.json()) as any;
        const songList = h5Json?.data?.song?.list;
        if (Array.isArray(songList) && songList.length > 0) {
          return songList.map((item: any) => {
            const platformId = String(item.songmid || item.mid || item.songid || '');
            const durationSec = typeof item.interval === 'number' ? item.interval : 0;
            const artist = Array.isArray(item.singer) ? item.singer.map((s: any) => s.name).join(' / ') : '';
            const albumName = item.albumname || item.album?.name || '';
            const albumMid = item.albummid || item.album?.mid || '';
            const cover = albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : '';

            return {
              id: `qq:${platformId}`,
              title: item.songname || item.name || '未知歌曲',
              name: item.songname || item.name || '未知歌曲',
              artist: artist || '未知歌手',
              album: albumName,
              duration: durationSec,
              cover,
              coverUrl: cover,
              platform: 'qq',
              platformId,
              sources: [
                {
                  platform: 'qq',
                  platformId,
                  duration: durationSec,
                },
              ],
              source: 'qq',
              lyricId: platformId,
            };
          });
        }
      }
    } catch {}

    // 2. Secondary: modern QQ musicu.fcg desktop search API
    try {
      const reqBody = {
        comm: { ct: '19', cv: '1859', uin: '0' },
        req: {
          method: 'DoSearchForQQMusicDesktop',
          module: 'music.search.SearchCgiService',
          param: {
            num_per_page: count,
            page_num: page,
            query,
            search_type: 0,
          },
        },
      };

      const uRes = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://y.qq.com/',
          'Origin': 'https://y.qq.com',
          'Accept': 'application/json',
        },
        body: JSON.stringify(reqBody),
        signal: options?.signal || AbortSignal.timeout(config.timeoutMs),
      });

      if (uRes.ok) {
        const uJson = (await uRes.json()) as any;
        const songList = uJson?.req?.data?.body?.song?.list;
        if (Array.isArray(songList) && songList.length > 0) {
          return songList.map((item: any) => {
            const platformId = String(item.mid || item.id || '');
            const durationSec = typeof item.interval === 'number' ? item.interval : 0;
            const artist = Array.isArray(item.singer) ? item.singer.map((s: any) => s.name).join(' / ') : '';
            const albumName = item.album?.name || '';
            const albumMid = item.album?.mid || '';
            const cover = albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : '';

            return {
              id: `qq:${platformId}`,
              title: item.name || item.title || '未知歌曲',
              name: item.name || item.title || '未知歌曲',
              artist: artist || '未知歌手',
              album: albumName,
              duration: durationSec,
              cover,
              coverUrl: cover,
              platform: 'qq',
              platformId,
              sources: [
                {
                  platform: 'qq',
                  platformId,
                  duration: durationSec,
                },
              ],
              source: 'qq',
              lyricId: platformId,
            };
          });
        }
      }
    } catch {}

    // 3. Fallback: classic client_search_cp API
    try {
      const sUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=${page}&n=${count}&w=${encodeURIComponent(query)}&format=json`;
      const sRes = await fetch(sUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://y.qq.com/',
        },
        signal: options?.signal || AbortSignal.timeout(config.timeoutMs),
      });
      if (!sRes.ok) return [];
      const sJson = (await sRes.json()) as any;
      const list = sJson?.data?.song?.list;
      if (!Array.isArray(list)) return [];

      return list.map((item: any) => {
        const platformId = String(item.songmid || item.songid || '');
        const durationSec = typeof item.interval === 'number' ? item.interval : 0;
        const artist = Array.isArray(item.singer) ? item.singer.map((s: any) => s.name).join(' / ') : '';
        const album = item.albumname || '';
        const cover = item.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${item.albummid}.jpg` : '';

        return {
          id: `qq:${platformId}`,
          title: item.songname || '未知歌曲',
          name: item.songname || '未知歌曲',
          artist: artist || '未知歌手',
          album,
          duration: durationSec,
          cover,
          coverUrl: cover,
          platform: 'qq',
          platformId,
          sources: [
            {
              platform: 'qq',
              platformId,
              duration: durationSec,
            },
          ],
          source: 'qq',
          lyricId: platformId,
        };
      });
    } catch {
      return [];
    }
  },

};
