// Sonic Gateway — Shared Utilities

import type { LyricLine } from '../types';
import type { SonicSyncedLine, SonicWord, SonicLyricLevel } from './types';

import { isMetadataLine } from '../music';

// 核心隔离：严密剔除字内吞入的纯音乐间奏时间 (Interlude Isolation Protection)
// 确保每个字的高亮时间严格代表真实开口唱的时长，间奏时间必须被隔离为静止停驻！
export function calibrateWordsInterludeIsolation(words: SonicWord[], nextLineStartMs?: number | null): SonicWord[] {
  if (!words || words.length === 0) return [];

  return words.map((w, i) => {
    const start = typeof w.startMs === 'number' ? w.startMs : (typeof w.start === 'number' ? w.start : 0);
    const rawDur = typeof w.durationMs === 'number' && w.durationMs > 0
      ? w.durationMs
      : (typeof w.duration === 'number' && w.duration > 0 ? w.duration : 300);
    const text = String(w.text || '');

    const isLastWord = i === words.length - 1;
    let maxAllowedDur = rawDur;

    if (!isLastWord) {
      // 句中字：发音时长严禁越界侵入下一个发音字起始时间
      const nextW = words[i + 1];
      const nextStart = typeof nextW.startMs === 'number' ? nextW.startMs : (typeof nextW.start === 'number' ? nextW.start : (start + rawDur));
      const gapToNext = Math.max(60, nextStart - start);
      maxAllowedDur = Math.min(rawDur, gapToNext);
    } else {
      // 句末尾字：若后方紧邻下一行起始时间，尾字不得越界侵入下一行
      if (typeof nextLineStartMs === 'number' && nextLineStartMs > start) {
        const gapToNextLine = Math.max(100, nextLineStartMs - start - 50);
        // 若后方有长达数秒的纯音乐大间奏且原始时长异乎寻常巨大(>4000ms)，才将尾字延音保护性收敛为自然长拖音上限(3200ms)
        if (gapToNextLine > 4000 && rawDur > 4000) {
          maxAllowedDur = 3200;
        } else {
          maxAllowedDur = Math.min(rawDur, gapToNextLine);
        }
      }
    }

    const vocalDur = Math.max(60, maxAllowedDur);
    const end = start + vocalDur;

    return {
      text,
      startMs: start,
      start: start,
      startSec: parseFloat((start / 1000).toFixed(3)),
      endMs: end,
      end: end,
      endSec: parseFloat((end / 1000).toFixed(3)),
      durationMs: vocalDur,
      duration: vocalDur,
      durationSec: parseFloat((vocalDur / 1000).toFixed(3)),
    };
  });
}

export function internalLinesToSonicLines(lines: LyricLine[]): SonicSyncedLine[] {
  const filtered = lines.filter((l) => !isMetadataLine(l.text));
  const targetLines = filtered.length > 0 ? filtered : lines;

  return targetLines.map((line, idx, arr) => {
    const rawStartMs = line.time;
    const rawDurationMs = line.duration || 3000;
    const nextLine = arr[idx + 1];
    const nextLineStartMs = nextLine ? nextLine.time : null;

    const rawWords: SonicWord[] =
      line.words && line.words.length > 0
        ? line.words.map((w) => {
            const wStart = typeof w.start === 'number' ? w.start : (typeof (w as any).startMs === 'number' ? (w as any).startMs : rawStartMs);
            const wDur = typeof w.duration === 'number' && w.duration > 0 ? w.duration : (typeof (w as any).durationMs === 'number' && (w as any).durationMs > 0 ? (w as any).durationMs : 300);
            const wEnd = typeof w.end === 'number' ? w.end : (typeof (w as any).endMs === 'number' ? (w as any).endMs : (wStart + wDur));
            return {
              text: w.text,
              startMs: wStart,
              durationMs: wDur,
              start: wStart,
              startSec: parseFloat((wStart / 1000).toFixed(3)),
              end: wEnd,
              endMs: wEnd,
              endSec: parseFloat((wEnd / 1000).toFixed(3)),
              duration: wDur,
              durationSec: parseFloat((wDur / 1000).toFixed(3)),
            };
          })
        : [{
            text: line.text,
            startMs: rawStartMs,
            durationMs: rawDurationMs,
            start: rawStartMs,
            startSec: parseFloat((rawStartMs / 1000).toFixed(3)),
            end: rawStartMs + rawDurationMs,
            endMs: rawStartMs + rawDurationMs,
            endSec: parseFloat(((rawStartMs + rawDurationMs) / 1000).toFixed(3)),
            duration: rawDurationMs,
            durationSec: parseFloat((rawDurationMs / 1000).toFixed(3)),
          }];

    // 严密隔离：彻底剔除字内吞入的间奏时间！
    const words = calibrateWordsInterludeIsolation(rawWords, nextLineStartMs);

    // 核心对齐原则：行起始时间严格与第一个发音字对齐，真实发音截止严格以最后一个字唱完为准
    const lineStartMs = words.length > 0 ? words[0].startMs : rawStartMs;
    const vocalEndMs = words.length > 0
      ? words[words.length - 1].endMs
      : (lineStartMs + rawDurationMs);
    const vocalDurationMs = Math.max(300, vocalEndMs - lineStartMs);

    return {
      text: line.text,
      startMs: lineStartMs,
      start: lineStartMs,
      startSec: parseFloat((lineStartMs / 1000).toFixed(3)),
      durationMs: vocalDurationMs,
      duration: vocalDurationMs,
      durationSec: parseFloat((vocalDurationMs / 1000).toFixed(3)),
      endMs: vocalEndMs,
      end: vocalEndMs,
      endSec: parseFloat((vocalEndMs / 1000).toFixed(3)),
      words,
    };
  });
}

