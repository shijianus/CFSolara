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

function getTrackDedupKey(title: string, artist: string): string {
  const cleanTitle = (title || '')
    .toLowerCase()
    .replace(/[\s\-_—·.,!?'"()[\]{}<>《》「」【】]/g, '')
    .replace(/(live|remaster|remastered|flac|320k|伴奏|instrumental)/g, '');
  const cleanArtist = (artist || '')
    .toLowerCase()
    .replace(/[\s\-_—·.,!?'"()[\]{}<>《》「」【】]/g, '')
    .split('/')[0] || '';
  return `${cleanTitle}:::${cleanArtist}`;
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

  // Normalization, Deduplication & Multi-Platform ID Merging
  const trackMap = new Map<string, SonicSearchTrack>();
  const mergedOrder: SonicSearchTrack[] = [];

  for (const track of allTracks) {
    if (!track.title) continue;
    const key = getTrackDedupKey(track.title, track.artist);

    if (trackMap.has(key)) {
      const existing = trackMap.get(key)!;

      // Merge sources array
      const existingSources = existing.sources || [];
      const newSource: SonicSearchSource = {
        platform: track.platform,
        platformId: track.platformId,
        duration: track.duration,
      };

      const hasSource = existingSources.some(
        (s) => s.platform === newSource.platform && s.platformId === newSource.platformId,
      );
      if (!hasSource) {
        existingSources.push(newSource);
      }

      // If incoming track is from netease and existing is not, promote netease as primary for audio playability
      if (track.platform === 'netease' && existing.platform !== 'netease') {
        existing.platform = 'netease';
        existing.platformId = track.platformId;
        existing.id = track.platformId;
        existing.urlId = track.platformId;
        existing.source = 'netease';
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
      const initialSources: SonicSearchSource[] = track.sources && track.sources.length > 0
        ? [...track.sources]
        : [
            {
              platform: track.platform,
              platformId: track.platformId,
              duration: track.duration,
            },
          ];

      const mergedTrack: SonicSearchTrack = {
        id: track.platformId || track.id,
        title: track.title,
        name: track.title,
        artist: track.artist,
        album: track.album || '',
        duration: track.duration || 0,
        cover: track.cover || '',
        coverUrl: track.cover || '',
        platform: track.platform,
        platformId: track.platformId,
        sources: initialSources,
        picId: track.picId,
        lyricId: track.lyricId || track.platformId,
        urlId: track.urlId || track.platformId,
        source: track.source || track.platform,
      };

      trackMap.set(key, mergedTrack);
      mergedOrder.push(mergedTrack);
    }
  }

  // Sort tracks: prioritize tracks that have a netease source for instant audio playback reliability
  mergedOrder.sort((a, b) => {
    const aHasNetease = a.platform === 'netease' || (a.sources && a.sources.some((s) => s.platform === 'netease')) ? 1 : 0;
    const bHasNetease = b.platform === 'netease' || (b.sources && b.sources.some((s) => s.platform === 'netease')) ? 1 : 0;
    return bHasNetease - aHasNetease;
  });

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
