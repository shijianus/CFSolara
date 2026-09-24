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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json',
      Referer: 'https://music.gdstudio.xyz/',
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

export function parseHighPrecisionLyrics(raw: string): {
  syncType: LyricSyncType;
  offset: number;
  lines: LyricLine[];
} {
  if (!raw || !raw.trim()) {
    return { syncType: 'line', offset: 0, lines: [] };
  }

  // 1. 提取全局偏移量 [offset: +/- ms]
  let offsetMs = 0;
  const offsetMatch = raw.match(/\[offset:\s*([+-]?\d+)\]/i);
  if (offsetMatch) {
    offsetMs = parseInt(offsetMatch[1], 10) || 0;
  }

  // 2. 检测是否为 XML 包装的 QRC 格式
  let cleanInput = raw;
  const qrcXmlMatch = raw.match(/<Lyric_1[^>]*LyricContent="([^"]+)"/i);
  if (qrcXmlMatch) {
    cleanInput = qrcXmlMatch[1];
  }

  const rawLines = cleanInput.split('\n');
  const parsedLines: LyricLine[] = [];
  let hasWordTimestamps = false;

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 过滤元数据标签 [ti:], [ar:], [al:], [by:], [offset:] 等
    if (/^\[(ti|ar|al|by|offset|kana|re|ve):/i.test(line)) {
      continue;
    }

    // 2.1 匹配网易云 YRC 格式：[lineStart,lineDur](wordStart,wordDur,0)word...
    const yrcLineMatch = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (yrcLineMatch) {
      const lineStartMs = parseInt(yrcLineMatch[1], 10) + offsetMs;
      const lineDurMs = parseInt(yrcLineMatch[2], 10);
      const content = yrcLineMatch[3];

      const words: LyricWord[] = [];
      const wordRegex = /\((\d+),(\d+)(?:,\d+)?\)([^(]+)/g;
      let wMatch;
      let lineText = '';

      while ((wMatch = wordRegex.exec(content)) !== null) {
        let wStart = parseInt(wMatch[1], 10);
        const wDur = parseInt(wMatch[2], 10);
        const wText = wMatch[3];

        if (wStart < lineStartMs && wStart < 60000) {
          wStart = lineStartMs + wStart;
        } else {
          wStart = wStart + offsetMs;
        }

        const wEnd = wStart + wDur;
        words.push({
          text: wText,
          start: Math.max(0, wStart),
          startSec: parseFloat((Math.max(0, wStart) / 1000).toFixed(3)),
          end: Math.max(0, wEnd),
          endSec: parseFloat((Math.max(0, wEnd) / 1000).toFixed(3)),
          duration: Math.max(0, wDur),
        });
        lineText += wText;
      }

      if (words.length > 0) {
        hasWordTimestamps = true;
        parsedLines.push({
          time: Math.max(0, lineStartMs),
          timeSec: parseFloat((Math.max(0, lineStartMs) / 1000).toFixed(3)),
          duration: lineDurMs,
          text: lineText.trim() || content.replace(/\([^)]+\)/g, '').trim(),
          words,
        });
        continue;
      }
    }

    // 2.2 匹配标准行级时间戳 [mm:ss.xx] 或 [mm:ss.xxx]
    const standardTimeRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    const timeMatchesMs: number[] = [];
    let match;

    while ((match = standardTimeRegex.exec(line)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      timeMatchesMs.push(minutes * 60000 + seconds * 1000 + ms + offsetMs);
    }

    const cleanLineBody = line.replace(standardTimeRegex, '').trim();
    if (!cleanLineBody && timeMatchesMs.length > 0) continue;

    // 检查行内是否有逐字标签：
    // 形式一：<0.28,0.68>word 或 <280,680>word
    const angleWordRegex = /<([\d.]+)(?:,\s*([\d.]+))?>([^<]+)/g;
    // 形式二：(1234,567)word
    const parenWordRegex = /\((\d+),(\d+)(?:,\d+)?\)([^(]+)/g;

    let lineWords: LyricWord[] = [];
    let angleMatch;
    while ((angleMatch = angleWordRegex.exec(cleanLineBody)) !== null) {
      const rawStart = parseFloat(angleMatch[1]);
      const rawDur = angleMatch[2] ? parseFloat(angleMatch[2]) : 0.3;
      const wText = angleMatch[3];

      const isSeconds = rawStart < 1000 && !line.includes('[00:00.');
      const startMs = Math.round((isSeconds ? rawStart * 1000 : rawStart) + offsetMs);
      const durMs = Math.round(isSeconds ? rawDur * 1000 : rawDur);

      lineWords.push({
        text: wText,
        start: Math.max(0, startMs),
        startSec: parseFloat((Math.max(0, startMs) / 1000).toFixed(3)),
        end: Math.max(0, startMs + durMs),
        endSec: parseFloat((Math.max(0, startMs + durMs) / 1000).toFixed(3)),
        duration: Math.max(0, durMs),
      });
    }

    if (lineWords.length === 0) {
      let pMatch;
      while ((pMatch = parenWordRegex.exec(cleanLineBody)) !== null) {
        const wStart = parseInt(pMatch[1], 10) + offsetMs;
        const wDur = parseInt(pMatch[2], 10);
        const wText = pMatch[3];
        lineWords.push({
          text: wText,
          start: Math.max(0, wStart),
          startSec: parseFloat((Math.max(0, wStart) / 1000).toFixed(3)),
          end: Math.max(0, wStart + wDur),
          endSec: parseFloat((Math.max(0, wStart + wDur) / 1000).toFixed(3)),
          duration: Math.max(0, wDur),
        });
      }
    }

    const plainText = cleanLineBody
      .replace(/<[^>]+>/g, '')
      .replace(/\([^)]+\)/g, '')
      .trim();

    if (!plainText) continue;

    if (lineWords.length > 0) {
      hasWordTimestamps = true;
    }

    if (timeMatchesMs.length > 0) {
      for (const t of timeMatchesMs) {
        parsedLines.push({
          time: Math.max(0, t),
          timeSec: parseFloat((Math.max(0, t) / 1000).toFixed(3)),
          text: plainText,
          words: lineWords.length > 0 ? lineWords : undefined,
        });
      }
    } else if (lineWords.length > 0) {
      const lineStart = lineWords[0].start;
      parsedLines.push({
        time: lineStart,
        timeSec: lineWords[0].startSec,
        duration: lineWords[lineWords.length - 1].end - lineStart,
        text: plainText,
        words: lineWords,
      });
    }
  }

  parsedLines.sort((a, b) => a.time - b.time);

  // 为没有设定 duration 的行计算行时长
  for (let i = 0; i < parsedLines.length; i++) {
    const cur = parsedLines[i];
    if (!cur.duration) {
      const next = parsedLines[i + 1];
      if (next) {
        cur.duration = Math.max(300, next.time - cur.time);
      } else {
        cur.duration = 4500;
      }
    }
  }

  return {
    syncType: hasWordTimestamps ? 'word' : 'line',
    offset: offsetMs,
    lines: parsedLines,
  };
}

