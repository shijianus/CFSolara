// Sonic Gateway — Unified Type Definitions
// Brand: Sonic (声波 / Sonic Multi-Source Gateway)

export type SonicLyricLevel = 'word' | 'line' | 'none';
export type SonicSourceQuality = 'real' | 'interpolated' | 'none';
export type SonicProvider =
  | 'nexus'
  | 'lyriva'
  | 'amll'
  | 'lrclib'
  | 'netease'
  | 'qq'
  | 'kugou'
  | 'gdstudio'
  | 'apple'
  | 'ytmusic'
  | 'kuwo'
  | 'joox'
  | 'musixmatch'
  | 'internal'
  | 'none';

export type SonicMatchLevel = 'HIGH_CONFIDENCE' | 'MEDIUM' | 'LOW' | 'NONE';
export type SonicCacheLevel = 'memory' | 'kv' | 'cf-cache' | 'none';

export interface SonicAttempt {
  provider: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface SonicWord {
  text: string;
  startMs: number;
  durationMs: number;
  start?: number;
  startSec?: number;
  end?: number;
  endSec?: number;
  duration?: number;
  durationSec?: number;
}

export interface SonicSyncedLine {
  text: string;
  startMs: number;
  durationMs: number;
  start?: number;
  startSec?: number;
  duration?: number;
  durationSec?: number;
  endMs?: number;
  end?: number;
  endSec?: number;
  words: SonicWord[];
}

export interface SonicTrack {
  title: string;
  artist: string;
  album: string;
  isrc?: string;
}

export interface SonicTtmlMetadata {
  songName?: string;
  artists?: string[];
  ncmMusicId?: string;
  qqMusicId?: string;
  spotifyId?: string;
  appleMusicId?: string;
  isrc?: string;
}

export interface SonicLyricsData {
  provider: SonicProvider | string;
  level: SonicLyricLevel;
  sourceQuality: SonicSourceQuality;
  track: SonicTrack;
  plainLyrics: string;
  syncedLyrics: SonicSyncedLine[];
  rawTtml: string;
  ttmlMetadata: SonicTtmlMetadata;
  instrumental: boolean;
  sourceId: string;
  sourceUrl: string;
}

export interface SonicMeta {
  cached: boolean;
  cacheLevel: SonicCacheLevel;
  qualityScore?: number;
  matchLevel?: SonicMatchLevel;
  matchScore?: number;
  latencyMs: number;
  requested?: string;
  provider: SonicProvider | string;
  attempts?: SonicAttempt[];
  [key: string]: any;
}

export interface SonicLyricsResponse {
  brand: 'Sonic';
  data: SonicLyricsData;
  meta: SonicMeta;
}

export interface SonicErrorResponse {
  brand: 'Sonic';
  error: {
    code: string;
    message: string;
  };
  meta: Partial<SonicMeta>;
}

export interface SonicQueryParams {
  title?: string;
  artist?: string;
  duration?: number;
  album?: string;
  ncmMusicId?: string;
  qqMusicId?: string;
  appleMusicId?: string;
  spotifyId?: string;
  isrc?: string;
  platform?: string;
  platformId?: string;
  prefer?: 'real' | 'approx' | 'auto' | 'word';
  nocache?: boolean;
}

// ── Search Gateway Types ──

export interface SonicSearchSource {
  platform: string;
  platformId: string;
  duration?: number;
  quality?: string;
  url?: string;
  bitrate?: string | number;
}

export interface SonicSearchTrack {
  id: string; // for CFSolara player compatibility
  title: string;
  name: string; // alias for player compatibility
  artist: string;
  album: string;
  duration: number; // in seconds
  cover: string;
  coverUrl: string; // alias for player
  platform: string;
  platformId: string;
  sources: SonicSearchSource[];
  // Additional player compatibility fields:
  picId?: string;
  lyricId?: string;
  urlId?: string;
  source?: string;
}

export interface SonicSearchData {
  query: string;
  page: number;
  count: number;
  total: number;
  tracks: SonicSearchTrack[];
}

export interface SonicSearchResponse {
  brand: 'Sonic';
  data: SonicSearchData;
  meta: SonicMeta;
}

export interface SonicSearchOptions {
  page?: number;
  count?: number;
  platform?: string;
  signal?: AbortSignal;
}
