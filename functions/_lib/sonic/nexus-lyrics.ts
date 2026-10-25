// Sonic Gateway — Nexus Lyrics Orchestrator
// Brand: Sonic (声波 / Sonic Lyrics Gateway)
// Priority:
// ① Platform Native (NetEase YRC / QQ QRC / Kugou KRC)
// ② AMLL TTML (api.amll.dev by platform ID)
// ③ AMLL TTML (api.amll.dev by search)
// ④ LRCLIB Instrumental & Line-level
// ⑤ Other connected multi-sources (Universal engine)
// ⑥ Line-level LRC -> Server-side word interpolation (sourceQuality: "interpolated")
// ⑦ None / Instrumental

import type { AppEnv } from '../types';
import type {
  SonicQueryParams,
  SonicLyricsData,
  SonicMatchLevel,
  SonicAttempt,
  SonicSyncedLine,
  SonicSourceQuality,
  SonicLyricLevel,
} from './types';
import type { ProviderLyricResult } from './providers/adapter';
import { getSonicConfig } from './config';
import { getProvider } from './providers';
import { lyrivaProvider } from './providers/lyriva';
import { kugouProvider } from './providers/kugou';
import { fetchAmllByIds, fetchAmllBySearch } from './providers/amll';
import { lrclibProvider } from './providers/lrclib';
import { internalLinesToSonicLines, extractPlainLyrics, computeQualityScore, isInstrumentalText } from './utils';
import {
  parseTtmlLyrics,
  interpolateWordTimestamps,
  getUniversalLyrics,
} from '../music';
import { callLocalEngineJson, type CircuitState } from './local-engine';
import { sanitizeErrorForClient } from './net-guard';

export interface NexusLyricsResult {
  data: SonicLyricsData;
  matchLevel: SonicMatchLevel;
  matchScore: number;
  provider: string;
  qualityScore: number;
  attempts: SonicAttempt[];
  degraded?: boolean;
  degradedReason?: string;
  circuitState?: CircuitState;
}

