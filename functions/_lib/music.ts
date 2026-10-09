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

export async function getTrackStreamUrl(
  env: AppEnv,
  id: string,
  source = 'netease',
  quality = '320',
  title?: string,
  artist?: string
): Promise<string> {
  let cleanId = id;
  let cleanSource = source;
  if (cleanId.includes(':')) {
    const parts = cleanId.split(':');
    cleanSource = parts[0] || cleanSource;
    cleanId = parts.slice(1).join(':');
  }

  // 1. Direct Kuwo stream if source is kuwo or id is numeric rid
  if (cleanSource === 'kuwo') {
    try {
      const kuwoUrl = `https://antiserver.kuwo.cn/anti.s?type=convert_url&rid=${encodeURIComponent(cleanId)}&format=mp3&response=url`;
      const res = await fetch(kuwoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://www.kuwo.cn/',
        },
      });
      if (res.ok) {
        const directUrl = (await res.text()).trim();
        if (directUrl && directUrl.startsWith('http')) return directUrl;
      }
    } catch {}
  }

  // 2. Primary GDStudio / Meting Bridge (netease, joox, bilibili)
  try {
    const data = await fetchMusicProvider(env, {
      types: 'url',
      id: cleanId,
      source: cleanSource === 'qq' ? 'tencent' : cleanSource,
      br: quality,
    });
    if (typeof data === 'object' && data !== null && typeof data.url === 'string' && data.url.startsWith('http')) {
      return data.url;
    }
  } catch {}

  // 3. High-availability Kuwo search fallback when track is restricted or unresolvable
  const searchKeywords = [title, artist].filter(Boolean).join(' ').trim();
  if (searchKeywords) {
    try {
      const kwSearchUrl = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(searchKeywords)}&pn=0&rn=3&vipver=1&ft=music&encoding=utf8&rformat=json&mobi=1`;
      const kwRes = await fetch(kwSearchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sonic/2.1.0' },
      });
      if (kwRes.ok) {
        const kwJson: any = await kwRes.json();
        const rid = kwJson?.abslist?.[0]?.MUSICRID?.replace('MUSIC_', '');
        if (rid) {
          const kwPlayUrl = `https://antiserver.kuwo.cn/anti.s?type=convert_url&rid=${encodeURIComponent(rid)}&format=mp3&response=url`;
          const playRes = await fetch(kwPlayUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Referer: 'https://www.kuwo.cn/',
            },
          });
          if (playRes.ok) {
            const finalAudioUrl = (await playRes.text()).trim();
            if (finalAudioUrl && finalAudioUrl.startsWith('http')) return finalAudioUrl;
          }
        }
      }
    } catch {}
  }

  // 4. NetEase Direct Outer MP3 fallback
  if (cleanSource === 'netease' && /^\d+$/.test(cleanId)) {
    try {
      const outerUrl = `https://music.163.com/song/media/outer/url?id=${cleanId}.mp3`;
      const testRes = await fetch(outerUrl, {
        method: 'HEAD',
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      const loc = testRes.headers.get('location') || '';
      if (loc && !loc.includes('404')) {
        return outerUrl;
      }
    } catch {}
  }

  return '';
}

export function isMetadataLine(text: string, title?: string, artist?: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (
    /^(作词|作詞|作曲|编曲|編曲|歌|唄|演奏|プロデュース|レコーディング|ミキシング|マスタリング|词|曲|制作|制作人|监制|总监制|录音|录音师|录音室|混音|混音师|混音室|母带|母带后期|母带工程|吉他|贝斯|鼓|和声|合声|和声编写|合声编写|和声配唱|弦乐|弦乐编写|键盘|钢琴|小提琴|中提琴|大提琴|小提琴独奏|大提琴独奏|萨克斯|长笛|笛子|二胡|古筝|琵琶|打击乐|管乐|铜管|企划|统筹|OP|SP|演唱|原唱|歌手|专辑|发行|发行人|出品|出品人|出品公司|发行公司|版权|版权所有|特别支持|特别鸣谢|鸣谢|鸣谢单位|致谢|文案|插画|封面|总策划|音乐总监|人声编辑|音频编辑|录音工程|录音助理|混音助理|项目经理|营销|宣发|商务|Written|Composed|Arranged|Arrangement|Produced|Production|Lyrics|Music|Vocal|Singer|Mixed|Mixing|Mastered|Mastering|Recorded|Recording|Sound Engineer|Executive Producer|Music Director|Special Thanks|Presented by|Published by|Strings|Strings Arrange|Guitar|Bass|Drums|Keyboard|Piano|Synthesizer|Programming)[\u4e00-\u9fa5\u3040-\u30ffa-zA-Z0-9\s.·()（）]*[:：\/—–-]/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (/^[^-–—]+[-–—][^-–—]+$/.test(trimmed) && trimmed.length < 60 && /(唱|曲|词|编|混|录|室)/.test(trimmed)) {
    return true;
  }
  // Title / Artist delimiter check (e.g. "李荣浩 - 年少有为", "G.E.M. 邓紫棋 - 泡沫", "Shape of You - Ed Sheeran")
  if (/^([^-–—]+)[-–—]([^-–—]+)$/.test(trimmed)) {
    const parts = trimmed.split(/[-–—]/).map((p) => p.trim().toLowerCase());
    const cleanTitle = (title || '').toLowerCase().replace(/\([^)]+\)/g, '').trim();
    const cleanArtist = (artist || '').toLowerCase().replace(/\([^)]+\)/g, '').trim();
    if (
      (cleanTitle && (parts[0].includes(cleanTitle) || parts[1].includes(cleanTitle))) ||
      (cleanArtist && (parts[0].includes(cleanArtist) || parts[1].includes(cleanArtist)))
    ) {
      return true;
    }
  }
  if (title) {
    const cleanTitle = title.toLowerCase().replace(/\([^)]+\)/g, '').trim();
    if (cleanTitle.length >= 2 && trimmed.toLowerCase() === cleanTitle) {
      return true;
    }
  }
  return false;
}