export function parseLrcLyrics(rawLrc: string): LyricLine[] {
  return parseHighPrecisionLyrics(rawLrc).lines;
}

export async function getTrackLyrics(env: AppEnv, id: string, source = 'netease'): Promise<HighPrecisionLyricPayload> {
  let rawLyric = '';

  // 1. 网易云直接优先尝试高精度 YRC
  if (source === 'netease') {
    try {
      const url = `https://music.163.com/api/song/lyric/v1?id=${encodeURIComponent(id)}&cp=false&tv=0&lv=0&rv=0&kv=0&yv=-1&ytv=0&yrv=0`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Referer: 'https://music.163.com/',
        },
      });
      if (resp.ok) {
        const json = (await resp.json()) as any;
        if (json?.yrc?.lyric && typeof json.yrc.lyric === 'string') {
          rawLyric = json.yrc.lyric;
        } else if (json?.lrc?.lyric && typeof json.lrc.lyric === 'string') {
          rawLyric = json.lrc.lyric;
        }
      }
    } catch {
      // 忽略直接请求异常
    }
  }

  // 2. 上游 Provider 抓取
  if (!rawLyric) {
    try {
      const data = await fetchMusicProvider(env, {
        types: 'lyric',
        id,
        source,
      });

      if (typeof data === 'object' && data !== null && typeof data.lyric === 'string') {
        rawLyric = data.lyric;
      } else if (typeof data === 'string') {
        rawLyric = data;
      }
    } catch {
      rawLyric = '';
    }
  }

  // 3. 高精度多协议解析
  const { syncType, offset, lines } = parseHighPrecisionLyrics(rawLyric);

  return {
    ok: true,
    id,
    source,
    syncType,
    offset,
    lines,
    lineCount: lines.length,
    rawLyric,
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