export function extractPlainLyrics(lines: SonicSyncedLine[]): string {
  return lines.map((l) => l.text).join('\n');
}

export function computeQualityScore(level: SonicLyricLevel, lineCount: number, avgWordsPerLine: number): number {
  if (level === 'none') return 0;
  let score = 0;
  if (level === 'word') score += 60;
  else if (level === 'line') score += 30;
  // Line count bonus (more lines = more complete)
  score += Math.min(30, lineCount * 0.5);
  // Word density bonus
  if (level === 'word' && avgWordsPerLine > 2) score += 10;
  return Math.min(100, Math.round(score));
}

export function normalizeArtistString(artist: unknown): string {
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

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function isInstrumentalText(text: string): boolean {
  if (!text) return false;
  return /纯音乐|没有填词|请您?欣赏|instrumental|accompaniment|no lyrics/i.test(text);
}

export function sonicLinesToLrc(lines: SonicSyncedLine[], title?: string, artist?: string): string {
  const result: string[] = [];
  if (title) result.push(`[ti:${title}]`);
  if (artist) result.push(`[ar:${artist}]`);
  if (lines.length === 0) {
    result.push(`[00:00.00]纯音乐，请欣赏`);
    return result.join('\n');
  }

  for (const line of lines) {
    const totalSec = Math.max(0, line.startMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    const ms = Math.floor((line.startMs % 1000) / 10);
    const timeTag = `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}]`;
    result.push(`${timeTag}${line.text}`);
  }

  return result.join('\n');
}

export function sonicLinesToTtml(lines: SonicSyncedLine[], title?: string, artist?: string): string {
  const formatTime = (ms: number) => {
    const totalSec = Math.max(0, ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = (totalSec % 60).toFixed(3);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(6, '0')}`;
  };

  const bodyLines = lines.map((line) => {
    const begin = formatTime(line.startMs);
    const end = formatTime(line.startMs + (line.durationMs || 3000));
    if (line.words && line.words.length > 0) {
      const spans = line.words.map((w) => {
        const wBegin = formatTime(w.startMs);
        const wEnd = formatTime(w.startMs + (w.durationMs || 300));
        return `<span begin="${wBegin}" end="${wEnd}">${escapeXml(w.text)}</span>`;
      }).join('');
      return `      <p begin="${begin}" end="${end}">${spans}</p>`;
    }
    return `      <p begin="${begin}" end="${end}">${escapeXml(line.text)}</p>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
  <head>
    <metadata>
      <ttm:title>${escapeXml(title || '')}</ttm:title>
      <ttm:agent type="person">${escapeXml(artist || '')}</ttm:agent>
    </metadata>
  </head>
  <body>
    <div>
${bodyLines}
    </div>
  </body>
</tt>`;
}