export async function resolveNexusLyrics(
  params: SonicQueryParams,
  env?: AppEnv,
  options?: { request?: Request },
): Promise<NexusLyricsResult> {
  const config = getSonicConfig(env);
  const attempts: SonicAttempt[] = [];
  let degraded = false;
  let degradedReason: string | undefined;
  let circuitState: CircuitState | undefined;

  const defaultVia = config.runtime === 'linux-engine' ? 'local-engine' : 'cf-direct';
  const formatProvider = (p: string) => {
    if (config.runtime === 'linux-engine' && (p === 'netease' || p === 'qq' || p === 'kugou' || p === 'kuwo')) {
      return `local-${p}`;
    }
    return p;
  };

  const recordAttempt = (provider: string, ok: boolean, startMs: number, error?: string, via = defaultVia) => {
    attempts.push({
      provider: formatProvider(provider),
      via,
      source: via,
      ok,
      ms: Date.now() - startMs,
      error: error ? String(error).slice(0, 150) : undefined,
    });
  };

  // Derive platform/platformId if not explicitly set
  if (!params.platform) {
    if (params.ncmMusicId) {
      params.platform = 'netease';
      params.platformId = params.ncmMusicId;
    } else if (params.qqMusicId) {
      params.platform = 'qq';
      params.platformId = params.qqMusicId;
    }
  }

  // 0. Comprehensive Instrumental Pre-check (Explicit + Masterpiece Disambiguation)
  const isWellKnownInstrumental = (title?: string, artist?: string): boolean => {
    const t = (title || '').toLowerCase().trim();
    const a = (artist || '').toLowerCase().trim();
    if (/(^|\s|\(|\[)(instrumental|纯音乐|伴奏|piano version|acoustic version)(\)|\s|\]|$)/i.test(t)) return true;
    if (a.includes('yiruma') && (t.includes('river flows in you') || t.includes('kiss the rain'))) return true;
    if (a.includes('ludovico einaudi') && t.includes('nuvole bianche')) return true;
    if (a.includes('maksim') && t.includes('croatian rhapsody')) return true;
    if (a.includes('two steps from hell')) return true;
    return false;
  };

  const isTitleInstrumental = isWellKnownInstrumental(params.title, params.artist);
  if (isTitleInstrumental) {
    return {
      data: {
        provider: 'none',
        level: 'none',
        sourceQuality: 'none',
        track: {
          title: params.title || '',
          artist: params.artist || '',
          album: params.album || '',
          isrc: params.isrc || '',
        },
        plainLyrics: '',
        syncedLyrics: [],
        rawTtml: '',
        ttmlMetadata: {},
        instrumental: true,
        sourceId: '',
        sourceUrl: '',
      },
      matchLevel: 'HIGH_CONFIDENCE',
      matchScore: 100,
      provider: 'none',
      qualityScore: 0,
      attempts: [],
    };
  }

  let interpolatedFallback: ProviderLyricResult | null = null;
  const finalize = (res: ProviderLyricResult): NexusLyricsResult => ({
    ...res,
    provider: formatProvider(String(res.provider)),
    attempts,
    degraded,
    degradedReason,
    circuitState,
  });

  // ── ⓪ Linux VPS Local Engine Primary Hop (when running on Cloudflare Pages) ──
  if (config.enableLocalEngine) {
    const q = new URLSearchParams();
    if (params.title) q.set('title', params.title);
    if (params.artist) q.set('artist', params.artist);
    if (params.album) q.set('album', params.album);
    if (params.duration) q.set('duration', String(params.duration));
    if (params.platform) q.set('platform', params.platform);
    if (params.platformId) q.set('platformId', params.platformId);
    if (params.ncmMusicId) q.set('ncmMusicId', params.ncmMusicId);
    if (params.qqMusicId) q.set('qqMusicId', params.qqMusicId);
    if (params.isrc) q.set('isrc', params.isrc);
    if (params.prefer) q.set('prefer', params.prefer);
    q.set('nocache', '1');

    const engineRes = await callLocalEngineJson<{
      brand?: string;
      data?: SonicLyricsData;
      meta?: {
        matchLevel?: SonicMatchLevel;
        matchScore?: number;
        qualityScore?: number;
        provider?: string;
        attempts?: SonicAttempt[];
      };
    }>(`/api/sonic/lyrics/nexus?${q.toString()}`, env, {
      request: options?.request,
      timeoutMs: Math.min(config.engineTimeoutMs, config.timeoutMs),
    });
    circuitState = engineRes.circuitState;

    if (engineRes.ok && engineRes.data?.data) {
      const d = engineRes.data.data;
      const m = engineRes.data.meta || {};
      const upstreamAttempts = (m.attempts || []).map((a) => ({
        ...a,
        via: a.via || 'local-engine',
        source: a.source || a.via || 'local-engine',
      }));
      return {
        data: d,
        matchLevel: m.matchLevel || 'HIGH_CONFIDENCE',
        matchScore: typeof m.matchScore === 'number' ? m.matchScore : 90,
        provider: String(m.provider || d.provider || 'local-engine'),
        qualityScore: typeof m.qualityScore === 'number' ? m.qualityScore : 90,
        attempts: [
          { provider: 'local-engine', via: 'local-engine', source: 'local-engine', ok: true, ms: engineRes.latencyMs },
          ...upstreamAttempts,
        ],
        degraded: false,
        circuitState: 'CLOSED',
      };
    }

    degraded = true;
    degradedReason = engineRes.error || 'local_engine_unavailable';
    attempts.push({
      provider: 'local-engine',
      via: 'local-engine',
      source: 'local-engine',
      ok: false,
      ms: engineRes.latencyMs,
      error: degradedReason,
    });
  }

  // Helper to build a resolved result
  function buildResult(
    provider: string,
    sonicLines: SonicSyncedLine[],
    sourceQuality: SonicSourceQuality,
    matchLevel: SonicMatchLevel,
    matchScore: number,
    extra?: Partial<SonicLyricsData>,
  ): ProviderLyricResult {
    const rawPlain = extra?.plainLyrics ?? extractPlainLyrics(sonicLines);
    const isInst = Boolean(extra?.instrumental) ||
      isInstrumentalText(rawPlain) ||
      (sonicLines.length > 0 && sonicLines.every((l) => isInstrumentalText(l.text)));

    const finalSonicLines = isInst ? [] : sonicLines;
    const finalLevel: SonicLyricLevel = (!isInst && finalSonicLines.length > 0 && sourceQuality !== 'none') ? 'word' : 'none';
    const finalSourceQuality: SonicSourceQuality = isInst ? 'none' : sourceQuality;

    const avgWords = finalSonicLines.length > 0
      ? finalSonicLines.reduce((sum, l) => sum + l.words.length, 0) / finalSonicLines.length
      : 0;

    return {
      data: {
        provider,
        level: finalLevel,
        sourceQuality: finalSourceQuality,
        track: extra?.track ?? {
          title: params.title || '',
          artist: params.artist || '',
          album: params.album || '',
          isrc: params.isrc || '',
        },
        plainLyrics: isInst ? (rawPlain || '纯音乐，请欣赏') : rawPlain,
        syncedLyrics: finalSonicLines,
        rawTtml: isInst ? '' : (extra?.rawTtml ?? ''),
        ttmlMetadata: extra?.ttmlMetadata ?? {},
        instrumental: isInst,
        sourceId: extra?.sourceId ?? '',
        sourceUrl: extra?.sourceUrl ?? '',
      },
      matchLevel,
      matchScore,
      provider,
      qualityScore: isInst ? 100 : computeQualityScore(finalLevel, finalSonicLines.length, avgWords),
    };
  }

  // ① Platform Native Lyrics (Highest Priority: when platform + platformId is provided)
  if (params.platform && params.platformId) {
    const pStart = Date.now();
    const platName = params.platform.toLowerCase();
    const adapter = getProvider(platName) || (config.enableGdstudio ? getProvider('gdstudio') : undefined);

    if (adapter && adapter.getLyrics && adapter.isEnabled(env)) {
      try {
        const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
        const nativeResult = await adapter.getLyrics(params, { env, signal: timeoutSignal });
        if (nativeResult && nativeResult.data && (nativeResult.data.instrumental || nativeResult.data.syncedLyrics.length > 0)) {
          recordAttempt(String(adapter.name), true, pStart);
          if (nativeResult.data.instrumental || nativeResult.data.sourceQuality === 'real') {
            return finalize(nativeResult);
          }
          if (!interpolatedFallback) {
            interpolatedFallback = nativeResult;
          }
        } else {
          recordAttempt(String(adapter.name), false, pStart, 'No native lyrics returned');
        }
      } catch (err: any) {
        recordAttempt(String(adapter.name), false, pStart, sanitizeErrorForClient(err, 'Platform native error'));
      }
    }
  }

  // ② AMLL TTML by Platform ID (High Confidence)
  if (config.enableAmll && (params.ncmMusicId || params.qqMusicId || params.appleMusicId || params.spotifyId || params.isrc || params.platformId)) {
    const aStart = Date.now();
    try {
      const amllSignal = AbortSignal.timeout(config.timeoutMs);
      const amllById = await fetchAmllByIds(params, amllSignal, config.upstreamAmll);
      if (amllById) {
        const lines = parseTtmlLyrics(amllById.ttml);
        const hasWords = lines.some((l) => l.words && l.words.length > 0);
        for (const line of lines) {
          if (!line.words || line.words.length === 0) {
            line.words = interpolateWordTimestamps(line.text, line.time, line.duration || 3000);
          }
        }
        const sonicLines = internalLinesToSonicLines(lines);
        if (sonicLines.length > 0) {
          recordAttempt('amll', true, aStart);
          const result = buildResult(
            'amll',
            sonicLines,
            hasWords ? 'real' : 'interpolated',
            amllById.matchLevel,
            hasWords ? 95 : 60,
            {
              rawTtml: amllById.ttml,
              ttmlMetadata: amllById.metadata,
              sourceId: amllById.sourceId,
              sourceUrl: `${config.upstreamAmll}/v1/lyrics/get?id=${amllById.sourceId}`,
              track: {
                title: amllById.metadata.songName || params.title || '',
                artist: amllById.metadata.artists?.join(' / ') || params.artist || '',
                album: params.album || '',
                isrc: amllById.metadata.isrc || params.isrc || '',
              },
            },
          );
          if (result.data.instrumental || hasWords) return finalize(result);
          if (!interpolatedFallback) interpolatedFallback = result;
        } else {
          recordAttempt('amll', false, aStart, 'Empty lines parsed from TTML');
        }
      } else {
        recordAttempt('amll', false, aStart, 'Not found by ID');
      }
    } catch (err: any) {
      recordAttempt('amll', false, aStart, sanitizeErrorForClient(err, 'AMLL ID error'));
    }
  }

  // ③ AMLL TTML by Search (Medium Confidence)
  if (config.enableAmll && (params.title || params.artist)) {
    const sStart = Date.now();
    try {
      const amllSignal = AbortSignal.timeout(config.timeoutMs);
      const amllBySearch = await fetchAmllBySearch(params, amllSignal, config.upstreamAmll);
      if (amllBySearch) {
        const lines = parseTtmlLyrics(amllBySearch.ttml);
        const hasWords = lines.some((l) => l.words && l.words.length > 0);
        for (const line of lines) {
          if (!line.words || line.words.length === 0) {
            line.words = interpolateWordTimestamps(line.text, line.time, line.duration || 3000);
          }
        }
        const sonicLines = internalLinesToSonicLines(lines);
        if (sonicLines.length > 0) {
          recordAttempt('amll', true, sStart);
          const result = buildResult(
            'amll',
            sonicLines,
            hasWords ? 'real' : 'interpolated',
            amllBySearch.matchLevel,
            hasWords ? 70 : 45,
            {
              rawTtml: amllBySearch.ttml,
              ttmlMetadata: amllBySearch.metadata,
              sourceId: amllBySearch.sourceId,
              sourceUrl: `${config.upstreamAmll}/v1/lyrics/get?id=${amllBySearch.sourceId}`,
              track: {
                title: amllBySearch.metadata.songName || params.title || '',
                artist: amllBySearch.metadata.artists?.join(' / ') || params.artist || '',
                album: params.album || '',
                isrc: amllBySearch.metadata.isrc || params.isrc || '',
              },
            },
          );
          if (result.data.instrumental || hasWords) return finalize(result);
          if (!interpolatedFallback) interpolatedFallback = result;
        } else {
          recordAttempt('amll', false, sStart, 'Empty lines parsed from TTML search');
        }
      } else {
        recordAttempt('amll', false, sStart, 'Not found by search');
      }
    } catch (err: any) {
      recordAttempt('amll', false, sStart, sanitizeErrorForClient(err, 'AMLL search error'));
    }
  }

  // ④ Kugou KRC True Word-Level Lyrics (Highest Multi-language Syllable Precision)
  if (config.enableKugou && (params.title || params.artist || params.platformId)) {
    const kStart = Date.now();
    try {
      const kSignal = AbortSignal.timeout(config.timeoutMs);
      const kugouResult = await kugouProvider.getLyrics(params, { env, signal: kSignal });
      if (kugouResult && (kugouResult.data.instrumental || kugouResult.data.syncedLyrics.length > 0)) {
        recordAttempt('kugou', true, kStart);
        if (kugouResult.data.instrumental || kugouResult.data.sourceQuality === 'real') {
          return finalize(kugouResult);
        }
        if (!interpolatedFallback) {
          interpolatedFallback = kugouResult;
        }
      } else {
        recordAttempt('kugou', false, kStart, 'No lyrics from Kugou');
      }
    } catch (err: any) {
      recordAttempt('kugou', false, kStart, sanitizeErrorForClient(err, 'Kugou KRC error'));
    }
  }

  // ⑤ LRCLIB Instrumental Pre-check & Synced LRC Fallback
  if (config.enableLrclib) {
    const lStart = Date.now();
    try {
      const lrcSignal = AbortSignal.timeout(config.timeoutMs);
      const lrcResult = await lrclibProvider.getLyrics!(params, { env, signal: lrcSignal });
      if (lrcResult) {
        recordAttempt('lrclib', true, lStart);
        if (lrcResult.data.instrumental) {
          return finalize(lrcResult);
        }
        if (lrcResult.data.sourceQuality === 'real') {
          return finalize(lrcResult);
        }
        if (!interpolatedFallback && lrcResult.data.syncedLyrics.length > 0) {
          interpolatedFallback = lrcResult;
        }
      } else {
        recordAttempt('lrclib', false, lStart, 'Not found in LRCLIB');
      }
    } catch (err: any) {
      recordAttempt('lrclib', false, lStart, sanitizeErrorForClient(err, 'LRCLIB error'));
    }
  }

  // ⑥ Other Connected Multi-sources (Universal Native Engine)
  if (env && (params.title || params.artist || params.platformId)) {
    const uStart = Date.now();
    try {
      const uSource = (params.platform === 'qq' || params.platform === 'tencent') ? 'tencent' : 'netease';
      const uTimeoutMs = Math.min(config.timeoutMs, 6000);
      const uPromise = getUniversalLyrics(env, {
        id: params.platformId || '',
        source: uSource,
        title: params.title || '',
        artist: params.artist || '',
        duration: params.duration,
      });
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Universal engine timeout')), uTimeoutMs)
      );

      const uResult = await Promise.race([uPromise, timeoutPromise]);

      if (uResult && (uResult.lines.length > 0 || isInstrumentalText(uResult.title || '') || isInstrumentalText((uResult as any).lyric || ''))) {
        const sonicLines = internalLinesToSonicLines(uResult.lines);
        const isReal = uResult.syncType === 'word';
        const providerName = uResult.source || 'universal';
        recordAttempt(providerName, true, uStart);

        const result = buildResult(
          providerName,
          sonicLines,
          isReal ? 'real' : 'interpolated',
          isReal ? 'MEDIUM' : 'LOW',
          isReal ? 65 : 35,
          {
            sourceId: uResult.id || '',
            track: {
              title: uResult.title || params.title || '',
              artist: uResult.artist || params.artist || '',
              album: params.album || '',
              isrc: params.isrc || '',
            },
          },
        );
        if (result.data.instrumental || isReal) return finalize(result);
        if (!interpolatedFallback) interpolatedFallback = result;
      } else {
        recordAttempt('universal', false, uStart, 'Universal engine returned empty lines');
      }
    } catch (err: any) {
      recordAttempt('universal', false, uStart, sanitizeErrorForClient(err, 'Universal engine error'));
    }
  }

  // ⑥b Optional Last-Resort Third-Party Lyriva Fallback (DISABLED BY DEFAULT: SONIC_ENABLE_LYRIVA=false)
  if (config.enableLyriva && (params.title || params.artist || params.platformId)) {
    const lyrivaStart = Date.now();
    try {
      const lyrivaSignal = AbortSignal.timeout(config.timeoutMs);
      const lyrivaResult = await lyrivaProvider.getLyrics(params, { env, signal: lyrivaSignal });
      if (lyrivaResult && (lyrivaResult.data.instrumental || lyrivaResult.data.syncedLyrics.length > 0)) {
        recordAttempt('lyriva', true, lyrivaStart, undefined, 'third-party');
        if (lyrivaResult.data.instrumental || lyrivaResult.data.sourceQuality === 'real') {
          return { ...finalize(lyrivaResult), provider: 'lyriva' };
        }
        if (!interpolatedFallback) {
          interpolatedFallback = lyrivaResult;
        }
      } else {
        recordAttempt('lyriva', false, lyrivaStart, 'No synced lyrics from Lyriva', 'third-party');
      }
    } catch (err: any) {
      recordAttempt('lyriva', false, lyrivaStart, sanitizeErrorForClient(err, 'Lyriva fallback error'), 'third-party');
    }
  }

  // ⑦ Return best interpolated fallback if available (words[] guaranteed populated)
  if (interpolatedFallback) {
    for (const line of interpolatedFallback.data.syncedLyrics) {
      if (!line.words || line.words.length === 0) {
        const words = interpolateWordTimestamps(line.text, line.startMs, line.durationMs || 3000);
        line.words = words.map((w) => {
          const wStart = typeof w.start === 'number' ? w.start : line.startMs;
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
    }
    interpolatedFallback.data.level = 'word';
    interpolatedFallback.data.sourceQuality = 'interpolated';
    return finalize(interpolatedFallback);
  }

  // ⑧ No lyrics found
  const emptyResult = buildResult('none', [], 'none', 'NONE', 0);
  return finalize(emptyResult);
}
