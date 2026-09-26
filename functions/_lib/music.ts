import type { AppEnv, HighPrecisionLyricPayload, LyricFetchOptions, LyricLine, LyricSyncType, LyricWord, SongItem } from './types';

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

export function isMetadataLine(text: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (/^(作词|作曲|编曲|词|曲|制作|制作人|监制|录音|混音|母带|吉他|贝斯|鼓|和声|弦乐|企划|统筹|OP|SP|演唱|原唱|歌手|专辑|发行|出品|Written|Composed|Arranged|Produced|Lyrics|Music|Vocal|Singer)\s*[:：]/i.test(trimmed)) {
    return true;
  }
  if (/^[^-–—]+[-–—][^-–—]+$/.test(trimmed) && trimmed.length < 50) {
    return true;
  }
  return false;
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
    if (/^\[(ti|ar|al|by|offset|kana|re|ve|hash|sign|qq|total):/i.test(line)) {
      continue;
    }

    // 2.1 网易云 / smart-lyric JSON 行格式：{"t":1234,"c":[{"tx":"...", "t":1234, "d":500}]} 或 {"c":[{"tx":"..."}]}
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const json = JSON.parse(line);
        if (Array.isArray(json.c)) {
          let lineText = '';
          const words: LyricWord[] = [];
          let hasWordInfo = false;
          const lineBaseTime = typeof json.t === 'number' ? json.t : 0;

          for (const item of json.c) {
            const tx = item.tx || '';
            lineText += tx;
            if (typeof item.t === 'number' && typeof item.d === 'number') {
              hasWordInfo = true;
              const wStart = item.t + offsetMs;
              const wEnd = wStart + item.d;
              words.push({
                text: tx,
                start: Math.max(0, wStart),
                startSec: parseFloat((Math.max(0, wStart) / 1000).toFixed(3)),
                end: Math.max(0, wEnd),
                endSec: parseFloat((Math.max(0, wEnd) / 1000).toFixed(3)),
                duration: Math.max(0, item.d),
              });
            }
          }

          const cleanText = lineText.trim();
          if (!cleanText) continue;
          if (/^(作词|作曲|编曲|词|曲|制作|制作人|监制|录音|混音|母带|吉他|贝斯|鼓|和声|弦乐|企划|统筹|OP|SP|Written by|Composed by|Arranged by|Produced by|Lyrics by|Music by)\s*[:：]/i.test(cleanText)) {
            continue;
          }

          if (hasWordInfo && words.length > 0) hasWordTimestamps = true;
          const lineTime = words.length > 0 ? words[0].start : (lineBaseTime + offsetMs);
          const lineDur = words.length > 0 ? (words[words.length - 1].end - lineTime) : undefined;

          parsedLines.push({
            time: Math.max(0, lineTime),
            timeSec: parseFloat((Math.max(0, lineTime) / 1000).toFixed(3)),
            duration: lineDur,
            text: cleanText,
            words: words.length > 0 ? words : undefined,
          });
          continue;
        }
      } catch {}
    }

    // 2.2 匹配网易云 YRC 格式：[lineStart,lineDur](wordStart,wordDur,0)word...
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

      const cleanText = lineText.trim() || content.replace(/\([^)]+\)/g, '').trim();
      if (!cleanText) continue;
      if (/^(作词|作曲|编曲|词|曲|制作|制作人|监制|录音|混音|母带|吉他|贝斯|鼓|和声|弦乐|企划|统筹|OP|SP|Written by|Composed by|Arranged by|Produced by|Lyrics by|Music by)\s*[:：]/i.test(cleanText)) {
        continue;
      }

      if (words.length > 0) {
        hasWordTimestamps = true;
        parsedLines.push({
          time: Math.max(0, lineStartMs),
          timeSec: parseFloat((Math.max(0, lineStartMs) / 1000).toFixed(3)),
          duration: lineDurMs,
          text: cleanText,
          words,
        });
        continue;
      }
    }

    // 2.3 匹配标准行级时间戳 [mm:ss.xx] 或 [mm:ss.xxx]
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

      const isSeconds = String(angleMatch[1]).includes('.') || rawStart < 100;
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
    if (/^(作词|作曲|编曲|词|曲|制作|制作人|监制|录音|混音|母带|吉他|贝斯|鼓|和声|弦乐|企划|统筹|OP|SP|Written by|Composed by|Arranged by|Produced by|Lyrics by|Music by)\s*[:：]/i.test(plainText)) {
      continue;
    }

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

  // 为没有设定 duration 的行计算合理行时长，基于自然语速声学模型保留间奏与伴奏呼吸空间
  for (let i = 0; i < parsedLines.length; i++) {
    const cur = parsedLines[i];
    if (!cur.duration) {
      const next = parsedLines[i + 1];
      const gapMs = next ? next.time - cur.time : 4500;
      const clean = cur.text.replace(/\[[^\]]+\]/g, '').replace(/<[^>]+>/g, '').replace(/\([^)]+\)/g, '').trim();
      const vocalChars = Math.max(1, clean.replace(/[\s\p{P}\p{S}]/gu, '').length);
      const naturalMs = Math.round(Math.max(1200, vocalChars * 240 + 350));
      if (gapMs <= 0) {
        cur.duration = naturalMs;
      } else if (naturalMs >= gapMs - 200) {
        cur.duration = Math.max(400, Math.min(gapMs, gapMs - 150));
      } else {
        cur.duration = Math.min(gapMs - 250, naturalMs);
      }
    }
    cur.durationSec = parseFloat((cur.duration / 1000).toFixed(3));
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

