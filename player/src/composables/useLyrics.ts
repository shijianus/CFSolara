import { useAudioStore } from '@/stores/modules/audio'
import {
  type LyricWord,
  buildProcessedWords,
  isMetadataLine,
} from '@/utils/lyricsWordSync'

export type { LyricWord }

export interface LyricLine {
  time: number
  ori: string
  tran?: string
  roma?: string
  words?: LyricWord[]
}

export interface RawLyricLine {
  time: number
  startMs?: number
  text: string
  words?: LyricWord[]
}

const state = reactive({
  lyricsOriginal: [] as RawLyricLine[],
  lyricsTrans: [] as RawLyricLine[],
  lyricsRoma: [] as RawLyricLine[],
  showTrans: true,
  showRoma: false,
})
const lastCacheKey = ref<string | null>(null)
const loading = ref(false)
let currentFetchSeq = 0

const lyricCache = new Map<string, { ori: RawLyricLine[]; tran: RawLyricLine[]; roma: RawLyricLine[] }>()

/**
 * 统一将歌词行序列转为带逐字发音单元的高精结构
 */
export const processLinesToWords = (
  rawLines: Array<{ time?: number; startMs?: number; timeSec?: number; text?: string; words?: any[] }>,
  title?: string,
  artist?: string
): RawLyricLine[] => {
  if (!Array.isArray(rawLines)) return []
  const filtered = rawLines.filter(l => !isMetadataLine(l.text || '', title, artist))
  const targetLines = filtered.length > 0 ? filtered : rawLines

  return targetLines.map((line, idx, arr) => {
    const rawStartMs = Number.isFinite(line.startMs)
      ? line.startMs!
      : Number.isFinite(line.timeSec)
        ? Math.round(line.timeSec! * 1000)
        : Number.isFinite(line.time)
          ? (line.time! < 1000 ? Math.round(line.time! * 1000) : Math.round(line.time!))
          : 0

    const nextLine = arr[idx + 1]
    const nextStartMs = nextLine
      ? (Number.isFinite(nextLine.startMs)
        ? nextLine.startMs!
        : Number.isFinite(nextLine.timeSec)
          ? Math.round(nextLine.timeSec! * 1000)
          : Number.isFinite(nextLine.time)
            ? (nextLine.time! < 1000 ? Math.round(nextLine.time! * 1000) : Math.round(nextLine.time!))
            : null)
      : null

    const durMs = (Number.isFinite((line as any).durationMs) && (line as any).durationMs > 0)
      ? (line as any).durationMs
      : (Number.isFinite((line as any).duration) && (line as any).duration > 0)
        ? (line as any).duration
        : nextStartMs
          ? Math.max(500, nextStartMs - rawStartMs)
          : 3500

    const words = buildProcessedWords(line.words, line.text || '', rawStartMs, nextStartMs, durMs)
    const lineStartMs = words.length > 0 ? words[0].startMs : rawStartMs
    const lineStartSec = parseFloat((lineStartMs / 1000).toFixed(3))

    return {
      time: lineStartSec,
      startMs: lineStartMs,
      text: String(line.text || '').trim(),
      words,
    }
  }).filter(l => Boolean(l.text)).sort((a, b) => a.time - b.time)
}

/**
 * 通用多协议歌词解析器：兼容标准 LRC、增强型逐字 LRC (ELRC)、QQ QRC 与网易云 YRC JSON
 */
