// Sonic Gateway — Nexus Search Orchestrator
// Brand: Sonic (声波 / Sonic Multi-Source Search Gateway)
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

export interface NexusSearchResult {
  data: SonicSearchData;
  attempts: SonicAttempt[];
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

export async function searchNexus(
  query: string,
  options: SonicSearchOptions = {},
  env?: AppEnv,
): Promise<NexusSearchResult> {
  const config = getSonicConfig(env);
  const attempts: SonicAttempt[] = [];

  const page = options.page || 1;
  const count = Math.min(50, Math.max(1, options.count || 20));

  // Determine active providers
  let activeProviders: SonicProviderAdapter[] = [];

  if (options.platform && options.platform !== 'nexus' && options.platform !== 'all') {
    const single = getProvider(options.platform);
    if (single && single.search) {
      activeProviders = [single];
    } else {
      activeProviders = [gdstudioProvider];
    }
  } else {
    // Parallel Multi-Upstream: GDStudio, NetEase, QQ, Kugou
    if (config.enableGdstudio && gdstudioProvider.search) activeProviders.push(gdstudioProvider);
    if (config.enableNetease && neteaseProvider.search) activeProviders.push(neteaseProvider);
    if (config.enableQq && qqProvider.search) activeProviders.push(qqProvider);
    if (config.enableKugou && kugouProvider.search) activeProviders.push(kugouProvider);
  }

  // Parallel Execution with timeout isolation & Promise.allSettled
  const results = await Promise.allSettled(
    activeProviders.map(async (provider) => {
      const pStart = Date.now();
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
          provider: String(provider.name),
          ok: true,
          ms: Date.now() - pStart,
        });
        return { provider: String(provider.name), tracks };
      } catch (err: any) {
        attempts.push({
          provider: String(provider.name),
          ok: false,
          ms: Date.now() - pStart,
          error: err?.message || 'Search timeout or network error',
        });
        return { provider: String(provider.name), tracks: [] };
      }
    }),
  );

  // Collect all returned tracks
  const allTracks: SonicSearchTrack[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value.tracks)) {
      allTracks.push(...r.value.tracks);
    }
  }

  // Normalization, SHA Deduplication & Audio Quality Classification
  const trackMap = new Map<string, SonicSearchTrack>();
  const mergedOrder: SonicSearchTrack[] = [];

  for (const track of allTracks) {
    if (!track.title) continue;
    const sha = await computeSongSha(track.title, track.artist);

    if (trackMap.has(sha)) {
      const existing = trackMap.get(sha)!;

      // Merge and record quality capabilities without exposing third-party provider names
      const existingQualities = existing.qualities || [];
      const hasLossless = existingQualities.some(q => q.level === 'lossless');
      const hasExhigh = existingQualities.some(q => q.level === 'exhigh');

      // Promote quality if higher tier discovered
      const origPlat = track.platform || track.source || 'netease';
      const qParams = `id=${encodeURIComponent(track.platformId || track.id)}&source=${encodeURIComponent(origPlat)}&title=${encodeURIComponent(track.title || '')}&artist=${encodeURIComponent(track.artist || '')}`;
      if ((track.platform === 'kugou' || track.platform === 'netease' || track.platform === 'qq') && !hasLossless) {
        existingQualities.unshift({
          level: 'lossless',
          label: 'SQ 无损',
          bitrate: 'FLAC 24bit',
          streamUrl: `/api/music/stream?${qParams}&br=lossless`,
        });
        existing.qualityBadge = 'SQ';
      } else if (!hasExhigh) {
        existingQualities.push({
          level: 'exhigh',
          label: 'HQ 极高',
          bitrate: '320kbps',
          streamUrl: `/api/music/stream?${qParams}&br=320`,
        });
        if (existing.qualityBadge !== 'SQ') existing.qualityBadge = 'HQ';
      }

      // If incoming track is from netease and existing is not, use netease ID internally for highest stream compatibility
      if (track.platform === 'netease' && existing.platform !== 'netease') {
        existing.platformId = track.platformId;
        existing.id = track.platformId;
        existing.urlId = track.platformId;
        existing.streamUrl = `/api/music/stream?${qParams}`;
        if (track.picId) existing.picId = track.picId;
      }

      // Enrich missing metadata
      if (!existing.album && track.album) existing.album = track.album;
      if (!existing.cover && track.cover) {
        existing.cover = track.cover;
        existing.coverUrl = track.cover;
      }
      if ((!existing.duration || existing.duration === 0) && track.duration) {
        existing.duration = track.duration;
      }
    } else {
      const canonicalId = track.platformId || track.id;
      const origPlatform = track.platform || track.source || 'netease';
      const qParams = `id=${encodeURIComponent(canonicalId)}&source=${encodeURIComponent(origPlatform)}&title=${encodeURIComponent(track.title || '')}&artist=${encodeURIComponent(track.artist || '')}`;
      // Default classified quality tiers for Sonic native delivery
      const isHighTier = track.platform === 'netease' || track.platform === 'kugou' || track.platform === 'qq';
      const qualities: any[] = [
        ...(isHighTier
          ? [
              {
                level: 'lossless' as const,
                label: 'SQ 无损',
                bitrate: 'FLAC',
                streamUrl: `/api/music/stream?${qParams}&br=lossless`,
              },
              {
                level: 'exhigh' as const,
                label: 'HQ 极高',
                bitrate: '320kbps',
                streamUrl: `/api/music/stream?${qParams}&br=320`,
              },
            ]
          : [
              {
                level: 'exhigh' as const,
                label: 'HQ 极高',
                bitrate: '320kbps',
                streamUrl: `/api/music/stream?${qParams}&br=320`,
              },
            ]),
        {
          level: 'standard' as const,
          label: '标准',
          bitrate: '128kbps',
          streamUrl: `/api/music/stream?${qParams}&br=128`,
        },
      ];

      const mergedTrack: SonicSearchTrack = {
        id: canonicalId,
        sha,
        title: track.title,
        name: track.title,
        artist: track.artist,
        album: track.album || '',
        duration: track.duration || 0,
        cover: track.cover || '',
        coverUrl: track.cover || '',
        platform: 'sonic', // Desensitized brand
        platformId: canonicalId,
        qualities,
        qualityBadge: isHighTier ? 'SQ' : 'HQ',
        streamUrl: `/api/music/stream?${qParams}`,
        sources: [
          {
            platform: 'sonic',
            platformId: canonicalId,
            duration: track.duration,
          },
        ],
        picId: track.picId,
        lyricId: track.lyricId || canonicalId,
        urlId: track.urlId || canonicalId,
        source: 'sonic',
      };

      trackMap.set(sha, mergedTrack);
      mergedOrder.push(mergedTrack);
    }
  }

  return {
    data: {
      query,
      page,
      count: mergedOrder.length,
      total: mergedOrder.length,
      tracks: mergedOrder,
    },
    attempts,
  };
}
