/**
 * API 响应数据转换器
 * 统一处理各种 API 响应格式的数据转换
 */
import { formatCoverUrl } from '@/utils/imageUrl'
import { BRAND_PRODUCT } from '@/config/brand'
import { formatDateLong } from '@/utils/time'
import i18n from '@/languages'

// ============ 类型定义 ============

export interface BannerData {
  coverImgUrl: string
  title: string
  description: string
  url?: string
  targetId?: number | string
  targetType?: number
  internalTo: string
}

export interface PlaylistData {
  id: number | string
  name: string
  coverImgUrl: string
  playCount: number
  trackCount?: number
}

export interface SongData {
  id: number | string
  name: string
  artist: string
  artistId?: number | string
  artists?: { id: number | string; name: string }[]
  album: string
  albumId?: number | string
  cover: string
  duration: number
  liked?: boolean
  mvId?: number | string
  sha?: string
  qualityBadge?: string
  qualities?: Array<{ level: string; label: string; bitrate: string; streamUrl?: string }>
  url?: string
  streamType?: 'full' | 'trial' | 'unavailable'
  trialDuration?: number
  sources?: Array<{ platform: string; platformId: string | number; duration?: number }>
}

export interface ArtistData {
  id: number | string
  name: string
  picUrl: string
  alias?: string[]
  albumSize?: number
  musicSize?: number
  mvSize?: number
}

export interface MVData {
  id: number | string
  name: string
  cover: string
  artist: string
  playCount?: number
  duration?: number
}

export interface AlbumData {
  id: number | string
  name: string
  picUrl: string
  artist: string
  artistId?: number | string
  publishTime?: string
  size?: number
  description?: string
}

export interface PlaylistDetailData {
  name: string
  description: string
  creator: string
  creatorAvatar: string
  createTime: string
  songCount: number
  playCount: string | number
  likes: string | number
  category: string
  coverImgUrl: string
}

// ============ 数据提取器 ============

type ApiResponse = Record<string, unknown>

/**
 * 从 API 响应中提取数据，支持多种响应格式
 */
export function extractData<T>(
  response: ApiResponse,
  ...paths: string[]
): T | undefined {
  for (const path of paths) {
    const keys = path.split('.')
    let result: unknown = response
    for (const key of keys) {
      if (result && typeof result === 'object' && key in result) {
        result = (result as Record<string, unknown>)[key]
      } else {
        result = undefined
        break
      }
    }
    if (result !== undefined) return result as T
  }
  return undefined
}

/**
 * 提取数组数据
 */
export function extractArray<T = unknown>(
  response: ApiResponse,
  ...paths: string[]
): T[] {
  const data = extractData<T[]>(response, ...paths)
  return Array.isArray(data) ? data : []
}

// ============ 转换器 ============

/**
 * 将时长统一归一化为毫秒
 * 部分接口（如搜索 nexus 网关）返回秒级时长；小于 1 小时毫秒数（3,600,000ms）的值
 * 不可能是真实曲目，按秒级输入换算为毫秒，保证 formatDuration 等调用点单位一致
 */
export function normalizeDurationMs(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  if (n > 0 && n < 3600) return Math.round(n * 1000)
  return n
}

/**
 * 转换 Banner 数据
 * 严格屏蔽纯外部商业活动，并将单曲/专辑等引导至站内闭环播放与浏览
 */
