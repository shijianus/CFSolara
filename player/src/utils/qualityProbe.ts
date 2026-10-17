/**
 * 共享音质探测模块 (单一数据来源)
 * 提供全站统一的音频规格真实探测、内存缓存、并发控制与音质真伪判定
 */

export type QualityLevel = 'lossless' | 'exhigh' | 'standard'

export interface QualityChoiceMeta {
  level: QualityLevel
  label: string
}

export const QUALITY_LEVELS: { level: QualityLevel; label: string; nominalFormat: string; nominalBitrate: string }[] = [
  { level: 'lossless', label: 'SQ 无损', nominalFormat: 'FLAC', nominalBitrate: 'FLAC · 无损' },
  { level: 'exhigh', label: 'HQ 极高', nominalFormat: 'MP3', nominalBitrate: 'MP3 · 320 kbps' },
  { level: 'standard', label: '标准', nominalFormat: 'MP3', nominalBitrate: 'MP3 · 128 kbps' },
]

export interface ProbeQualityItem {
  level: QualityLevel
  label: string
  status: number | null
  contentType: string
  totalBytes: number | null
  actualBitrateKbps: number | null
  isAvailable: boolean
  unavailableReason?: string
  sizeFormatted: string
  formatLabel: string
  bitrateLabel: string
  isProbing: boolean
  isUnknown: boolean
}

export interface SongProbeResult {
  songId: string
  lossless: ProbeQualityItem
  exhigh: ProbeQualityItem
  standard: ProbeQualityItem
  probedAt: number
}

// 内存缓存: songId -> SongProbeResult
const probeCache = new Map<string, SongProbeResult>()

// 记录各歌曲进行中的 AbortController
const activeControllers = new Map<string, AbortController>()

// 并发限制器：最大并发 3
let activeRequestCount = 0
const waitQueue: (() => void)[] = []

async function acquireSlot(): Promise<() => void> {
  if (activeRequestCount < 3) {
    activeRequestCount++
    let released = false
    return () => {
      if (!released) {
        released = true
        activeRequestCount--
        const next = waitQueue.shift()
        if (next) next()
      }
    }
  }

  return new Promise((resolve) => {
    waitQueue.push(() => {
      activeRequestCount++
      let released = false
      resolve(() => {
        if (!released) {
          released = true
          activeRequestCount--
          const next = waitQueue.shift()
          if (next) next()
        }
      })
    })
  })
}

/** 格式化字节大小 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes <= 0 || isNaN(bytes)) {
    return '—'
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 检测 Content-Type 是否为真正无损格式 */
export function isLosslessContentType(contentType: string): boolean {
  const ct = (contentType || '').toLowerCase()
  return (
    ct.includes('flac') ||
    ct.includes('alac') ||
    ct.includes('wav') ||
    ct.includes('audio/x-flac') ||
    ct.includes('audio/x-wav')
  )
}

/** 提取格式大写标签 */
export function extractFormatLabel(contentType: string, fallbackLevel: QualityLevel): string {
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('flac')) return 'FLAC'
  if (ct.includes('wav')) return 'WAV'
  if (ct.includes('alac')) return 'ALAC'
  if (ct.includes('aac')) return 'AAC'
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'MP3'
  if (fallbackLevel === 'lossless') return 'FLAC'
  return 'MP3'
}

/** 构造与 download.ts 完全一致的请求 URL */
export function buildProbeUrl(song: any, level: QualityLevel): string {
  const brMap: Record<QualityLevel, string> = {
    lossless: 'lossless',
    exhigh: '320',
    standard: '128',
  }
  const br = brMap[level] || '320'

  const found = song.qualities?.find((q: any) => q.level === level)
  if (found && found.streamUrl) {
    return found.streamUrl
  }

  const songId = encodeURIComponent(String(song.id || ''))
  const title = encodeURIComponent(song.name || '')
  const artist = encodeURIComponent(song.artist || '')
  return `/api/music/stream?id=${songId}&source=netease&br=${br}&title=${title}&artist=${artist}`
}

/**
 * 中止指定歌曲正在进行的探测请求
 */
export function cancelSongProbe(songId: string | number): void {
  const idStr = String(songId)
  const ctrl = activeControllers.get(idStr)
  if (ctrl) {
    ctrl.abort()
    activeControllers.delete(idStr)
  }
}

/**
 * 获取指定歌曲的缓存探测结果（若有）
 */
export function getCachedProbeResult(songId: string | number): SongProbeResult | null {
  return probeCache.get(String(songId)) || null
}

