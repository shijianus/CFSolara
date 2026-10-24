/**
 * Sonic Music Platform — Image URL Normalization & Resiliency Utility
 * Fixes multi-channel cover loading, anti-hotlinking, and size formatting
 */

export const DEFAULT_COVER_DATA_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300' viewBox='0 0 300 300'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%232563eb'/%3E%3Cstop offset='50%25' stop-color='%2338bdf8'/%3E%3Cstop offset='100%25' stop-color='%231d4ed8'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='300' height='300' rx='28' fill='url(%23g)'/%3E%3Ccircle cx='150' cy='150' r='54' fill='rgba(255,255,255,0.18)'/%3E%3Cpath d='M142 118v46a18 18 0 1 0 12 17v-40l24-7v-16z' fill='%23ffffff'/%3E%3C/svg%3E"

export interface FormatCoverOptions {
  size?: number | string
  width?: number
  height?: number
  fallback?: string
  artist?: string
}

/**
 * Normalizes and formats music cover & artist picture URLs safely.
 * - Prevents '?param=...' from being appended to empty strings (which caused 404/broken images)
 * - Upgrades insecure http:// URLs to https:// (fixes mixed-content blocks)
 * - Replaces Kugou {size} templates (e.g. {size} -> 400)
 * - Applies NetEase ?param=WyH sizing cleanly without corrupting existing query params
 * - Preserves QQ Music, Kugou, and other CDNs without injecting invalid NetEase params
 */
export function formatCoverUrl(url?: string, options?: FormatCoverOptions): string {
  if (!url || !url.trim()) {
    if (options?.fallback) return options.fallback
    if (options?.artist && options.artist !== '未知歌手') {
      return `/api/music/cover?artist=${encodeURIComponent(options.artist)}`
    }
    return ''
  }

  const trimmed = url.trim()

  // Base64 or Blob URLs don't need formatting
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed
  }

  // Upgrade http:// to https://
  let cleanUrl = trimmed.startsWith('http://') ? trimmed.replace('http://', 'https://') : trimmed

  // Kugou template resolution (e.g. http://imge.kugou.com/stdmusic/{size}/...)
  if (cleanUrl.includes('{size}')) {
    const targetSize = String(options?.size || options?.width || 400)
    cleanUrl = cleanUrl.replace(/\{size\}/g, targetSize)
  }

  const isNetEase = cleanUrl.includes('music.126.net') || cleanUrl.includes('163.com')
  const hasExplicitSize = Boolean(options?.width || options?.height || options?.size)
  if (isNetEase && hasExplicitSize) {
    const width = options?.width || options?.size || 300
    const height = options?.height || options?.size || 300
    const paramValue = `${width}y${height}`
    if (cleanUrl.includes('?param=')) {
      cleanUrl = cleanUrl.replace(/\?param=[^&]*/, `?param=${paramValue}`)
    } else if (cleanUrl.includes('&param=')) {
      cleanUrl = cleanUrl.replace(/&param=[^&]*/, `&param=${paramValue}`)
    } else if (cleanUrl.includes('?')) {
      cleanUrl = `${cleanUrl}&param=${paramValue}`
    } else {
      cleanUrl = `${cleanUrl}?param=${paramValue}`
    }
    return cleanUrl
  }

  // For /api/music/cover endpoints, avoid double question mark
  if (cleanUrl.startsWith('/api/music/cover')) {
    if (options?.size && !cleanUrl.includes('size=')) {
      cleanUrl += cleanUrl.includes('?') ? `&size=${options.size}` : `?size=${options.size}`
    }
    return cleanUrl
  }

  return cleanUrl
}

/**
 * Returns proxy URL for external images that might suffer from anti-hotlinking
 */
export function getProxyCoverUrl(rawUrl: string): string {
  if (!rawUrl || !rawUrl.startsWith('http')) return rawUrl || ''
  return `/api/music/cover?url=${encodeURIComponent(rawUrl)}`
}

/**
 * Returns fallback artist avatar URL
 */
export function getArtistAvatarUrl(artistName?: string, rawPicUrl?: string): string {
  if (rawPicUrl && rawPicUrl.trim()) {
    return formatCoverUrl(rawPicUrl, { size: 300 })
  }
  if (artistName && artistName.trim() && artistName !== '未知歌手') {
    return `/api/music/cover?artist=${encodeURIComponent(artistName.trim())}`
  }
  return DEFAULT_COVER_DATA_URI
}
