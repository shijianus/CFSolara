/**
 * 智能推荐与搜索偏好 Store
 * 管理：
 *   - 隐私优先的匿名设备标识 (`anonId`) 与个性化总开关 (`personalizationEnabled`)
 *   - 自动连续电台 / Auto DJ 开关 (`autoDjEnabled`)
 *   - 负向反馈 (`dislikedTracks` — 减少类似推荐)
 *   - 非阻塞异步行为事件批量上报 (`play_start`, `play_progress`, `play_complete`, `skip`, `replay`, `favorite`, `dislike`, `search`, `search_click`)
 */
import { defineStore } from 'pinia'
import piniaPersistConfig from '../persist'
import type { Song } from '../interface'
import { useLibraryStore } from './library'
import { useAudioStore } from './audio'
import { useToastStore } from './toast'
import {
  deleteSonicEvents,
  fetchRecommendForYou,
  postSonicEvents,
  type RecommendSongItem,
  type SonicEventPayload,
} from '@/api/recommend'

export interface DislikedTrackEntry {
  id: string
  canonicalTrackId?: string
  name: string
  artist: string
  createdAt: number
}

interface RecommendStoreState {
  personalizationEnabled: boolean
  autoDjEnabled: boolean
  anonId: string
  dislikedTracks: DislikedTrackEntry[]
}

function generateAnonId(): string {
  const bytes = new Uint8Array(12)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `anon_${hex}`
}

function encodeContextBase64Url(obj: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(obj)
    const bytes = new TextEncoder().encode(json)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch {
    return ''
  }
}