export function calibrateLyricsWithReference(
  parsedLines: LyricLine[],
  refRawLyric?: string,
): LyricLine[] {
  if (!refRawLyric || !parsedLines || parsedLines.length === 0) return parsedLines;

  // 1. 提取参考音频原始 LRC 中可信的非元数据演唱句
  const refLines: { text: string; timeSec: number }[] = [];
  for (const line of refRawLyric.split('\n')) {
    const m = line.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\](.*)$/);
    if (m) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const ms = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const timeSec = min * 60 + sec + ms / 1000;
      const text = m[4].replace(/\{[^}]+\}/g, '').replace(/<[^>]+>/g, '').trim();
      if (text && text.length >= 2 && !isMetadataLine(text)) {
        refLines.push({ text: text.replace(/\s+/g, ''), timeSec });
      }
    }
  }

  if (refLines.length === 0) return parsedLines;

  // 2. 跨句子查找物理时间基准锚点（对比前 10 句真实演唱句）
  const deltas: number[] = [];
  for (const ref of refLines.slice(0, 10)) {
    const cand = parsedLines.find((c) => {
      const cClean = c.text.replace(/\s+/g, '');
      return (
        (cClean.length >= 3 && ref.text.includes(cClean.slice(0, 3))) ||
        (ref.text.length >= 3 && cClean.includes(ref.text.slice(0, 3)))
      );
    });
    if (cand) {
      const diffSec = ref.timeSec - cand.timeSec;
      if (Math.abs(diffSec) <= 10.0) {
        deltas.push(diffSec);
      }
    }
  }

  if (deltas.length === 0) return parsedLines;

  // 取中位数消除单句转音或个体标记差异
  deltas.sort((a, b) => a - b);
  const medianDelta = deltas[Math.floor(deltas.length / 2)];

  // 若偏差小于 35ms，视为完美贴合，无需物理微移
  if (Math.abs(medianDelta) < 0.035) {
    return parsedLines;
  }

  const deltaMs = Math.round(medianDelta * 1000);

  return parsedLines.map((line) => {
    const newTime = Math.max(0, line.time + deltaMs);
    const newTimeSec = parseFloat((newTime / 1000).toFixed(3));
    let newWords = line.words;
    if (Array.isArray(line.words)) {
      newWords = line.words.map((w) => {
        const wStart = Math.max(0, w.start + deltaMs);
        const wEnd = Math.max(0, w.end + deltaMs);
        return {
          ...w,
          start: wStart,
          startSec: parseFloat((wStart / 1000).toFixed(3)),
          end: wEnd,
          endSec: parseFloat((wEnd / 1000).toFixed(3)),
        };
      });
    }
    return {
      ...line,
      time: newTime,
      timeSec: newTimeSec,
      words: newWords,
    };
  });
}

export function parseTtmlTimestamp(ts: string): number {
  if (!ts) return 0;
  const trimmed = ts.trim();
  const colonParts = trimmed.split(':');
  if (colonParts.length === 3) {
    const hours = parseFloat(colonParts[0]) || 0;
    const minutes = parseFloat(colonParts[1]) || 0;
    const seconds = parseFloat(colonParts[2]) || 0;
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  } else if (colonParts.length === 2) {
    const minutes = parseFloat(colonParts[0]) || 0;
    const seconds = parseFloat(colonParts[1]) || 0;
    return Math.round((minutes * 60 + seconds) * 1000);
  } else if (trimmed.endsWith('ms')) {
    return parseFloat(trimmed.slice(0, -2)) || 0;
  } else if (trimmed.endsWith('s')) {
    return Math.round((parseFloat(trimmed.slice(0, -1)) || 0) * 1000);
  }
  const num = parseFloat(trimmed);
  return isNaN(num) ? 0 : Math.round(num < 1000 ? num * 1000 : num);
}

export function parseTtmlLyrics(xml: string, offsetMs = 0): LyricLine[] {
  const lines: LyricLine[] = [];
  const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pAttrs = pMatch[1];
    let pContent = pMatch[2];

    const beginMatch = pAttrs.match(/begin="([^"]+)"/i);
    const endMatch = pAttrs.match(/end="([^"]+)"/i);
    const pBeginMs = beginMatch ? parseTtmlTimestamp(beginMatch[1]) + offsetMs : 0;
    const pEndMs = endMatch ? parseTtmlTimestamp(endMatch[1]) + offsetMs : pBeginMs + 3000;

    // 1. 过滤翻译行与罗马音行 (ttm:role="x-translation" / "x-roman")
    pContent = pContent.replace(/<span\b[^>]*ttm:role=["']x-(?:translation|roman)["'][^>]*>[\s\S]*?<\/span>/gi, '');

    // 2. 解包外层背景伴唱容器 (ttm:role="x-bg")，让内部嵌套的子 span 成为一级发音单元
    pContent = pContent.replace(/<span\b[^>]*ttm:role=["']x-bg["'][^>]*>/gi, '');

    // 3. 匹配有效字级 span，同时捕获 span 之间的空白字符
    const spanRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>([\t ]*)/gi;
    let spanMatch: RegExpExecArray | null;
    const words: LyricWord[] = [];
    const validSpanTexts: string[] = [];

    while ((spanMatch = spanRegex.exec(pContent)) !== null) {
      const spanAttrs = spanMatch[1];
      const rawText = spanMatch[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      const trailingSpace = spanMatch[3] || '';

      const sBeginMatch = spanAttrs.match(/begin="([^"]+)"/i);
      const sEndMatch = spanAttrs.match(/end="([^"]+)"/i);

      if (!sBeginMatch) {
        // 无时间戳的杂项 span，不作为字级发音词
        continue;
      }

      const sBeginMs = parseTtmlTimestamp(sBeginMatch[1]) + offsetMs;
      const sEndMs = sEndMatch ? parseTtmlTimestamp(sEndMatch[1]) + offsetMs : sBeginMs + 300;
      const durMs = Math.max(0, sEndMs - sBeginMs);

      // 若 span 之后有空格，或者为西方语言单词且需要空格间隔，保留尾随空格
      let wordText = rawText;
      if (trailingSpace.length > 0 && !wordText.endsWith(' ')) {
        wordText += ' ';
      }

      words.push({
        text: wordText,
        start: sBeginMs,
        startSec: parseFloat((sBeginMs / 1000).toFixed(3)),
        end: sEndMs,
        endSec: parseFloat((sEndMs / 1000).toFixed(3)),
        duration: durMs,
        durationSec: parseFloat((durMs / 1000).toFixed(3)),
      });
      validSpanTexts.push(wordText);
    }

    // 纯文本正文：优先由合法字级 words 拼接，无 words 时清洗剩余纯标签
    const cleanText = validSpanTexts.length > 0
      ? validSpanTexts.join('').trim()
      : pContent.replace(/<[^>]+>/g, '').trim();

    if (!cleanText || isMetadataLine(cleanText)) continue;

    const lineStartMs = words.length > 0 ? words[0].start : pBeginMs;
    // 确保整行持续时长完全覆盖到 pEndMs 或最后一个字发音结束，杜绝 300ms 闪退
    const lineEndMs = words.length > 0
      ? Math.max(pEndMs, words[words.length - 1].end)
      : pEndMs;
    const lineDurMs = Math.max(500, lineEndMs - lineStartMs);

    lines.push({
      time: lineStartMs,
      timeSec: parseFloat((lineStartMs / 1000).toFixed(3)),
      duration: lineDurMs,
      durationSec: parseFloat((lineDurMs / 1000).toFixed(3)),
      text: cleanText,
      words: words.length > 0 ? words : undefined,
    });
  }

  return lines;
}

export function parseMusixmatchRichsync(raw: string, offsetMs = 0): LyricLine[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    if (parsed.length === 0 || typeof parsed[0].ts !== 'number') return null;

    const lines: LyricLine[] = [];
    for (const item of parsed) {
      const lineStartMs = Math.round(item.ts * 1000) + offsetMs;
      const lineEndMs = typeof item.te === 'number' ? Math.round(item.te * 1000) + offsetMs : lineStartMs + 3000;
      const words: LyricWord[] = [];
      let lineText = '';

      if (Array.isArray(item.l)) {
        for (let i = 0; i < item.l.length; i++) {
          const wItem = item.l[i];
          const wText = String(wItem.c || '');
          const wStartMs = Math.round((item.ts + (wItem.o || 0)) * 1000) + offsetMs;
          const nextW = item.l[i + 1];
          const wEndMs = nextW
            ? Math.round((item.ts + (nextW.o || 0)) * 1000) + offsetMs
            : lineEndMs;
          const wDurMs = Math.max(40, wEndMs - wStartMs);

          words.push({
            text: wText,
            start: wStartMs,
            startSec: parseFloat((wStartMs / 1000).toFixed(3)),
            end: wEndMs,
            endSec: parseFloat((wEndMs / 1000).toFixed(3)),
            duration: wDurMs,
            durationSec: parseFloat((wDurMs / 1000).toFixed(3)),
          });
          lineText += wText;
        }
      }

      const cleanText = lineText.trim();
      if (!cleanText || isMetadataLine(cleanText)) continue;

      lines.push({
        time: lineStartMs,
        timeSec: parseFloat((lineStartMs / 1000).toFixed(3)),
        duration: lineEndMs - lineStartMs,
        durationSec: parseFloat(((lineEndMs - lineStartMs) / 1000).toFixed(3)),
        text: cleanText,
        words: words.length > 0 ? words : undefined,
      });
    }

    return lines;
  } catch {
    return null;
  }
}

