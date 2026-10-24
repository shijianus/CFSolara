/**
 * 音频 Blob 二进制元数据解析工具
 * 直接读取 Blob 头部 ArrayBuffer，解析真实音频封装格式与码率
 * 杜绝落库字段伪造，不依赖 Node.js Buffer
 */

export type ResolvedBlobTier = 'lossless' | 'exhigh' | 'standard'

export interface ParsedAudioMeta {
  container?: string
  codec?: string
  bitrate?: number
  sampleRate?: number
  bitsPerSample?: number
  isLossless: boolean
  resolvedTier: ResolvedBlobTier
  displayTag: string
  detailText: string
  mismatchWarning: string | null
}

/**
 * 浏览器环境通过 HTMLAudioElement 的 loadedmetadata 取得真实播放时长
 */
async function getBlobAudioDuration(blob: Blob): Promise<number | null> {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null
  try {
    const url = URL.createObjectURL(blob)
    const audio = new Audio()
    const dur = await new Promise<number>((resolve, reject) => {
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => resolve(audio.duration)
      audio.onerror = () => reject(new Error('Audio load failed'))
      audio.src = url
    })
    URL.revokeObjectURL(url)
    return dur && Number.isFinite(dur) && dur > 0 ? dur : null
  } catch {
    return null
  }
}

