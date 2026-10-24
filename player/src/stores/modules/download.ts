import { defineStore } from 'pinia'
import { downloadedMusicDB, type DownloadedSong } from '@/utils/indexedDB'
import type { Song } from '../interface'
import { useAudioStore } from './audio'
import { useToastStore } from './toast'
import i18n from '@/languages'

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
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    lastManualSave: null as { blob: Blob; fileName: string } | null,
    abortController: null as AbortController | null,
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

    /** 查询同一首歌是否已下载过指定音质 */
    async findDownloadedByQuality(
      id: string | number,
      qualityLevel: string
    ): Promise<DownloadedSong | null> {
      const inMemory = this.downloadedList.find(
        item => String(item.id) === String(id) && item.qualityLevel === qualityLevel
      )
      if (inMemory) return inMemory
      try {
        const list = await downloadedMusicDB.getAll()
        this.downloadedList = list.sort((a, b) => (b.downloadTime || 0) - (a.downloadTime || 0))
        return (
          this.downloadedList.find(
            item => String(item.id) === String(id) && item.qualityLevel === qualityLevel
          ) || null
        )
      } catch {
        return null
      }
    },

    /** 取消进行中的下载 */
    cancelDownload() {
      this.abortController?.abort()
    },

    /** 浏览器自动保存被拦截/失去用户手势时，由用户点击后重新保存 */
    saveManually() {
      const payload = this.lastManualSave
      if (!payload) return
      this._saveBlob(payload.blob, payload.fileName)
      useToastStore().show({
        message: i18n.global.t('download.saved'),
        type: 'success',
        duration: 3000,
      })
    },

    _saveBlob(blob: Blob, fileName: string) {
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = fileName
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000)
    },

    _canAutoSave(): boolean {
      const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
        .userActivation
      return !activation || activation.isActive !== false
    },

    _fetchBlobWithProgress(
      streamUrl: string,
      signal: AbortSignal,
      onProgress: (loaded: number, total: number) => void
    ): Promise<Blob> {
      return new Promise<Blob>((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'))
          return
        }
        const xhr = new XMLHttpRequest()
        xhr.open('GET', streamUrl)
        xhr.responseType = 'blob'
        xhr.onprogress = event => onProgress(event.loaded, event.lengthComputable ? event.total : 0)
        xhr.onerror = () => reject(new Error(i18n.global.t('download.networkError')))
        xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.response)
          } else {
            reject(
              new Error(
                xhr.status === 403 || xhr.status === 404
                  ? i18n.global.t('download.sourceUnavailable')
                  : `HTTP ${xhr.status}`
              )
            )
          }
        }
        signal.addEventListener('abort', () => xhr.abort(), { once: true })
        xhr.send()
      })
    },

    /**
     * 触发下载并存入本地 IndexedDB；支持进度、取消与手动保存兜底
     */
    async startDownload(
      song: Song,
      qualityChoice: QualityChoice,
      options: { overwrite?: boolean } = {}
    ) {
      if (!song || this.isDownloading) return
      const existing = await this.findDownloadedByQuality(song.id, qualityChoice.level)
      if (existing && !options.overwrite) {
        const err = new Error('DUPLICATE_DOWNLOAD')
        err.name = 'DuplicateDownloadError'
        throw err
      }

      const controller = new AbortController()
      this.abortController = controller
      this.isDownloading = true
      this.downloadingId = song.id
      this.errorMsg = null
      this.downloadProgress = 0
      this.downloadedBytes = 0
      this.totalBytes = 0

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

        // 1. 获取音频二进制 Blob（带进度，可取消）
        const blob = await this._fetchBlobWithProgress(
          streamUrl,
          controller.signal,
          (loaded, total) => {
            this.downloadedBytes = loaded
            this.totalBytes = total
            this.downloadProgress =
              total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0
          }
        )
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
        this.downloadProgress = 100

        // 2. 格式与文件名规范
        const isFlac =
          qualityChoice.level === 'lossless' ||
          blob.type.includes('flac') ||
          streamUrl.includes('flac')
        const ext = isFlac ? 'flac' : 'mp3'
        const badgeLabel =
          qualityChoice.level === 'lossless' ? 'SQ' : qualityChoice.level === 'exhigh' ? 'HQ' : '标准'

        const safeArtist = (song.artist || i18n.global.t('player.unknownArtist')).replace(/[\\/:*?"<>|]/g, '_')
        const safeTitle = (song.name || i18n.global.t('player.unknownSong')).replace(/[\\/:*?"<>|]/g, '_')
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
        const existingIdx = this.downloadedList.findIndex(
          (item) => String(item.id) === String(song.id)
        )
        if (existingIdx >= 0) {
          this.downloadedList.splice(existingIdx, 1, downloadedSong)
        } else {
          this.downloadedList.unshift(downloadedSong)
        }

        // 5. 自动保存；异步请求后可能已失去用户手势，保留手动保存入口
        this.lastManualSave = { blob, fileName }
        const canAutoSave = this._canAutoSave()
        if (canAutoSave) {
          try {
            this._saveBlob(blob, fileName)
          } catch {
            // 浏览器可能拦截自动下载，转入手动保存提示
          }
        }
        useToastStore().show({
          message: canAutoSave
            ? i18n.global.t('download.completed', { name: song.name })
            : i18n.global.t('download.manualSaveRequired'),
          type: canAutoSave ? 'success' : 'warning',
          duration: canAutoSave ? 8000 : 0,
          actions: [
            {
              label: i18n.global.t('download.saveNow'),
              primary: true,
              handler: () => this.saveManually(),
            },
          ],
        })

        // 关闭弹窗
        this.closeDownloadDialog()
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          this.errorMsg = null
          useToastStore().show({
            message: i18n.global.t('download.cancelled'),
            type: 'info',
            duration: 3000,
          })
          return
        }
        console.error('[DownloadStore] Download failed:', err)
        const reason = err?.message || i18n.global.t('download.networkError')
        this.errorMsg = i18n.global.t('download.failed', { reason })
        useToastStore().show({ message: this.errorMsg, type: 'error', duration: 5000 })
        throw err
      } finally {
        this.isDownloading = false
        this.downloadingId = null
        this.abortController = null
      }
    },

    /** 从本地下载列表删除单个 */
    async deleteDownload(id: string | number) {
      try {
        await downloadedMusicDB.delete(id)
        this.downloadedList = this.downloadedList.filter((item) => String(item.id) !== String(id))
      } catch (err) {
        console.error('[DownloadStore] Failed to delete download:', err)
      }
    },

    /** 批量删除多个已下载项目 */
    async deleteMultiple(ids: (string | number)[]) {
      const idSet = new Set(ids.map((id) => String(id)))
      try {
        for (const id of ids) {
          await downloadedMusicDB.delete(id)
        }
        this.downloadedList = this.downloadedList.filter((item) => !idSet.has(String(item.id)))
      } catch (err) {
        console.error('[DownloadStore] Failed to batch delete downloads:', err)
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