// ── 外部爬虫与多源聚合抓取器 ──

export function isValidLyric(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^\[00:00(?:\.00+)?\]\s*(暂无歌词|纯音乐，请欣赏|没有填词|纯音乐)/i.test(trimmed)) return false;
  const lines = trimmed.split('\n').filter((l) => l.trim() && !/^\[(ti|ar|al|by|offset|kana|re|ve|hash|sign|qq|total):/i.test(l.trim()));
  const validVocalLines = lines.filter((l) => {
    const textOnly = l.replace(/\[[^\]]+\]/g, '').replace(/<[^>]+>/g, '').replace(/\([^)]+\)/g, '').trim();
    if (!textOnly) return false;
    return !isMetadataLine(textOnly);
  });
  return validVocalLines.length > 0;
}

async function fetchDirectNetEaseLyrics(id: string): Promise<string> {
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
      if (json?.yrc?.lyric && typeof json.yrc.lyric === 'string' && isValidLyric(json.yrc.lyric)) {
        return json.yrc.lyric;
      }
      if (json?.lrc?.lyric && typeof json.lrc.lyric === 'string' && isValidLyric(json.lrc.lyric)) {
        return json.lrc.lyric;
      }
    }
  } catch {}
  return '';
}

async function fetchDirectQQLyrics(songmid: string): Promise<string> {
  try {
    const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(songmid)}&format=json&nobase64=1`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://y.qq.com/',
      },
    });
    if (resp.ok) {
      const json = (await resp.json()) as any;
      if (json.code === 0 && typeof json.lyric === 'string' && isValidLyric(json.lyric)) {
        return json.lyric;
      }
    }
  } catch {}
  return '';
}

async function crawlNetEaseBySearch(query: string): Promise<{ raw: string; id: string; title: string; artist: string } | null> {
  try {
    const sUrl = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&offset=0&total=true&limit=6`;
    const sRes = await fetch(sUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://music.163.com/',
      },
    });
    if (!sRes.ok) return null;
    const sJson = (await sRes.json()) as any;
    const songs = sJson.result?.songs;
    if (!Array.isArray(songs) || songs.length === 0) return null;

    let candidate: { raw: string; id: string; title: string; artist: string } | null = null;

    for (const song of songs.slice(0, 5)) {
      if (!song?.id) continue;
      const raw = await fetchDirectNetEaseLyrics(String(song.id));
      if (raw && isValidLyric(raw)) {
        const item = {
          raw,
          id: String(song.id),
          title: String(song.name || ''),
          artist: Array.isArray(song.artists) ? song.artists.map((a: any) => a.name).join(' / ') : '',
        };
        // 优先采纳含逐字 YRC 标签的候选项（包括网易云原生 JSON 逐字与标签逐字）
        if (raw.includes('{"t":') || (raw.includes('[') && raw.includes(']('))) {
          return item;
        }
        if (!candidate) {
          candidate = item;
        }
      }
    }
    return candidate;
  } catch {}
  return null;
}

