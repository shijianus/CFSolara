export interface AppEnv {
  EPOMAIL_BASE_URL?: string;
  EPOMAIL_CLIENT_ID?: string;
  EPOMAIL_CLIENT_SECRET?: string;
  EPOMAIL_REDIRECT_URI?: string;
  MUSIC_API_BASE?: string;
  SOLARA_SECRET?: string;
  KV?: any;
  DB?: any;
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
}

export interface LyricLine {
  time: number;       // 毫秒
  timeSec: number;    // 秒
  duration?: number;  // 毫秒
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
