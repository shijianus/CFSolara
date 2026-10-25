// epocanvas sonic Gateway — Nexus Search Orchestrator
// Brand: epocanvas sonic (声波 / epocanvas sonic Multi-Source Search Gateway)
// Multi-source parallel search, timeout isolation, normalization & deduplication

import type { AppEnv } from '../types';
import type {
  SonicSearchTrack,
  SonicSearchData,
  SonicSearchOptions,
  SonicAttempt,
  SonicSearchSource,
} from './types';
import type { SonicProviderAdapter } from './providers/adapter';
import { getSonicConfig } from './config';
import { getProvider } from './providers';
import { gdstudioProvider } from './providers/gdstudio';
import { neteaseProvider } from './providers/netease';
import { qqProvider } from './providers/qq';
import { kugouProvider } from './providers/kugou';
import { callLocalEngineJson, type CircuitState } from './local-engine';
import { sanitizeErrorForClient } from './net-guard';

export interface NexusSearchResult {
  data: SonicSearchData;
  attempts: SonicAttempt[];
  degraded?: boolean;
  degradedReason?: string;
  circuitState?: CircuitState;
}

async function computeSongSha(title: string, artist: string): Promise<string> {
  const cleanTitle = (title || '')
    .toLowerCase()
    .replace(/[\s\-_—·.,!?'"()[\]{}<>《》「」【】]/g, '')
    .replace(/(live|remaster|remastered|flac|320k|伴奏|instrumental)/g, '');
  const cleanArtist = (artist || '')
    .toLowerCase()
    .replace(/[\s\-_—·.,!?'"()[\]{}<>《》「」【】]/g, '')
    .split('/')[0] || '';
  const raw = `${cleanTitle}:::${cleanArtist}`;
  try {
    const data = new TextEncoder().encode(raw);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  } catch {
    let h1 = 0xdeadbeef, h2 = 0x41c64e6d;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    return (((h1 ^ (h1 >>> 16)) >>> 0).toString(16).padStart(8, '0') +
            ((h2 ^ (h2 >>> 16)) >>> 0).toString(16).padStart(8, '0')).slice(0, 16);
  }
}

function normalizeText(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[\s\-_—·.,!?'"`()[\]{}<>《》「」【】]/g, '')
    .trim();
}

function cleanTitleForMatching(title: string): string {
  return normalizeText(
    (title || '')
      .replace(/\s*[\(\[\{（【][^\)\]\}）】]*(live|remaster|remastered|flac|320k|伴奏|instrumental|原唱|无损|高品质|纯音乐|片段|铃声|demo)[^\)\]\}）】]*[\)\]\}）】]/gi, '')
      .replace(/(live|remaster|remastered|flac|320k|伴奏|instrumental|原唱|无损|高品质)/gi, '')
  );
}

function cleanArtistForMatching(artist: string): string {
  const norm = (artist || '').toLowerCase();
  const primary = norm.split(/[/&,、+，]|(\s+feat\.?\s+)|(\s+ft\.?\s+)/)[0] || norm;
  return normalizeText(primary);
}