export const parseAnyLrc = (raw: string): RawLyricLine[] => {
  if (!raw || typeof raw !== 'string') return []
  const trimmed = raw.trim()
  if (!trimmed) return []

  // 1. 纯音乐判断
  if (/^\[00:00(?:\.00+)?\]\s*(纯音乐，请欣赏|纯音乐|暂无填词)/i.test(trimmed)) {
    return [{ time: 0, startMs: 0, text: '纯音乐，请欣赏' }]
  }

  // 2. 网易云 YRC 逐字 JSON 格式解析 {"t":28950,"c":[{"tx":"故"},{"tx":"事"}]}
  if (trimmed.includes('{"t":') && trimmed.includes('"c":')) {
    const lines = trimmed.split(/\r?\n/)
    const result: RawLyricLine[] = []
    for (const line of lines) {
      const lineTrim = line.trim()
      if (!lineTrim.startsWith('{')) continue
      try {
        const obj = JSON.parse(lineTrim)
        if (typeof obj.t === 'number' && Array.isArray(obj.c)) {
          const text = obj.c.map((w: any) => w.tx || '').join('').trim()
          if (text) {
            result.push({
              time: parseFloat((obj.t / 1000).toFixed(3)),
              startMs: obj.t,
              text,
            })
          }
        }
      } catch {}
    }
    if (result.length > 0) return result.sort((a, b) => a.time - b.time)
  }

  // 3. QQ 音乐 QRC 格式解析 [28950,3121]<0,440,0>故<440,440,0>事...
  if (/^\[\d+,\d+\]/m.test(trimmed)) {
    const lines = trimmed.split(/\r?\n/)
    const result: RawLyricLine[] = []
    for (const line of lines) {
      const m = line.trim().match(/^\[(\d+),(\d+)\](.*)/)
      if (m) {
        const text = m[3].replace(/<[^>]+>/g, '').trim()
        if (text) {
          const startMs = Number(m[1])
          result.push({
            time: parseFloat((startMs / 1000).toFixed(3)),
            startMs,
            text,
          })
        }
      }
    }
    if (result.length > 0) return result.sort((a, b) => a.time - b.time)
  }

  // 4. 标准 LRC 与带内嵌字级时间戳的 Enhanced LRC ([mm:ss.xx]<mm:ss.xx>...)
  const lines = trimmed.split(/\r?\n/)
  const result: RawLyricLine[] = []
  const timeTag = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g
  const metaFilter = /^\[(ti|ar|al|by|offset|kana|re|ve|hash|sign|qq|total|language|id):/i

  // 提取全局 offset 偏移量（毫秒）
  const offsetMatch = trimmed.match(/^\[offset:\s*(-?\d+)\s*\]/im)
  const lrcOffsetMs = offsetMatch ? parseInt(offsetMatch[1], 10) : 0
  const lrcOffsetSec = lrcOffsetMs / 1000

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || metaFilter.test(line)) continue

    // 剔除增强逐字标记如 <00:12.345>
    const cleanLine = line.replace(/<[^>]+>/g, '')
    const text = cleanLine.replace(timeTag, '').trim()
    if (!text) continue

    timeTag.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = timeTag.exec(cleanLine))) {
      const m = Number(match[1])
      const s = Number(match[2])
      const msStr = match[3] || '0'
      const ms = Number(msStr.padEnd(3, '0').slice(0, 3))
      const time = Math.max(0, m * 60 + s + ms / 1000 + lrcOffsetSec)
      const startMs = Math.max(0, m * 60000 + s * 1000 + ms + lrcOffsetMs)
      result.push({
        time: parseFloat(time.toFixed(3)),
        startMs,
        text,
      })
    }
  }

  return result.sort((a, b) => a.time - b.time)
}

const parseLrc = parseAnyLrc

interface LyricMerged {
  time: number
  ori: string
  tran?: string
  roma?: string
}
const mergedLines = computed<LyricMerged[]>(() => {
  const ori = state.lyricsOriginal
  const tran = state.lyricsTrans
  const roma = state.lyricsRoma
  const res: LyricMerged[] = []
  let j = 0, k = 0
  const eps = 0.5

  for (let i = 0; i < ori.length; i++) {
    const o = ori[i]
    while (j + 1 < tran.length && tran[j + 1].time <= o.time + eps) j++
    while (k + 1 < roma.length && roma[k + 1].time <= o.time + eps) k++

    const tCandidate = tran[j] && Math.abs(tran[j].time - o.time) <= eps ? tran[j].text : undefined
    const rCandidate = roma[k] && Math.abs(roma[k].time - o.time) <= eps ? roma[k].text : undefined

    res.push({
      time: o.time,
      ori: o.text,
      tran: tCandidate,
      roma: rCandidate,
      words: o.words,
    })
  }
  return res
})

const activeSingleLyrics = computed<LyricLine[]>(() => {
  return mergedLines.value.map(m => ({
    time: m.time,
    ori: m.ori,
    tran: m.tran,
    roma: m.roma,
    words: m.words,
  }))
})

