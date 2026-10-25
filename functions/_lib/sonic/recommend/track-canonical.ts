// Sonic Intelligent Recommendation & Smart Search — Canonical Track Normalization & Cross-Platform Merging

import type { SonicQualityOption, SonicSearchSource, SonicSearchTrack } from '../types';
import type {
  CanonicalTrack,
  ComputedPopularity,
  RecommendationExplanation,
  RecommendedTrack,
  ScoreSourceKind,
  TrackEdition,
} from './types';
import {
  classifyTrackEdition,
  compactNormalize,
  extractCleanBaseTitle,
  extractGenresAndTags,
  inferTrackLanguage,
  resolveCanonicalArtist,
  splitArtists,
  toPinyinInfo,
  toSimplifiedChinese,
} from './text-norm';

const FEATURE_VERSION = 1;

// Deterministic 64-bit dual-hash (FNV-1a + Murmur mix) -> 16 hex chars
export function deterministicHash16(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ ch, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x85ebca6b);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35);
  const p1 = ((h1 ^ (h1 >>> 13)) >>> 0).toString(16).padStart(8, '0');
  const p2 = ((h2 ^ (h2 >>> 16)) >>> 0).toString(16).padStart(8, '0');
  return `${p1}${p2}`;
}

export function computeCanonicalTrackId(
  cleanTitle: string,
  canonicalArtist: string,
  edition: TrackEdition = 'studio',
): string {
  const normTitle = cleanTitle || 'untitled';
  const normArtist = compactNormalize(canonicalArtist) || 'unknown';
  return `trk_${deterministicHash16(`${normTitle}:::${normArtist}:::${edition}`)}`;
}

export function isPlayableTrack(track: Pick<CanonicalTrack, 'streamType' | 'providerTrackId' | 'availableSources'>): boolean {
  if (track.streamType === 'unavailable') return false;
  if (!track.providerTrackId && (!track.availableSources || track.availableSources.length === 0)) {
    return false;
  }
  return true;
}

