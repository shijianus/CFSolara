/**
 * Sonic Karaoke Syllable-Level Alignment & Highlight Engine
 * 继承原本的毫秒级语言感知分词、声学权重分配、间奏隔离保护与 60fps 显式切片逐字追随算法
 */

export interface LyricWord {
  text: string
  start: number
  startMs: number
  startSec: number
  end: number
  endMs: number
  endSec: number
  duration: number
  durationMs: number
  durationSec: number
}

/**
 * 语言感知分词与声学权重分配（当上游无原生逐字时使用）
 */
export function interpolateWordTimestamps(
  lineText: string,
  lineStartMs: number,
  lineDurationMs?: number
): LyricWord[] {
  const clean = lineText.replace(/\[[^\]]+\]/g, '').replace(/<[^>]+>/g, '').trim()
  if (!clean) return []

  const isJapanese = /[\u3040-\u30ff]/.test(clean)

  // 1. 智能语言感知分词流 (Language-Aware Syllable/Token Stream)
  const tokenRegex = isJapanese
    ? /([\u3040-\u30ff][ぁぃぅぇぉゃゅょゎァィゥェォャュョヮー〜~]?|[\u4e00-\u9fa5]|[\uac00-\ud7af]|[a-zA-Z0-9'’]+|[^\s\w\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]+|\s+)/gu
    : /([\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]|[a-zA-Z0-9'’]+|[^\s\w\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]+|\s+)/gu

  const rawSegments: string[] = []
  let match: RegExpExecArray | null
  while ((match = tokenRegex.exec(clean)) !== null) {
    if (match[1]) rawSegments.push(match[1])
  }
  if (rawSegments.length === 0) rawSegments.push(clean)

  // 2. 标点符号与空白智能吸附绑定
  const mergedTokens: string[] = []
  let pendingLeadingPunct = ''

  for (const seg of rawSegments) {
    const isPunctOrSpace = /^[\s\p{P}\p{S}]+$/u.test(seg)
    if (isPunctOrSpace) {
      if (mergedTokens.length === 0) {
        pendingLeadingPunct += seg
      } else {
        mergedTokens[mergedTokens.length - 1] += seg
      }
    } else {
      if (pendingLeadingPunct) {
        mergedTokens.push(pendingLeadingPunct + seg)
        pendingLeadingPunct = ''
      } else {
        mergedTokens.push(seg)
      }
    }
  }

  if (mergedTokens.length === 0 && pendingLeadingPunct) {
    mergedTokens.push(pendingLeadingPunct)
  }

  const tokensList = mergedTokens.length > 0 ? mergedTokens : rawSegments

  // 3. 计算各发音单元的语言学生理学权重
  const tokenWeights = tokensList.map((tok, idx) => {
    const core = tok.replace(/[\s\p{P}\p{S}]/gu, '')
    if (!core) return 0.2

    const isLast = idx === tokensList.length - 1
    const cadenceMultiplier = isLast ? 1.5 : 1.0

    if (isJapanese) {
      if (/[\u4e00-\u9fa5]/.test(core)) return 1.95 * cadenceMultiplier
      if (/[っッ]/.test(core)) return 0.75 * cadenceMultiplier
      if (/[ー〜~ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]/.test(core)) return 1.35 * cadenceMultiplier
      return 1.0 * cadenceMultiplier
    }

    if (/[\u4e00-\u9fa5]/.test(core)) {
      return 1.0 * (isLast ? 1.45 : 1.0)
    }

    if (/[\uac00-\ud7af]/.test(core)) {
      return 1.0 * (isLast ? 1.4 : 1.0)
    }

    const coreLen = core.length
    return Math.max(1.0, coreLen * 0.45) * (isLast ? 1.35 : 1.0)
  })

  const totalWeight = Math.max(0.1, tokenWeights.reduce((a, b) => a + b, 0))

  // 4. 科学合理的整行声乐发音时长分配
  let vocalDurationMs: number
  if (lineDurationMs && lineDurationMs > 0) {
    const breathPauseMs = Math.min(450, Math.max(120, Math.round(lineDurationMs * 0.09)))
    const usableLineMs = Math.max(400, lineDurationMs - breathPauseMs)

    if (lineDurationMs > 7000 && usableLineMs / totalWeight > 850) {
      const interludeVocal = Math.round(totalWeight * 650)
      vocalDurationMs = Math.min(usableLineMs, Math.max(3500, interludeVocal))
    } else {
      vocalDurationMs = usableLineMs
    }
  } else {
    vocalDurationMs = Math.max(1500, Math.round(totalWeight * 450))
  }

  let currentStart = lineStartMs
  const tokens: LyricWord[] = []

  for (let i = 0; i < tokensList.length; i++) {
    const tok = tokensList[i]
    const weight = tokenWeights[i]
    const tokDur =
      i === tokensList.length - 1
        ? Math.max(60, Math.round(lineStartMs + vocalDurationMs - currentStart))
        : Math.max(60, Math.round((weight / totalWeight) * vocalDurationMs))
    const tokEnd = currentStart + tokDur

    tokens.push({
      text: tok,
      start: currentStart,
      startMs: currentStart,
      startSec: parseFloat((currentStart / 1000).toFixed(3)),
      end: tokEnd,
      endMs: tokEnd,
      endSec: parseFloat((tokEnd / 1000).toFixed(3)),
      duration: tokDur,
      durationMs: tokDur,
      durationSec: parseFloat((tokDur / 1000).toFixed(3)),
    })
    currentStart = tokEnd
  }
  return tokens
}

/**
 * 规整单字对象
 */
export function normalizeLyricWord(w: any, lineStartMs: number, fallbackDurMs = 300): LyricWord | null {
  if (!w) return null
  let startMs = Number.isFinite(w.startMs)
    ? w.startMs
    : Number.isFinite(w.start)
      ? w.start
      : Number.isFinite(w.startSec)
        ? Math.round(w.startSec * 1000)
        : lineStartMs

  let durMs =
    Number.isFinite(w.durationMs) && w.durationMs > 0
      ? w.durationMs
      : Number.isFinite(w.duration) && w.duration > 0
        ? w.duration
        : Number.isFinite(w.durationSec) && w.durationSec > 0
          ? Math.round(w.durationSec * 1000)
          : Number.isFinite(w.endMs) && w.endMs > startMs
            ? w.endMs - startMs
            : Number.isFinite(w.end) && w.end > startMs
              ? w.end - startMs
              : Number.isFinite(w.endSec) && w.endSec * 1000 > startMs
                ? Math.round(w.endSec * 1000 - startMs)
                : fallbackDurMs

  if (!Number.isFinite(startMs)) startMs = lineStartMs || 0
  if (!Number.isFinite(durMs) || durMs <= 0) durMs = 300

  const endMs = startMs + durMs
  const startSec = parseFloat((startMs / 1000).toFixed(3))
  const endSec = parseFloat((endMs / 1000).toFixed(3))
  const durationSec = parseFloat((durMs / 1000).toFixed(3))

  return {
    text: String(w.text || ''),
    startMs,
    start: startMs,
    startSec,
    durationMs: durMs,
    duration: durMs,
    durationSec,
    endMs,
    end: endMs,
    endSec,
  }
}

/**
 * 严密隔离纯音乐间奏时间，确保每个字的高亮时间代表真实声乐发音
 */
export function calibrateWordsInterludeIsolation(
  words: LyricWord[],
  nextLineStartMs: number | null
): LyricWord[] {
  if (!words || words.length === 0) return []

  return words.map((w, i) => {
    const start = Number.isFinite(w.startMs) ? w.startMs : 0
    const rawDur = Number.isFinite(w.durationMs) && w.durationMs > 0 ? w.durationMs : 300
    const text = String(w.text || '')

    const isLastWord = i === words.length - 1
    let maxAllowedDur = rawDur

    if (!isLastWord) {
      const nextW = words[i + 1]
      const nextStart = Number.isFinite(nextW.startMs) ? nextW.startMs : start + rawDur
      const gapToNext = Math.max(60, nextStart - start)
      maxAllowedDur = Math.min(rawDur, gapToNext)
    } else {
      if (Number.isFinite(nextLineStartMs) && nextLineStartMs !== null && nextLineStartMs > start) {
        const gapToNextLine = Math.max(100, nextLineStartMs - start - 50)
        if (gapToNextLine > 4000 && rawDur > 4000) {
          maxAllowedDur = 3200
        } else {
          maxAllowedDur = Math.min(rawDur, gapToNextLine)
        }
      }
    }

    const vocalDur = Math.max(60, maxAllowedDur)
    const end = start + vocalDur

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
    }
  })
}

/**
 * 处理一行的单字流，保证西文单词间空格不粘连
 */
export function buildProcessedWords(
  rawWords: any[] | undefined,
  lineText: string,
  lineStartMs: number,
  nextLineStartMs: number | null,
  lineDurationMs: number
): LyricWord[] {
  let words: LyricWord[]
  if (Array.isArray(rawWords) && rawWords.length > 0) {
    const normalized = rawWords
      .map((w, idx) => normalizeLyricWord(w, lineStartMs + idx * 250, 300))
      .filter(Boolean) as LyricWord[]
    words = calibrateWordsInterludeIsolation(normalized, nextLineStartMs)
  } else {
    const interpolated = interpolateWordTimestamps(lineText, lineStartMs, lineDurationMs)
    words = calibrateWordsInterludeIsolation(interpolated, nextLineStartMs)
  }

  // 格式化英文单词间的空格吸附
  for (let i = 0; i < words.length - 1; i++) {
    const cur = words[i]
    const next = words[i + 1]
    if (
      /[a-zA-Z0-9]$/.test(cur.text) &&
      /^[a-zA-Z0-9]/.test(next.text) &&
      !cur.text.endsWith(' ')
    ) {
      cur.text += ' '
    }
  }

  return words
}

/**
 * 识别并过滤元数据信息行
 */
export function isMetadataLine(text?: string, title?: string, artist?: string): boolean {
  if (!text) return true
  const trimmed = String(text).trim()
  if (
    /^(作词|作詞|作曲|编曲|編曲|歌|唄|演奏|プロデュース|レコーディング|ミキシング|マスタリング|词|曲|制作|制作人|监制|总监制|录音|录音师|录音室|混音|混音师|混音室|母带|母带后期|母带工程|吉他|贝斯|鼓|和声|合声|和声编写|合声编写|和声配唱|弦乐|弦乐编写|键盘|钢琴|小提琴|中提琴|大提琴|小提琴独奏|大提琴独奏|萨克斯|长笛|笛子|二胡|古筝|琵琶|打击乐|管乐|铜管|企划|统筹|OP|SP|演唱|原唱|歌手|专辑|发行|发行人|出品|出品人|出品公司|发行公司|版权|版权所有|特别支持|特别鸣谢|鸣谢|鸣谢单位|致谢|文案|插画|封面|总策划|音乐总监|人声编辑|音频编辑|录音工程|录音助理|混音助理|项目经理|营销|宣发|商务|Written|Composed|Arranged|Arrangement|Produced|Production|Lyrics|Music|Vocal|Singer|Mixed|Mixing|Mastered|Mastering|Recorded|Recording|Sound Engineer|Executive Producer|Music Director|Special Thanks|Presented by|Published by|Strings|Strings Arrange|Guitar|Bass|Drums|Keyboard|Piano|Synthesizer|Programming)[\u4e00-\u9fa5\u3040-\u30ffa-zA-Z0-9\s.·()（）]*[:：\/—–-]/i.test(
      trimmed
    )
  ) {
    return true
  }
  if (/^[^-–—]+[-–—][^-–—]+$/.test(trimmed) && trimmed.length < 60 && /(唱|曲|词|编|混|录|室)/.test(trimmed)) {
    return true
  }
  if (/^([^-–—]+)[-–—]([^-–—]+)$/.test(trimmed)) {
    const parts = trimmed.split(/[-–—]/).map(p => p.trim().toLowerCase())
    const rawTitle = title || ''
    const rawArtist = artist || ''
    const cleanTitle = String(rawTitle).toLowerCase().replace(/\([^)]+\)/g, '').trim()
    const cleanArtist = String(rawArtist).toLowerCase().replace(/\([^)]+\)/g, '').trim()
    if (
      (cleanTitle && (parts[0].includes(cleanTitle) || parts[1].includes(cleanTitle))) ||
      (cleanArtist && (parts[0].includes(cleanArtist) || parts[1].includes(cleanArtist)))
    ) {
      return true
    }
  }
  const rawTitleOnly = title || ''
  const cleanTitleOnly = String(rawTitleOnly).toLowerCase().replace(/\([^)]+\)/g, '').trim()
  if (cleanTitleOnly && cleanTitleOnly.length >= 2 && trimmed.toLowerCase().replace(/\([^)]+\)/g, '').trim() === cleanTitleOnly) {
    return true
  }
  return false
}