async function crawlQQBySearch(query: string): Promise<{ raw: string; id: string; title: string; artist: string } | null> {
  try {
    const sUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=5&w=${encodeURIComponent(query)}&format=json`;
    const sRes = await fetch(sUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://y.qq.com/',
      },
    });
    if (!sRes.ok) return null;
    const sJson = (await sRes.json()) as any;
    const songList = sJson.data?.song?.list;
    if (!Array.isArray(songList) || songList.length === 0) return null;

    for (const song of songList.slice(0, 4)) {
      if (!song?.songmid) continue;
      const raw = await fetchDirectQQLyrics(song.songmid);
      if (raw && isValidLyric(raw)) {
        return {
          raw,
          id: song.songmid,
          title: String(song.songname || ''),
          artist: Array.isArray(song.singer) ? song.singer.map((s: any) => s.name).join(' / ') : '',
        };
      }
    }
  } catch {}
  return null;
}

async function crawlLrclibBySearch(query: string, title?: string, artist?: string): Promise<{ raw: string; id: string; title: string; artist: string } | null> {
  try {
    let url = '';
    if (title) {
      url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}${artist ? `&artist_name=${encodeURIComponent(artist)}` : ''}`;
    } else {
      url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    }
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CFSolara/2.0' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (Array.isArray(json)) {
      const match = json.find((x: any) => x.syncedLyrics && isValidLyric(x.syncedLyrics));
      if (match?.syncedLyrics) {
        return {
          raw: match.syncedLyrics,
          id: String(match.id),
          title: String(match.trackName || ''),
          artist: String(match.artistName || ''),
        };
      }
    } else if (json?.syncedLyrics && isValidLyric(json.syncedLyrics)) {
      return {
        raw: json.syncedLyrics,
        id: String(json.id),
        title: String(json.trackName || ''),
        artist: String(json.artistName || ''),
      };
    }
  } catch {}
  return null;
}

async function crawlKugouBySearch(query: string): Promise<{ raw: string; id: string; title: string; artist: string } | null> {
  try {
    const sUrl = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(query)}&page=1&pagesize=3`;
    const sRes = await fetch(sUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CFSolara/2.0' },
    });
    if (!sRes.ok) return null;
    const sJson = (await sRes.json()) as any;
    const item = sJson.data?.lists?.[0];
    if (!item?.FileHash) return null;

    const lUrl = `http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(item.SongName)}&hash=${item.FileHash}&timelength=${(item.Duration || 0) * 1000}`;
    const lRes = await fetch(lUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CFSolara/2.0' },
    });
    if (!lRes.ok) return null;
    const lJson = (await lRes.json()) as any;
    const candidate = lJson.candidates?.[0];
    if (!candidate?.id || !candidate?.accesskey) return null;

    const dUrl = `http://lyrics.kugou.com/download?ver=1&client=pc&id=${candidate.id}&accesskey=${candidate.accesskey}&fmt=lrc&charset=utf8`;
    const dRes = await fetch(dUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CFSolara/2.0' },
    });
    if (!dRes.ok) return null;
    const dJson = (await dRes.json()) as any;
    if (dJson.content) {
      try {
        const binaryStr = atob(dJson.content);
        const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
        const decoded = new TextDecoder('utf-8').decode(bytes);
        if (isValidLyric(decoded)) {
          return {
            raw: decoded,
            id: item.FileHash,
            title: String(item.SongName || ''),
            artist: String(item.SingerName || ''),
          };
        }
      } catch {}
    }
  } catch {}
  return null;
}

/**
 * 通用全网歌词聚合抓取入口 (Universal High-Precision Lyric Engine)
 * 支持通过 ID 直接获取，或通过 title / artist / q 在全网主流平台进行瀑布爬取
 */