const activeTimeline = computed<number[]>(() => mergedLines.value.map(m => m.time))
const timeForIndex = (index: number) => mergedLines.value[index]?.time ?? 0

const fetchLyrics = async (idOrSong?: string | number | any, force = false, songOverride?: any) => {
  try {
    let targetSong: any = null
    if (typeof idOrSong === 'object' && idOrSong !== null) {
      targetSong = idOrSong
    } else {
      try {
        const audioStore = useAudioStore()
        const cur = audioStore.getCurrentSong
        if (cur && (!idOrSong || String(cur.id) === String(idOrSong))) {
          targetSong = cur
        }
      } catch {}
    }
    if (songOverride) {
      targetSong = { ...(targetSong || {}), ...songOverride }
    }

    const rawId = targetSong?.id ?? idOrSong
    if (!rawId) {
      state.lyricsOriginal = []
      state.lyricsTrans = []
      state.lyricsRoma = []
      lastCacheKey.value = null
      return
    }

    const title = String(targetSong?.name || targetSong?.title || '').trim()
    let artist = ''
    if (Array.isArray(targetSong?.artists)) {
      artist = targetSong.artists
        .map((a: any) => (typeof a === 'object' && a ? a.name || '' : String(a)))
        .filter(Boolean)
        .join(' / ')
    } else if (typeof targetSong?.artist === 'string') {
      artist = targetSong.artist.trim()
    } else if (Array.isArray(targetSong?.ar)) {
      artist = targetSong.ar.map((a: any) => a?.name || '').filter(Boolean).join(' / ')
    }

    const album = String(targetSong?.album?.name || targetSong?.album || targetSong?.al?.name || '').trim()
    const duration = targetSong?.duration || targetSong?.dt || 0
    const source = String(targetSong?.source || targetSong?.platform || 'netease').toLowerCase()
    const cleanId = String(rawId).replace(/^[a-z0-9_-]+:/i, '')

    const cacheKey = `${cleanId}_${title}_${artist}`
    if (!force && lastCacheKey.value === cacheKey) return
    if (!force && lyricCache.has(cacheKey)) {
      const cached = lyricCache.get(cacheKey)!
      state.lyricsOriginal = cached.ori
      state.lyricsTrans = cached.tran
      state.lyricsRoma = cached.roma
      lastCacheKey.value = cacheKey
      return
    }

    const thisSeq = ++currentFetchSeq
    loading.value = true

    let ori: RawLyricLine[] = []
    let tran: RawLyricLine[] = []
    let roma: RawLyricLine[] = []

    // ═══════ ① 优先调用 Sonic Lyrics Gateway 聚合端点 (/api/sonic/lyrics/nexus) ═══════
    try {
      const nexusParams = new URLSearchParams()
      if (title) nexusParams.set('title', title)
      if (artist) nexusParams.set('artist', artist)
      if (album) nexusParams.set('album', album)
      if (duration) nexusParams.set('duration', String(duration))

      if (cleanId) {
        nexusParams.set('platform', source)
        nexusParams.set('platformId', cleanId)
        if (source === 'netease' || source === 'ncm' || /^\d+$/.test(cleanId)) {
          nexusParams.set('ncmMusicId', cleanId)
        } else if (source === 'qq' || source === 'tencent' || /^00[a-zA-Z0-9]{12}$/.test(cleanId)) {
          nexusParams.set('qqMusicId', cleanId)
        }
      }

      if (Array.isArray(targetSong?.sources)) {
        for (const s of targetSong.sources) {
          const sId = String(s.platformId || s.id || '').replace(/^[a-z0-9_-]+:/i, '')
          if ((s.platform === 'netease' || s.platform === 'ncm') && !nexusParams.has('ncmMusicId') && sId) {
            nexusParams.set('ncmMusicId', sId)
          }
          if ((s.platform === 'qq' || s.platform === 'tencent') && !nexusParams.has('qqMusicId') && sId) {
            nexusParams.set('qqMusicId', sId)
          }
        }
      }
      nexusParams.set('prefer', 'word')

      const nexusRes = await fetch(`/api/sonic/lyrics/nexus?${nexusParams.toString()}`).then(r => r.json()) as any
      if (nexusRes?.brand === 'Sonic' && nexusRes?.data) {
        const d = nexusRes.data
        if (d.instrumental) {
          ori = [{ time: 0, text: '纯音乐，请欣赏' }]
        } else if (Array.isArray(d.syncedLyrics) && d.syncedLyrics.length > 0) {
          ori = processLinesToWords(d.syncedLyrics, title, artist)

          if (d.translation || d.tlyric) {
            tran = parseAnyLrc(d.translation || d.tlyric)
          }
          if (d.roma || d.romalrc) {
            roma = parseAnyLrc(d.roma || d.romalrc)
          }
        } else if (d.plainLyrics || d.lrc) {
          ori = processLinesToWords(parseAnyLrc(d.plainLyrics || d.lrc), title, artist)
        }
      }
    } catch {}

    // ═══════ ② 次选 /api/music/lyric 多源通用引擎保障 ═══════
    if (ori.length === 0) {
      try {
        const musicParams = new URLSearchParams()
        if (cleanId) musicParams.set('id', cleanId)
        if (source) musicParams.set('source', source)
        if (title) musicParams.set('title', title)
        if (artist) musicParams.set('artist', artist)
        if (album) musicParams.set('album', album)
        if (duration) musicParams.set('duration', String(duration))

        const musicRes = await fetch(`/api/music/lyric?${musicParams.toString()}`).then(r => r.json()) as any
        if (musicRes?.isPureMusic) {
          ori = [{ time: 0, text: '纯音乐，请欣赏' }]
        } else if (Array.isArray(musicRes?.lines) && musicRes.lines.length > 0) {
          ori = processLinesToWords(musicRes.lines, title, artist)

          if (musicRes?.tlyric?.lyric || musicRes?.tlyric) {
            tran = parseAnyLrc(musicRes.tlyric?.lyric || musicRes.tlyric)
          }
          if (musicRes?.romalrc?.lyric || musicRes?.romalrc) {
            roma = parseAnyLrc(musicRes.romalrc?.lyric || musicRes.romalrc)
          }
        } else if (musicRes?.lrc?.lyric || musicRes?.lyric || musicRes?.rawLyric || musicRes?.elrc) {
          const parsed = parseAnyLrc(musicRes.lrc?.lyric || musicRes.lyric || musicRes.rawLyric || musicRes.elrc)
          ori = processLinesToWords(parsed, title, artist)
          if (musicRes?.tlyric?.lyric || musicRes?.tlyric) {
            tran = parseAnyLrc(musicRes.tlyric?.lyric || musicRes.tlyric)
          }
        }
      } catch {}
    }

    // ═══════ ③ 经典 /api/lyric 保底查询 ═══════
    if (ori.length === 0 && cleanId) {
      try {
        const classicRes = await fetch(`/api/lyric?id=${encodeURIComponent(cleanId)}`).then(r => r.json()) as any
        const raw = classicRes?.lrc?.lyric || classicRes?.lyric || classicRes?.rawLyric || ''
        if (raw) {
          ori = processLinesToWords(parseAnyLrc(raw), title, artist)
        }
        const rawTrans = classicRes?.tlyric?.lyric || classicRes?.tlyric || ''
        if (rawTrans) {
          tran = parseAnyLrc(rawTrans)
        }
      } catch {}
    }

    if (thisSeq !== currentFetchSeq) return

    state.lyricsOriginal = ori.length > 0 ? ori : [{ time: 0, text: '暂无歌词' }]
    state.lyricsTrans = tran
    state.lyricsRoma = roma
    lastCacheKey.value = cacheKey

    lyricCache.set(cacheKey, {
      ori: state.lyricsOriginal,
      tran: state.lyricsTrans,
      roma: state.lyricsRoma,
    })
  } catch {
    if (thisSeq !== currentFetchSeq) return
    state.lyricsOriginal = [{ time: 0, text: '歌词获取失败' }]
    state.lyricsTrans = []
    state.lyricsRoma = []
  } finally {
    if (thisSeq === currentFetchSeq) {
      loading.value = false
    }
  }
}

export const useLyrics = () => {
  return {
    ...toRefs(state),
    mergedLines,
    activeSingleLyrics,
    activeTimeline,
    timeForIndex,
    fetchLyrics,
    loading,
  }
}