let pendingQueue: SonicEventPayload[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

export const useRecommendStore = defineStore('recommend', {
  state: (): RecommendStoreState => ({
    personalizationEnabled: true,
    autoDjEnabled: true,
    anonId: '',
    dislikedTracks: [],
  }),

  getters: {
    dislikedCount: (state): number => state.dislikedTracks.length,
  },

  actions: {
    ensureAnonId(): string {
      if (!this.personalizationEnabled) return ''
      if (!this.anonId || !/^anon_[a-zA-Z0-9_-]{8,64}$/.test(this.anonId)) {
        this.anonId = generateAnonId()
      }
      return this.anonId
    },

    buildRequestHeaders(includeContext = true): Record<string, string> {
      if (!this.personalizationEnabled) {
        return {
          'X-Sonic-Personalization': 'off',
        }
      }

      const headers: Record<string, string> = {}
      const id = this.ensureAnonId()
      if (id) {
        headers['X-Sonic-Anon-Id'] = id
      }

      try {
        const apiKey =
          typeof localStorage !== 'undefined' ? localStorage.getItem('sonic_api_key') : null
        if (apiKey && apiKey.startsWith('sonic_live_v1.')) {
          headers['X-Sonic-Key'] = apiKey
        }
      } catch {}

      if (includeContext) {
        try {
          const libraryStore = useLibraryStore()
          const audioStore = useAudioStore()

          const likedArtists = Array.from(
            new Set(libraryStore.likedSongs.slice(0, 15).map((s) => s.artist).filter(Boolean))
          ).slice(0, 10)
          const recentArtists = Array.from(
            new Set(
              (audioStore.audio.playHistory || [])
                .slice(0, 15)
                .map((s) => s.artist)
                .filter(Boolean)
            )
          ).slice(0, 10)
          const likedTrackIds = libraryStore.likedSongs
            .slice(0, 15)
            .map((s) => String(s.id))
          const dislikedTrackIds = this.dislikedTracks
            .slice(0, 25)
            .map((d) => d.canonicalTrackId || d.id)
          let recentQueries: string[] = []
          try {
            const rawGlobal =
              typeof localStorage !== 'undefined' ? localStorage.getItem('global') : null
            if (rawGlobal) {
              const parsed = JSON.parse(rawGlobal)
              if (Array.isArray(parsed?.searchHistory)) {
                recentQueries = parsed.searchHistory.slice(0, 8)
              }
            }
          } catch {}

          const ctx = encodeContextBase64Url({
            likedArtists,
            recentArtists,
            likedTrackIds,
            dislikedTrackIds,
            recentQueries,
          })
          if (ctx && ctx.length <= 3600) {
            headers['X-Sonic-Context'] = ctx
          }
        } catch {}
      }

      return headers
    },

    isSongDisliked(idOrCanonicalId?: string | number): boolean {
      if (idOrCanonicalId === undefined || idOrCanonicalId === null) return false
      const target = String(idOrCanonicalId)
      return this.dislikedTracks.some(
        (d) => d.id === target || (d.canonicalTrackId && d.canonicalTrackId === target)
      )
    },

    recordEvent(payload: SonicEventPayload, immediate = false) {
      if (!this.personalizationEnabled) return
      const evId =
        payload.eventId ||
        `fe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      pendingQueue.push({
        ...payload,
        eventId: evId,
        timestamp: payload.timestamp || Date.now(),
      })
      if (pendingQueue.length > 40) {
        pendingQueue = pendingQueue.slice(-40)
      }

      if (immediate) {
        this.flushEvents()
        return
      }
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null
          this.flushEvents()
        }, 1200)
      }
    },

    async flushEvents() {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (!this.personalizationEnabled || pendingQueue.length === 0) {
        pendingQueue = []
        return
      }
      const batch = [...pendingQueue]
      pendingQueue = []
      const headers = this.buildRequestHeaders(false)
      const ok = await postSonicEvents(batch, headers)
      if (!ok) {
        // 发送失败(断网/网关 5xx):把整批按原顺序放回队首,等下次上报重试
        const capacity = Math.max(0, 40 - pendingQueue.length)
        pendingQueue = [...batch.slice(0, capacity), ...pendingQueue]
      }
    },

    dislikeSong(
      song: Partial<Song> & { id: string | number; canonicalTrackId?: string }
    ) {
      const idStr = String(song.id)
      if (!this.isSongDisliked(idStr)) {
        this.dislikedTracks.unshift({
          id: idStr,
          canonicalTrackId: song.canonicalTrackId,
          name: song.name || '',
          artist: song.artist || '',
          createdAt: Date.now(),
        })
        if (this.dislikedTracks.length > 100) {
          this.dislikedTracks.pop()
        }
      }

      this.recordEvent(
        {
          type: 'dislike',
          track: {
            id: song.id,
            canonicalTrackId: song.canonicalTrackId,
            title: song.name,
            artist: song.artist,
            album: song.album,
            duration: song.duration ? Math.round(song.duration / 1000) : undefined,
          },
        },
        true
      )

      // 若当前正在播放被标记“不喜欢”的歌曲，自动切到下一首
      try {
        const audioStore = useAudioStore()
        if (
          audioStore.audio.currentSong &&
          String(audioStore.audio.currentSong.id) === idStr
        ) {
          audioStore.nextSong(false)
        }
      } catch {}
    },

    undislikeSong(id: string | number) {
      const target = String(id)
      const found = this.dislikedTracks.find(
        (d) => d.id === target || d.canonicalTrackId === target
      )
      this.dislikedTracks = this.dislikedTracks.filter(
        (d) => d.id !== target && d.canonicalTrackId !== target
      )
      if (found) {
        this.recordEvent(
          {
            type: 'undislike',
            track: {
              id: found.id,
              canonicalTrackId: found.canonicalTrackId,
              title: found.name,
              artist: found.artist,
            },
          },
          true
        )
      }
    },

    async startSongRadio(
      seedSong: Partial<Song> & { id: string | number; name: string; artist: string }
    ): Promise<RecommendSongItem[]> {
      const headers = this.buildRequestHeaders(true)
      const res = await fetchRecommendForYou(
        {
          mode: 'radio',
          count: 16,
          seedTrackId: seedSong.id,
          seedTitle: seedSong.name,
          seedArtist: seedSong.artist,
          temperature: 0.35,
        },
        headers
      )

      const audioStore = useAudioStore()
      const seedPlayable: Song = {
        id: seedSong.id,
        name: seedSong.name,
        artist: seedSong.artist,
        album: seedSong.album || '',
        cover: seedSong.cover || '',
        duration: seedSong.duration || 0,
        url: seedSong.url,
      }
      const radioQueue: Song[] = [seedPlayable, ...res.tracks]
      audioStore.setPlaylist(radioQueue, 0)
      await audioStore.playSong(radioQueue[0], 0, true)

      useToastStore().show({
        message: `已开启「${seedSong.name}」相似音乐电台 (${res.tracks.length + 1} 首)`,
        type: 'success',
        duration: 3500,
      })
      return res.tracks
    },

    async fetchAutoDjNextSongs(seedSong?: Song | null, count = 5): Promise<RecommendSongItem[]> {
      if (!this.autoDjEnabled) return []
      try {
        const audioStore = useAudioStore()
        const excludeIds = audioStore.audio.playlist.slice(-15).map((s) => String(s.id))
        const res = await fetchRecommendForYou(
          {
            mode: 'next',
            count,
            seedTrackId: seedSong?.id,
            seedTitle: seedSong?.name,
            seedArtist: seedSong?.artist,
            exclude: excludeIds,
          },
          this.buildRequestHeaders(true)
        )
        return res.tracks
      } catch {
        return []
      }
    },

    setPersonalizationEnabled(enabled: boolean) {
      this.personalizationEnabled = enabled
      if (!enabled) {
        pendingQueue = []
      } else {
        this.ensureAnonId()
      }
    },

    async clearAllRecommendationProfile(): Promise<boolean> {
      pendingQueue = []
      const headers = this.buildRequestHeaders(false)
      // 若之前关闭了个性化但存在旧 anonId，也一并带上删除服务端残留记录
      if (this.anonId && !headers['X-Sonic-Anon-Id']) {
        headers['X-Sonic-Anon-Id'] = this.anonId
        delete headers['X-Sonic-Personalization']
      }
      const ok = await deleteSonicEvents(headers)
      this.dislikedTracks = []
      this.anonId = this.personalizationEnabled ? generateAnonId() : ''
      return ok
    },
  },

  persist: piniaPersistConfig<RecommendStoreState>('recommend', [
    'personalizationEnabled',
    'autoDjEnabled',
    'anonId',
    'dislikedTracks',
  ]),
})

// 页面卸载/切后台时把防抖窗口内未上报的事件立即冲刷出去。
// postSonicEvents 使用 fetch keepalive,页面关闭后浏览器仍会完成发送。
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const flushPendingOnHide = () => {
    try {
      if (pendingQueue.length === 0) return
      const store = useRecommendStore()
      if (!store.personalizationEnabled) return
      const batch = [...pendingQueue]
      pendingQueue = []
      postSonicEvents(batch, store.buildRequestHeaders(false))
    } catch {
      // pinia 尚未安装(测试/SSR)时静默跳过
    }
  }
  window.addEventListener('pagehide', flushPendingOnHide)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingOnHide()
  })
}