export async function getUniversalLyrics(env: AppEnv, options: LyricFetchOptions): Promise<HighPrecisionLyricPayload> {
  const { id = '', source = 'netease', title = '', artist = '', q = '' } = options;

  let rawLyric = '';
  let finalSource = source;
  let finalId = id;
  let finalTitle = title;
  let finalArtist = artist;

  // 1. 直连 ID 优先提取
  if (id && id !== 'undefined' && id !== 'null') {
    if (source === 'netease' || (/^\d+$/.test(id) && source !== 'tencent' && source !== 'qq')) {
      const directNetease = await fetchDirectNetEaseLyrics(id);
      if (directNetease && isValidLyric(directNetease)) {
        rawLyric = directNetease;
        finalSource = 'netease';
      }
    } else if (source === 'tencent' || source === 'qq') {
      const directQQ = await fetchDirectQQLyrics(id);
      if (directQQ && isValidLyric(directQQ)) {
        rawLyric = directQQ;
        finalSource = 'tencent';
      }
    }

    // 上游 Provider 备选
    if (!rawLyric) {
      try {
        const data = await fetchMusicProvider(env, { types: 'lyric', id, source });
        if (typeof data === 'object' && data !== null && typeof data.lyric === 'string' && isValidLyric(data.lyric)) {
          rawLyric = data.lyric;
        } else if (typeof data === 'string' && isValidLyric(data)) {
          rawLyric = data;
        }
      } catch {}
    }
  }

  // 2. 如果直连未取到歌词，但提供了 title、artist 或 q，启动全网瀑布实时爬虫
  const searchQuery = (q || `${title} ${artist}`).trim();
  if (!rawLyric && searchQuery) {
    // 2.1 网易云全网检索 (多候选遍历与 YRC 优先)
    const neteaseResult = await crawlNetEaseBySearch(searchQuery);
    if (neteaseResult?.raw && isValidLyric(neteaseResult.raw)) {
      rawLyric = neteaseResult.raw;
      finalSource = 'netease';
      finalId = neteaseResult.id;
      if (!finalTitle) finalTitle = neteaseResult.title;
      if (!finalArtist) finalArtist = neteaseResult.artist;
    }

    // 2.2 QQ 音乐全网检索
    if (!rawLyric) {
      const qqResult = await crawlQQBySearch(searchQuery);
      if (qqResult?.raw && isValidLyric(qqResult.raw)) {
        rawLyric = qqResult.raw;
        finalSource = 'tencent';
        finalId = qqResult.id;
        if (!finalTitle) finalTitle = qqResult.title;
        if (!finalArtist) finalArtist = qqResult.artist;
      }
    }

    // 2.3 LRCLIB 国际公共库检索 (覆盖海量全球与外文歌曲)
    if (!rawLyric) {
      const lrclibResult = await crawlLrclibBySearch(searchQuery, title, artist);
      if (lrclibResult?.raw && isValidLyric(lrclibResult.raw)) {
        rawLyric = lrclibResult.raw;
        finalSource = 'lrclib';
        finalId = lrclibResult.id;
        if (!finalTitle) finalTitle = lrclibResult.title;
        if (!finalArtist) finalArtist = lrclibResult.artist;
      }
    }

    // 2.4 酷狗音乐检索
    if (!rawLyric) {
      const kugouResult = await crawlKugouBySearch(searchQuery);
      if (kugouResult?.raw && isValidLyric(kugouResult.raw)) {
        rawLyric = kugouResult.raw;
        finalSource = 'kugou';
        finalId = kugouResult.id;
        if (!finalTitle) finalTitle = kugouResult.title;
        if (!finalArtist) finalArtist = kugouResult.artist;
      }
    }
  }

  // 3. 高精度多协议结构化解析
  const { syncType, offset, lines } = parseHighPrecisionLyrics(rawLyric);

  const isPure = lines.length === 0 || /纯音乐/i.test(rawLyric);

  return {
    ok: true,
    id: finalId,
    source: finalSource,
    syncType,
    offset,
    title: finalTitle || undefined,
    artist: finalArtist || undefined,
    lines,
    lineCount: lines.length,
    rawLyric,
    isPureMusic: isPure,
  };
}

export async function getTrackLyrics(env: AppEnv, id: string, source = 'netease'): Promise<HighPrecisionLyricPayload> {
  return getUniversalLyrics(env, { id, source });
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