export function parseHighPrecisionLyrics(
  raw: string,
  title?: string,
  artist?: string,
  referenceRawLyric?: string,
): {
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

  // 2. 检测 TTML / Apple Music XML 格式
  if (raw.includes('<tt') || /<p\b[^>]*begin=/i.test(raw)) {
    const ttmlLines = parseTtmlLyrics(raw, offsetMs);
    if (ttmlLines.length > 0) {
      const hasWordTimestamps = ttmlLines.some((l) => l.words && l.words.length > 0);
      const filtered = ttmlLines.filter((l) => !isMetadataLine(l.text, title, artist));
      const calibrated = calibrateLyricsWithReference(filtered, referenceRawLyric);
      return {
        syncType: hasWordTimestamps ? 'word' : 'line',
        offset: offsetMs,
        lines: calibrated.sort((a, b) => a.time - b.time),
      };
    }
  }

  // 3. 检测 Musixmatch richsync JSON 格式
  if (raw.trim().startsWith('[') && /"ts"\s*:\s*[\d.]+/i.test(raw)) {
    const mmLines = parseMusixmatchRichsync(raw, offsetMs);
    if (mmLines && mmLines.length > 0) {
      const filtered = mmLines.filter((l) => !isMetadataLine(l.text, title, artist));
      const calibrated = calibrateLyricsWithReference(filtered, referenceRawLyric);
      return {
        syncType: 'word',
        offset: offsetMs,
        lines: calibrated.sort((a, b) => a.time - b.time),
      };
    }
  }

  // 4. 检测是否为 XML 包装的 QRC 格式
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

    // 过滤元数据标签 [ti:], [ar:], [al:], [by:], [offset:], [language:], [id:] 等
    if (/^\[(ti|ar|al|by|offset|kana|re|ve|hash|sign|qq|total|language|id):/i.test(line)) {
      continue;
    }

    // 4.1 网易云 / smart-lyric JSON 行格式：{"t":1234,"c":[{"tx":"...", "t":1234, "d":500}]} 或 {"c":[{"tx":"..."}]}
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
                durationSec: parseFloat((Math.max(0, item.d) / 1000).toFixed(3)),
              });
            }
          }

          const cleanText = lineText.trim();
          if (!cleanText || isMetadataLine(cleanText, title, artist)) {
            continue;
          }

          if (hasWordInfo && words.length > 1) {
            hasWordTimestamps = true;
          }
          const lineTime = words.length > 0 ? words[0].start : (lineBaseTime + offsetMs);
          const lineDur = words.length > 0 ? (words[words.length - 1].end - lineTime) : undefined;

          // 若整句仅包含 1 个词块但文字有多字，拆分为音节以便逐字卡拉OK平滑展示
          let finalWords: LyricWord[] | undefined = words.length > 0 ? words : undefined;
          if (finalWords && finalWords.length === 1 && cleanText.length > 1 && lineDur && lineDur > 400) {
            finalWords = interpolateWordTimestamps(cleanText, lineTime, lineDur);
          }

          parsedLines.push({
            time: Math.max(0, lineTime),
            timeSec: parseFloat((Math.max(0, lineTime) / 1000).toFixed(3)),
            duration: lineDur,
            durationSec: lineDur !== undefined ? parseFloat((Math.max(0, lineDur) / 1000).toFixed(3)) : undefined,
            text: cleanText,
            words: finalWords,
          });
          continue;
        }
      } catch {}
    }

    // 2.2 匹配网易云 YRC 与酷狗 KRC 逐字格式：
    // YRC: [lineStart,lineDur](wordStart,wordDur)word...
    // KRC: [lineStart,lineDur]<wordStart,wordDur,0>word...
    const yrcLineMatch = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (yrcLineMatch) {
      const lineStartMs = parseInt(yrcLineMatch[1], 10) + offsetMs;
      const lineDurMs = parseInt(yrcLineMatch[2], 10);
      const content = yrcLineMatch[3];

      const words: LyricWord[] = [];
      const wordRegex = /[<(](\d+),(\d+)(?:,\d+)?[>)]([^<(\n]+)/g;
      let wMatch;
      let lineText = '';

      // 预先检测整行是相对偏移模式还是绝对时间戳模式（严防句中相对偏移累加大于 lineStartMs 时发生时间戳倒流）
      const firstTag = content.match(/[<(](\d+),/);
      const isRelativeOffset = firstTag ? parseInt(firstTag[1], 10) < lineStartMs : true;

      while ((wMatch = wordRegex.exec(content)) !== null) {
        const rawOffset = parseInt(wMatch[1], 10);
        const wDur = parseInt(wMatch[2], 10);
        const wText = wMatch[3];

        const wStart = isRelativeOffset ? (lineStartMs + rawOffset) : (rawOffset + offsetMs);
        const wEnd = wStart + wDur;
        words.push({
          text: wText,
          start: Math.max(0, wStart),
          startSec: parseFloat((Math.max(0, wStart) / 1000).toFixed(3)),
          end: Math.max(0, wEnd),
          endSec: parseFloat((Math.max(0, wEnd) / 1000).toFixed(3)),
          duration: Math.max(0, wDur),
          durationSec: parseFloat((Math.max(0, wDur) / 1000).toFixed(3)),
        });
        lineText += wText;
      }

      const cleanText = lineText.trim() || content.replace(/[<(][^>)]+[>)]/g, '').trim();
      if (!cleanText || isMetadataLine(cleanText, title, artist)) continue;

      if (words.length > 0) {
        hasWordTimestamps = true;
        const lineTime = words[0].start;
        const lineDur = (words[words.length - 1].end - lineTime) || lineDurMs;
        parsedLines.push({
          time: Math.max(0, lineTime),
          timeSec: parseFloat((Math.max(0, lineTime) / 1000).toFixed(3)),
          duration: lineDur,
          durationSec: parseFloat((Math.max(0, lineDur) / 1000).toFixed(3)),
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
        durationSec: parseFloat((Math.max(0, durMs) / 1000).toFixed(3)),
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
          durationSec: parseFloat((Math.max(0, wDur) / 1000).toFixed(3)),
        });
      }
    }

    const plainText = cleanLineBody
      .replace(/<[^>]+>/g, '')
      .replace(/\([^)]+\)/g, '')
      .trim();

    if (!plainText) continue;
    if (isMetadataLine(plainText, title, artist)) {
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
      const lineDur = lineWords[lineWords.length - 1].end - lineStart;
      parsedLines.push({
        time: lineStart,
        timeSec: lineWords[0].startSec,
        duration: lineDur,
        durationSec: parseFloat((Math.max(0, lineDur) / 1000).toFixed(3)),
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
      if (gapMs <= 0) {
        cur.duration = 3500;
      } else if (gapMs <= 7000) {
        // 正常歌唱句间衔接：保留约 150ms~450ms 自然换气微歇，整行发音时间充分平滑展开
        const breathMs = Math.min(450, Math.max(150, Math.round(gapMs * 0.09)));
        cur.duration = Math.max(800, gapMs - breathMs);
      } else {
        // 存在真正伴奏长间奏（gapMs > 7s）：限制发音时间在合理的自然慢歌演唱范围（如 4s~6s），剩余为纯音乐间奏
        const clean = cur.text.replace(/\[[^\]]+\]/g, '').replace(/<[^>]+>/g, '').replace(/\([^)]+\)/g, '').trim();
        const vocalChars = Math.max(1, clean.replace(/[\s\p{P}\p{S}]/gu, '').length);
        const interludeVocalMs = Math.round(Math.max(3500, Math.min(gapMs - 1500, vocalChars * 550 + 800)));
        cur.duration = interludeVocalMs;
      }
    }
    cur.durationSec = parseFloat((cur.duration / 1000).toFixed(3));

    // 关键升级：若当前行缺失逐字标签，采用自然语流声学插值生成毫秒级字级/音节级发音时序
    if (!cur.words || cur.words.length === 0) {
      cur.words = interpolateWordTimestamps(cur.text, cur.time, cur.duration);
    }
  }

  const filtered = parsedLines.filter((l) => !isMetadataLine(l.text, title, artist));
  const calibrated = calibrateLyricsWithReference(filtered, referenceRawLyric);

  return {
    syncType: hasWordTimestamps ? 'word' : 'line',
    offset: offsetMs,
    lines: calibrated,
  };
}