export function toCanonicalTrack(
  raw: Record<string, any>,
  options?: {
    rank?: number;
    externalPopularity?: number;
    explicitGenres?: string[];
    nowMs?: number;
  },
): CanonicalTrack | null {
  const rawTitle = String(raw?.title || raw?.name || '').trim();
  if (!rawTitle) return null;

  const rawArtist = String(
    raw?.artist ||
      (Array.isArray(raw?.artists)
        ? raw.artists.map((a: any) => (typeof a === 'string' ? a : a?.name || '')).filter(Boolean).join(' / ')
        : '') ||
      '未知歌手',
  ).trim();
  const rawAlbum = String(raw?.album?.name ?? raw?.album ?? '').trim();
  const durationRaw = Number(raw?.duration ?? raw?.dt ?? 0);
  // Normalize ms vs seconds (NetEase `dt` can be ms if > 3600)
  const duration = Number.isFinite(durationRaw) && durationRaw > 0
    ? durationRaw > 3600
      ? Math.round(durationRaw / 1000)
      : Math.round(durationRaw)
    : 0;

  let edition = (raw?.edition as TrackEdition) || classifyTrackEdition(rawTitle, rawAlbum);
  if (edition === 'studio' && duration > 0 && duration < 42 && /(片段|铃声|preview|试听)/i.test(rawTitle)) {
    edition = 'demo';
  }

  const cleanTitle = extractCleanBaseTitle(rawTitle);
  const simpTitle = toSimplifiedChinese(rawTitle);
  const artists = splitArtists(rawArtist);
  const primaryArtist = artists[0] || rawArtist;
  const canonicalArtist = resolveCanonicalArtist(primaryArtist);
  const py = toPinyinInfo(`${simpTitle} ${canonicalArtist}`);
  const titlePy = toPinyinInfo(simpTitle);
  const cleanAlbum = compactNormalize(rawAlbum);

  const language =
    (raw?.language as CanonicalTrack['language']) ||
    inferTrackLanguage(rawTitle, canonicalArtist, rawAlbum, edition);
  const { genres, tags } = extractGenresAndTags({
    title: rawTitle,
    artist: canonicalArtist,
    album: rawAlbum,
    edition,
    language,
    explicitGenres: options?.explicitGenres || raw?.genres,
  });

  const origPlatRaw = String(raw?.platform || raw?.source || 'netease').toLowerCase();
  const initialSources: SonicSearchSource[] = Array.isArray(raw?.sources)
    ? raw.sources
        .filter((s: any) => s && s.platform && s.platformId)
        .map((s: any) => ({
          platform: String(s.platform).toLowerCase(),
          platformId: String(s.platformId),
          duration: s.duration ?? (duration || undefined),
          quality: s.quality,
        }))
    : [];

  const rawId = String(raw?.platformId || raw?.id || '').trim();
  let primaryProvider = origPlatRaw === 'sonic' && initialSources[0]?.platform
    ? initialSources[0].platform
    : origPlatRaw === 'sonic'
      ? 'netease'
      : origPlatRaw;
  let primaryProviderId =
    origPlatRaw === 'sonic' && initialSources[0]?.platformId
      ? initialSources[0].platformId
      : rawId;

  if (!primaryProviderId && initialSources.length > 0) {
    primaryProvider = initialSources[0].platform;
    primaryProviderId = initialSources[0].platformId;
  }

  const sourceIds: Record<string, string> = {};
  if (primaryProvider && primaryProviderId && primaryProvider !== 'sonic') {
    sourceIds[primaryProvider] = primaryProviderId;
  }
  for (const s of initialSources) {
    if (s.platform && s.platformId && s.platform !== 'sonic') {
      sourceIds[s.platform] = s.platformId;
    }
  }
  if (raw?.sourceIds && typeof raw.sourceIds === 'object') {
    for (const [k, v] of Object.entries(raw.sourceIds)) {
      if (v) sourceIds[k.toLowerCase()] = String(v);
    }
  }

  const availableSources: SonicSearchSource[] = [];
  const seenSourceKeys = new Set<string>();
  const pushSource = (s: SonicSearchSource) => {
    const key = `${s.platform}:${s.platformId}`;
    if (!s.platform || !s.platformId || seenSourceKeys.has(key)) return;
    seenSourceKeys.add(key);
    availableSources.push(s);
  };
  for (const s of initialSources) pushSource(s);
  for (const [plat, pid] of Object.entries(sourceIds)) {
    pushSource({ platform: plat, platformId: pid, duration: duration || undefined });
  }

  const canonicalTrackId =
    typeof raw?.canonicalTrackId === 'string' && raw.canonicalTrackId.startsWith('trk_')
      ? raw.canonicalTrackId
      : computeCanonicalTrackId(cleanTitle, canonicalArtist, edition);

  const rawCover = String(raw?.coverUrl || raw?.cover || '').trim();
  const cleanCover = rawCover
    ? rawCover.replace('{size}', '400').replace(/^http:\/\//i, 'https://')
    : `/api/music/cover?artist=${encodeURIComponent(canonicalArtist || primaryArtist)}`;

  const cleanArtistPic = raw?.artistPic
    ? String(raw.artistPic).replace('{size}', '400').replace(/^http:\/\//i, 'https://')
    : cleanCover;

  const rankScore =
    options?.externalPopularity !== undefined
      ? options.externalPopularity
      : typeof raw?.externalPopularity === 'number'
        ? raw.externalPopularity
        : options?.rank !== undefined
          ? Math.max(10, 92 - options.rank * 3.5)
          : 45;

  const now = options?.nowMs ?? Date.now();

  return {
    canonicalTrackId,
    provider: primaryProvider || 'netease',
    providerTrackId: primaryProviderId || canonicalTrackId,
    title: rawTitle,
    cleanTitle,
    simpTitle,
    pinyinFull: titlePy.full || py.full,
    pinyinInitials: titlePy.initials || py.initials,
    artists,
    primaryArtist,
    canonicalArtist,
    album: rawAlbum,
    cleanAlbum,
    duration,
    edition,
    language,
    genres,
    tags,
    releaseDate: raw?.releaseDate ? String(raw.releaseDate) : undefined,
    coverUrl: cleanCover,
    artistPic: cleanArtistPic,
    qualityBadge: raw?.qualityBadge || (['netease', 'qq', 'kugou'].includes(primaryProvider) ? 'SQ' : 'HQ'),
    qualities: Array.isArray(raw?.qualities) ? raw.qualities : undefined,
    streamType: raw?.streamType || 'full',
    sourceIds,
    availableSources,
    externalPopularity: Math.max(0, Math.min(100, rankScore)),
    featureVersion: FEATURE_VERSION,
    firstSeenAt: typeof raw?.firstSeenAt === 'number' ? raw.firstSeenAt : now,
    updatedAt: now,
  };
}

export function canMergeCanonicalTracks(a: CanonicalTrack, b: CanonicalTrack): boolean {
  if (a.canonicalTrackId === b.canonicalTrackId) {
    // Guard extreme duration discrepancy (e.g. 30s ringtone vs 260s studio track)
    if (a.duration > 0 && b.duration > 0 && Math.abs(a.duration - b.duration) > 25) {
      return false;
    }
    return true;
  }
  if (a.edition !== b.edition) return false;
  if (!a.cleanTitle || a.cleanTitle !== b.cleanTitle) return false;
  if (compactNormalize(a.canonicalArtist) !== compactNormalize(b.canonicalArtist)) return false;
  if (a.duration > 0 && b.duration > 0 && Math.abs(a.duration - b.duration) > 12) return false;
  return true;
}

const PROVIDER_PRIORITY: Record<string, number> = {
  netease: 4,
  qq: 3,
  kugou: 3,
  kuwo: 2,
  gdstudio: 1,
};

export function mergeCanonicalTracks(existing: CanonicalTrack, incoming: CanonicalTrack): CanonicalTrack {
  const mergedSourceIds: Record<string, string> = { ...existing.sourceIds, ...incoming.sourceIds };
  const seenSources = new Set<string>();
  const mergedSources: SonicSearchSource[] = [];
  for (const s of [...existing.availableSources, ...incoming.availableSources]) {
    const key = `${s.platform}:${s.platformId}`;
    if (!s.platform || !s.platformId || seenSources.has(key)) continue;
    seenSources.add(key);
    mergedSources.push(s);
  }

  // Prefer higher-compatibility playable provider ID
  const existingPrio = PROVIDER_PRIORITY[existing.provider] || 0;
  const incomingPrio = PROVIDER_PRIORITY[incoming.provider] || 0;
  const preferIncoming =
    (existing.streamType === 'unavailable' && incoming.streamType !== 'unavailable') ||
    (existing.streamType === 'trial' && incoming.streamType === 'full') ||
    (incoming.streamType !== 'unavailable' && incomingPrio > existingPrio);

  const provider = preferIncoming ? incoming.provider : existing.provider;
  const providerTrackId = preferIncoming ? incoming.providerTrackId : existing.providerTrackId;

  const streamOrder: Record<string, number> = { full: 3, trial: 2, unavailable: 1 };
  const bestStreamType =
    (streamOrder[incoming.streamType || 'full'] || 0) > (streamOrder[existing.streamType || 'full'] || 0)
      ? incoming.streamType
      : existing.streamType;

  const mergedGenres = Array.from(new Set([...existing.genres, ...incoming.genres]));
  const mergedTags = Array.from(new Set([...existing.tags, ...incoming.tags]));

  const hasRealCover = (url: string) => Boolean(url && !url.startsWith('/api/music/cover?artist='));
  const coverUrl = hasRealCover(existing.coverUrl)
    ? existing.coverUrl
    : hasRealCover(incoming.coverUrl)
      ? incoming.coverUrl
      : existing.coverUrl || incoming.coverUrl;

  return {
    ...existing,
    provider,
    providerTrackId,
    album: existing.album || incoming.album,
    cleanAlbum: existing.cleanAlbum || incoming.cleanAlbum,
    duration: existing.duration || incoming.duration,
    language: existing.language !== 'unknown' ? existing.language : incoming.language,
    genres: mergedGenres,
    tags: mergedTags,
    releaseDate: existing.releaseDate || incoming.releaseDate,
    coverUrl,
    artistPic: existing.artistPic || incoming.artistPic,
    qualityBadge: existing.qualityBadge === 'SQ' || incoming.qualityBadge === 'SQ' ? 'SQ' : existing.qualityBadge || incoming.qualityBadge,
    streamType: bestStreamType,
    sourceIds: mergedSourceIds,
    availableSources: mergedSources,
    externalPopularity: Math.max(existing.externalPopularity, incoming.externalPopularity),
    firstSeenAt: Math.min(existing.firstSeenAt, incoming.firstSeenAt),
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
  };
}

export function buildQualitiesForCanonical(track: CanonicalTrack): SonicQualityOption[] {
  if (Array.isArray(track.qualities) && track.qualities.length > 0) {
    return track.qualities;
  }
  const origPlat = track.provider || 'netease';
  const pid = track.providerTrackId || track.canonicalTrackId;
  const qParams = `id=${encodeURIComponent(pid)}&source=${encodeURIComponent(origPlat)}&title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.primaryArtist)}`;
  const isHighTier = ['netease', 'qq', 'kugou'].includes(origPlat);

  const list: SonicQualityOption[] = [];
  if (isHighTier) {
    list.push({
      level: 'lossless',
      label: 'SQ 无损',
      bitrate: 'FLAC 24bit',
      format: 'flac',
      streamUrl: `/api/music/stream?${qParams}&br=lossless`,
      desc: '超清无损母带音质 (FLAC / 24-bit)',
    });
  }
  list.push(
    {
      level: 'exhigh',
      label: 'HQ 极高',
      bitrate: '320kbps',
      format: 'mp3',
      streamUrl: `/api/music/stream?${qParams}&br=320`,
      desc: '极高品质MP3 (320kbps 饱满声场)',
    },
    {
      level: 'standard',
      label: '标准',
      bitrate: '128kbps',
      format: 'mp3',
      streamUrl: `/api/music/stream?${qParams}&br=128`,
      desc: '标准流畅音质 (128kbps 快速省流)',
    },
  );
  return list;
}

export function canonicalToSonicTrack(track: CanonicalTrack): SonicSearchTrack {
  const origPlat = track.provider || 'netease';
  const pid = track.providerTrackId || track.canonicalTrackId;
  const artistDisplay = track.artists.length > 1 ? track.artists.join(' / ') : track.primaryArtist;
  const qParams = `id=${encodeURIComponent(pid)}&source=${encodeURIComponent(origPlat)}&title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(artistDisplay)}`;
  const qualities = buildQualitiesForCanonical(track);
  const sources: SonicSearchSource[] =
    track.availableSources.length > 0
      ? track.availableSources
      : [{ platform: origPlat, platformId: pid, duration: track.duration || undefined }];

  return {
    id: pid,
    sha: track.canonicalTrackId.replace(/^trk_/, ''),
    title: track.title,
    name: track.title,
    artist: artistDisplay,
    album: track.album || '',
    duration: track.duration || 0,
    cover: track.coverUrl,
    coverUrl: track.coverUrl,
    artistPic: track.artistPic || track.coverUrl,
    platform: sources.length > 1 ? 'sonic' : origPlat,
    platformId: pid,
    sources,
    qualities,
    qualityBadge: track.qualityBadge || 'HQ',
    streamUrl: `/api/music/stream?${qParams}`,
    lyricId: pid,
    urlId: pid,
    source: sources.length > 1 ? 'sonic' : origPlat,
  };
}

export function canonicalToRecommendedTrack(
  track: CanonicalTrack,
  recommendScore: number,
  scoreSource: ScoreSourceKind,
  explanation: RecommendationExplanation,
  pop?: ComputedPopularity,
): RecommendedTrack {
  const base = canonicalToSonicTrack(track);
  return {
    ...base,
    canonicalTrackId: track.canonicalTrackId,
    edition: track.edition,
    language: track.language,
    genres: track.genres,
    recommendScore: Math.round(recommendScore * 10000) / 10000,
    scoreSource,
    explanation,
    ...(pop
      ? {
          popularity: {
            internalScore: Math.round(pop.internalScore * 10000) / 10000,
            externalChartScore: Math.round(pop.externalChartScore * 10000) / 10000,
            uniqueListeners: pop.uniqueListeners,
            effectivePlays: Math.round(pop.effectivePlays * 100) / 100,
            velocityScore: Math.round(pop.velocityScore * 10000) / 10000,
            confidence: Math.round(pop.confidence * 10000) / 10000,
          },
        }
      : {}),
  };
}
