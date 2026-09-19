import type { AppEnv, LyricLine, SongItem } from './types';

const DEFAULT_API_BASE = 'https://music-api.gdstudio.xyz/api.php';
const KUWO_HOST_PATTERN = /(^|\.)kuwo\.cn$/i;

export function getMusicApiBase(env: AppEnv): string {
  return env.MUSIC_API_BASE || DEFAULT_API_BASE;
}

export function generateSignature(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export function normalizeArtist(artist: unknown): string {
  if (Array.isArray(artist)) {
    return artist
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'name' in item) return String((item as { name: string }).name);
        return '';
      })
      .filter(Boolean)
      .join(' / ');
  }
  if (typeof artist === 'string') return artist;
  return '未知歌手';
}

export function normalizeTrack(raw: Record<string, any>, fallbackSource = 'netease'): SongItem {
  const artist = normalizeArtist(raw.artist || raw.ar);
  const picId = String(raw.pic_id || raw.pic || raw.cover || (raw.al && (raw.al.pic_str || raw.al.pic || raw.al.picUrl)) || '');
  const lyricId = String(raw.lyric_id || raw.id || '');
  const source = String(raw.source || fallbackSource || 'netease');

  return {
    id: String(raw.id || ''),
    name: String(raw.name || '未知歌曲'),
    artist,
    album: String(raw.album || (raw.al && raw.al.name) || ''),
    source,
    picId,
    lyricId,
    urlId: raw.url_id ? String(raw.url_id) : undefined,
    coverUrl: picId && !picId.startsWith('http') ? `/api/music/cover?id=${encodeURIComponent(picId)}&source=${source}` : picId || undefined,
  };
}

export async function fetchMusicProvider(env: AppEnv, params: Record<string, string>): Promise<any> {
  const url = new URL(getMusicApiBase(env));
  url.searchParams.set('s', generateSignature());
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Upstream music provider error: ${response.status}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function searchTracks(env: AppEnv, query: string, source = 'netease', count = 20, page = 1): Promise<SongItem[]> {
  const data = await fetchMusicProvider(env, {
    types: 'search',
    source,
    name: query,
    count: String(count),
    pages: String(page),
  });

  if (!Array.isArray(data)) return [];
  return data
    .filter((item) => Boolean(item && typeof item === 'object' && item.id))
    .map((item) => normalizeTrack(item, source));
}

export async function getTrackStreamUrl(env: AppEnv, id: string, source = 'netease', quality = '320'): Promise<string> {
  const data = await fetchMusicProvider(env, {
    types: 'url',
    id,
    source,
    br: quality,
  });

  if (typeof data === 'object' && data !== null && typeof data.url === 'string') {
    return data.url;
  }
  return '';
}

export function parseLrcLyrics(rawLrc: string): LyricLine[] {
  if (!rawLrc) return [];
  const lines = rawLrc.split('\n');
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

  for (const line of lines) {
    const text = line.replace(timeRegex, '').trim();
    if (!text) continue;

    timeRegex.lastIndex = 0;
    let match;
    while ((match = timeRegex.exec(line)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const time = minutes * 60 + seconds + milliseconds / 1000;
      result.push({ time, text });
    }
  }

  result.sort((a, b) => a.time - b.time);
  return result;
}

export async function getTrackLyrics(env: AppEnv, id: string, source = 'netease'): Promise<{ lyric: string; parsed: LyricLine[] }> {
  const data = await fetchMusicProvider(env, {
    types: 'lyric',
    id,
    source,
  });

  const rawLyric = typeof data === 'object' && data !== null && typeof data.lyric === 'string'
    ? data.lyric
    : typeof data === 'string'
      ? data
      : '';

  return {
    lyric: rawLyric,
    parsed: parseLrcLyrics(rawLyric),
  };
}

export async function getRandomTracks(env: AppEnv, count = 10, genre?: string): Promise<SongItem[]> {
  const GENRES = ['流行', '古典', '民谣', '摇滚', '爵士', '纯音乐', 'ACG', '轻音乐'];
  const targetGenre = genre || GENRES[Math.floor(Math.random() * GENRES.length)];
  const page = Math.floor(Math.random() * 3) + 1;
  const tracks = await searchTracks(env, targetGenre, 'netease', count, page);
  return tracks.sort(() => Math.random() - 0.5);
}

export function isAllowedKuwoHost(hostname: string): boolean {
  return KUWO_HOST_PATTERN.test(hostname);
}