export function interpolateWordTimestamps(lineText: string, lineStartMs: number, lineDurationMs: number): LyricWord[] {
  const clean = lineText.replace(/\[[^\]]+\]/g, '').replace(/<[^>]+>/g, '').trim();
  if (!clean) return [];

  const isJapanese = /[\u3040-\u30ff]/.test(clean);

  // 1. 智能语言感知分词流 (Language-Aware Syllable/Token Stream)
  // - 日文平假名/片假名 + 拗音小假名/长音符自动结合为单一发音拍单元
  // - 汉字单个成字
  // - 西方语言按单词
  // - 标点符号与空白提取并智能吸附
  const tokenRegex = isJapanese
    ? /([\u3040-\u30ff][ぁぃぅぇぉゃゅょゎァィゥェォャュョヮー〜~]?|[\u4e00-\u9fa5]|[\uac00-\ud7af]|[a-zA-Z0-9'’]+|[^\s\w\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]+|\s+)/gu
    : /([\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]|[a-zA-Z0-9'’]+|[^\s\w\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]+|\s+)/gu;

  const rawSegments: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(clean)) !== null) {
    if (match[1]) rawSegments.push(match[1]);
  }
  if (rawSegments.length === 0) rawSegments.push(clean);

  // 2. 标点符号与空白智能吸附绑定（Punctuation & Whitespace Binding）
  // 严格杜绝行首标点（如日文引号「、中文括号（）被当作独立字占用时间！
  const mergedTokens: string[] = [];
  let pendingLeadingPunct = '';

  for (const seg of rawSegments) {
    const isPunctOrSpace = /^[\s\p{P}\p{S}]+$/u.test(seg);
    if (isPunctOrSpace) {
      if (mergedTokens.length === 0) {
        // 行首标点暂存，待绑定至首个真实发音字
        pendingLeadingPunct += seg;
      } else {
        // 行间/行末标点吸附于前一个字
        mergedTokens[mergedTokens.length - 1] += seg;
      }
    } else {
      if (pendingLeadingPunct) {
        mergedTokens.push(pendingLeadingPunct + seg);
        pendingLeadingPunct = '';
      } else {
        mergedTokens.push(seg);
      }
    }
  }

  // 极端情况下若整行全为标点
  if (mergedTokens.length === 0 && pendingLeadingPunct) {
    mergedTokens.push(pendingLeadingPunct);
  }

  const tokensList = mergedTokens.length > 0 ? mergedTokens : rawSegments;

  // 3. 计算各发音单元的语言学生理学权重 (Mora / Syllable Acoustic Weights)
  const tokenWeights = tokensList.map((tok, idx) => {
    const core = tok.replace(/[\s\p{P}\p{S}]/gu, '');
    if (!core) return 0.2;

    const isLast = idx === tokensList.length - 1;
    const cadenceMultiplier = isLast ? 1.5 : 1.0;

    if (isJapanese) {
      // 日语语境：
      // - 汉字（Kanji）通常为双拍甚至三拍（如「愛」「夢」「心」），赋予 1.95 基准权重
      if (/[\u4e00-\u9fa5]/.test(core)) {
        return 1.95 * cadenceMultiplier;
      }
      // - 促音「っ/ッ」为顿音，赋予 0.75 权重
      if (/[っッ]/.test(core)) {
        return 0.75 * cadenceMultiplier;
      }
      // - 含长音符或复合拗音
      if (/[ー〜~ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]/.test(core)) {
        return 1.35 * cadenceMultiplier;
      }
      // - 单假名标准拍 (1 Mora)
      return 1.0 * cadenceMultiplier;
    }

    // 中文语境：单字 1.0，句尾延音 1.45
    if (/[\u4e00-\u9fa5]/.test(core)) {
      return 1.0 * (isLast ? 1.45 : 1.0);
    }

    // 韩文音节
    if (/[\uac00-\ud7af]/.test(core)) {
      return 1.0 * (isLast ? 1.4 : 1.0);
    }

    // 西方语言多字母单词
    const coreLen = core.length;
    return Math.max(1.0, coreLen * 0.45) * (isLast ? 1.35 : 1.0);
  });

  const totalWeight = Math.max(0.1, tokenWeights.reduce((a, b) => a + b, 0));

  // 4. 科学合理的整行声乐发音时长分配 (Dynamic Vocal Duration Allocation)
  // 彻底废除 Math.round(totalWeight * 320) 的强行腰斩截断！
  let vocalDurationMs: number;
  if (lineDurationMs && lineDurationMs > 0) {
    // 留出 120ms~450ms 自然呼吸换气微歇
    const breathPauseMs = Math.min(450, Math.max(120, Math.round(lineDurationMs * 0.09)));
    const usableLineMs = Math.max(400, lineDurationMs - breathPauseMs);

    // 只有当平均每拍时长异常巨大 (> 850ms，且总时长 > 7000ms) 时，才判定为长器乐伴奏间奏
    if (lineDurationMs > 7000 && (usableLineMs / totalWeight) > 850) {
      // 长间奏下的合理发音时长（慢歌优雅展开，其余为纯音乐间奏）
      const interludeVocal = Math.round(totalWeight * 650);
      vocalDurationMs = Math.min(usableLineMs, Math.max(3500, interludeVocal));
    } else {
      // 绝大多数正常演唱行：全额平滑使用该行自然演唱时段，绝不提前跑完！
      vocalDurationMs = usableLineMs;
    }
  } else {
    // 无时长参考时按自然歌唱 450ms/拍 估算
    vocalDurationMs = Math.max(1500, Math.round(totalWeight * 450));
  }

  let currentStart = lineStartMs;
  const resultWords: LyricWord[] = [];

  for (let i = 0; i < tokensList.length; i++) {
    const tok = tokensList[i];
    const weight = tokenWeights[i];
    const tokDur = (i === tokensList.length - 1)
      ? Math.max(60, Math.round(lineStartMs + vocalDurationMs - currentStart))
      : Math.max(60, Math.round((weight / totalWeight) * vocalDurationMs));
    const tokEnd = currentStart + tokDur;

    resultWords.push({
      text: tok,
      start: currentStart,
      startSec: parseFloat((currentStart / 1000).toFixed(3)),
      end: tokEnd,
      endSec: parseFloat((tokEnd / 1000).toFixed(3)),
      duration: tokDur,
      durationSec: parseFloat((tokDur / 1000).toFixed(3)),
    });
    currentStart = tokEnd;
  }
  return resultWords;
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
  const lines = trimmed.split('\n').filter((l) => l.trim() && !/^\[(ti|ar|al|by|offset|kana|re|ve|hash|sign|qq|total|language|id):/i.test(l.trim()));
  const validVocalLines = lines.filter((l) => {
    const textOnly = l.replace(/\[[^\]]+\]/g, '').replace(/<[^>]+>/g, '').replace(/\([^)]+\)/g, '').trim();
    if (!textOnly) return false;
    return !isMetadataLine(textOnly);
  });
  return validVocalLines.length > 0;
}