export async function searchNexus(
  query: string,
  options: SonicSearchOptions & { request?: Request } = {},
  env?: AppEnv,
): Promise<NexusSearchResult> {
  const config = getSonicConfig(env);
  const attempts: SonicAttempt[] = [];
  let degraded = false;
  let degradedReason: string | undefined;
  let circuitState: CircuitState | undefined;

  const page = options.page || 1;
  const count = Math.min(50, Math.max(1, options.count || 20));
  const isSinglePlatform = Boolean(options.platform && options.platform !== 'nexus' && options.platform !== 'all');

  // 1. Primary Hop (when running on Cloudflare Pages): Linux VPS Local Engine
  if (config.enableLocalEngine && !isSinglePlatform) {
    const q = new URLSearchParams({
      q: query,
      page: String(page),
      count: String(count),
      nocache: '1',
    });
    const engineTimeout = Math.min(config.engineTimeoutMs, config.timeoutMs);
    const engineRes = await callLocalEngineJson<{
      brand?: string;
      data?: SonicSearchData;
      meta?: { attempts?: SonicAttempt[] };
    }>(`/api/sonic/search/nexus?${q.toString()}`, env, {
      request: options.request,
      timeoutMs: engineTimeout,
      signal: options.signal,
    });
    circuitState = engineRes.circuitState;

    if (engineRes.ok && engineRes.data?.data && Array.isArray(engineRes.data.data.tracks)) {
      const upstreamAttempts = (engineRes.data.meta?.attempts || []).map((a) => ({
        ...a,
        via: a.via || 'local-engine',
        source: a.source || a.via || 'local-engine',
      }));
      return {
        data: engineRes.data.data,
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

  // 2. Local / Direct Native Providers (Linux Engine primary OR Cloudflare Edge graceful degradation)
  let activeProviders: SonicProviderAdapter[] = [];

  if (isSinglePlatform) {
    const single = getProvider(options.platform!);
    if (single && single.search && single.isEnabled(env)) {
      activeProviders = [single];
    }
  } else {
    if (config.enableNetease && neteaseProvider.search) activeProviders.push(neteaseProvider);
    if (config.enableQq && qqProvider.search) activeProviders.push(qqProvider);
    if (config.enableKugou && kugouProvider.search) activeProviders.push(kugouProvider);
  }

  const via = config.runtime === 'linux-engine' ? 'local-engine' : 'cf-direct';
  const formatProviderName = (rawName: string) =>
    config.runtime === 'linux-engine' ? `local-${rawName}` : rawName;

  // Parallel Execution with timeout isolation & Promise.allSettled
  const results = await Promise.allSettled(
    activeProviders.map(async (provider) => {
      const pStart = Date.now();
      const pLabel = formatProviderName(String(provider.name));
      try {
        const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
        const tracks = await provider.search!(query, {
          page,
          count,
          env,
          signal: timeoutSignal,
          platform: options.platform,
        });

        attempts.push({
          provider: pLabel,
          via,
          source: via,
          ok: tracks.length > 0,
          ms: Date.now() - pStart,
          error: tracks.length === 0 ? 'Empty result set' : undefined,
        });
        return { provider: String(provider.name), tracks };
      } catch (err: any) {
        attempts.push({
          provider: pLabel,
          via,
          source: via,
          ok: false,
          ms: Date.now() - pStart,
          error: sanitizeErrorForClient(err, 'Search timeout or network error'),
        });
        return { provider: String(provider.name), tracks: [] };
      }
    }),
  );

  // Collect all returned tracks with original provider rank
  interface RankedTrack {
    track: SonicSearchTrack;
    rank: number;
    provider: string;
  }
  const allRankedTracks: RankedTrack[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value.tracks)) {
      r.value.tracks.forEach((t, idx) => {
        if (t && t.title) {
          allRankedTracks.push({ track: t, rank: idx, provider: r.value.provider });
        }
      });
    }
  }

  // 3. Optional Last-Resort Fallback: Third-Party GDStudio (DISABLED BY DEFAULT)
  if (allRankedTracks.length === 0 && !isSinglePlatform && config.enableGdstudio && gdstudioProvider.search) {
    const gStart = Date.now();
    try {
      const gTracks = await gdstudioProvider.search(query, {
        page,
        count,
        env,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      attempts.push({
        provider: 'gdstudio',
        via: 'third-party',
        source: 'third-party',
        ok: gTracks.length > 0,
        ms: Date.now() - gStart,
        error: gTracks.length === 0 ? 'Empty third-party fallback result' : undefined,
      });
      gTracks.forEach((t, idx) => {
        if (t && t.title) allRankedTracks.push({ track: t, rank: idx, provider: 'gdstudio' });
      });
    } catch (err: any) {
      attempts.push({
        provider: 'gdstudio',
        via: 'third-party',
        source: 'third-party',
        ok: false,
        ms: Date.now() - gStart,
        error: sanitizeErrorForClient(err, 'GDStudio fallback error'),
      });
    }
  }

  // Multi-Attribute Canonical Song Clustering & Merging
  // Match based on SHA, normalized title, primary artist, and album/duration correlation
  const trackClusters: Array<{
    key: string;
    sha: string;
    track: SonicSearchTrack;
    occurrenceCount: number;
    bestRank: number;
    cleanTitle: string;
    cleanArtist: string;
    cleanAlbum: string;
  }> = [];

  for (const { track, rank } of allRankedTracks) {
    if (!track.title) continue;
    const sha = await computeSongSha(track.title, track.artist);
    const cleanT = cleanTitleForMatching(track.title);
    const cleanAr = cleanArtistForMatching(track.artist);
    const cleanAl = normalizeText(track.album || '');
    const trackDur = track.duration || 0;

    // Comprehensive cluster finder: check SHA, title + artist + album/duration
    let existingCluster = trackClusters.find((c) => {
      if (c.sha === sha) return true;
      if (c.cleanTitle && cleanT && c.cleanTitle === cleanT && c.cleanArtist === cleanAr) {
        // If albums both exist and match, or one is empty
        if (!c.cleanAlbum || !cleanAl || c.cleanAlbum === cleanAl || c.cleanAlbum.includes(cleanAl) || cleanAl.includes(c.cleanAlbum)) {
          return true;
        }
        // If durations are close (within 6s), treat as same song
        if (c.track.duration && trackDur && Math.abs(c.track.duration - trackDur) <= 6) {
          return true;
        }
      }
      return false;
    });

    const origPlat = track.platform || track.source || 'netease';
    const canonicalId = track.platformId || track.id;
    const qParams = `id=${encodeURIComponent(canonicalId)}&source=${encodeURIComponent(origPlat)}&title=${encodeURIComponent(track.title || '')}&artist=${encodeURIComponent(track.artist || '')}`;

    if (existingCluster) {
      existingCluster.occurrenceCount += 1;
      if (rank < existingCluster.bestRank) {
        existingCluster.bestRank = rank;
      }

      const existing = existingCluster.track;
      const existingQualities = existing.qualities || [];
      const hasLossless = existingQualities.some((q) => q.level === 'lossless');
      const hasExhigh = existingQualities.some((q) => q.level === 'exhigh');

      const isLosslessCandidate = (track.platform === 'kugou' || track.platform === 'netease' || track.platform === 'qq');
      if (isLosslessCandidate && !hasLossless) {
        existingQualities.unshift({
          level: 'lossless',
          label: 'SQ 无损',
          bitrate: 'FLAC 24bit',
          format: 'flac',
          streamUrl: `/api/music/stream?${qParams}&br=lossless`,
          desc: '超清无损母带音质 (FLAC / 24-bit)',
        });
        existing.qualityBadge = 'SQ';
      } else if (!hasExhigh) {
        existingQualities.push({
          level: 'exhigh',
          label: 'HQ 极高',
          bitrate: '320kbps',
          format: 'mp3',
          streamUrl: `/api/music/stream?${qParams}&br=320`,
          desc: '极高品质MP3 (320kbps 饱满声场)',
        });
        if (existing.qualityBadge !== 'SQ') existing.qualityBadge = 'HQ';
      }

      // If incoming track is from NetEase and current is not, use NetEase ID internally for highest stream compatibility
      if (track.platform === 'netease' && existing.platform !== 'netease') {
        existing.platformId = track.platformId;
        existing.id = track.platformId;
        existing.urlId = track.platformId;
        existing.streamUrl = `/api/music/stream?${qParams}`;
        if (track.picId) existing.picId = track.picId;
      }

      // Enrich missing album / cover metadata
      if (!existing.album && track.album) {
        existing.album = track.album;
        existingCluster.cleanAlbum = cleanAl;
      }
      const cleanTrackCover = track.cover ? track.cover.replace('{size}', '400').replace('http://', 'https://') : '';
      const cleanTrackArtistPic = track.artistPic ? track.artistPic.replace('{size}', '400').replace('http://', 'https://') : '';

      if (cleanTrackArtistPic && !existing.artistPic) existing.artistPic = cleanTrackArtistPic;
      if (!existing.cover && cleanTrackCover) {
        existing.cover = cleanTrackCover;
        existing.coverUrl = cleanTrackCover;
      }
      if ((!existing.duration || existing.duration === 0) && track.duration) {
        existing.duration = track.duration;
      }

      // Record per-platform source IDs for cross-provider lyric/stream resolution
      existing.sources.push({
        platform: origPlat,
        platformId: canonicalId,
        duration: track.duration,
      });
    } else {
      const isHighTier = track.platform === 'netease' || track.platform === 'kugou' || track.platform === 'qq';
      const qualities: any[] = [
        ...(isHighTier
          ? [
              {
                level: 'lossless' as const,
                label: 'SQ 无损',
                bitrate: 'FLAC 24bit',
                format: 'flac',
                streamUrl: `/api/music/stream?${qParams}&br=lossless`,
                desc: '超清无损母带音质 (FLAC / 24-bit)',
              },
              {
                level: 'exhigh' as const,
                label: 'HQ 极高',
                bitrate: '320kbps',
                format: 'mp3',
                streamUrl: `/api/music/stream?${qParams}&br=320`,
                desc: '极高品质MP3 (320kbps 饱满声场)',
              },
            ]
          : [
              {
                level: 'exhigh' as const,
                label: 'HQ 极高',
                bitrate: '320kbps',
                format: 'mp3',
                streamUrl: `/api/music/stream?${qParams}&br=320`,
                desc: '极高品质MP3 (320kbps 饱满声场)',
              },
            ]),
        {
          level: 'standard' as const,
          label: '标准',
          bitrate: '128kbps',
          format: 'mp3',
          streamUrl: `/api/music/stream?${qParams}&br=128`,
          desc: '标准流畅音质 (128kbps 快速省流)',
        },
      ];

      const cleanCover = track.cover ? track.cover.replace('{size}', '400').replace('http://', 'https://') : '';
      const cleanArtistPic = track.artistPic ? track.artistPic.replace('{size}', '400').replace('http://', 'https://') : '';
      const finalCover = cleanCover || cleanArtistPic || (track.artist ? `/api/music/cover?artist=${encodeURIComponent(track.artist)}` : '');

      const mergedTrack: SonicSearchTrack = {
        id: canonicalId,
        sha,
        title: track.title,
        name: track.title,
        artist: track.artist,
        album: track.album || '',
        duration: track.duration || 0,
        cover: finalCover,
        coverUrl: finalCover,
        artistPic: cleanArtistPic || finalCover,
        platform: isSinglePlatform ? origPlat : 'sonic',
        platformId: canonicalId,
        qualities,
        qualityBadge: isHighTier ? 'SQ' : 'HQ',
        streamUrl: `/api/music/stream?${qParams}`,
        sources: [
          {
            platform: origPlat,
            platformId: canonicalId,
            duration: track.duration,
          },
        ],
        picId: track.picId,
        lyricId: track.lyricId || canonicalId,
        urlId: track.urlId || canonicalId,
        source: 'sonic',
      };

      trackClusters.push({
        key: `${cleanT}:::${cleanAr}`,
        sha,
        track: mergedTrack,
        occurrenceCount: 1,
        bestRank: rank,
        cleanTitle: cleanT,
        cleanArtist: cleanAr,
        cleanAlbum: cleanAl,
      });
    }
  }

  // Weight Calculation & Ranking Algorithm
  // Factors: Query Match (Exact/Prefix/Contain) + Repetition Consensus (occurrenceCount) + Click Popularity (bestRank) + Quality Tier
  const qClean = normalizeText(query);
  const qWords = (query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);

  const scoredTracks = trackClusters.map((cluster) => {
    const t = cluster.track;
    const tNorm = normalizeText(t.title);
    const arNorm = normalizeText(t.artist);
    const alNorm = normalizeText(t.album);

    let score = 0;

    // 1. Search Result Match Score (0 - 1500)
    if (tNorm === qClean) {
      score += 1500; // Exact title match
    } else if (tNorm.startsWith(qClean)) {
      score += 900;
    } else if (tNorm.includes(qClean)) {
      score += 600;
    } else if (qWords.length > 0 && qWords.every((w) => tNorm.includes(w))) {
      score += 500;
    }

    // Artist query match bonus (0 - 600)
    if (arNorm === qClean) {
      score += 600;
    } else if (arNorm.includes(qClean)) {
      score += 350;
    }

    // Album query match bonus (0 - 200)
    if (alNorm && alNorm.includes(qClean)) {
      score += 200;
    }

    // 2. Repetition / Cross-Source Consensus Weight (重复次数最多的版本加权)
    // Up to 4 sources agreeing on the canonical track
    score += Math.min(1000, cluster.occurrenceCount * 250);

    // 3. Click / Popularity Rank Weight (最多人点击的版本加权)
    // Upstream providers rank top songs by click/play counts
    score += Math.max(0, 400 - cluster.bestRank * 60);

    // 4. Audio Quality Tier Bonus (SQ/HQ versions)
    if (t.qualityBadge === 'SQ') {
      score += 100;
    } else if (t.qualityBadge === 'HQ') {
      score += 50;
    }

    return { track: t, score };
  });

  // Sort descending by calculated weight score
  scoredTracks.sort((a, b) => b.score - a.score);

  const finalTracks = scoredTracks.map((item) => item.track);

  return {
    data: {
      query,
      page,
      count: finalTracks.length,
      total: finalTracks.length,
      tracks: finalTracks,
    },
    attempts,
    degraded,
    degradedReason,
    circuitState,
  };
}
