// Sonic Provider — Lyriva (https://lyriva.xyz / https://api.lyriva.xyz)
// Unified lyrics infrastructure with word-level & line-level sync

import type { AppEnv } from '../../types';
import type {
  SonicQueryParams,
  SonicLyricsData,
  SonicSyncedLine,
  SonicWord,
  SonicSourceQuality,
  SonicLyricLevel,
  SonicMatchLevel,
} from '../types';
import type { SonicProviderAdapter, ProviderLyricResult } from './adapter';
import { getSonicConfig, SONIC_UA } from '../config';
import { extractPlainLyrics, computeQualityScore, isInstrumentalText } from '../utils';
import { interpolateWordTimestamps, parseHighPrecisionLyrics } from '../../music';

export const lyrivaProvider: SonicProviderAdapter = {
  name: 'lyriva',
  isEnabled(env?: AppEnv): boolean {
    return getSonicConfig(env).enableLyriva;
  },

  async getLyrics(params: SonicQueryParams, options?: { env?: AppEnv; signal?: AbortSignal }): Promise<ProviderLyricResult | null> {
    const config = getSonicConfig(options?.env);
    const baseUrl = config.upstreamLyriva;
    const signal = options?.signal;

    const title = params.title || params.q || '';
    if (!title) return null;

    try {
      const url = new URL(`${baseUrl}/lyriva/lyrics`);
      url.searchParams.set('title', title);
      if (params.artist) url.searchParams.set('artist', params.artist);
      if (params.album) url.searchParams.set('album', params.album);
      if (params.duration && params.duration > 0) {
        url.searchParams.set('duration', String(Math.round(params.duration)));
      }
      if (params.isrc) url.searchParams.set('isrc', params.isrc);

      const providerParam = (params.platform && ['netease', 'qq', 'kugou', 'kuwo', 'amll', 'lrclib'].includes(params.platform.toLowerCase()))
        ? params.platform.toLowerCase()
        : 'auto';
      url.searchParams.set('provider', providerParam);

      const idParam = params.platformId || params.ncmMusicId || params.qqMusicId;
      if (idParam) {
        url.searchParams.set('id', idParam);
      }

      const timeoutSignal = signal || AbortSignal.timeout(config.timeoutMs);
      const resp = await fetch(url.toString(), {
        headers: {
          'User-Agent': SONIC_UA,
          Accept: 'application/json',
        },
        signal: timeoutSignal,
      });

      if (!resp.ok) {
        return null;
      }

      const json = (await resp.json()) as any;
      if (!json || typeof json !== 'object') {
        return null;
      }

      const data = json.data || json;
      const meta = json.meta || {};

      // Check instrumental detection
      const plainLyrics = typeof data.plainLyrics === 'string' ? data.plainLyrics : '';
      const isInst = data.instrumental === true || isInstrumentalText(plainLyrics);

      if (isInst) {
        return {
          data: {
            provider: 'lyriva',
            level: 'none',
            sourceQuality: 'none',
            track: {
              title: data.track?.title || params.title || '',
              artist: data.track?.artist || params.artist || '',
              album: data.track?.album || params.album || '',
              isrc: data.track?.isrc || params.isrc || '',
            },
            plainLyrics: plainLyrics || '纯音乐，请欣赏',
            syncedLyrics: [],
            rawTtml: '',
            ttmlMetadata: {
              upstreamProvider: data.provider || meta.provider,
            },
            instrumental: true,
            sourceId: data.sourceId || '',
            sourceUrl: data.sourceUrl || '',
          },
          matchLevel: 'HIGH_CONFIDENCE',
          matchScore: 100,
          provider: 'lyriva',
          qualityScore: 100,
        };
      }

      // Check syncedLyrics
      if (Array.isArray(data.syncedLyrics) && data.syncedLyrics.length > 0) {
        const hasRealWords = data.syncedLyrics.some(
          (l: any) => Array.isArray(l.words) && l.words.length > 0 && typeof l.words[0].startMs === 'number',
        );

        const sonicLines: SonicSyncedLine[] = data.syncedLyrics.map((line: any, idx: number, arr: any[]) => {
          const startMs = typeof line.startMs === 'number' ? line.startMs : 0;
          const nextLine = arr[idx + 1];
          const rawDurationMs = typeof line.durationMs === 'number' && line.durationMs > 0
            ? line.durationMs
            : (nextLine && typeof nextLine.startMs === 'number' ? Math.max(500, nextLine.startMs - startMs) : 3500);

          let words: SonicWord[] = [];
          if (Array.isArray(line.words) && line.words.length > 0) {
            words = line.words.map((w: any) => {
              const wStart = typeof w.startMs === 'number' ? w.startMs : (typeof w.start === 'number' ? w.start : startMs);
              const wDur = typeof w.durationMs === 'number' && w.durationMs > 0 ? w.durationMs : (typeof w.duration === 'number' && w.duration > 0 ? w.duration : 300);
              const wEnd = typeof w.end === 'number' ? w.end : (wStart + wDur);
              return {
                text: String(w.text || ''),
                startMs: wStart,
                durationMs: wDur,
                start: wStart,
                startSec: parseFloat((wStart / 1000).toFixed(3)),
                end: wEnd,
                endSec: parseFloat((wEnd / 1000).toFixed(3)),
                duration: wDur,
                durationSec: parseFloat((wDur / 1000).toFixed(3)),
              };
            });
          } else {
            // Interpolate words for lines without word timestamps (with strict interlude isolation)
            const interp = interpolateWordTimestamps(line.text || '', startMs, rawDurationMs);
            words = interp.map((w) => {
              const wStart = typeof w.start === 'number' ? w.start : startMs;
              const wDur = typeof w.duration === 'number' && w.duration > 0 ? w.duration : 300;
              const wEnd = typeof w.end === 'number' ? w.end : (wStart + wDur);
              return {
                text: w.text,
                startMs: wStart,
                durationMs: wDur,
                start: wStart,
                startSec: parseFloat((wStart / 1000).toFixed(3)),
                end: wEnd,
                endSec: parseFloat((wEnd / 1000).toFixed(3)),
                duration: wDur,
                durationSec: parseFloat((wDur / 1000).toFixed(3)),
              };
            });
          }

          // 真实发音截止时间：严格以本行最后一个字实际唱完为准，严禁将歌曲间奏算入逐字发音中！
          const vocalEndMs = words.length > 0
            ? (typeof words[words.length - 1].end === 'number' ? words[words.length - 1].end : (words[words.length - 1].start + words[words.length - 1].duration))
            : (startMs + rawDurationMs);
          const vocalDurationMs = Math.max(300, vocalEndMs - startMs);

          return {
            text: String(line.text || ''),
            startMs,
            start: startMs,
            startSec: parseFloat((startMs / 1000).toFixed(3)),
            durationMs: vocalDurationMs,
            duration: vocalDurationMs,
            durationSec: parseFloat((vocalDurationMs / 1000).toFixed(3)),
            endMs: vocalEndMs,
            end: vocalEndMs,
            endSec: parseFloat((vocalEndMs / 1000).toFixed(3)),
            words,
          };
        });

        const level: SonicLyricLevel = 'word';
        const sourceQuality: SonicSourceQuality = hasRealWords ? 'real' : 'interpolated';
        const totalWords = sonicLines.reduce((sum, l) => sum + l.words.length, 0);
        const avgWords = sonicLines.length > 0 ? totalWords / sonicLines.length : 0;

        return {
          data: {
            provider: 'lyriva',
            level,
            sourceQuality,
            track: {
              title: data.track?.title || params.title || '',
              artist: data.track?.artist || params.artist || '',
              album: data.track?.album || params.album || '',
              isrc: data.track?.isrc || params.isrc || '',
            },
            plainLyrics: plainLyrics || extractPlainLyrics(sonicLines),
            syncedLyrics: sonicLines,
            rawTtml: '',
            ttmlMetadata: {
              upstreamProvider: data.provider || meta.provider,
              sourceId: data.sourceId,
              matchReason: meta.selectionReason,
            },
            instrumental: false,
            sourceId: data.sourceId || '',
            sourceUrl: data.sourceUrl || '',
          },
          matchLevel: (meta.matchLevel as SonicMatchLevel) || 'HIGH_CONFIDENCE',
          matchScore: typeof meta.matchScore === 'number' ? meta.matchScore : (hasRealWords ? 95 : 75),
          provider: 'lyriva',
          qualityScore: computeQualityScore(level, sonicLines.length, avgWords),
        };
      }

      // Fallback: If only plainLyrics is provided and it has LRC time tags
      if (plainLyrics && /\[\d{2}:\d{2}/.test(plainLyrics)) {
        const parsed = parseHighPrecisionLyrics(plainLyrics);
        if (parsed.lines && parsed.lines.length > 0) {
          const sonicLines: SonicSyncedLine[] = parsed.lines.map((line) => {
            const timeMs = line.time;
            const rawDurMs = line.duration || 3500;
            const interp = (line.words && line.words.length > 0)
              ? line.words
              : interpolateWordTimestamps(line.text, timeMs, rawDurMs);
            const words: SonicWord[] = interp.map((w) => {
              const wStart = typeof w.start === 'number' ? w.start : timeMs;
              const wDur = typeof w.duration === 'number' && w.duration > 0 ? w.duration : 300;
              const wEnd = typeof w.end === 'number' ? w.end : (wStart + wDur);
              return {
                text: w.text,
                startMs: wStart,
                durationMs: wDur,
                start: wStart,
                startSec: parseFloat((wStart / 1000).toFixed(3)),
                end: wEnd,
                endSec: parseFloat((wEnd / 1000).toFixed(3)),
                duration: wDur,
                durationSec: parseFloat((wDur / 1000).toFixed(3)),
              };
            });

            const vocalEndMs = words.length > 0
              ? (typeof words[words.length - 1].end === 'number' ? words[words.length - 1].end : (words[words.length - 1].start + words[words.length - 1].duration))
              : (timeMs + rawDurMs);
            const vocalDurationMs = Math.max(300, vocalEndMs - timeMs);

            return {
              text: line.text,
              startMs: timeMs,
              start: timeMs,
              startSec: parseFloat((timeMs / 1000).toFixed(3)),
              durationMs: vocalDurationMs,
              duration: vocalDurationMs,
              durationSec: parseFloat((vocalDurationMs / 1000).toFixed(3)),
              endMs: vocalEndMs,
              end: vocalEndMs,
              endSec: parseFloat((vocalEndMs / 1000).toFixed(3)),
              words,
            };
          });

          return {
            data: {
              provider: 'lyriva',
              level: 'word',
              sourceQuality: 'interpolated',
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
                upstreamProvider: data.provider || meta.provider,
              },
              instrumental: false,
              sourceId: data.sourceId || '',
              sourceUrl: data.sourceUrl || '',
            },
            matchLevel: 'MEDIUM',
            matchScore: 60,
            provider: 'lyriva',
            qualityScore: 60,
          };
        }
      }

      return null;
    } catch (err) {
      return null;
    }
  },
};
