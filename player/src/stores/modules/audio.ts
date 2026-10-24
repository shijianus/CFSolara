/**
 * 音频播放器 Store
 * 核心模块：管理音频播放、播放列表、播放模式、音量等全部播放器状态
 */
import { defineStore } from 'pinia'
import { songUrlV1 } from '@/api'
import { Song, PlayMode, AudioStoreState } from '../interface'
import { useSettingsStore } from './settings'
import { useToastStore } from './toast'
import i18n from '@/languages'
import piniaPersistConfig from '../persist'

/** 全局 Audio 单例（整个应用只创建一个 HTMLAudioElement） */
let globalAudio: HTMLAudioElement | null = null
/** 标记事件是否已绑定，防止重复监听 */
let eventsBound = false
/** 链接过期自动重试节流：记录上次重试的歌曲 ID，避免短时间重复刷新 */
let lastRetrySongId: string | number | null = null
/** 上次重试时间戳 */
let lastRetryTime = 0
/** 标记当前播放歌曲是否已触发过下一首预加载，避免重复发起 */
let hasPreloadedNext = false

type PlaybackErrorKind = 'network' | 'source' | 'copyright'

/** 将媒体错误/播放异常归类为网络、音源不可用或版权受限 */
const classifyPlaybackError = (error?: MediaError | Error | null): PlaybackErrorKind => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'network'
  const mediaError = error as MediaError | null
  if (mediaError && typeof mediaError.code === 'number') {
    if (mediaError.code === 2) return 'network'
    if (mediaError.code === 3) return 'source'
    // 媒体源不受支持/被拒绝：非本地源优先按版权受限提示
    if (mediaError.code === 4) return 'copyright'
  }
  const msg = String((error as Error | null)?.message || '').toLowerCase()
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout') || msg.includes('offline')) {
    return 'network'
  }
  if (msg.includes('403') || msg.includes('404') || msg.includes('copyright') || msg.includes('版权')) {
    return 'copyright'
  }
  return 'source'
}

let lastPlaybackToastId: number | null = null
let lastPlaybackToastKey = ''
let lastPlaybackToastAt = 0

/** 获取 Audio 单例（懒初始化） */
const getAudioSingleton = (): HTMLAudioElement => {
  if (!globalAudio) {
    globalAudio = new Audio()
    // 允许跨域，以便 AudioContext 进行音频可视化分析
    globalAudio.crossOrigin = 'anonymous'
    globalAudio.id = 'audioPlayer'
    if (typeof document !== 'undefined') {
      const attachAudio = () => {
        if (!document.getElementById('audioPlayer') && document.body) {
          document.body.appendChild(globalAudio)
        }
      }
      if (document.body) {
        attachAudio()
      } else {
        document.addEventListener('DOMContentLoaded', attachAudio, { once: true })
      }
    }
    if (typeof window !== 'undefined') {
      ;(window as any).__audioPlayer = globalAudio
      ;(window as any).__sonicAudio = globalAudio
    }
  }
  return globalAudio
}

/**
 * Fisher-Yates 洗牌算法 —— 随机打乱数组
 * @param array 待打乱的数组
 * @returns 打乱后的新数组（不修改原数组）
 */