export async function parseAudioBlob(blob: Blob, durationSeconds?: number, reqQualityLevel?: string): Promise<ParsedAudioMeta> {
  // 1. 先读前 64 字节以识别容器与头部特征
  const initSlice = await blob.slice(0, 64).arrayBuffer()
  const initBytes = new Uint8Array(initSlice)

  let container = 'UNKNOWN'
  let codec = 'UNKNOWN'
  let isLossless = false
  let bitrateKbps: number | null = null
  let sampleRate: number | null = null
  let bitsPerSample: number | null = null
  let isVbr = false
  let xingFrames: number | null = null
  let xingBytes: number | null = null

  // 1. FLAC: 0x66 0x4C 0x61 0x43 ("fLaC")
  if (initBytes.length >= 4 && initBytes[0] === 0x66 && initBytes[1] === 0x4C && initBytes[2] === 0x61 && initBytes[3] === 0x43) {
    container = 'FLAC'
    codec = 'FLAC'
    isLossless = true
    const flacSlice = await blob.slice(0, 128).arrayBuffer()
    const bytes = new Uint8Array(flacSlice)
    if (bytes.length >= 22) {
      // STREAMINFO block is at bytes 4..38
      sampleRate = ((bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4)) >>> 0
      bitsPerSample = (((bytes[20] & 0x01) << 4) | (bytes[21] >> 4)) + 1
      if (sampleRate === 0) sampleRate = 44100
    }
  }
  // 2. WAV: 0x52 0x49 0x46 0x46 ("RIFF") ... "WAVE"
  else if (
    initBytes.length >= 12 &&
    initBytes[0] === 0x52 && initBytes[1] === 0x49 && initBytes[2] === 0x46 && initBytes[3] === 0x46 &&
    initBytes[8] === 0x57 && initBytes[9] === 0x41 && initBytes[10] === 0x56 && initBytes[11] === 0x45
  ) {
    container = 'WAV'
    codec = 'PCM'
    isLossless = true
    const wavSlice = await blob.slice(0, 64).arrayBuffer()
    const bytes = new Uint8Array(wavSlice)
    if (bytes.length >= 36) {
      sampleRate = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16) | (bytes[27] << 24)
      bitsPerSample = bytes[34] | (bytes[35] << 8)
    }
  }
  // 3. MP4 / M4A: ftyp atom at bytes 4..7
  else if (initBytes.length >= 8 && initBytes[4] === 0x66 && initBytes[5] === 0x74 && initBytes[6] === 0x79 && initBytes[7] === 0x70) {
    container = 'M4A'
    const m4aSlice = await blob.slice(0, 128).arrayBuffer()
    const sub = new TextDecoder('latin1').decode(new Uint8Array(m4aSlice).slice(8))
    if (sub.includes('alac')) {
      isLossless = true
      codec = 'ALAC'
    } else {
      codec = 'AAC'
    }
  }
  // 4. MP3: ID3v2 ("ID3") or MPEG Frame Sync (0xFF 0xEx)
  else {
    container = 'MP3'
    codec = 'MPEG 1 Layer 3'

    let frameOffset = 0
    if (initBytes.length >= 10 && initBytes[0] === 0x49 && initBytes[1] === 0x44 && initBytes[2] === 0x33) {
      const id3BodySize = ((initBytes[6] & 0x7F) << 21) | ((initBytes[7] & 0x7F) << 14) | ((initBytes[8] & 0x7F) << 7) | (initBytes[9] & 0x7F)
      const hasFooter = (initBytes[5] & 0x10) !== 0
      frameOffset = 10 + id3BodySize + (hasFooter ? 10 : 0)
    }

    // 先按 ID3v2 标签长度跳过再读取第一帧（支持超大封面图）
    const frameSlice = await blob.slice(frameOffset, frameOffset + 65536).arrayBuffer()
    const bytes = new Uint8Array(frameSlice)

    for (let i = 0; i < Math.min(bytes.length - 4, 8192); i++) {
      if (bytes[i] === 0xFF && (bytes[i + 1] & 0xE0) === 0xE0) {
        const ver = (bytes[i + 1] >> 3) & 0x03
        const layer = (bytes[i + 1] >> 1) & 0x03
        const brIndex = (bytes[i + 2] >> 4) & 0x0F
        const srIndex = (bytes[i + 2] >> 2) & 0x03
        const channelMode = (bytes[i + 3] >> 6) & 0x03

        const bitratesMpeg1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        const sampleRatesMpeg1 = [44100, 48000, 32000]

        if (ver === 3) {
          if (srIndex < sampleRatesMpeg1.length) sampleRate = sampleRatesMpeg1[srIndex]
          if (layer === 1 && brIndex < bitratesMpeg1L3.length) {
            bitrateKbps = bitratesMpeg1L3[brIndex]
          }
        }

        // 探测 Xing / Info 头部 (VBR/CBR 扩展信息)
        const sideInfoLen = channelMode === 3 ? 17 : 32
        const xingOffset = i + 4 + sideInfoLen
        if (bytes.length >= xingOffset + 8) {
          const tag = String.fromCharCode(bytes[xingOffset], bytes[xingOffset + 1], bytes[xingOffset + 2], bytes[xingOffset + 3])
          if (tag === 'Xing' || tag === 'Info') {
            if (tag === 'Xing') isVbr = true
            const flags = ((bytes[xingOffset + 4] << 24) | (bytes[xingOffset + 5] << 16) | (bytes[xingOffset + 6] << 8) | bytes[xingOffset + 7]) >>> 0
            let pos = xingOffset + 8
            if (flags & 0x0001 && bytes.length >= pos + 4) {
              xingFrames = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0
              pos += 4
            }
            if (flags & 0x0002 && bytes.length >= pos + 4) {
              xingBytes = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0
              pos += 4
            }
          }
        }

        // 探测 VBRI 头部
        const vbriOffset = i + 36
        if (!xingFrames && bytes.length >= vbriOffset + 18) {
          const tag = String.fromCharCode(bytes[vbriOffset], bytes[vbriOffset + 1], bytes[vbriOffset + 2], bytes[vbriOffset + 3])
          if (tag === 'VBRI') {
            isVbr = true
            xingBytes = ((bytes[vbriOffset + 10] << 24) | (bytes[vbriOffset + 11] << 16) | (bytes[vbriOffset + 12] << 8) | bytes[vbriOffset + 13]) >>> 0
            xingFrames = ((bytes[vbriOffset + 14] << 24) | (bytes[vbriOffset + 15] << 16) | (bytes[vbriOffset + 16] << 8) | bytes[vbriOffset + 17]) >>> 0
          }
        }

        break
      }
    }
  }

  // 时长获取：优先 Xing/VBRI 头，次选 durationSeconds，最后 HTMLAudioElement loadedmetadata
  let effectiveDuration: number | null = null
  if (xingFrames && sampleRate && sampleRate > 0) {
    effectiveDuration = (xingFrames * 1152) / sampleRate
  }
  if (!effectiveDuration && durationSeconds && durationSeconds > 0) {
    effectiveDuration = durationSeconds
  }
  if (!effectiveDuration) {
    effectiveDuration = await getBlobAudioDuration(blob)
  }

  // 平均码率计算：文件大小 × 8 ÷ 时长
  let avgBitrateKbps: number | null = null
  if (effectiveDuration && effectiveDuration > 0) {
    avgBitrateKbps = Math.round((blob.size * 8) / effectiveDuration / 1000)
  }

  // 综合码率判定：VBR 必须使用平均码率；CBR 且有 frameBitrate 则使用 frameBitrate，否则使用平均码率
  let finalBitrateKbps = bitrateKbps
  if (isVbr && avgBitrateKbps) {
    finalBitrateKbps = avgBitrateKbps
  } else if (!finalBitrateKbps && avgBitrateKbps) {
    finalBitrateKbps = avgBitrateKbps
  }

  // HQ/标准分类：使用平均码率（若无法取得则回退 finalBitrateKbps）
  const classificationBitrate = avgBitrateKbps || finalBitrateKbps || 128

  let resolvedTier: ResolvedBlobTier = 'standard'
  let displayTag = 'MP3 128k'

  if (isLossless) {
    resolvedTier = 'lossless'
    if (container === 'WAV') {
      displayTag = 'WAV'
    } else if (codec === 'ALAC') {
      displayTag = 'ALAC'
    } else {
      displayTag = 'FLAC'
    }
  } else if (classificationBitrate >= 256) {
    resolvedTier = 'exhigh'
    if (container === 'M4A' || codec === 'AAC') {
      displayTag = classificationBitrate >= 300 ? 'AAC 320k' : `AAC ${classificationBitrate}k`
    } else {
      displayTag = classificationBitrate >= 300 ? 'MP3 320k' : `MP3 ${classificationBitrate}k`
    }
  } else {
    resolvedTier = 'standard'
    if (container === 'M4A' || codec === 'AAC') {
      displayTag = classificationBitrate ? `AAC ${classificationBitrate}k` : 'AAC 128k'
    } else {
      displayTag = finalBitrateKbps ? `MP3 ${finalBitrateKbps}k` : 'MP3 128k'
    }
  }

  // 检查请求音质与实际格式是否不符 (警示提示)
  let mismatchWarning: string | null = null
  const req = reqQualityLevel || 'standard'
  if (req === 'lossless' && !isLossless) {
    const actualBitrateStr = finalBitrateKbps ? `${finalBitrateKbps} kbps` : '128 kbps'
    mismatchWarning = `请求 SQ 无损, 实际为 ${container === 'M4A' ? 'AAC' : 'MP3'} ${actualBitrateStr}`
  } else if (req === 'exhigh' && (!classificationBitrate || classificationBitrate < 256)) {
    const actualBitrateStr = finalBitrateKbps ? `${finalBitrateKbps} kbps` : '128 kbps'
    mismatchWarning = `请求 HQ 极高, 实际为 ${container === 'M4A' ? 'AAC' : 'MP3'} ${actualBitrateStr}`
  }

  const details: string[] = []
  if (sampleRate) {
    details.push(`${(sampleRate / 1000).toFixed(1)}kHz`)
  }
  if (bitsPerSample) {
    details.push(`${bitsPerSample}bit`)
  }

  return {
    container,
    codec: isVbr ? `${codec} (VBR)` : codec,
    bitrate: finalBitrateKbps ? finalBitrateKbps * 1000 : undefined,
    sampleRate: sampleRate || undefined,
    bitsPerSample: bitsPerSample || undefined,
    isLossless,
    resolvedTier,
    displayTag,
    detailText: details.join(' · '),
    mismatchWarning,
  }
}
