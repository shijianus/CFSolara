export interface AppEnv {
  EPOMAIL_BASE_URL?: string;
  EPOMAIL_CLIENT_ID?: string;
  EPOMAIL_CLIENT_SECRET?: string;
  EPOMAIL_REDIRECT_URI?: string;
  MUSIC_API_BASE?: string;
  SOLARA_SECRET?: string;
  SONIC_SECRET?: string;
  KV?: any;
  DB?: any;
  SONIC_UPSTREAM_GDSTUDIO?: string;
  SONIC_UPSTREAM_AMLL?: string;
  SONIC_UPSTREAM_LRCLIB?: string;
  SONIC_UPSTREAM_METING?: string;
  SONIC_ENABLE_NETEASE?: string;
  SONIC_ENABLE_QQ?: string;
  SONIC_ENABLE_KUGOU?: string;
  SONIC_ENABLE_AMLL?: string;
  SONIC_ENABLE_LRCLIB?: string;
  SONIC_ENABLE_GDSTUDIO?: string;
  SONIC_ENABLE_APPLE?: string;
  SONIC_ENABLE_YTMUSIC?: string;
  SONIC_APPLE_MUSIC_TOKEN?: string;
  SONIC_YOUTUBE_API_KEY?: string;
  SONIC_TIMEOUT_MS?: string;
  [key: string]: any;
}


export interface SongItem {
  id: string;
  name: string;
  artist: string;
  album: string;
  source: string;
  picId: string;
  lyricId: string;
  urlId?: string;
  coverUrl?: string;
  duration?: number;
}

export type LyricSyncType = 'word' | 'line';

export interface LyricWord {
  text: string;
  start: number;     // 毫秒
  startSec: number;  // 秒
  end: number;       // 毫秒
  endSec: number;    // 秒
  duration: number;  // 毫秒
  durationSec?: number; // 秒
}

export interface LyricLine {
  time: number;       // 毫秒
  timeSec: number;    // 秒
  duration?: number;  // 毫秒
  durationSec?: number; // 秒
  text: string;
  words?: LyricWord[];
}

export interface HighPrecisionLyricPayload {
  ok: boolean;
  id: string;
  source: string;
  syncType: LyricSyncType;
  offset: number;     // 毫秒
  title?: string;
  artist?: string;
  lines: LyricLine[];
  lineCount: number;
  rawLyric?: string;
  elrc?: string;      // Enhanced LRC (LRC A2 / Lyricify / AMLL)
  ttml?: string;      // Apple Music Timed Text XML (TTML)
  isPureMusic?: boolean;
}

export interface LyricFetchOptions {
  id?: string;
  source?: string;
  title?: string;
  artist?: string;
  q?: string;
  duration?: number;
}

export interface UserSession {
  id: string;
  email: string;
  name: string;
  avatar: string;
  role: string;
  apiKey: string;
  createdAt: string;
  expiresAt: string;
}