const shuffleArray = <T>(array: T[]): T[] => {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export const useAudioStore = defineStore('audio', {
  state: (): AudioStoreState => ({
    // 全局计数器
    count: 0,
    // 音频播放器状态
    audio: {
      // 音频实例
      audio: null,
      // 是否正在播放
      isPlaying: false,
      // 是否已暂停
      isPaused: false,
      // 是否正在加载
      isLoading: false,
      // 当前播放的歌曲
      currentSong: null,
      // 当前歌曲在播放列表中的索引
      currentIndex: -1,
      // 当前播放列表
      playlist: [] as Song[],
      // 原始播放列表（用于随机模式恢复）
      originalPlaylist: [],
      // 播放模式（列表循环/单曲循环/随机播放）
      playMode: PlayMode.LIST,
      // 音量大小（0-1）
      volume: 1,
      // 是否静音
      isMuted: false,
      // 当前播放时间（秒）
      currentTime: 0,
      // 歌曲总时长（秒）
      duration: 0,
      // 播放历史记录
      playHistory: [],
      // 错误信息
      error: null,
      // 记录静音前的音量
      previousVolume: 1,
    },
  }),

  getters: {
    // 获取当前播放的歌曲
    getCurrentSong: (state): Song | null => state.audio.currentSong,
    // 获取播放状态
    getIsPlaying: (state): boolean => state.audio.isPlaying,
    // 获取播放列表
    getPlaylist: (state): Song[] => state.audio.playlist,
    // 获取播放模式
    getPlayMode: (state): PlayMode => state.audio.playMode,
    // 获取音量
    getVolume: (state): number => state.audio.volume,
    // 获取是否静音
    getIsMuted: (state): boolean => state.audio.isMuted,
    // 获取当前播放时间
    getCurrentTime: (state): number => state.audio.currentTime,
    // 获取歌曲总时长
    getDuration: (state): number => state.audio.duration,
    // 获取播放进度百分比
    getProgress: (state): number => {
      return state.audio.duration > 0 ? (state.audio.currentTime / state.audio.duration) * 100 : 0
    },

    // 检查是否有下一首/上一首
    hasNext: (state): boolean => {
      if (state.audio.playMode === PlayMode.SINGLE) return true
      return state.audio.currentIndex < state.audio.playlist.length - 1
    },
    hasPrevious: (state): boolean => {
      if (state.audio.playMode === PlayMode.SINGLE) return true
      return state.audio.currentIndex > 0
    },
  },

  actions: {
    // 初始化音频播放器
    initAudio() {
      if (!this.audio.audio) {
        this.audio.audio = getAudioSingleton()
        this.setupAudioEvents()
        // 如果有歌曲的情况下
        if (this.audio.playlist.length > 0) {
          const index =
            typeof this.audio.currentIndex === 'number' &&
            this.audio.currentIndex >= 0 &&
            this.audio.currentIndex < this.audio.playlist.length
              ? this.audio.currentIndex
              : 0
          this.audio.currentIndex = index
          this.audio.currentSong = this.audio.playlist[index]
          this.audio.audio.src = (this.audio.currentSong && this.audio.currentSong.url) || ''
          this.audio.audio.load()
        }
        //
      }
    },

    // 设置音频事件监听
    setupAudioEvents() {
      if (!this.audio.audio) return
      if (eventsBound) return

      const audio = this.audio.audio

      // 播放开始
      audio.addEventListener('play', () => {
        this.audio.isPlaying = true
        this.audio.isPaused = false
        this.audio.error = null
        this._dismissPlaybackErrorToast()
      })

      // 播放暂停
      audio.addEventListener('pause', () => {
        // waiting 导致的暂停不更新状态，等待自动恢复
        if (!this.audio._isWaiting) {
          this.audio.isPlaying = false
          this.audio.isPaused = true
        }
      })

      // 播放结束
      audio.addEventListener('ended', () => {
        this.audio.isPlaying = false
        this.audio._isWaiting = false
        this.handleSongEnd()
      })

      // 加载开始
      audio.addEventListener('loadstart', () => {
        this.audio.isLoading = true
      })

      // 可以播放
      audio.addEventListener('canplay', () => {
        this.audio.isLoading = false
        this.audio.duration = audio.duration || 0
      })

      // 缓冲等待：网络慢或缓冲不足时触发
      audio.addEventListener('waiting', () => {
        this.audio._isWaiting = true
        this.audio.isLoading = true
      })

      // 实际开始播放（缓冲恢复后也会触发）
      audio.addEventListener('playing', () => {
        this.audio._isWaiting = false
        this.audio.isLoading = false
        this.audio.isPlaying = true
        this.audio.isPaused = false
      })

      // 网络数据获取停滞
      audio.addEventListener('stalled', () => {
        console.warn('Audio stalled: 网络数据获取停滞')
      })

      // 时间更新
      audio.addEventListener('timeupdate', () => {
        const cur = audio.currentTime || 0
        this.audio.currentTime = cur
        const dur = audio.duration || 0
        // 主动预判：当播放剩余时间少于 15 秒且非重复触发时，后台静默预解析下一首歌曲地址
        if (dur > 25 && dur - cur < 15 && !hasPreloadedNext) {
          hasPreloadedNext = true
          this.preloadNextTrack()
        }
      })

      // 音量变化
      audio.addEventListener('volumechange', () => {
        this.audio.volume = audio.volume
        this.audio.isMuted = audio.muted
      })

      // 错误处理
      audio.addEventListener('error', (e: any) => {
        this.audio.isLoading = false
        this.audio.isPlaying = false
        this._reportPlaybackError(audio.error || e)
        console.error('Audio error:', e)
        // 触发一次刷新播放地址并重试，10秒内同一歌曲仅重试一次
        const now = Date.now()
        const id = this.audio.currentSong?.id ?? null
        if (id && (!lastRetrySongId || lastRetrySongId !== id || now - lastRetryTime > 10000)) {
          lastRetrySongId = id as any
          lastRetryTime = now
          this.refreshAndReplay()
        }
      })
      eventsBound = true
    },

    /** 播放歌曲（自动获取缺失的播放地址） */
    async playSong(song?: Song, index?: number, force = false) {
      this.initAudio()

      const prevSong = this.audio.currentSong
      const prevIndex = this.audio.currentIndex
      // 判定是否正在切换歌曲：显式 force，或者传入了不同歌曲对象/不同索引/不同 ID/不同 URL
      const isSwitchingSong =
        force ||
        !!(
          song &&
          (!prevSong ||
            (index !== undefined && index !== prevIndex) ||
            song.id !== prevSong.id ||
            (song.url && prevSong.url && song.url !== prevSong.url))
        )

      if (song && index !== undefined) {
        this.audio.currentSong = song
        this.audio.currentIndex = index
      }

      if (!this.audio.currentSong || !this.audio.audio) return

      const audio = this.audio.audio
      const currentAudioSrc = audio.getAttribute('src') || audio.src
      const resolvedTargetUrl =
        this.audio.currentSong.url && typeof window !== 'undefined'
          ? new URL(this.audio.currentSong.url, window.location.href).href
          : this.audio.currentSong.url
      const isSrcUnchanged =
        !force &&
        !isSwitchingSong &&
        !!currentAudioSrc &&
        !!this.audio.currentSong.url &&
        (currentAudioSrc === this.audio.currentSong.url || audio.src === resolvedTargetUrl)

      const isAtEnd =
        audio.ended || (audio.duration > 0 && audio.currentTime >= audio.duration - 0.1)

      // 同一首歌播放结束后重新点击播放，重置到开头从头播放
      if (!isSwitchingSong && isSrcUnchanged && isAtEnd) {
        audio.currentTime = 0
        this.audio.currentTime = 0
      }

      // 同一首歌、audio.src 未变、currentTime > 0 且未播完时，从暂停恢复播放，不重载、不重设 src、不归零
      if (!isSwitchingSong && isSrcUnchanged && audio.currentTime > 0 && !isAtEnd) {
        const resumeTime = audio.currentTime || this.audio.currentTime || 0
        let shouldFallbackReload = false

        // 检查媒体状态是否异常（抛错、error、readyState 为 0、或 networkState 为 NETWORK_NO_SOURCE 即 3）
        if (audio.error || audio.readyState === 0 || audio.networkState === 3) {
          shouldFallbackReload = true
        } else {
          try {
            this.audio.error = null
            await audio.play()
            if (audio.error || audio.readyState === 0 || audio.networkState === 3) {
              shouldFallbackReload = true
            } else {
              return
            }
          } catch (error) {
            console.warn('Resume play failed, triggering fallback reload:', error)
            shouldFallbackReload = true
          }
        }

        // 失败兜底：强制重载音频源并在 loadedmetadata 后尝试恢复暂停进度，确保播放不卡死
        if (shouldFallbackReload) {
          try {
            this.audio.isLoading = true
            if (resumeTime > 0) {
              const restoreProgress = () => {
                try {
                  if (audio.duration && audio.duration > 0) {
                    audio.currentTime = Math.min(resumeTime, audio.duration)
                  } else {
                    audio.currentTime = resumeTime
                  }
                } catch (_) {}
              }
              audio.addEventListener('loadedmetadata', restoreProgress, { once: true })
            }
            this._loadAudioSrc(this.audio.currentSong.url || '', true)
            await audio.play()
            this.audio.error = null
            return
          } catch (reloadErr) {
            console.error('Fallback reload and resume error, attempting restart from 0:', reloadErr)
            try {
              audio.currentTime = 0
              this.audio.currentTime = 0
              await audio.play()
              this.audio.error = null
              return
            } catch (finalErr) {
              console.error('Final play attempt error:', finalErr)
              const id = this.audio.currentSong?.id ?? null
              if (id) this.refreshAndReplay()
              return
            }
          } finally {
            this.audio.isLoading = false
          }
        }
      }

      try {
        this.audio.error = null
        this.audio.isLoading = true

        // 若无 URL 则拉取（本地音乐除外）
        if (!this.audio.currentSong.url && !this.audio.currentSong.isLocal) {
          await this._fetchAndApplyUrl()
        }

        if (!this.audio.currentSong.url) {
          throw new Error('无法获取播放地址')
        }

        // 切歌时复位进度到开头，强制更新音频源，并重置预加载状态
        if (isSwitchingSong) {
          hasPreloadedNext = false
          audio.currentTime = 0
          this.audio.currentTime = 0
        }
        this._loadAudioSrc(this.audio.currentSong.url || '', isSwitchingSong)
        await this.audio.audio.play()

        // 添加到播放历史
        this.addToHistory(this.audio.currentSong)
      } catch (error: any) {
        this.audio.isPlaying = false
        this._reportPlaybackError(error)
        console.error('Play error:', error)
        // 播放失败时也尝试刷新 URL 后重试
        const id = this.audio.currentSong?.id ?? null
        if (id && !this.audio.currentSong.isLocal) {
          await this.refreshAndReplay()
        }
      } finally {
        this.audio.isLoading = false
      }
    },

    /**
     * 刷新当前歌曲的播放地址并重试播放
     * 用于链接过期等场景的自动恢复
     */
    async refreshAndReplay() {
      if (!this.audio.currentSong || !this.audio.audio) return
      if (this.audio.currentSong.isLocal) return

      this.audio.isLoading = true
      try {
        await this._fetchAndApplyUrl()
        if (!this.audio.currentSong.url) return
        this._loadAudioSrc(this.audio.currentSong!.url || '')
        await this.audio.audio!.play()
        this.audio.error = null
      } catch (e) {
        console.error('Refresh url failed:', e)
        this._reportPlaybackError(e as Error)
      } finally {
        this.audio.isLoading = false
      }
    },

    /**
     * 智能预解析下一首歌曲播放地址
     * 实现用户切歌或歌曲自然结束时 0 延迟瞬时起播
     */
    async preloadNextTrack() {
      if (!this.audio.playlist.length) return
      let nextIndex = this.audio.currentIndex + 1
      if (nextIndex >= this.audio.playlist.length) {
        if (this.audio.playMode === PlayMode.LIST) {
          nextIndex = 0
        } else {
          return
        }
      }
      const nextSong = this.audio.playlist[nextIndex]
      if (nextSong && !nextSong.url && !nextSong.isLocal) {
        try {
          await this._fetchAndApplyUrl(nextSong)
        } catch {}
      }
    },

    /**
     * 内部方法：获取歌曲播放地址并同步到 currentSong 和 playlist
     * 抽取自 playSong 和 refreshAndReplay 的公共逻辑，支持传入目标歌曲进行预解析
     */
    async _fetchAndApplyUrl(targetSong?: Song) {
      const song = targetSong || this.audio.currentSong
      if (!song) return
      const settingsStore = useSettingsStore()
      let url = ''
      try {
        const res: any = await songUrlV1({
          id: String(song.id),
          level: settingsStore.audioQuality,
        })
        url = res?.data?.[0]?.url || res?.data?.data?.[0]?.url || res?.url || ''
      } catch {}

      // Sonic 多源聚合网关智能兜底
      if (!url) {
        url = `/api/music/stream?id=${encodeURIComponent(String(song.id))}&source=netease`
      }

      song.url = url
      // 同步到播放列表对应项
      const idx = this.audio.playlist.findIndex(p => p.id === song.id)
      if (idx !== -1) {
        this.audio.playlist[idx].url = url
      }
    },

    /**
     * 内部方法：当 URL 变化（或 force=true 强制）时重新加载音频源
     */
    _loadAudioSrc(url: string, force = false) {
      if (!this.audio.audio) return
      const currentSrc = this.audio.audio.src
      const resolved =
        url && typeof window !== 'undefined' ? new URL(url, window.location.href).href : url
      if (force || (currentSrc !== resolved && this.audio.audio.getAttribute('src') !== url)) {
        this.audio.audio.src = url
        this.audio.audio.load()
      }
    },

    // 暂停播放
    pause() {
      if (this.audio.audio && this.audio.isPlaying) {
        this.audio.audio.pause()
      }
    },

    // 继续播放
    resume() {
      if (this.audio.audio) {
        this.audio.audio.play()
      }
    },

    // 播放/暂停切换（启动播放时会自动获取缺失的URL）
    togglePlay() {
      this.initAudio()
      if (!this.audio.audio) return

      if (this.audio.isPlaying) {
        this.pause()
      } else {
        if (!this.audio.currentSong && this.audio.playlist.length > 0) {
          this.audio.currentSong = this.audio.playlist[0]
          this.audio.currentIndex = 0
        }
        if (this.audio.currentSong) {
          // 统一通过 playSong 执行，确保缺失URL的懒加载
          this.playSong(this.audio.currentSong, this.audio.currentIndex)
        }
      }
    },

    // 下一首
    nextSong(isAutoEnd = false) {
      if (this.audio.playlist.length === 0) return

      let nextIndex = this.audio.currentIndex

      // 如果是单曲播放结束触发的自动切歌，单曲循环模式下重播当前歌曲
      if (isAutoEnd && this.audio.playMode === PlayMode.SINGLE) {
        this.playSong(this.audio.currentSong!, this.audio.currentIndex, true)
        return
      }

      switch (this.audio.playMode) {
        case PlayMode.RANDOM:
          // 随机播放
          const availableIndexes = this.audio.playlist
            .map((_: any, index: any) => index)
            .filter((index: any) => index !== this.audio.currentIndex)

          if (availableIndexes.length > 0) {
            nextIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)]
          } else {
            nextIndex = 0
          }
          break

        case PlayMode.SINGLE:
        case PlayMode.LIST:
        default:
          // 列表循环（单曲循环下手动点击下一首也切换到下一首）
          nextIndex = (this.audio.currentIndex + 1) % this.audio.playlist.length
          break
      }

      const nextSong = this.audio.playlist[nextIndex]
      if (nextSong) {
        this.playSong(nextSong, nextIndex, true)
      }
    },

    // 上一首
    previousSong() {
      if (this.audio.playlist.length === 0) return

      let prevIndex = this.audio.currentIndex

      switch (this.audio.playMode) {
        case PlayMode.RANDOM:
          // 随机播放 - 从历史记录中获取上一首
          if (this.audio.playHistory.length > 1) {
            const prevSong = this.audio.playHistory[this.audio.playHistory.length - 2]
            const foundIdx = this.audio.playlist.findIndex(
              (song: { id: any }) => song.id === prevSong.id
            )
            prevIndex =
              foundIdx !== -1 ? foundIdx : Math.floor(Math.random() * this.audio.playlist.length)
          } else {
            // 如果没有历史记录，随机选择
            prevIndex = Math.floor(Math.random() * this.audio.playlist.length)
          }
          break

        case PlayMode.SINGLE:
        case PlayMode.LIST:
        default:
          // 列表循环（单曲循环下手动点击上一首也切换到上一首）
          prevIndex =
            this.audio.currentIndex <= 0
              ? this.audio.playlist.length - 1
              : this.audio.currentIndex - 1
          break
      }

      const prevSong = this.audio.playlist[prevIndex]
      if (prevSong) {
        this.playSong(prevSong, prevIndex, true)
      }
    },

    // 处理歌曲播放结束
    handleSongEnd() {
      switch (this.audio.playMode) {
        case PlayMode.SINGLE:
          // 单曲循环
          this.playSong(this.audio.currentSong!, this.audio.currentIndex, true)
          break

        case PlayMode.LIST:
        case PlayMode.RANDOM:
        default:
          // 列表循环或随机播放
          this.nextSong(true)
          break
      }
    },

    /** 循环切换播放模式：列表循环 → 单曲循环 → 随机播放 */
    togglePlayMode() {
      const modes = [PlayMode.LIST, PlayMode.SINGLE, PlayMode.RANDOM]
      const currentIndex = modes.indexOf(this.audio.playMode)
      const nextIndex = (currentIndex + 1) % modes.length
      this.setPlayMode(modes[nextIndex])
    },

    /** 设置播放模式（随机模式自动打乱列表，切出时恢复原始顺序） */
    setPlayMode(mode: PlayMode) {
      this.audio.playMode = mode

      if (mode === PlayMode.RANDOM) {
        this.shufflePlaylist()
      } else if (this.audio.originalPlaylist.length > 0) {
        this._restoreOriginalPlaylist()
      }
    },

    /** 打乱播放列表（保留原始顺序的备份） */
    shufflePlaylist() {
      if (this.audio.playlist.length === 0) return

      // 首次打乱时保存原始顺序
      if (this.audio.originalPlaylist.length === 0) {
        this.audio.originalPlaylist = [...this.audio.playlist]
      }

      this.audio.playlist = shuffleArray(this.audio.playlist)
      this._syncCurrentIndex()
    },

    /** 内部方法：恢复原始播放列表顺序 */
    _restoreOriginalPlaylist() {
      this.audio.playlist = [...this.audio.originalPlaylist]
      this._syncCurrentIndex()
    },

    /** 内部方法：根据当前歌曲同步 currentIndex */
    _syncCurrentIndex() {
      if (this.audio.currentSong) {
        this.audio.currentIndex = this.audio.playlist.findIndex(
          (song: { id: any }) => song.id === this.audio.currentSong!.id
        )
      }
    },

    /** 切换当前播放歌曲的音质等级并平滑无缝恢复播放进度 */
    async switchQuality(targetLevel: string) {
      if (!this.audio.currentSong || !this.audio.audio) return
      if (this.audio.currentSong.isLocal) return

      const currentTime = this.audio.audio.currentTime || 0
      const wasPlaying = this.audio.isPlaying

      // 查找对应音质配置
      const qualityOpt = this.audio.currentSong.qualities?.find(q => q.level === targetLevel)
      let newUrl = qualityOpt?.streamUrl || ''

      const brMap: Record<string, string> = {
        lossless: 'lossless',
        exhigh: '320',
        standard: '128',
      }
      const br = brMap[targetLevel] || '320'

      if (!newUrl) {
        newUrl = `/api/music/stream?id=${encodeURIComponent(String(this.audio.currentSong.id))}&source=netease&br=${br}&title=${encodeURIComponent(this.audio.currentSong.name || '')}&artist=${encodeURIComponent(this.audio.currentSong.artist || '')}`
      }

      this.audio.currentSong.url = newUrl
      const badgeMap: Record<string, string> = {
        lossless: 'SQ',
        exhigh: 'HQ',
        standard: '标准',
      }
      if (badgeMap[targetLevel]) {
        this.audio.currentSong.qualityBadge = badgeMap[targetLevel]
      }

      // 同步到播放列表
      const idx = this.audio.currentIndex
      if (idx >= 0 && idx < this.audio.playlist.length) {
        this.audio.playlist[idx].url = newUrl
        this.audio.playlist[idx].qualityBadge = this.audio.currentSong.qualityBadge
      }

      this.audio.isLoading = true
      try {
        this._loadAudioSrc(newUrl)
        this.audio.audio.currentTime = currentTime
        if (wasPlaying) {
          await this.audio.audio.play()
        }
      } catch (err) {
        console.error('Switch quality failed:', err)
      } finally {
        this.audio.isLoading = false
      }
    },

    // 设置音量
    setVolume(volume: number) {
      if (this.audio.audio) {
        this.audio.audio.volume = Math.max(0, Math.min(1, volume))
        this.audio.volume = this.audio.audio.volume
      }
    },

    // 静音切换
    toggleMute() {
      if (this.audio.audio) {
        if (this.audio.audio.muted) {
          // 恢复静音前的音量
          this.audio.audio.muted = false
          this.audio.isMuted = false
          this.setVolume(this.audio.previousVolume || 1)
        } else {
          // 开启静音，记录当前音量
          this.audio.previousVolume = this.audio.volume
          this.audio.audio.muted = true
          this.audio.isMuted = true
          this.setVolume(0)
        }
      }
    },

    // 设置播放进度
    setCurrentTime(time: number) {
      const validTime = Math.max(0, time)
      if (this.audio.audio) {
        try {
          const maxTime = this.audio.duration > 0 ? this.audio.duration : validTime
          this.audio.audio.currentTime = Math.min(maxTime, validTime)
        } catch {}
      }
      this.audio.currentTime = validTime
    },

    // 设置播放进度（百分比）
    setProgress(progress: number) {
      if (this.audio.duration > 0) {
        const time = (progress / 100) * this.audio.duration
        this.setCurrentTime(time)
      }
    },

    // 添加歌曲到播放列表
    addSong(song: Song) {
      const exists = this.audio.playlist.find((s: { id: string | number }) => s.id === song.id)
      if (!exists) {
        this.audio.playlist.push(song)
        if (this.audio.originalPlaylist.length > 0) {
          this.audio.originalPlaylist.push(song)
        }
      }
    },

    // 添加多首歌曲
    addSongs(songs: Song[]) {
      songs.forEach(song => this.addSong(song))
    },

    // 移动歌曲位置
    moveSong(fromIndex: number, toIndex: number) {
      if (fromIndex === toIndex) return
      if (fromIndex < 0 || fromIndex >= this.audio.playlist.length) return
      if (toIndex < 0 || toIndex >= this.audio.playlist.length) return
      const move = (arr: Song[]) => {
        const item = arr.splice(fromIndex, 1)[0]
        arr.splice(toIndex, 0, item)
      }
      move(this.audio.playlist)
      if (this.audio.originalPlaylist.length === this.audio.playlist.length)
        move(this.audio.originalPlaylist)
      if (this.audio.currentIndex === fromIndex) {
        this.audio.currentIndex = toIndex
      } else if (fromIndex < this.audio.currentIndex && toIndex >= this.audio.currentIndex) {
        this.audio.currentIndex -= 1
      } else if (fromIndex > this.audio.currentIndex && toIndex <= this.audio.currentIndex) {
        this.audio.currentIndex += 1
      }
    },

    // 将指定歌曲排到下一首播放
    queueNext(songId: string | number) {
      if (this.audio.playlist.length === 0) return
      const idx = this.audio.playlist.findIndex((s: { id: string | number }) => s.id === songId)
      if (idx === -1) return
      const target = Math.min(this.audio.currentIndex + 1, this.audio.playlist.length - 1)
      this.moveSong(idx, target)
    },

    // 批量删除歌曲
    removeSongs(ids: Array<string | number>) {
      ids.forEach(id => this.removeSong(id))
    },

    // 从播放列表删除歌曲
    removeSong(songId: string | number) {
      const index = this.audio.playlist.findIndex(
        (song: { id: string | number }) => song.id === songId
      )
      if (index !== -1) {
        this.audio.playlist.splice(index, 1)

        // 同时从原始播放列表删除
        const originalIndex = this.audio.originalPlaylist.findIndex(
          (song: { id: string | number }) => song.id === songId
        )
        if (originalIndex !== -1) {
          this.audio.originalPlaylist.splice(originalIndex, 1)
        }

        // 如果删除的是当前播放的歌曲
        if (index === this.audio.currentIndex) {
          if (this.audio.playlist.length > 0) {
            // 播放下一首
            const nextIndex = Math.min(index, this.audio.playlist.length - 1)
            this.playSong(this.audio.playlist[nextIndex], nextIndex)
          } else {
            // 没有歌曲了，停止播放
            this.stop()
          }
        } else if (index < this.audio.currentIndex) {
          // 如果删除的歌曲在当前歌曲之前，更新索引
          this.audio.currentIndex--
        }
      }
    },

    // 清空播放列表
    clearPlaylist() {
      this.stop()
      this.audio.playlist = []
      this.audio.originalPlaylist = []
      this.audio.currentSong = null
      this.audio.currentIndex = -1
    },

    // 设置播放列表
    setPlaylist(songs: Song[], startIndex: number = 0) {
      this.audio.playlist = [...songs]
      this.audio.originalPlaylist = [...songs]

      // 只设置当前歌曲和索引，不自动播放
      if (songs.length > 0 && startIndex >= 0 && startIndex < songs.length) {
        this.audio.currentSong = songs[startIndex]
        this.audio.currentIndex = startIndex
      }
    },

    // 播放指定索引的歌曲
    playByIndex(index: number) {
      if (index >= 0 && index < this.audio.playlist.length) {
        const isCurrent = index === this.audio.currentIndex
        this.playSong(this.audio.playlist[index], index, !isCurrent)
      }
    },

    // 停止播放
    stop() {
      if (this.audio.audio) {
        this.audio.audio.pause()
        this.audio.audio.currentTime = 0
      }
      this.audio.isPlaying = false
      this.audio.isPaused = false
      this.audio.currentTime = 0
    },

    // 添加到播放历史
    addToHistory(song: Song) {
      // 移除已存在的相同歌曲（避免重复）
      const existingIndex = this.audio.playHistory.findIndex(
        (s: { id: string | number }) => s.id === song.id
      )

      if (existingIndex !== -1) {
        this.audio.playHistory.splice(existingIndex, 1)
      }

      // 添加到历史记录末尾
      this.audio.playHistory.push(song)

      // 限制历史记录数量
      if (this.audio.playHistory.length > 100) {
        this.audio.playHistory.shift()
      }
    },

    // 清空播放历史
    clearHistory() {
      this.audio.playHistory = []
    },

    /** 播放失败：写入 audio.error 并弹出全局 Toast（重试/下一首），同类错误节流 10 秒 */
    _reportPlaybackError(error?: MediaError | Error | null) {
      const kind = classifyPlaybackError(error)
      const message = i18n.global.t(`player.playbackError.${kind}`)
      this.audio.error = message
      this.audio.isLoading = false

      const songId = this.audio.currentSong?.id ?? ''
      const key = `${songId}:${kind}`
      const now = Date.now()
      if (lastPlaybackToastId !== null && key === lastPlaybackToastKey && now - lastPlaybackToastAt < 10000) {
        return
      }
      lastPlaybackToastKey = key
      lastPlaybackToastAt = now
      if (lastPlaybackToastId !== null) {
        useToastStore().dismiss(lastPlaybackToastId)
      }

      lastPlaybackToastId = useToastStore().show({
        message,
        type: 'error',
        duration: 0,
        actions: [
          {
            label: i18n.global.t('common.retry'),
            primary: true,
            handler: () => {
              this.clearError()
              if (this.audio.currentSong) {
                this.playSong(this.audio.currentSong, this.audio.currentIndex, true)
              }
            },
          },
          {
            label: i18n.global.t('player.next'),
            handler: () => {
              this.clearError()
              this.nextSong()
            },
          },
        ],
      })
    },

    /** 播放恢复后关闭残留的播放错误 Toast */
    _dismissPlaybackErrorToast() {
      if (lastPlaybackToastId !== null) {
        useToastStore().dismiss(lastPlaybackToastId)
        lastPlaybackToastId = null
        lastPlaybackToastKey = ''
      }
    },

    // 清除错误信息
    clearError() {
      this.audio.error = null
      this._dismissPlaybackErrorToast()
    },

    // 销毁音频播放器
    destroy() {
      if (this.audio.audio) {
        this.audio.audio.pause()
        this.audio.audio.src = ''
        this.audio.audio = null
      }

      this.audio.isPlaying = false
      this.audio.isPaused = false
      this.audio.isLoading = false
      this.audio.currentSong = null
      this.audio.currentIndex = -1
      this.audio.currentTime = 0
      this.audio.duration = 0
      this.audio.error = null
    },
  },

  persist: piniaPersistConfig('audio', [
    'count',
    'audio.currentSong',
    'audio.currentIndex',
    'audio.playlist',
    'audio.originalPlaylist',
    'audio.playMode',
    'audio.volume',
    'audio.isMuted',
    'audio.playHistory',
  ]),
})