export function hasWordSyncTags(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  // KRC or YRC syllable tags: [lineStart,lineDur]<wStart,wDur,0>word
  if (/\[\d+,\d+\]\s*[<(]\d+,\d+/.test(raw)) return true;
  // Enhanced LRC (multiple syllable timestamps per line)
  if (/<(?:\d{1,2}:)?\d{2}[.:]\d{2,3}>[^<\n]+<(?:\d{1,2}:)?\d{2}[.:]\d{2,3}>/.test(raw)) return true;
  // TTML / XML spans
  if (/<span\b[^>]*begin=/i.test(raw)) return true;
  // Smart lyric JSON: must have multiple word tokens inside a c array
  if (/"c"\s*:\s*\[[^{}]*\{"tx"[^{}]*\}[^{}]*\{"tx"/.test(raw)) return true;
  // Musixmatch richsync JSON
  if (/"ts"\s*:\s*[\d.]+\s*,\s*"te"\s*:\s*[\d.]+\s*,\s*"l"\s*:\s*\[/.test(raw)) return true;
  return false;
}

export async function fetchDirectNetEaseLyrics(id: string): Promise<string> {
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

export async function fetchDirectQQLyrics(songmid: string): Promise<string> {
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
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sonic/2.1.0' },
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

async function decodeKugouKrc(base64Content: string): Promise<string> {
  const binaryStr = atob(base64Content);
  const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
  const key = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
  const bodyBuf = bytes.slice(4);
  for (let i = 0; i < bodyBuf.length; i++) {
    bodyBuf[i] ^= key[i % 16];
  }
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(bodyBuf);
  writer.close();
  const res = new Response(ds.readable);
  return await res.text();
}

async function crawlKugouBySearch(
  query: string,
  targetDuration?: number,
  targetArtist?: string,
  targetTitle?: string,
  referenceRawLyric?: string,
): Promise<{ raw: string; id: string; title: string; artist: string; duration?: number } | null> {
  try {
    const cleanTargetTitle = (targetTitle || '')
      .replace(/\([^)]+\)/g, '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/《[^》]+》/g, '')
      .trim()
      .toLowerCase();

    interface RawCandidate {
      id: string;
      accesskey: string;
      song: string;
      singer: string;
      duration: number;
      fileHash?: string;
      productFrom?: string;
      krctype?: number;
    }

    const collectedCandidates: RawCandidate[] = [];

    // 渠道 1：通过酷狗 master song search (mobilecdn + song_search_v2) 获取录音室母带版本与哈希值
    try {
      const searchApis = [
        `http://mobilecdn.kugou.com/api/v3/search/song?keyword=${encodeURIComponent(query)}&page=1&pagesize=5`,
        `http://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(query)}&page=1&pagesize=5&clientver=&platform=WebFilter`,
      ];
      for (const sUrl of searchApis) {
        try {
          const sRes = await fetch(sUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sonic/2.1.0' },
          });
          if (sRes.ok) {
            const sJson = (await sRes.json()) as any;
            const items = Array.isArray(sJson.data?.info) ? sJson.data.info : (Array.isArray(sJson.data?.lists) ? sJson.data.lists : []);
            for (const item of items.slice(0, 4)) {
              const hash = item.hash || item.FileHash;
              const sSong = item.songname || item.SongName;
              const sSinger = item.singername || item.SingerName;
              const sDur = typeof item.duration === 'number' ? item.duration : (item.Duration || 0);
              if (!hash || !sSong) continue;

              const lUrl = `http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(sSong)}&hash=${hash}&timelength=${sDur * 1000}`;
              const lRes = await fetch(lUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sonic/2.1.0' },
              });
              if (lRes.ok) {
                const lJson = (await lRes.json()) as any;
                for (const c of lJson.candidates || []) {
                  if (c.id && c.accesskey) {
                    collectedCandidates.push({
                      id: String(c.id),
                      accesskey: String(c.accesskey),
                      song: String(c.song || sSong || ''),
                      singer: String(c.singer || sSinger || ''),
                      duration: typeof c.duration === 'number' ? c.duration : sDur * 1000,
                      fileHash: hash,
                      productFrom: String(c.product_from || ''),
                      krctype: typeof c.krctype === 'number' ? c.krctype : undefined,
                    });
                  }
                }
              }
            }
          }
        } catch {}
      }
    } catch {}

    // 渠道 2：直接向 lyrics.kugou.com/search 检索备用候选
    const directQueries = [query];
    if (targetTitle && targetTitle !== query) directQueries.push(targetTitle);
    for (const dq of directQueries) {
      const durParam = targetDuration ? `&timelength=${Math.round(targetDuration * 1000)}` : '';
      const dUrl = `http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(dq)}${durParam}`;
      try {
        const dRes = await fetch(dUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sonic/2.1.0' } });
        if (dRes.ok) {
          const dJson = (await dRes.json()) as any;
          for (const c of dJson.candidates || []) {
            if (c.id && c.accesskey) {
              const cDur = typeof c.duration === 'number' ? c.duration : 0;
              // 若已知完整歌曲超过 60 秒，直接丢弃小于 60 秒的铃声/剪辑片段
              if (targetDuration && targetDuration > 60 && cDur > 0 && cDur < 60000) {
                continue;
              }
              collectedCandidates.push({
                id: String(c.id),
                accesskey: String(c.accesskey),
                song: String(c.song || ''),
                singer: String(c.singer || ''),
                duration: cDur,
                productFrom: String(c.product_from || ''),
                krctype: typeof c.krctype === 'number' ? c.krctype : undefined,
              });
            }
          }
        }
      } catch {}
    }

    if (collectedCandidates.length === 0) return null;

    // 按 ID 去重
    const seenCandidateIds = new Set<string>();
    const uniqueCandidates = collectedCandidates.filter((c) => {
      if (seenCandidateIds.has(c.id)) return false;
      seenCandidateIds.add(c.id);
      return true;
    });

    // 严密计算候选歌曲打分（坚固防线：杜绝短版、铃声、伴奏与翻唱）
    const scoredCandidates = uniqueCandidates
      .map((c) => {
        let score = 0;
        const sClean = c.song.replace(/\([^)]+\)/g, '').replace(/\[[^\]]+\]/g, '').trim().toLowerCase();
        const durSec = c.duration / 1000;

        // 0. 时长贴合权重（关键防线：若歌曲长于60秒，坚决剔除小于60秒的铃声短版片段）
        if (targetDuration && targetDuration > 20) {
          if (targetDuration > 60 && durSec < 60) {
            return { candidate: c, score: -999 };
          }
          const diff = Math.abs(durSec - targetDuration);
          if (diff <= 3) score += 90;
          else if (diff <= 8) score += 60;
          else if (diff <= 18) score += 25;
          else if (diff > 35) score -= 100;
        } else if (durSec < 60) {
          // 未指定目标时长时，对于小于60秒的片段也施加严厉惩罚，优先完整版
          score -= 80;
        }

        // 官方推荐歌词优先加成
        if (c.productFrom?.includes('官方') || c.krctype === 1) {
          score += 100;
        }

        // 1. 歌名核心匹配权重
        if (cleanTargetTitle && cleanTargetTitle.length >= 2) {
          if (sClean.includes(cleanTargetTitle) || cleanTargetTitle.includes(sClean)) {
            score += 50;
          } else {
            score -= 60;
          }
        }

        // 2. 过滤垃圾/改编/伴奏
        if (/(伴奏|伴唱|纯音乐|铃声|片段|短版|剪辑|双声道|变奏|改编|翻唱|二创|鬼畜|环绕|慢速|加速|减速)/i.test(c.song)) {
          score -= 120;
        }

        // 3. 歌手匹配权重与严密防线
        if (targetArtist) {
          const normTarget = targetArtist.toLowerCase().split(/[\/,]/)[0].trim();
          const normSinger = c.singer.toLowerCase().trim();
          if (normTarget && (normSinger.includes(normTarget) || normTarget.includes(normSinger))) {
            score += 60;
          } else if (normTarget.length >= 2) {
            // 歌手完全不匹配，严厉惩罚翻唱与张冠李戴填词，杜绝纯音乐被李代桃僵
            score -= 150;
          }
        }

        return { candidate: c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    for (const { candidate } of scoredCandidates.slice(0, 5)) {

        // 1. 优先尝试获取并解码毫秒级逐字 KRC 格式
        try {
          const krcUrl = `http://lyrics.kugou.com/download?ver=1&client=pc&id=${candidate.id}&accesskey=${candidate.accesskey}&fmt=krc&charset=utf8`;
          const krcRes = await fetch(krcUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sonic/2.1.0' },
          });
          if (krcRes.ok) {
            const krcJson = (await krcRes.json()) as any;
            if (krcJson.content) {
              const decoded = await decodeKugouKrc(krcJson.content);
              if (isValidLyric(decoded) && hasWordSyncTags(decoded)) {
                // 深度校验 1：检查 KRC 实际最后一句歌词时间戳，确保不是半截歌词
                const timeMatches = [...decoded.matchAll(/\[(\d+),/g)];
                const lastTimestampMs = timeMatches.length > 0 ? parseInt(timeMatches[timeMatches.length - 1][1], 10) : 0;
                if (targetDuration && targetDuration > 60 && lastTimestampMs < (targetDuration - 50) * 1000) {
                  // 歌词在歌曲结束前50秒以上就戛然而止，属于截断歌词，跳过
                  continue;
                }

                // 深度校验 2：内容相似度与全曲时间轴（含间奏）严格对齐校验
                if (referenceRawLyric) {
                  const refParsedLines: { text: string; timeSec: number }[] = [];
                  for (const rawLine of referenceRawLyric.split('\n')) {
                    const l = rawLine.trim();
                    if (!l) continue;
                    if (l.startsWith('{') && l.endsWith('}')) {
                      try {
                        const j = JSON.parse(l);
                        if (Array.isArray(j.c)) {
                          const tText = j.c.map((c: any) => c.tx || '').join('').trim();
                          const tSec = (j.t || 0) / 1000;
                          if (tText && tText.length >= 2 && !/^(作词|作曲|编曲|词|曲|制作|演唱|歌手)/i.test(tText)) {
                            refParsedLines.push({ text: tText, timeSec: tSec });
                          }
                          continue;
                        }
                      } catch {}
                    }
                    const m = l.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\](.*)$/);
                    if (m) {
                      const min = parseInt(m[1], 10);
                      const sec = parseInt(m[2], 10);
                      const ms = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0;
                      const tSec = min * 60 + sec + ms / 1000;
                      const tText = m[4].replace(/\{[^}]+\}/g, '').trim();
                      if (tText && tText.length >= 2 && !/^(作词|作曲|编曲|词|曲|制作|演唱|歌手)/i.test(tText)) {
                        refParsedLines.push({ text: tText, timeSec: tSec });
                      }
                    }
                  }

                  if (refParsedLines.length >= 4) {
                    const cleanDecoded = decoded.replace(/<[^>]+>/g, '').replace(/\([^)]+\)/g, '');

                    // A. 语种一致性严密防护（杜绝韩语歌曲被替换为英文/中文版）
                    const refHasKorean = refParsedLines.some((x) => /[\uac00-\ud7af]/.test(x.text));
                    if (refHasKorean && !/[\uac00-\ud7af]/.test(cleanDecoded)) {
                      continue;
                    }
                    const refHasJapanese = refParsedLines.some((x) => /[\u3040-\u30ff]/.test(x.text));
                    if (refHasJapanese && !/[\u3040-\u30ff]/.test(cleanDecoded)) {
                      continue;
                    }

                    // B. 文本相似度抽样核验
                    const sample1 = refParsedLines[Math.floor(refParsedLines.length * 0.25)];
                    const sample2 = refParsedLines[Math.floor(refParsedLines.length * 0.65)];
                    const s1Clean = sample1 ? sample1.text.replace(/\s+/g, '') : '';
                    const s2Clean = sample2 ? sample2.text.replace(/\s+/g, '') : '';
                    const m1 = s1Clean && cleanDecoded.includes(s1Clean.slice(0, Math.min(4, s1Clean.length)));
                    const m2 = s2Clean && cleanDecoded.includes(s2Clean.slice(0, Math.min(4, s2Clean.length)));
                    if (!m1 && !m2) {
                      continue;
                    }

                    // C. 间奏后时间戳严格物理对齐（坚决杜绝因变奏/长间奏导致后半段直接乱掉）
                    const candidateLines: { text: string; timeSec: number }[] = [];
                    for (const candLine of decoded.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
                      const cMatch = candLine.match(/^\[(\d+),\d+\](.*)$/);
                      if (cMatch) {
                        const cTimeSec = parseInt(cMatch[1], 10) / 1000;
                        const cText = cMatch[2].replace(/<[^>]+>/g, '').replace(/\([^)]+\)/g, '').replace(/\s+/g, '');
                        if (cText.length >= 2 && !/^(作词|作曲|编曲|词|曲|制作|演唱|歌手)/i.test(cText)) {
                          candidateLines.push({ text: cText, timeSec: cTimeSec });
                        }
                      }
                    }

                    // 多位点巡检（覆盖前奏后、第一段间奏后、第二段间奏后的句子，时差超过 2.0 秒坚决舍弃）
                    let hasInterludeDrift = false;
                    const checkIndices = [
                      Math.floor(refParsedLines.length * 0.20),
                      Math.floor(refParsedLines.length * 0.35),
                      Math.floor(refParsedLines.length * 0.50),
                      Math.floor(refParsedLines.length * 0.65),
                      Math.floor(refParsedLines.length * 0.80),
                    ];

                    // 计算首个匹配句的基准偏移量（消除前奏长短静音差异）
                    const firstMatchRef = refParsedLines.find((r) => candidateLines.some((c) => c.text.includes(r.text.slice(0, 3))));
                    const firstMatchCand = firstMatchRef ? candidateLines.find((c) => c.text.includes(firstMatchRef.text.slice(0, 3))) : null;
                    const baseOffsetSec = firstMatchRef && firstMatchCand ? (firstMatchCand.timeSec - firstMatchRef.timeSec) : 0;

                    for (const idx of checkIndices) {
                      const refItem = refParsedLines[idx];
                      if (!refItem) continue;
                      const rClean = refItem.text.replace(/\s+/g, '');
                      if (rClean.length < 3) continue;

                      const match = candidateLines.find((cl) => {
                        return cl.text.includes(rClean.slice(0, 3)) || rClean.includes(cl.text.slice(0, 3));
                      });

                      if (match) {
                        const relativeDiff = Math.abs((match.timeSec - baseOffsetSec) - refItem.timeSec);
                        if (relativeDiff > 2.5) {
                          hasInterludeDrift = true;
                          break;
                        }
                      }
                    }

                    if (hasInterludeDrift) {
                      // 间奏或编曲时长与原曲录音室音源相差超过 2.0 秒，说明版本不符，直接舍弃！
                      continue;
                    }
                  }
                }

                return {
                  raw: decoded,
                  id: candidate.fileHash || candidate.id,
                  title: String(candidate.song || ''),
                  artist: String(candidate.singer || ''),
                  duration: candidate.duration,
                };
              }
            }
          }
        } catch {}

        // 2. 降级尝试获取普通行级 LRC
        try {
          const lrcUrl = `http://lyrics.kugou.com/download?ver=1&client=pc&id=${candidate.id}&accesskey=${candidate.accesskey}&fmt=lrc&charset=utf8`;
          const lrcRes = await fetch(lrcUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sonic/2.1.0' },
          });
          if (lrcRes.ok) {
            const lrcJson = (await lrcRes.json()) as any;
            if (lrcJson.content) {
              const binaryStr = atob(lrcJson.content);
              const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
              const decoded = new TextDecoder('utf-8').decode(bytes);
              if (isValidLyric(decoded)) {
                return {
                  raw: decoded,
                  id: candidate.fileHash || candidate.id,
                  title: String(candidate.song || ''),
                  artist: String(candidate.singer || ''),
                  duration: candidate.duration,
                };
              }
            }
          }
        } catch {}
      }
  } catch {}
  return null;
}