/**
 * 60fps 毫秒级显式切片逐字高亮追随驱动器 (Strict Explicit-Segment Highlight Follower)
 * 在动画帧中直接精准操作当前行 DOM 的 --fill 渐变和状态类名
 */
export function syncWordElements(
  container: HTMLElement | null,
  lyricsData: Array<{ time?: number; words?: LyricWord[] }>,
  currentTime: number,
  currentIndex?: number,
  lastLineIndexRef?: { value: number }
) {
  if (!container || !Array.isArray(lyricsData) || lyricsData.length === 0) return

  const lineEls = container.querySelectorAll('.lyric-line')
  if (!lineEls.length) return

  // 1. 根据当前播放时间精确定位活动行（完全还原 js/index.js 算法）
  let targetIndex = -1
  for (let i = 0; i < lyricsData.length; i++) {
    if (currentTime >= (lyricsData[i].time || 0)) {
      targetIndex = i
    } else {
      break
    }
  }

  const activeIndex = targetIndex !== -1 ? targetIndex : (typeof currentIndex === 'number' ? currentIndex : -1)
  const lastIndex = lastLineIndexRef ? lastLineIndexRef.value : -2
  const lineChanged = lastIndex !== activeIndex

  if (lineChanged) {
    if (lastLineIndexRef) lastLineIndexRef.value = activeIndex

    if (activeIndex === -1) {
      lineEls.forEach(element => {
        element.classList.remove('current')
        element.querySelectorAll('.word-char').forEach(c => {
          const el = c as HTMLElement
          el.style.setProperty('--fill', '0%')
          el.style.backgroundImage = ''
          el.classList.remove('word-sung', 'word-singing')
        })
      })
      return
    }

    lineEls.forEach((element, index) => {
      element.classList.toggle('current', index === activeIndex)
      if (index < activeIndex) {
        // 过去行：100% 已唱过
        element.querySelectorAll('.word-char').forEach(c => {
          const el = c as HTMLElement
          el.style.setProperty('--fill', '100%')
          el.style.backgroundImage = ''
          el.classList.add('word-sung')
          el.classList.remove('word-singing')
        })
      } else if (index > activeIndex) {
        // 未来行：0% 还没唱到
        element.querySelectorAll('.word-char').forEach(c => {
          const el = c as HTMLElement
          el.style.setProperty('--fill', '0%')
          el.style.backgroundImage = ''
          el.classList.remove('word-sung', 'word-singing')
        })
      }
    })
  }

  // 2. 当前活动行：毫秒级切片渐变追随
  if (activeIndex >= 0 && activeIndex < lyricsData.length) {
    const curLine = lyricsData[activeIndex]
    const currentLineEl = (container.querySelector(`.lyric-line[data-index="${activeIndex}"]`) || lineEls[activeIndex]) as HTMLElement
    if (currentLineEl && curLine?.words && curLine.words.length > 0) {
      const charSpans = currentLineEl.querySelectorAll('.word-char')
      for (let wIdx = 0; wIdx < curLine.words.length; wIdx++) {
        const charSpan = charSpans[wIdx] as HTMLElement
        if (!charSpan) continue
        const w = curLine.words[wIdx]
        const start = Number.isFinite(w.startSec) ? w.startSec : (w.startMs || 0) / 1000
        const end = Number.isFinite(w.endSec) ? w.endSec : (w.endMs || (start * 1000 + 300)) / 1000

        if (currentTime < start) {
          // 状态 ①：还没唱到
          charSpan.style.setProperty('--fill', '0%')
          charSpan.style.backgroundImage = ''
          charSpan.classList.remove('word-sung', 'word-singing')
        } else if (currentTime < end) {
          // 状态 ②：正在唱到这里（显式平滑渐变填充）
          const dur = Math.max(0.04, end - start)
          const pct = Math.min(100, Math.max(0, ((currentTime - start) / dur) * 100))
          const pctStr = `${pct.toFixed(1)}%`
          charSpan.style.setProperty('--fill', pctStr)
          charSpan.style.backgroundImage = `linear-gradient(to right, var(--lyric-word-active, #ffffff) 0%, var(--lyric-word-active, #ffffff) ${pctStr}, var(--lyric-word-inactive, rgba(255, 255, 255, 0.38)) ${pctStr}, var(--lyric-word-inactive, rgba(255, 255, 255, 0.38)) 100%)`
          charSpan.classList.add('word-singing')
          charSpan.classList.remove('word-sung')
        } else {
          // 状态 ③：已经唱过
          charSpan.style.setProperty('--fill', '100%')
          charSpan.style.backgroundImage = ''
          charSpan.classList.add('word-sung')
          charSpan.classList.remove('word-singing')
        }
      }
    }
  }
}
