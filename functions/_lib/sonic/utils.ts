// Sonic Gateway — Shared Utilities

import type { LyricLine } from '../types';
import type { SonicSyncedLine, SonicWord, SonicLyricLevel } from './types';

export function internalLinesToSonicLines(lines: LyricLine[]): SonicSyncedLine[] {
  return lines.map((line) => {
    const startMs = line.time;
    const durationMs = line.duration || 3000;
    const words: SonicWord[] =
      line.words && line.words.length > 0
        ? line.words.map((w) => {
            const wStart = typeof w.start === 'number' ? w.start : (typeof (w as any).startMs === 'number' ? (w as any).startMs : startMs);
            const wDur = typeof w.duration === 'number' && w.duration > 0 ? w.duration : (typeof (w as any).durationMs === 'number' && (w as any).durationMs > 0 ? (w as any).durationMs : 300);
            const wEnd = typeof w.end === 'number' ? w.end : (wStart + wDur);
            return {
              text: w.text,
              startMs: wStart,
              durationMs: wDur,
              start: wStart,
              startSec: parseFloat((wStart / 1000).toFixed(3)),
              end: wEnd,
              endSec: parseFloat((wEnd / 1000).toFixed(3)),
              duration: wDur,
              durationSec: parseFloat((wDur / 1000).toFixed(3)),
            };
          })
        : [{
            text: line.text,
            startMs,
            durationMs,
            start: startMs,
            startSec: parseFloat((startMs / 1000).toFixed(3)),
            end: startMs + durationMs,
            endSec: parseFloat(((startMs + durationMs) / 1000).toFixed(3)),
            duration: durationMs,
            durationSec: parseFloat((durationMs / 1000).toFixed(3)),
          }];
    return {
      text: line.text,
      startMs,
      durationMs,
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
