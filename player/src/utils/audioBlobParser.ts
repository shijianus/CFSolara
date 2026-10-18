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

export async function parseAudioBlob(blob: Blob, durationSeconds?: number, reqQualityLevel?: string): Promise<ParsedAudioMeta> {
  const sliceSize = Math.min(blob.size, 65536)
  const headerBuf = await blob.slice(0, sliceSize).arrayBuffer()
  const bytes = new Uint8Array(headerBuf)

  let container = 'UNKNOWN'
  let codec = 'UNKNOWN'
  let isLossless = false
  let bitrateKbps: number | null = null
  let sampleRate: number | null = null
  let bitsPerSample: number | null = null

  // 1. FLAC: 0x66 0x4C 0x61 0x43 ("fLaC")
  if (bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) {
    container = 'FLAC'
    codec = 'FLAC'
    isLossless = true
    if (bytes.length >= 22) {
      // STREAMINFO block is at bytes 4..38
      // Sample rate: 20 bits (bytes 18..20)
      sampleRate = ((bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4)) >>> 0
      // Channels: 3 bits
      const channels = ((bytes[20] >> 1) & 0x07) + 1
      // Bits per sample: 5 bits
      bitsPerSample = (((bytes[20] & 0x01) << 4) | (bytes[21] >> 4)) + 1
      if (sampleRate === 0) sampleRate = 44100
    }
  }
  // 2. WAV: 0x52 0x49 0x46 0x46 ("RIFF") ... "WAVE"
  else if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
  ) {
    container = 'WAV'
    codec = 'PCM'
    isLossless = true
    if (bytes.length >= 36) {
      sampleRate = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16) | (bytes[27] << 24)
      bitsPerSample = bytes[34] | (bytes[35] << 8)
    }
  }
  // 3. MP4 / M4A: ftyp atom at bytes 4..7
  else if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    container = 'M4A'
    const sub = new TextDecoder('latin1').decode(bytes.slice(8, Math.min(bytes.length, 128)))
    if (sub.includes('alac') || sub.includes('M4A ')) {
      isLossless = sub.includes('alac')
      codec = isLossless ? 'ALAC' : 'AAC'
    } else {
      codec = 'AAC'
    }
  }
  // 4. MP3: ID3v2 ("ID3") or MPEG Frame Sync (0xFF 0xEx)
  else {
    let frameOffset = 0
    if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      container = 'MP3'
      codec = 'MPEG 1 Layer 3'
      const id3Size = ((bytes[6] & 0x7F) << 21) | ((bytes[7] & 0x7F) << 14) | ((bytes[8] & 0x7F) << 7) | (bytes[9] & 0x7F)
      frameOffset = 10 + id3Size
    }

    // 寻找 MPEG 帧同步头 (0xFF 0xEx)
    const scanLimit = Math.min(bytes.length - 4, frameOffset + 4096)
    for (let i = frameOffset; i < scanLimit; i++) {
      if (bytes[i] === 0xFF && (bytes[i + 1] & 0xE0) === 0xE0) {
        container = 'MP3'
        codec = 'MPEG 1 Layer 3'
        const brIndex = (bytes[i + 2] >> 4) & 0x0F
        const srIndex = (bytes[i + 2] >> 2) & 0x03
        const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        const sampleRates = [44100, 48000, 32000]
        if (brIndex > 0 && brIndex < bitrates.length) {
          bitrateKbps = bitrates[brIndex]
        }
        if (srIndex < sampleRates.length) {
          sampleRate = sampleRates[srIndex]
        }
        break
      }
    }
  }

  // 计算码率回退值
  if (!bitrateKbps && durationSeconds && durationSeconds > 0) {
    bitrateKbps = Math.round((blob.size * 8) / durationSeconds / 1000)
  }

  // 分类规则: FLAC/ALAC/WAV → SQ; MP3/AAC ≥ 256 kbps → HQ; 其余 → 标准
  let resolvedTier: ResolvedBlobTier = 'standard'
  let displayTag = 'MP3 128k'
  if (isLossless) {
    resolvedTier = 'lossless'
    displayTag = container === 'WAV' ? 'WAV' : 'FLAC'
  } else if (bitrateKbps && bitrateKbps >= 256) {
    resolvedTier = 'exhigh'
    displayTag = bitrateKbps >= 300 ? 'MP3 320k' : `MP3 ${bitrateKbps}k`
  } else {
    resolvedTier = 'standard'
    displayTag = bitrateKbps ? `MP3 ${bitrateKbps}k` : 'MP3 128k'
  }

  // 检查请求音质与实际格式是否不符 (警示提示)
  let mismatchWarning: string | null = null
  const req = reqQualityLevel || 'standard'
  if (req === 'lossless' && !isLossless) {
    const actualBitrateStr = bitrateKbps ? `${bitrateKbps} kbps` : '128 kbps'
    mismatchWarning = `请求 SQ 无损, 实际为 MP3 ${actualBitrateStr}`
  } else if (req === 'exhigh' && (!bitrateKbps || bitrateKbps < 256)) {
    const actualBitrateStr = bitrateKbps ? `${bitrateKbps} kbps` : '128 kbps'
    mismatchWarning = `请求 HQ 极高, 实际为 MP3 ${actualBitrateStr}`
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
    codec,
    bitrate: bitrateKbps ? bitrateKbps * 1000 : undefined,
    sampleRate: sampleRate || undefined,
    bitsPerSample: bitsPerSample || undefined,
    isLossless,
    resolvedTier,
    displayTag,
    detailText: details.join(' · '),
    mismatchWarning,
  }
}