export function transformBanner(item: Record<string, unknown>): BannerData | null {
  const targetType = Number(item?.targetType ?? 0)
  let targetId = (item?.targetId as number | string) || ''
  const rawUrl = String(item?.url || '')

  // 若未直接提供 targetId，尝试从 URL 解析
  if (!targetId && rawUrl) {
    const match = rawUrl.match(/(?:song|album|playlist|mv)[/=](\d+)/i) || rawUrl.match(/id=(\d+)/i)
    if (match) targetId = match[1]
  }

  // 1. 严格屏蔽纯外部商业活动（targetType === 3000 或无有效音乐实体的外链）
  if (targetType === 3000 || (!targetId && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')))) {
    return null
  }

  // 2. 根据类型构建安全的站内闭环路由
  let internalTo = ''
  if (targetType === 1 && targetId) {
    internalTo = `/song/${targetId}?autoplay=1`
  } else if (targetType === 10 && targetId) {
    internalTo = `/album/${targetId}?autoplay=1`
  } else if (targetType === 1000 && targetId) {
    internalTo = `/playlist/${targetId}`
  } else if (targetType === 1004 && targetId) {
    internalTo = `/mv-player/${targetId}`
  } else if (rawUrl.startsWith('/')) {
    internalTo = rawUrl
  } else if (targetId) {
    internalTo = `/song/${targetId}?autoplay=1`
  } else {
    // 无法定位站内实体则直接丢弃，不予展示
    return null
  }

  return {
    coverImgUrl: (item?.pic as string) || (item?.imageUrl as string) || (item?.bigImageUrl as string) || '',
    title:
      (item?.typeTitle as string) ||
      i18n.global.t('home.exclusiveRecommend', { brand: BRAND_PRODUCT }),
    description: (item?.title as string) || '',
    targetId,
    targetType,
    internalTo,
    url: internalTo,
  }
}

/**
 * 批量转换 Banner（自动剔除外部推广卡片，仅保留可站内闭环消费的项目）
 */
export function transformBanners(
  response: ApiResponse,
  limit?: number
): BannerData[] {
  const list = extractArray(response, 'data.banners', 'banners')
  const result: BannerData[] = []
  for (const item of list) {
    const bannerItem = transformBanner(item as Record<string, unknown>)
    if (bannerItem && bannerItem.internalTo) {
      result.push(bannerItem)
    }
  }
  return limit ? result.slice(0, limit) : result
}

/**
 * 转换歌单数据
 */
export function transformPlaylist(
  item: Record<string, unknown>,
  fallbackName = i18n.global.t('common.unknownPlaylist')
): PlaylistData {
  return {
    id: (item?.id as number | string) || 0,
    name: (item?.name as string) || fallbackName,
    coverImgUrl: (item?.picUrl as string) || (item?.coverImgUrl as string) || '',
    playCount: (item?.playCount as number) || 0,
    trackCount: (item?.trackCount as number) || 0,
  }
}

/**
 * 批量转换歌单（推荐歌单）
 */
export function transformPlaylists(
  response: ApiResponse,
  limit?: number,
  fallbackName = i18n.global.t('common.unknownPlaylist')
): PlaylistData[] {
  const list = extractArray(response, 'result', 'data.result', 'playlists', 'data.playlists')
  const result = list.map(item =>
    transformPlaylist(item as Record<string, unknown>, fallbackName)
  )
  return limit ? result.slice(0, limit) : result
}

/**
 * 提取艺术家名称
 */
function extractArtistName(item: Record<string, unknown>): string {
  const ar = item?.ar as Array<Record<string, unknown>> | undefined
  const artists = item?.artists as Array<Record<string, unknown>> | undefined
  const songArtists = (item?.song as Record<string, unknown>)?.artists as
    | Array<Record<string, unknown>>
    | undefined

  const artistList = ar || artists || songArtists
  if (Array.isArray(artistList)) {
    return artistList.map(a => a?.name || '').join(' / ')
  }
  return (item?.artistName as string) || ''
}

/**
 * 转换歌曲数据
 */
export function transformSong(item: Record<string, unknown>): SongData {
  const song = item?.song as Record<string, unknown> | undefined
  const al = item?.al as Record<string, unknown> | undefined
  const album = item?.album as Record<string, unknown> | undefined
  const songAlbum = song?.album as Record<string, unknown> | undefined

  const albumData = al || album || songAlbum

  // 提取歌手数组
  const ar = item?.ar as Array<Record<string, unknown>> | undefined
  const artistsRaw = item?.artists as Array<Record<string, unknown>> | undefined
  const songArtists = song?.artists as Array<Record<string, unknown>> | undefined
  const artistList = ar || artistsRaw || songArtists

  const artists = Array.isArray(artistList)
    ? artistList.map(a => ({
        id: (a?.id as number | string) || 0,
        name: (a?.name as string) || '',
      }))
    : undefined

  const artistId = (artists?.[0]?.id as number | string) || 0
  const artistName = extractArtistName(item)
  const rawCover =
    (albumData?.picUrl as string) ||
    (albumData?.pic as string) ||
    (item?.picUrl as string) ||
    (item?.pic as string) ||
    (item?.cover as string) ||
    (item?.coverUrl as string) ||
    (song?.cover as string) ||
    (song?.coverUrl as string) ||
    ((item?.artistPic || (item?.artists as any[])?.[0]?.img1v1Url || (albumData?.artist as any)?.img1v1Url) as string) ||
    ''

  const cover = formatCoverUrl(rawCover, {
    size: 300,
    artist: artistName,
  })

  return {
    id: (item?.id as number | string) || (song?.id as number | string) || 0,
    name: (item?.name as string) || (song?.name as string) || '',
    artist: artistName,
    artistId,
    artists,
    album: (albumData?.name as string) || '',
    albumId: (albumData?.id as number | string) || 0,
    cover,
    duration: normalizeDurationMs(
      (item?.dt as number) ?? (item?.duration as number) ?? (song?.duration as number) ?? 0
    ),
    liked: false,
    mvId: (item?.mv as number | string) || (item?.mvid as number | string) || 0,
    sha: (item?.sha as string) || (song?.sha as string) || '',
    // 缺失音质数据时保持为空，由展示层隐藏徽章；真实档位由 qualityProbe 网络探测补齐
    qualityBadge: (item?.qualityBadge as string) || (song?.qualityBadge as string) || undefined,
    qualities: (item?.qualities as any[]) || (song?.qualities as any[]) || undefined,
    url: (item?.streamUrl as string) || (item?.url as string) || (song?.url as string) || '',
    streamType: (item?.streamType as any) || (song?.streamType as any) || undefined,
    trialDuration: (item?.trialDuration as number) || (song?.trialDuration as number) || undefined,
    sources: (item?.sources as any[]) || (song?.sources as any[]) || undefined,
  }
}

/**
 * 批量转换歌曲
 */
export function transformSongs(
  response: ApiResponse,
  limit?: number
): SongData[] {
  const list = extractArray(
    response,
    'songs',
    'data.songs',
    'result',
    'data.result',
    'result.songs'
  )
  const result = list.map(item => transformSong(item as Record<string, unknown>))
  return limit ? result.slice(0, limit) : result
}

/**
 * 转换歌手数据
 */
export function transformArtist(item: Record<string, unknown>): ArtistData {
  const name = (item?.name as string) || ''
  const rawPic =
    (item?.picUrl as string) ||
    (item?.img1v1Url as string) ||
    (item?.cover as string) ||
    (item?.avatar as string) ||
    ''
  const picUrl = formatCoverUrl(rawPic, { size: 400, artist: name })

  return {
    id: (item?.id as number | string) || 0,
    name,
    picUrl,
    alias: (item?.alias as string[]) || [],
    albumSize: (item?.albumSize as number) || 0,
    musicSize: (item?.musicSize as number) || 0,
    mvSize: (item?.mvSize as number) || 0,
  }
}

/**
 * 批量转换歌手
 */
export function transformArtists(
  response: ApiResponse,
  limit?: number
): ArtistData[] {
  const list = extractArray(response, 'artists', 'data.artists', 'result.artists')
  const result = list.map(item => transformArtist(item as Record<string, unknown>))
  return limit ? result.slice(0, limit) : result
}

/**
 * 转换 MV 数据
 */
export function transformMV(item: Record<string, unknown>): MVData {
  return {
    id: (item?.id as number | string) || 0,
    name: (item?.name as string) || '',
    cover:
      (item?.cover as string) ||
      (item?.picUrl as string) ||
      (item?.imgurl as string) ||
      '',
    artist: (item?.artistName as string) || '',
    playCount: (item?.playCount as number) || 0,
    duration: (item?.duration as number) || 0,
  }
}

/**
 * 批量转换 MV
 */
export function transformMVs(
  response: ApiResponse,
  limit?: number
): MVData[] {
  const list = extractArray(response, 'result', 'data.result', 'mvs', 'data.mvs', 'result.mvs')
  const result = list.map(item => transformMV(item as Record<string, unknown>))
  return limit ? result.slice(0, limit) : result
}

/**
 * 转换专辑数据
 */
export function transformAlbum(item: Record<string, unknown>): AlbumData {
  const artist = item?.artist as Record<string, unknown> | undefined

  return {
    id: (item?.id as number | string) || 0,
    name: (item?.name as string) || '',
    picUrl: (item?.picUrl as string) || (item?.blurPicUrl as string) || '',
    artist: (artist?.name as string) || (item?.artistName as string) || '',
    artistId: (artist?.id as number | string) || 0,
    publishTime: item?.publishTime ? formatDateLong(item.publishTime as number) : '',
    size: (item?.size as number) || 0,
    description: (item?.description as string) || '',
  }
}

/**
 * 批量转换专辑
 */
export function transformAlbums(
  response: ApiResponse,
  limit?: number
): AlbumData[] {
  const list = extractArray(
    response,
    'albums',
    'data.albums',
    'hotAlbums',
    'data.hotAlbums',
    'result.albums'
  )
  const result = list.map(item => transformAlbum(item as Record<string, unknown>))
  return limit ? result.slice(0, limit) : result
}

/**
 * 转换歌单详情
 */
export function transformPlaylistDetail(
  response: ApiResponse,
  fallbackCategory = i18n.global.t('home.playlistFallback')
): PlaylistDetailData | null {
  const detail = extractData<Record<string, unknown>>(
    response,
    'playlist',
    'data.playlist',
    'data'
  )

  if (!detail) return null

  const creator = detail?.creator as Record<string, unknown> | undefined
  const tags = detail?.tags as string[] | undefined

  return {
    name: (detail?.name as string) || '',
    description: (detail?.description as string) || '',
    creator: (creator?.nickname as string) || '',
    creatorAvatar: (creator?.avatarUrl as string) || '',
    createTime: detail?.createTime ? formatDateLong(detail.createTime as number) : '',
    songCount: (detail?.trackCount as number) || 0,
    playCount: (detail?.playCount as string | number) || 0,
    likes: (detail?.subscribedCount as number) || (detail?.bookedCount as number) || 0,
    category: tags?.[0] || fallbackCategory,
    coverImgUrl: (detail?.coverImgUrl as string) || '',
  }
}

/**
 * 转换歌手详情
 */
export function transformArtistDetail(
  response: ApiResponse
): ArtistData | null {
  const artist = extractData<Record<string, unknown>>(
    response,
    'data.artist',
    'artist'
  )

  if (!artist) return null

  return {
    id: (artist?.id as number | string) || 0,
    name: (artist?.name as string) || '',
    picUrl:
      (artist?.cover as string) ||
      (artist?.picUrl as string) ||
      (artist?.avatar as string) ||
      '',
    alias: (artist?.alias as string[]) || [],
    albumSize: (artist?.albumSize as number) || 0,
    musicSize: (artist?.musicSize as number) || 0,
    mvSize: (artist?.mvSize as number) || 0,
  }
}

/**
 * 转换专辑详情
 */
export function transformAlbumDetail(
  response: ApiResponse
): AlbumData | null {
  const album = extractData<Record<string, unknown>>(
    response,
    'album',
    'data.album'
  )

  if (!album) return null

  return transformAlbum(album)
}

// ============ 搜索结果转换器 ============

/**
 * 搜索歌曲结果
 */
export function transformSearchSongs(
  response: ApiResponse,
  limit?: number
): { songs: SongData[]; total: number } {
  const songs = extractArray(response, 'result.songs', 'data.result.songs')
  const total = extractData<number>(response, 'result.songCount', 'data.result.songCount') || songs.length
  const result = songs.map(item => transformSong(item as Record<string, unknown>))
  return {
    songs: limit ? result.slice(0, limit) : result,
    total,
  }
}

/**
 * 搜索歌单结果
 */
export function transformSearchPlaylists(
  response: ApiResponse,
  limit?: number
): { playlists: PlaylistData[]; total: number } {
  const playlists = extractArray(response, 'result.playlists', 'data.result.playlists')
  const total = extractData<number>(response, 'result.playlistCount', 'data.result.playlistCount') || playlists.length
  const result = playlists.map(item => transformPlaylist(item as Record<string, unknown>))
  return {
    playlists: limit ? result.slice(0, limit) : result,
    total,
  }
}

/**
 * 搜索 MV 结果
 */
export function transformSearchMVs(
  response: ApiResponse,
  limit?: number
): { mvs: MVData[]; total: number } {
  const mvs = extractArray(response, 'result.mvs', 'data.result.mvs')
  const total = extractData<number>(response, 'result.mvCount', 'data.result.mvCount') || mvs.length
  const result = mvs.map(item => transformMV(item as Record<string, unknown>))
  return {
    mvs: limit ? result.slice(0, limit) : result,
    total,
  }
}

// ============ 新歌/榜单转换器 ============

/**
 * 转换新歌榜数据 (topSong API)
 * 复用 transformSong 避免重复映射逻辑
 */
export function transformTopSongs(
  response: ApiResponse,
  limit?: number
): SongData[] {
  const list = extractArray(
    response,
    'data.data',
    'data.songs',
    'songs',
    'data'
  )
  const result = list.map(item => transformSong(item as Record<string, unknown>))
  return limit ? result.slice(0, limit) : result
}

/**
 * 转换 MV 列表 (mvAll API)
 */
export function transformMVList(
  response: ApiResponse,
  limit?: number
): MVData[] {
  const list = extractArray(response, 'data', 'mvs', 'result')
  const result = list.map((item: unknown) => {
    const m = item as Record<string, unknown>
    return {
      id: (m?.id as number | string) || (m?.vid as string) || 0,
      name: (m?.name as string) || (m?.title as string) || '',
      cover: (m?.cover as string) || (m?.imgurl as string) || (m?.pic as string) || '',
      artist: (m?.artistName as string) || '',
      playCount: (m?.playCount as number) || 0,
      duration: (m?.duration as number) || 0,
    }
  })
  return limit ? result.slice(0, limit) : result
}
