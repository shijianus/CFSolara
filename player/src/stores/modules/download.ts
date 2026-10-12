import { defineStore } from 'pinia'
import { downloadedMusicDB, type DownloadedSong } from '@/utils/indexedDB'
import type { Song } from '../interface'
import { useAudioStore } from './audio'

export interface QualityChoice {
  level: string // 'lossless' | 'exhigh' | 'standard'
  label: string // 'SQ 无损' | 'HQ 极高' | '标准'
  bitrate: string // 'FLAC 24-bit' | '320kbps' | '128kbps'
  format: string // 'flac' | 'mp3'
  desc: string // '超清无损母带音质 (FLAC / 24-bit)'
  estimatedSize: string // '约 25MB - 50MB'
  streamUrl?: string
}

export const DEFAULT_QUALITY_CHOICES: QualityChoice[] = [
  {
    level: 'lossless',
    label: 'SQ 无损',
    bitrate: 'FLAC 24-bit',
    format: 'flac',
    desc: '母带级超清无损原声，高保真还原细节',
    estimatedSize: '约 25MB - 50MB',
  },
  {
    level: 'exhigh',
    label: 'HQ 极高',
    bitrate: '320kbps MP3',
    format: 'mp3',
    desc: '超清极高品质，声场饱满音质细腻',
    estimatedSize: '约 8MB - 12MB',
  },
  {
    level: 'standard',
    label: '标准',
    bitrate: '128kbps MP3',
    format: 'mp3',
    desc: '标准流畅音质，下载速度快且节省存储',
    estimatedSize: '约 3MB - 5MB',
  },
]