async function crawlMusixmatchBySearch(
  title?: string,
  artist?: string,
): Promise<{ raw: string; id: string; title: string; artist: string } | null> {
  if (!title) return null;
  try {
    const tokenRes = await fetch('https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(3000),
    });
    if (!tokenRes.ok) return null;
    const tokenData = (await tokenRes.json()) as any;
    const token = tokenData?.message?.body?.user_token;
    if (!token) return null;

    const qTrack = encodeURIComponent(title);
    const qArtist = artist ? encodeURIComponent(artist) : '';
    const subUrl = `https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&q_track=${qTrack}&q_artist=${qArtist}&user_token=${token}&app_id=web-desktop-app-v1.0`;
    const subRes = await fetch(subUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Cookie: 'AWSELBCORS=0; AWSELB=0',
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!subRes.ok) return null;
    const subData = (await subRes.json()) as any;
    const macro = subData?.message?.body?.macro_calls;
    const trackInfo = macro?.['matcher.track.get']?.message?.body?.track;
    const subtitleBody = macro?.['track.subtitles.get']?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body;
    if (subtitleBody && isValidLyric(subtitleBody) && trackInfo?.track_name) {
      const cleanTarget = title.toLowerCase().replace(/[\s\-_—·.,!?'"()[\]{}<>《》「」【】]/g, '');
      const cleanFound = String(trackInfo.track_name).toLowerCase().replace(/[\s\-_—·.,!?'"()[\]{}<>《》「」【】]/g, '');
      const isMatch =
        cleanTarget.length >= 2 &&
        (cleanTarget.includes(cleanFound) ||
          cleanFound.includes(cleanTarget) ||
          (cleanTarget.length >= 3 && cleanFound.slice(0, 3) === cleanTarget.slice(0, 3)));
      if (!isMatch) {
        return null;
      }
      return {
        raw: subtitleBody,
        id: String(trackInfo.track_id || ''),
        title: trackInfo.track_name,
        artist: trackInfo.artist_name || artist || '',
      };
    }
  } catch {}
  return null;

}

function formatLrcTimestamp(ms: number): string {
  const totalSec = Math.max(0, ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = (totalSec % 60).toFixed(3);
  return `${String(mins).padStart(2, '0')}:${secs.padStart(6, '0')}`;
}

function formatTtmlTimestamp(ms: number): string {
  const totalSec = Math.max(0, ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = (totalSec % 60).toFixed(3);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${secs.padStart(6, '0')}`;
}

export function generateEnhancedLrc(lines: LyricLine[]): string {
  return lines
    .map((line) => {
      const lineTimeStr = formatLrcTimestamp(line.time);
      if (line.words && line.words.length > 0) {
        const wordsStr = line.words
          .map((w) => `<${formatLrcTimestamp(w.start)}>${w.text}`)
          .join('');
        const endStr = `<${formatLrcTimestamp(line.words[line.words.length - 1].end)}>`;
        return `[${lineTimeStr}]${wordsStr}${endStr}`;
      }
      return `[${lineTimeStr}]${line.text}`;
    })
    .join('\n');
}

export function generateTtml(lines: LyricLine[], title?: string, artist?: string): string {
  const paragraphs = lines
    .map((line) => {
      const pBegin = formatTtmlTimestamp(line.time);
      const lineDur = line.duration || (line.words && line.words.length > 0 ? (line.words[line.words.length - 1].end - line.time) : 3000);
      const pEnd = formatTtmlTimestamp(line.time + lineDur);
      if (line.words && line.words.length > 0) {
        const spans = line.words
          .map((w) => {
            const sBegin = formatTtmlTimestamp(w.start);
            const sEnd = formatTtmlTimestamp(w.end);
            const escaped = w.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `        <span begin="${sBegin}" end="${sEnd}">${escaped}</span>`;
          })
          .join('\n');
        return `      <p begin="${pBegin}" end="${pEnd}">\n${spans}\n      </p>`;
      }
      const escapedText = line.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `      <p begin="${pBegin}" end="${pEnd}">${escapedText}</p>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-extensions">
  <head>
    <metadata>
      <ttm:title>${(title || '').replace(/&/g, '&amp;')}</ttm:title>
      <ttm:agent type="person">${(artist || '').replace(/&/g, '&amp;')}</ttm:agent>
    </metadata>
  </head>
  <body>
    <div>
${paragraphs}
    </div>
  </body>
</tt>`;
}

/**
 * 通用全网歌词聚合抓取入口 (Universal High-Precision Lyric Engine)
 * 支持通过 ID 直接获取，或通过 title / artist / q 在全网主流平台进行瀑布爬取
 */
export async function getUniversalLyrics(env: AppEnv, options: LyricFetchOptions): Promise<HighPrecisionLyricPayload> {
  const { id = '', source = 'netease', title = '', artist = '', q = '', duration } = options;

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

  // 计算既有歌词的基准时长与跨度（用于衡量候选项是否全篇对齐）
  let estimatedDurationSec = (typeof duration === 'number' && duration > 10) ? Math.round(duration) : 0;
  if (!estimatedDurationSec && rawLyric) {
    const timeMatches = [...rawLyric.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\]/g)];
    if (timeMatches.length > 0) {
      const lastM = timeMatches[timeMatches.length - 1];
      estimatedDurationSec = parseInt(lastM[1], 10) * 60 + parseInt(lastM[2], 10);
    }
  }

  // 若缺失歌曲标题但提供了网易云 ID，自动解析曲名与歌手以便进行全网高精逐字匹配
  if (!finalTitle && id && id !== 'undefined' && id !== 'null' && (source === 'netease' || /^\d+$/.test(id))) {
    try {
      const dRes = await fetch(`https://music.163.com/api/song/detail/?id=${encodeURIComponent(id)}&ids=[${encodeURIComponent(id)}]`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sonic/2.1.0' },
      });
      if (dRes.ok) {
        const dJson = (await dRes.json()) as any;
        const sItem = dJson?.songs?.[0];
        if (sItem) {
          finalTitle = sItem.name || finalTitle;
          if (!finalArtist && sItem.artists?.[0]?.name) {
            finalArtist = sItem.artists[0].name;
          }
          if (!estimatedDurationSec && sItem.duration) {
            estimatedDurationSec = Math.round(sItem.duration / 1000);
          }
        }
      }
    } catch {}
  }

  // 2. 逐字高精升级与全网瀑布实时爬虫：
  const searchQuery = (q || `${finalTitle || title} ${finalArtist || artist}`).trim();

  // 若未获取到原始歌词但提供了搜索线索，优先尝试从网易云获取录音室官方参考 LRC（用于获取权威时间轴与时长）
  if (!rawLyric && searchQuery) {
    try {
      const netRef = await crawlNetEaseBySearch(searchQuery);
      if (netRef?.raw && isValidLyric(netRef.raw)) {
        rawLyric = netRef.raw;
        finalSource = 'netease';
        if (!finalTitle) finalTitle = netRef.title;
        if (!finalArtist) finalArtist = netRef.artist;
        if (!estimatedDurationSec) {
          const timeMatches = [...netRef.raw.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\]/g)];
          if (timeMatches.length > 0) {
            const lastM = timeMatches[timeMatches.length - 1];
            estimatedDurationSec = parseInt(lastM[1], 10) * 60 + parseInt(lastM[2], 10);
          }
        }
      }
    } catch {}
  }

  // 保存原声提供商基准歌词，用于后续字级歌词物理锚点对齐校准
  const referenceRawLyric = rawLyric;

  if (searchQuery && (!rawLyric || !hasWordSyncTags(rawLyric))) {
    // 2.1 酷狗音乐高精逐字 KRC 检索（严守歌名、歌手、时长一致与内容相似度校验法则）
    const kugouResult = await crawlKugouBySearch(searchQuery, estimatedDurationSec, finalArtist || artist, finalTitle || title, referenceRawLyric);
    if (kugouResult?.raw && isValidLyric(kugouResult.raw) && hasWordSyncTags(kugouResult.raw)) {
      rawLyric = kugouResult.raw;
      finalSource = 'kugou';
      finalId = kugouResult.id;
      if (!finalTitle) finalTitle = kugouResult.title;
      if (!finalArtist) finalArtist = kugouResult.artist;
    }

    // 2.2 Musixmatch 字级 rich-sync 与行级 subtitles 检索（欧美及国际歌曲优先字级源）
    if (!rawLyric || !hasWordSyncTags(rawLyric)) {
      const mmResult = await crawlMusixmatchBySearch(finalTitle || title || searchQuery, finalArtist || artist);
      if (mmResult?.raw && isValidLyric(mmResult.raw) && (hasWordSyncTags(mmResult.raw) || !rawLyric)) {
        rawLyric = mmResult.raw;
        finalSource = 'musixmatch';
        finalId = mmResult.id;
        if (!finalTitle) finalTitle = mmResult.title;
        if (!finalArtist) finalArtist = mmResult.artist;
      }
    }

    // 2.3 若当前依然没有任何有效歌词，继续依次尝试网易云、QQ、LRCLIB 与酷狗普通 LRC
    if (!rawLyric) {
      const neteaseResult = await crawlNetEaseBySearch(searchQuery);
      if (neteaseResult?.raw && isValidLyric(neteaseResult.raw)) {
        rawLyric = neteaseResult.raw;
        finalSource = 'netease';
        finalId = neteaseResult.id;
        if (!finalTitle) finalTitle = neteaseResult.title;
        if (!finalArtist) finalArtist = neteaseResult.artist;
      }
    }

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

    if (!rawLyric) {
      const lrclibResult = await crawlLrclibBySearch(searchQuery, finalTitle || title, finalArtist || artist);
      if (lrclibResult?.raw && isValidLyric(lrclibResult.raw)) {
        rawLyric = lrclibResult.raw;
        finalSource = 'lrclib';
        finalId = lrclibResult.id;
        if (!finalTitle) finalTitle = lrclibResult.title;
        if (!finalArtist) finalArtist = lrclibResult.artist;
      }
    }

    if (!rawLyric && kugouResult?.raw && isValidLyric(kugouResult.raw)) {
      rawLyric = kugouResult.raw;
      finalSource = 'kugou';
      finalId = kugouResult.id;
      if (!finalTitle) finalTitle = kugouResult.title;
      if (!finalArtist) finalArtist = kugouResult.artist;
    }
  }

  // 3. 高精度多协议结构化解析与音频基准校准
  const { syncType, offset, lines } = parseHighPrecisionLyrics(rawLyric, finalTitle, finalArtist, referenceRawLyric);

  const isPure = lines.length === 0 || /纯音乐/i.test(rawLyric);

  const elrc = lines.length > 0 ? generateEnhancedLrc(lines) : (rawLyric || '');
  const ttml = lines.length > 0 ? generateTtml(lines, finalTitle, finalArtist) : '';

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
    elrc,
    ttml,
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