/**
 * 探测单个档位
 */
async function probeTier(
  song: any,
  level: QualityLevel,
  parentSignal: AbortSignal,
  durationSec: number
): Promise<{
  level: QualityLevel
  status: number | null
  contentType: string
  totalBytes: number | null
  actualBitrateKbps: number | null
  timedOut: boolean
  error: any
}> {
  const release = await acquireSlot()
  const streamUrl = buildProbeUrl(song, level)

  // 8 秒超时控制与中止级联
  const timeoutCtrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    timeoutCtrl.abort()
  }, 8000)

  const onParentAbort = () => {
    timeoutCtrl.abort()
  }
  parentSignal.addEventListener('abort', onParentAbort, { once: true })

  try {
    const res = await fetch(streamUrl, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-0',
      },
      signal: timeoutCtrl.signal,
    })

    clearTimeout(timer)
    parentSignal.removeEventListener('abort', onParentAbort)

    const status = res.status
    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    let totalBytes: number | null = null

    const contentRange = res.headers.get('content-range')
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/)
      if (match) totalBytes = parseInt(match[1], 10)
    }
    if (!totalBytes) {
      const cl = res.headers.get('content-length')
      if (cl && (status === 200 || status === 206)) {
        totalBytes = parseInt(cl, 10)
      }
    }

    let actualBitrateKbps: number | null = null
    if (totalBytes && durationSec > 0) {
      actualBitrateKbps = Math.round((totalBytes * 8) / durationSec / 1000)
    }

    return {
      level,
      status,
      contentType,
      totalBytes,
      actualBitrateKbps,
      timedOut: false,
      error: null,
    }
  } catch (err: any) {
    clearTimeout(timer)
    parentSignal.removeEventListener('abort', onParentAbort)
    return {
      level,
      status: null,
      contentType: '',
      totalBytes: null,
      actualBitrateKbps: null,
      timedOut,
      error: err,
    }
  } finally {
    release()
  }
}

/**
 * 对指定歌曲进行全档位真实网络探测并依据规则裁定可用性
 */