export const useDownloadStore = defineStore('download', {
  state: () => ({
    downloadedList: [] as DownloadedSong[],
    isLoading: false,
    isDownloading: false,
    downloadingId: null as string | number | null,
    dialogVisible: false,
    currentDownloadSong: null as Song | null,
    errorMsg: null as string | null,
  }),

  getters: {
    totalCount: (state) => state.downloadedList.length,
    totalSizeBytes: (state) =>
      state.downloadedList.reduce((sum, item) => sum + (item.fileSize || 0), 0),
    totalSizeFormatted(): string {
      const bytes = this.totalSizeBytes
      if (bytes === 0) return '0 B'
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
    },
    isSongDownloaded: (state) => (id: string | number) => {
      return state.downloadedList.some((item) => String(item.id) === String(id))
    },
  },

  actions: {
    /** 加载本地已下载歌曲列表 */
    async loadDownloads() {
      this.isLoading = true
      try {
        const list = await downloadedMusicDB.getAll()
        this.downloadedList = list.sort((a, b) => (b.downloadTime || 0) - (a.downloadTime || 0))
      } catch (err) {
        console.error('[DownloadStore] Failed to load downloaded songs:', err)
      } finally {
        this.isLoading = false
      }
    },

    /** 打开音质选择下载弹窗 */
    openDownloadDialog(song: Song) {
      this.currentDownloadSong = song
      this.errorMsg = null
      this.dialogVisible = true
    },

    /** 关闭下载弹窗 */
    closeDownloadDialog() {
      this.dialogVisible = false
      this.currentDownloadSong = null
      this.errorMsg = null
    },

    /**
     * 触发下载并存入本地 IndexedDB，同时唤起浏览器文件另存为
     */
    async startDownload(song: Song, qualityChoice: QualityChoice) {
      if (!song) return
      this.isDownloading = true
      this.downloadingId = song.id
      this.errorMsg = null

      try {
        const brMap: Record<string, string> = {
          lossless: 'lossless',
          exhigh: '320',
          standard: '128',
        }
        const br = brMap[qualityChoice.level] || '320'

        // 优先使用歌曲自带对应音质的 streamUrl
        let streamUrl = ''
        const found = song.qualities?.find((q) => q.level === qualityChoice.level)
        if (found && found.streamUrl) {
          streamUrl = found.streamUrl
        } else {
          streamUrl = `/api/music/stream?id=${encodeURIComponent(String(song.id))}&source=netease&br=${br}&title=${encodeURIComponent(song.name || '')}&artist=${encodeURIComponent(song.artist || '')}`
        }

        // 1. 获取音频二进制 Blob
        const response = await fetch(streamUrl)
        if (!response.ok) {
          throw new Error(`音频流请求失败 HTTP ${response.status}`)
        }
        const blob = await response.blob()

        // 2. 格式与文件名规范
        const isFlac =
          qualityChoice.level === 'lossless' ||
          blob.type.includes('flac') ||
          streamUrl.includes('flac')
        const ext = isFlac ? 'flac' : 'mp3'
        const badgeLabel = qualityChoice.level === 'lossless' ? 'SQ' : qualityChoice.level === 'exhigh' ? 'HQ' : '标准'

        const safeArtist = (song.artist || '未知歌手').replace(/[\\/:*?"<>|]/g, '_')
        const safeTitle = (song.name || '未知歌曲').replace(/[\\/:*?"<>|]/g, '_')
        const fileName = `${safeArtist} - ${safeTitle} [${badgeLabel}].${ext}`

        // 3. 持久化存储至 IndexedDB
        const downloadedSong: DownloadedSong = {
          id: song.id,
          name: song.name,
          artist: song.artist,
          album: song.album || '',
          duration: song.duration ? song.duration / 1000 : 0,
          cover: song.cover || '',
          qualityLevel: qualityChoice.level,
          qualityBadge: badgeLabel,
          bitrate: qualityChoice.bitrate,
          format: ext,
          fileSize: blob.size,
          file: blob,
          downloadTime: Date.now(),
          streamUrl,
        }

        await downloadedMusicDB.add(downloadedSong)

        // 4. 更新内存状态
        const existingIdx = this.downloadedList.findIndex((item) => String(item.id) === String(song.id))
        if (existingIdx >= 0) {
          this.downloadedList.splice(existingIdx, 1, downloadedSong)
        } else {
          this.downloadedList.unshift(downloadedSong)
        }

        // 5. 唤起浏览器本地文件保存
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000)

        // 关闭弹窗
        this.closeDownloadDialog()
      } catch (err: any) {
        console.error('[DownloadStore] Download failed:', err)
        this.errorMsg = err?.message || '下载失败，请检查网络或更换音质'
        throw err
      } finally {
        this.isDownloading = false
        this.downloadingId = null
      }
    },

    /** 从本地下载列表删除 */
    async deleteDownload(id: string | number) {
      try {
        await downloadedMusicDB.delete(id)
        this.downloadedList = this.downloadedList.filter((item) => String(item.id) !== String(id))
      } catch (err) {
        console.error('[DownloadStore] Failed to delete download:', err)
      }
    },

    /** 清空所有下载 */
    async clearDownloads() {
      try {
        await downloadedMusicDB.clear()
        this.downloadedList = []
      } catch (err) {
        console.error('[DownloadStore] Failed to clear downloads:', err)
      }
    },

    /** 离线播放已下载音乐 */
    playDownloaded(downloadedSong: DownloadedSong) {
      const audioStore = useAudioStore()
      const blobUrl = URL.createObjectURL(downloadedSong.file)
      const songItem: Song = {
        id: downloadedSong.id,
        name: downloadedSong.name,
        artist: downloadedSong.artist,
        album: downloadedSong.album,
        duration: (downloadedSong.duration || 0) * 1000,
        cover: downloadedSong.cover,
        url: blobUrl,
        isLocal: true,
        qualityBadge: downloadedSong.qualityBadge,
        qualities: [
          {
            level: downloadedSong.qualityLevel,
            label: downloadedSong.qualityBadge,
            bitrate: downloadedSong.bitrate || '',
            format: downloadedSong.format,
          },
        ],
      }
      audioStore.playSong(songItem, 0)
    },
  },
})