export async function probeSongQualities(
  song: any,
  options: { forceRefresh?: boolean; signal?: AbortSignal } = {}
): Promise<SongProbeResult> {
  if (!song || !song.id) {
    throw new Error('无效的歌曲数据，缺少歌曲 id')
  }

  const songId = String(song.id)

  if (!options.forceRefresh && probeCache.has(songId)) {
    return probeCache.get(songId)!
  }

  // 中止此前的探测
  cancelSongProbe(songId)

  const parentCtrl = new AbortController()
  activeControllers.set(songId, parentCtrl)

  // 级联外部中止信号
  if (options.signal) {
    if (options.signal.aborted) {
      parentCtrl.abort()
    } else {
      options.signal.addEventListener('abort', () => parentCtrl.abort(), { once: true })
    }
  }

  const durationSec = song.duration
    ? song.duration > 1000
      ? song.duration / 1000
      : song.duration
    : 0

  try {
    // 3 个档位并发探测 (受并发限制器调控)
    const [sqRaw, hqRaw, stdRaw] = await Promise.all([
      probeTier(song, 'lossless', parentCtrl.signal, durationSec),
      probeTier(song, 'exhigh', parentCtrl.signal, durationSec),
      probeTier(song, 'standard', parentCtrl.signal, durationSec),
    ])

    // ══════ 裁定规则应用 ══════
    // 1. 标准档 (基础档)
    const stdOk = Boolean(
      stdRaw.status &&
      (stdRaw.status === 200 || stdRaw.status === 206) &&
      stdRaw.totalBytes &&
      stdRaw.totalBytes > 0
    )
    const stdFormat = extractFormatLabel(stdRaw.contentType, 'standard')
    const stdBitrateText = `${stdFormat} · ${stdRaw.actualBitrateKbps ? `${stdRaw.actualBitrateKbps} kbps` : '128 kbps'}`

    const standardItem: ProbeQualityItem = {
      level: 'standard',
      label: '标准',
      status: stdRaw.status,
      contentType: stdRaw.contentType,
      totalBytes: stdRaw.totalBytes,
      actualBitrateKbps: stdRaw.actualBitrateKbps,
      isAvailable: stdOk,
      unavailableReason: stdOk ? undefined : (stdRaw.timedOut ? '探测超时' : '大小未知'),
      sizeFormatted: formatBytes(stdRaw.totalBytes),
      formatLabel: stdFormat,
      bitrateLabel: stdBitrateText,
      isProbing: false,
      isUnknown: !stdOk,
    }

    // 2. HQ 极高档
    const hqStatusOk = Boolean(
      hqRaw.status &&
      (hqRaw.status === 200 || hqRaw.status === 206) &&
      hqRaw.totalBytes &&
      hqRaw.totalBytes > 0
    )
    let hqAvailable = hqStatusOk
    let hqReason: string | undefined = undefined

    if (!hqStatusOk) {
      hqAvailable = false
      hqReason = hqRaw.timedOut ? '探测超时' : '大小未知'
    } else if (stdOk && stdRaw.totalBytes && hqRaw.totalBytes) {
      // 规则: 任一档的总长度与更低一档相同或相差小于 2% → 该档不可用 ("音源未提供更高音质")
      const diffRatio = (hqRaw.totalBytes - stdRaw.totalBytes) / stdRaw.totalBytes
      if (diffRatio < 0.02) {
        hqAvailable = false
        hqReason = '音源未提供更高音质'
      }
    }

    const hqFormat = extractFormatLabel(hqRaw.contentType, 'exhigh')
    const hqBitrateText = `${hqFormat} · ${hqRaw.actualBitrateKbps ? `${hqRaw.actualBitrateKbps} kbps` : '320 kbps'}`

    const exhighItem: ProbeQualityItem = {
      level: 'exhigh',
      label: 'HQ 极高',
      status: hqRaw.status,
      contentType: hqRaw.contentType,
      totalBytes: hqRaw.totalBytes,
      actualBitrateKbps: hqRaw.actualBitrateKbps,
      isAvailable: hqAvailable,
      unavailableReason: hqReason,
      sizeFormatted: formatBytes(hqRaw.totalBytes),
      formatLabel: hqFormat,
      bitrateLabel: hqBitrateText,
      isProbing: false,
      isUnknown: !hqStatusOk,
    }

    // 3. SQ 无损档
    const sqStatusOk = Boolean(
      sqRaw.status &&
      (sqRaw.status === 200 || sqRaw.status === 206) &&
      sqRaw.totalBytes &&
      sqRaw.totalBytes > 0
    )
    let sqAvailable = sqStatusOk
    let sqReason: string | undefined = undefined

    if (!sqStatusOk) {
      sqAvailable = false
      sqReason = sqRaw.timedOut ? '探测超时' : '大小未知'
    } else {
      // 规则 1: 请求无损但返回的不是 FLAC/ALAC/WAV → 无损不可用 ("音源未提供无损音质")
      const isLossless = isLosslessContentType(sqRaw.contentType)
      if (!isLossless) {
        sqAvailable = false
        sqReason = '音源未提供无损音质'
      } else {
        // 规则 2: 任一档的总长度与更低一档相同或相差小于 2% → 该档不可用 ("音源未提供更高音质")
        const lowerBytes = (hqAvailable && hqRaw.totalBytes)
          ? hqRaw.totalBytes
          : (stdOk && stdRaw.totalBytes)
            ? stdRaw.totalBytes
            : null
        if (lowerBytes && (sqRaw.totalBytes! - lowerBytes) / lowerBytes < 0.02) {
          sqAvailable = false
          sqReason = '音源未提供更高音质'
        }
      }
    }

    const sqFormat = extractFormatLabel(sqRaw.contentType, 'lossless')
    const sqBitrateText = isLosslessContentType(sqRaw.contentType)
      ? `${sqFormat} · 无损`
      : `${sqFormat} · ${sqRaw.actualBitrateKbps ? `${sqRaw.actualBitrateKbps} kbps` : '128 kbps'}`

    const losslessItem: ProbeQualityItem = {
      level: 'lossless',
      label: 'SQ 无损',
      status: sqRaw.status,
      contentType: sqRaw.contentType,
      totalBytes: sqRaw.totalBytes,
      actualBitrateKbps: sqRaw.actualBitrateKbps,
      isAvailable: sqAvailable,
      unavailableReason: sqReason,
      sizeFormatted: formatBytes(sqRaw.totalBytes),
      formatLabel: sqFormat,
      bitrateLabel: sqBitrateText,
      isProbing: false,
      isUnknown: !sqStatusOk,
    }

    const result: SongProbeResult = {
      songId,
      lossless: losslessItem,
      exhigh: exhighItem,
      standard: standardItem,
      probedAt: Date.now(),
    }

    probeCache.set(songId, result)
    return result
  } finally {
    activeControllers.delete(songId)
  }
}
