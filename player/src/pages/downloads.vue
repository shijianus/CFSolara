<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDownloadStore } from '@/stores/modules/download'
import { useAudio } from '@/composables/useAudio'
import { formatCoverUrl } from '@/utils/imageUrl'
import Button from '@/components/Ui/Button.vue'
import GlassSelect from '@/components/Ui/GlassSelect.vue'
import LazyImage from '@/components/Ui/LazyImage.vue'
import type { Song } from '@/stores/interface'
import type { DownloadedSong } from '@/utils/indexedDB'
import { parseAudioBlob, type ParsedAudioMeta, type ResolvedBlobTier } from '@/utils/blobMetadataParser'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/utils/time'

const { t, locale } = useI18n()
const router = useRouter()
const downloadStore = useDownloadStore()
const { currentSong, isPlaying, setPlaylist, play } = useAudio()

// ══════ 状态：检索、筛选与排序 ══════
const searchQuery = ref('')
const selectedQualityFilter = ref<'all' | 'lossless' | 'exhigh' | 'standard'>('all')
const sortBy = ref<'time' | 'name' | 'size'>('time')

const sortOptions = computed(() => [
  { label: t('downloads.sortLatest'), value: 'time' },
  { label: t('downloads.sortName'), value: 'name' },
  { label: t('downloads.sortSize'), value: 'size' },
])

// 页面可见性（页面隐藏或离开时停止动效）
const isPageVisible = ref(typeof document !== 'undefined' ? !document.hidden : true)
const handleVisibilityChange = () => {
  isPageVisible.value = !document.hidden
}

// ══════ P1.4 真实音频元数据解析 (audioBlobParser) ══════
const parsedMetaMap = ref<Record<string, ParsedAudioMeta>>({})
const metadataCache = new Map<string, ParsedAudioMeta>()

const parseBlobMetadata = async (item: DownloadedSong) => {
  if (!item.file || !(item.file instanceof Blob)) return
  const idStr = String(item.id)
  if (metadataCache.has(idStr)) {
    parsedMetaMap.value[idStr] = metadataCache.get(idStr)!
    return
  }

  try {
    const reqQuality = item.qualityLevel || (item.qualityBadge === 'SQ' ? 'lossless' : item.qualityBadge === 'HQ' ? 'exhigh' : 'standard')
    const parsed = await parseAudioBlob(item.file, item.duration, reqQuality)
    metadataCache.set(idStr, parsed)
    parsedMetaMap.value[idStr] = parsed
  } catch {
    const isFlac = item.format === 'flac' || item.format === 'wav' || item.format === 'alac'
    const fallbackTag = isFlac ? item.format.toUpperCase() : 'MP3 128k'
    const parsed: ParsedAudioMeta = {
      displayTag: fallbackTag,
      detailText: '',
      mismatchWarning: null,
      isLossless: false,
      resolvedTier: 'standard',
    }
    metadataCache.set(idStr, parsed)
    parsedMetaMap.value[idStr] = parsed
  }
}

const getParsedMeta = (item: DownloadedSong): ParsedAudioMeta => {
  const idStr = String(item.id)
  if (parsedMetaMap.value[idStr]) {
    return parsedMetaMap.value[idStr]
  }
  return {
    displayTag: '—',
    detailText: '',
    mismatchWarning: null,
    isLossless: false,
    resolvedTier: 'standard',
  }
}

/** 基于解析 blob 获取真实音质档位 (FLAC/ALAC/WAV -> SQ; >=256k -> HQ; 其余 -> 标准) */
const getSongActualTier = (item: DownloadedSong): ResolvedBlobTier => {
  const meta = parsedMetaMap.value[String(item.id)]
  if (meta) {
    return meta.resolvedTier
  }
  return 'standard'
}

onMounted(() => {
  downloadStore.loadDownloads()
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

const downloads = computed(() => downloadStore.downloadedList)

watch(
  downloads,
  (list) => {
    if (list && list.length > 0) {
      list.forEach((item) => {
        parseBlobMetadata(item)
      })
    }
  },
  { immediate: true, deep: true }
)

// 真实音质统计 (一律基于 blob 实际格式解析)
const sqCount = computed(() =>
  downloads.value.filter((d) => getSongActualTier(d) === 'lossless').length
)
const hqCount = computed(() =>
  downloads.value.filter((d) => getSongActualTier(d) === 'exhigh').length
)
const standardCount = computed(() =>
  downloads.value.filter((d) => getSongActualTier(d) === 'standard').length
)

// 分段控件配置
const qualityOptions = computed(() => [
  { value: 'all', label: t('downloads.filterAll'), count: formatNumber(downloads.value.length) },
  { value: 'lossless', label: t('downloads.filterLossless'), count: formatNumber(sqCount.value) },
  { value: 'exhigh', label: t('downloads.filterExhigh'), count: formatNumber(hqCount.value) },
  { value: 'standard', label: t('downloads.filterStandard'), count: formatNumber(standardCount.value) },
])

// 真实总占用体积
const totalSizeBytes = computed(() => {
  return downloads.value.reduce((sum, item) => {
    return sum + (item.file?.size || item.fileSize || 0)
  }, 0)
})

const totalSizeFormatted = computed(() => {
  const bytes = totalSizeBytes.value
  if (bytes === 0) return '0 B'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
})

// 分段控件键盘无障碍方向键导航 (role="radiogroup")
const handleQualityKeydown = (e: KeyboardEvent) => {
  const options = ['all', 'lossless', 'exhigh', 'standard'] as const
  const currentIndex = options.indexOf(selectedQualityFilter.value)
  if (currentIndex === -1) return

  let nextIndex = currentIndex
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    nextIndex = (currentIndex + 1) % options.length
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    nextIndex = (currentIndex - 1 + options.length) % options.length
  } else if (e.key === 'Home') {
    e.preventDefault()
    nextIndex = 0
  } else if (e.key === 'End') {
    e.preventDefault()
    nextIndex = options.length - 1
  }

  if (nextIndex !== currentIndex) {
    selectedQualityFilter.value = options[nextIndex]
    nextTick(() => {
      const btn = document.getElementById(`filter-radio-${options[nextIndex]}`)
      btn?.focus()
    })
  }
}

// 综合过滤与排序后的歌曲列表
const filteredDownloads = computed(() => {
  let list = [...downloads.value]

  // 1. 音质筛选 (一律基于 blob 实际格式解析)
  if (selectedQualityFilter.value === 'lossless') {
    list = list.filter((d) => getSongActualTier(d) === 'lossless')
  } else if (selectedQualityFilter.value === 'exhigh') {
    list = list.filter((d) => getSongActualTier(d) === 'exhigh')
  } else if (selectedQualityFilter.value === 'standard') {
    list = list.filter((d) => getSongActualTier(d) === 'standard')
  }

  // 2. 关键词检索 (歌名、歌手、专辑)
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter((d) => {
      const name = (d.name || '').toLowerCase()
      const artist = (d.artist || '').toLowerCase()
      const album = (d.album || '').toLowerCase()
      return name.includes(q) || artist.includes(q) || album.includes(q)
    })
  }

  // 3. 排序
  list.sort((a, b) => {
    if (sortBy.value === 'time') {
      return (b.downloadTime || 0) - (a.downloadTime || 0)
    }
    if (sortBy.value === 'name') {
      return (a.name || '').localeCompare(b.name || '', locale.value)
    }
    if (sortBy.value === 'size') {
      const sizeA = a.file?.size || a.fileSize || 0
      const sizeB = b.file?.size || b.fileSize || 0
      return sizeB - sizeA
    }
    return 0
  })

  return list
})

// 将 DownloadedSong 映射为播放器 Song 格式
const toSongList = (items: typeof downloads.value): Song[] => {
  return items.map((d) => {
    const meta = getParsedMeta(d)
    const badge = meta.isLossless ? 'SQ' : meta.displayTag.includes('320') ? 'HQ' : t('quality.standard')
    return {
      id: d.id,
      name: d.name,
      artist: d.artist,
      album: d.album,
      duration: (d.duration || 0) * 1000,
      cover: d.cover,
      url: d.file ? URL.createObjectURL(d.file) : '',
      isLocal: true,
      qualityBadge: badge,
      qualities: [
        {
          level: d.qualityLevel,
          label: badge,
          bitrate: meta.displayTag,
          format: meta.isLossless ? 'flac' : 'mp3',
        },
      ],
    }
  })
}

// 播放全部
const playAll = () => {
  if (!filteredDownloads.value.length) return
  const songList = toSongList(filteredDownloads.value)
  setPlaylist(songList, 0)
  play(songList[0], 0)
}

// 随机播放
const shufflePlay = () => {
  if (!filteredDownloads.value.length) return
  const songList = toSongList(filteredDownloads.value)
  const shuffled = [...songList].sort(() => Math.random() - 0.5)
  setPlaylist(shuffled, 0)
  play(shuffled[0], 0)
}

// 播放单曲
const playSingle = (_item: DownloadedSong, index: number) => {
  const songList = toSongList(filteredDownloads.value)
  setPlaylist(songList, index)
  play(songList[index], index)
}

// ══════ P2.1 播放状态判断与前台动画规范 ══════
// 当前歌曲是否来自本行离线音频 Blob
const isCurrentOffline = (item: DownloadedSong) => {
  const cur = currentSong.value
  if (!cur || String(cur.id) !== String(item.id)) return false
  return Boolean(cur.isLocal === true || cur.url?.startsWith('blob:'))
}

// 当前离线曲目正在播放
const isCurrentPlaying = (item: DownloadedSong) => {
  return isCurrentOffline(item) && isPlaying.value
}

// 当前离线曲目处于暂停状态
const isCurrentPaused = (item: DownloadedSong) => {
  return isCurrentOffline(item) && !isPlaying.value
}

// 导出文件到本地磁盘
const handleExport = (item: DownloadedSong) => {
  if (!item.file) return
  const blobUrl = URL.createObjectURL(item.file)
  const a = document.createElement('a')
  a.href = blobUrl
  const safeArtist = (item.artist || t('player.unknownArtist')).replace(/[\\/:*?"<>|]/g, '_')
  const safeTitle = (item.name || t('player.unknownSong')).replace(/[\\/:*?"<>|]/g, '_')
  const meta = getParsedMeta(item)
  const ext = meta.isLossless ? 'flac' : 'mp3'
  const badge = meta.displayTag ? ` [${meta.displayTag}]` : ''
  a.download = `${safeArtist} - ${safeTitle}${badge}.${ext}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(blobUrl), 15000)
}

// ══════ 删除确认弹窗逻辑 ══════
const itemToDelete = ref<DownloadedSong | null>(null)
const isClearAllConfirm = ref(false)

const openDeleteConfirm = (item: DownloadedSong) => {
  itemToDelete.value = item
  isClearAllConfirm.value = false
}

const openClearAllConfirm = () => {
  isClearAllConfirm.value = true
  itemToDelete.value = null
}

const closeDeleteModal = () => {
  itemToDelete.value = null
  isClearAllConfirm.value = false
}

const confirmDeleteAction = async () => {
  if (isClearAllConfirm.value) {
    await downloadStore.clearDownloads()
  } else if (itemToDelete.value) {
    await downloadStore.deleteDownload(itemToDelete.value.id)
  }
  closeDeleteModal()
}

const resetFilters = () => {
  searchQuery.value = ''
  selectedQualityFilter.value = 'all'
}

const formatSize = (bytes?: number) => {
  if (!bytes) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="flex flex-1 flex-col overflow-hidden p-4 sm:p-6">
    <div class="flex flex-1 flex-col overflow-hidden">
      <!-- 扁平 Header (P3.4 标题 22px/600，清空按钮基线严格对齐) -->
      <header class="flex items-center justify-between pb-3.5 border-b border-glass select-none shrink-0 min-h-[44px]">
        <div id="downloads-header-title-box" class="flex items-baseline gap-3">
          <h1 id="downloads-title-heading" class="text-[22px] font-semibold tracking-tight text-primary leading-none">{{ t('downloads.title') }}</h1>
          <p v-if="downloads.length > 0" class="text-[13px] text-primary/70 font-medium leading-none">
            {{ t('downloads.summary', { count: formatNumber(downloads.length), size: totalSizeFormatted }) }}
          </p>
        </div>

        <div v-if="downloads.length > 0" class="flex items-center">
          <button
            id="downloads-clear-all-btn"
            class="group inline-flex items-center gap-1.5 text-[13px] font-medium text-primary/70 hover:text-red-500 dark:hover:text-red-400 px-2.5 py-1.5 rounded-lg border border-glass bg-button-glass hover:border-red-500/30 hover:bg-red-500/10 transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 leading-none"
            @click="openClearAllConfirm"
            :title="t('downloads.clearAllAria')"
            :aria-label="t('downloads.clearAllAria')"
          >
            <span class="icon-[mdi--delete-sweep-outline] h-3.5 w-3.5 text-primary/60 group-hover:text-red-500 dark:group-hover:text-red-400 transition-colors"></span>
            <span>{{ t('downloads.clear') }}</span>
          </button>
        </div>
      </header>

      <!-- 操作栏 (P3.4 统一样式高 36px，分段控件淡强调色填充) -->
      <section
        v-if="downloads.length > 0"
        :aria-label="t('downloads.operationBar')"
        class="my-3 flex flex-wrap items-center justify-between gap-4 shrink-0"
      >
        <!-- 左侧：播放全部 / 随机播放 -->
        <div class="flex items-center gap-2">
          <Button
            variant="gradient"
            size="none"
            rounded="full"
            class="h-[36px] px-4 text-[13px] font-semibold shadow-md shadow-sky-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="filteredDownloads.length === 0"
            @click="playAll"
            :aria-label="t('actions.playAll')"
          >
            <span class="icon-[mdi--play] mr-1.5 h-4 w-4"></span>
            {{ t('actions.playAll') }}
          </Button>
          <Button
            variant="soft"
            size="none"
            rounded="full"
            class="h-[36px] px-3.5 text-[13px] font-medium text-primary bg-button-glass hover:bg-hover-button-glass disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="filteredDownloads.length === 0"
            @click="shufflePlay"
            :aria-label="t('actions.shufflePlay')"
          >
            <span class="icon-[mdi--shuffle] mr-1.5 h-4 w-4"></span>
            {{ t('actions.shufflePlay') }}
          </Button>
        </div>

        <!-- 中间：分段控件 (P3.4 选中态使用淡强调色填充，不要实心粉) -->
        <div
          role="radiogroup"
          :aria-label="t('downloads.filterAria')"
          class="flex items-center h-[36px] rounded-xl bg-button-glass p-1 border border-glass select-none gap-1"
          @keydown="handleQualityKeydown"
        >
          <button
            v-for="opt in qualityOptions"
            :key="opt.value"
            :id="`filter-radio-${opt.value}`"
            type="button"
            role="radio"
            :aria-checked="selectedQualityFilter === opt.value"
            :tabindex="selectedQualityFilter === opt.value ? 0 : -1"
            class="relative h-[28px] rounded-lg px-2.5 flex items-center text-[13px] font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 cursor-pointer border"
            :class="[
              selectedQualityFilter === opt.value
                ? 'bg-sky-500/20 text-primary border-sky-500/40 font-medium shadow-sm'
                : 'border-transparent text-primary/70 hover:text-primary hover:bg-hover-glass'
            ]"
            @click="selectedQualityFilter = (opt.value as any)"
          >
            {{ opt.label }} ({{ opt.count }})
          </button>
        </div>

        <!-- 右侧：搜索框与 GlassSelect 排序 -->
        <div class="flex items-center gap-2">
          <div class="relative w-48 sm:w-56 h-[36px]">
            <label for="download-search-input" class="sr-only">{{ t('downloads.searchLabel') }}</label>
            <input
              id="download-search-input"
              v-model="searchQuery"
              type="text"
              :placeholder="t('downloads.searchPlaceholder')"
              :aria-label="t('downloads.searchLabel')"
              class="w-full h-[36px] rounded-xl border border-glass bg-button-glass py-0 pr-8 pl-8 text-[13px] font-medium text-primary placeholder:text-primary/60 focus:border-sky-500/50 focus:outline-none transition-all"
            />
            <span class="icon-[mdi--magnify] absolute top-1/2 left-2.5 -translate-y-1/2 h-4 w-4 text-primary/60 pointer-events-none"></span>
            <button
              v-if="searchQuery"
              type="button"
              @click="searchQuery = ''"
              class="absolute top-1/2 right-2 -translate-y-1/2 p-0.5 text-primary/60 hover:text-primary focus:outline-none cursor-pointer"
              :aria-label="t('downloads.clearSearch')"
            >
              <span class="icon-[mdi--close-circle] h-4 w-4"></span>
            </button>
          </div>

          <div class="w-32 h-[36px] shrink-0">
            <GlassSelect
              v-model="sortBy"
              :options="sortOptions"
            />
          </div>
        </div>
      </section>

      <!-- 歌曲列表区 (P3.4 行高 56px，表头 13px/500) -->
      <div class="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
        <!-- 列表有内容 (WAI-ARIA 表格体系) -->
        <div
          v-if="filteredDownloads.length > 0"
          role="table"
          :aria-label="t('downloads.tableAria')"
          class="space-y-1 pb-4"
        >
          <!-- 表头 (桌面端：13px/500，严格对齐数据列) -->
          <div
            role="row"
            class="text-primary/70 mb-1 hidden items-center border border-transparent border-b-primary/10 py-2.5 px-2.5 text-[13px] font-medium tracking-wider select-none md:grid md:grid-cols-12 md:gap-3"
          >
            <div role="columnheader" class="col-span-1 text-center font-mono text-[13px] font-medium text-primary/70">#</div>
            <div role="columnheader" class="col-span-4 text-[13px] font-medium text-primary/70">{{ t('downloads.colSong') }}</div>
            <div role="columnheader" class="col-span-2 text-[13px] font-medium text-primary/70">{{ t('downloads.colAlbum') }}</div>
            <div role="columnheader" class="col-span-2 text-center text-[13px] font-medium text-primary/70">{{ t('downloads.colQuality') }}</div>
            <div role="columnheader" class="col-span-1 whitespace-nowrap text-right font-mono text-[13px] font-medium text-primary/70">{{ t('downloads.colSize') }}</div>
            <div role="columnheader" class="col-span-2 text-center text-[13px] font-medium text-primary/70">{{ t('downloads.colActions') }}</div>
          </div>

          <!-- 歌曲行容器 (role="rowgroup") -->
          <div role="rowgroup" class="space-y-1">
            <div
              v-for="(item, index) in filteredDownloads"
              :key="item.id"
              tabindex="0"
              role="row"
              :id="`download-row-${item.id}`"
              :aria-label="`${item.name} - ${item.artist}`"
              @dblclick="playSingle(item, index)"
              @keydown.enter.self="playSingle(item, index)"
              class="download-song-item group relative grid grid-cols-12 items-center gap-3 rounded-xl p-2.5 transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/50 cursor-pointer overflow-hidden border min-h-[56px] h-[56px]"
              :class="[
                isCurrentPlaying(item)
                  ? 'border-sky-500/30'
                  : isCurrentPaused(item)
                    ? 'border-sky-500/15'
                    : 'border-transparent hover:bg-primary/[0.06] hover:border-primary/10'
              ]"
              :style="{
                backgroundColor: isCurrentPlaying(item)
                  ? 'rgba(56,189,248, 0.10)'
                  : isCurrentPaused(item)
                    ? 'rgba(56,189,248, 0.05)'
                    : 'transparent'
              }"
            >
              <!-- 左侧 2px 强调色指示条 (仅在当前离线源时出现) -->
              <span
                v-if="isCurrentOffline(item)"
                class="absolute left-0 top-2 bottom-2 w-[2px] rounded-r"
                :class="isCurrentPlaying(item) ? 'bg-sky-500' : 'bg-sky-500/50'"
                aria-hidden="true"
              ></span>

              <!-- 序号 / 播放动效 / 暂停图标 / 悬停播放键 (Col 1) -->
              <div role="cell" class="col-span-1 relative flex items-center justify-center text-center select-none">
                <!-- 状态 1: 当前且正在播放 -> 均衡器柱动画 (页面不可见或 reduced-motion 时停止) -->
                <div
                  v-if="isCurrentPlaying(item)"
                  class="playing-icon flex items-center justify-center gap-0.5"
                  :aria-label="t('downloads.nowPlaying')"
                >
                  <span class="bar" :class="{ animate: isPageVisible }"></span>
                  <span class="bar" :class="{ animate: isPageVisible }"></span>
                  <span class="bar" :class="{ animate: isPageVisible }"></span>
                </div>

                <!-- 状态 2: 当前但暂停 -> 静态暂停图标，无动画 -->
                <div
                  v-else-if="isCurrentPaused(item)"
                  class="flex items-center justify-center text-primary"
                  :aria-label="t('downloads.paused')"
                  :title="t('downloads.paused')"
                >
                  <span class="icon-[mdi--pause] h-4 w-4"></span>
                </div>

                <!-- 状态 3 & 4: 非当前或当前为在线歌曲 -> 显示常规数字序号，悬停浮现播放键 -->
                <template v-else>
                  <span
                    class="row-hover-hide font-mono text-[13px] font-medium text-primary/70 transition-opacity duration-150"
                  >
                    {{ String(index + 1).padStart(2, '0') }}
                  </span>
                  <button
                    type="button"
                    class="row-hover-show absolute inset-0 flex items-center justify-center text-primary/80 hover:text-primary active:scale-95 cursor-pointer focus:outline-none"
                    :aria-label="t('downloads.play')"
                    :title="t('downloads.play')"
                    @click.stop="playSingle(item, index)"
                  >
                    <span class="icon-[mdi--play] h-4 w-4"></span>
                  </button>
                </template>
              </div>

              <!-- 封面与歌曲标题 + 歌手 (Col 2: 4 cols) -->
              <div role="cell" class="col-span-4 flex min-w-0 items-center gap-3">
                <div class="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg shadow-sm border border-primary/10 bg-primary/5">
                  <LazyImage
                    :src="formatCoverUrl(item.cover, { size: 80, artist: item.artist })"
                    :fallback-src="formatCoverUrl('', { artist: item.artist })"
                    :alt="item.name"
                    :title="item.name"
                    :seed="item.album || item.artist || item.name"
                    imgClass="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    wrapperClass="h-full w-full"
                  />
                </div>

                <div class="min-w-0 flex-1">
                  <h3
                    :title="item.name"
                    class="line-clamp-1 text-[15px] font-semibold text-primary transition-colors"
                  >
                    {{ item.name }}
                  </h3>
                  <p :title="item.artist" class="mt-0.5 truncate text-[13px] text-primary/70 font-medium">
                    {{ item.artist || t('player.unknownArtist') }}
                  </p>
                </div>
              </div>

              <!-- 专辑 (Col 3: 2 cols) -->
              <div role="cell" class="col-span-2 min-w-0 hidden md:block">
                <span :title="item.album" class="truncate text-[13px] text-primary/70 font-medium block">
                  {{ item.album || '-' }}
                </span>
              </div>

              <!-- 音质规格徽章 (Col 4: 2 cols, P1.4 真实格式与警示图标) -->
              <div role="cell" class="col-span-2 text-center hidden md:flex items-center justify-center gap-1">
                <span
                  class="inline-flex items-center px-1 py-0.5 rounded text-[11px] font-mono font-medium select-none whitespace-nowrap"
                  :class="[
                    getParsedMeta(item).isLossless
                      ? 'bg-transparent text-primary border border-sky-500/70'
                      : getParsedMeta(item).displayTag.includes('320')
                        ? 'bg-transparent text-primary border border-blue-500/60'
                        : 'bg-transparent text-primary/70 border border-primary/20'
                  ]"
                >
                  {{ getParsedMeta(item).displayTag }}
                </span>

                <!-- 格式不符警示图标 -->
                <span
                  v-if="getParsedMeta(item).mismatchWarning"
                  class="relative group/warn inline-flex items-center cursor-help text-amber-400 shrink-0"
                  :title="getParsedMeta(item).mismatchWarning!"
                  :aria-label="t('downloads.qualityMismatch')"
                >
                  <span class="icon-[mdi--alert-circle-outline] h-3.5 w-3.5"></span>
                  <span
                    class="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/warn:flex whitespace-nowrap z-30 rounded-lg bg-[var(--glass-bg-overlay)] border border-amber-500/40 px-2 py-1 text-[11px] font-medium text-amber-200 shadow-xl backdrop-blur-md"
                  >
                    {{ getParsedMeta(item).mismatchWarning }}
                  </span>
                </span>
              </div>

              <!-- 大小 (Col 5: 1 col, 严格使用实际 blob.size) -->
              <div role="cell" class="col-span-1 whitespace-nowrap text-right font-mono text-[13px] text-primary/70 font-medium hidden md:block">
                {{ formatSize(item.file?.size || item.fileSize) }}
              </div>

              <!-- 操作列 (Col 6: 2 cols) -->
              <div
                role="cell"
                class="col-span-2 relative flex items-center justify-center min-h-[32px]"
              >
                <!-- 非悬停时：显示低透明度 (0.5) 的更多图标 -->
                <div class="row-default-more flex items-center justify-center text-primary/60 transition-opacity duration-150">
                  <span class="icon-[mdi--dots-horizontal] h-5 w-5"></span>
                </div>

                <!-- 悬停或行内聚焦时：显示播放、重新导出、删除三个图标按钮 (32px 点击区域，间距 8px) -->
                <div
                  class="row-action-buttons absolute inset-0 flex items-center justify-center gap-2 transition-opacity duration-150"
                >
                  <button
                    type="button"
                    class="flex h-[32px] w-[32px] items-center justify-center rounded-lg text-primary/70 hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                    :aria-label="t('downloads.playSong')"
                    :title="t('downloads.play')"
                    @click.stop="playSingle(item, index)"
                  >
                    <span class="icon-[mdi--play] h-4 w-4"></span>
                  </button>
                  <button
                    type="button"
                    class="flex h-[32px] w-[32px] items-center justify-center rounded-lg text-primary/70 hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                    :aria-label="t('downloads.exportAudio')"
                    :title="t('downloads.reexport')"
                    @click.stop="handleExport(item)"
                  >
                    <span class="icon-[mdi--tray-arrow-down] h-4 w-4"></span>
                  </button>
                  <button
                    type="button"
                    class="flex h-[32px] w-[32px] items-center justify-center rounded-lg text-primary/70 hover:text-red-400 hover:bg-red-500/15 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
                    :aria-label="t('downloads.deleteFromOffline')"
                    :title="t('common.delete')"
                    @click.stop="openDeleteConfirm(item)"
                  >
                    <span class="icon-[mdi--trash-can-outline] h-4 w-4"></span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态：搜索/筛选无结果 -->
        <div
          v-else-if="downloads.length > 0 && filteredDownloads.length === 0"
          class="flex h-full min-h-[260px] flex-col items-center justify-center py-14 text-center select-none"
        >
          <div class="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/[0.04] border border-primary/10">
            <span class="icon-[mdi--text-search] h-7 w-7 text-primary/50"></span>
          </div>
          <h2 class="text-sm font-semibold text-primary">{{ t('downloads.searchEmptyTitle') }}</h2>
          <p class="mt-1 text-xs text-primary/60 font-medium">{{ t('downloads.searchEmptyHint') }}</p>
          <Button
            variant="soft"
            size="sm"
            rounded="full"
            class="mt-4 px-4 py-1.5 text-xs font-medium text-primary/80 hover:text-primary"
            @click="resetFilters"
            :aria-label="t('downloads.resetFilters')"
          >
            {{ t('downloads.resetFilters') }}
          </Button>
        </div>

        <!-- 空状态：暂无下载歌曲 -->
        <div
          v-else
          class="flex h-full min-h-[320px] flex-col items-center justify-center py-16 text-center select-none"
        >
          <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/[0.04] border border-primary/10 shadow-inner">
            <span class="icon-[mdi--tray-arrow-down] h-8 w-8 text-primary/50"></span>
          </div>
          <h2 class="text-base font-semibold text-primary">{{ t('downloads.emptyTitle') }}</h2>
          <p class="mt-1.5 max-w-xs text-xs text-primary/70 font-medium leading-relaxed">
            {{ t('downloads.emptyHint') }}
          </p>
          <Button
            variant="gradient"
            size="md"
            rounded="full"
            class="mt-6 px-5 py-2.5 text-xs font-semibold shadow-md shadow-sky-500/20"
            @click="router.push('/search')"
            :aria-label="t('downloads.discover')"
          >
            <span class="icon-[mdi--compass-outline] mr-1.5 h-4 w-4"></span>
            {{ t('downloads.discover') }}
          </Button>
        </div>
      </div>
    </div>

    <!-- 二次确认删除弹窗 -->
    <Teleport to="body">
      <transition name="fade">
        <div
          v-if="itemToDelete || isClearAllConfirm"
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          @keydown.esc="closeDeleteModal"
        >
          <div
            id="delete-confirm-dialog"
            class="w-full max-w-sm rounded-2xl border border-glass bg-[var(--glass-bg-overlay)] text-primary p-6 shadow-[var(--glass-shadow-xl)] backdrop-blur-md"
            @click.stop
          >
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/20 text-red-400 border border-red-500/30">
                <span class="icon-[mdi--alert-circle-outline] h-5 w-5"></span>
              </div>
              <div>
                <h3 id="confirm-dialog-title" class="text-base font-semibold text-primary">
                  {{ isClearAllConfirm ? t('downloads.clearAllTitle') : t('downloads.deleteTitle') }}
                </h3>
                <p class="text-xs text-primary/70 mt-1 font-medium">
                  {{ isClearAllConfirm ? t('downloads.clearAllDesc') : t('downloads.deleteDesc', { name: itemToDelete?.name || '' }) }}
                </p>
              </div>
            </div>

            <div class="mt-6 flex items-center justify-end gap-3">
              <Button
                variant="soft"
                size="sm"
                rounded="xl"
                class="px-4 py-2 text-xs font-medium text-primary/70 hover:text-primary hover:bg-hover-glass"
                @click="closeDeleteModal"
                :aria-label="t('common.cancel')"
              >
                {{ t('common.cancel') }}
              </Button>
              <Button
                id="confirm-delete-btn"
                variant="soft"
                size="sm"
                rounded="xl"
                class="bg-red-500/30 text-red-200 hover:bg-red-500/40 border border-red-500/40 px-4 py-2 text-xs font-semibold"
                @click="confirmDeleteAction"
                :aria-label="t('downloads.confirmDelete')"
              >
                {{ t('downloads.confirmDelete') }}
              </Button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.download-song-item {
  content-visibility: auto;
  contain-intrinsic-size: auto 56px;
}

.download-song-item .row-hover-show {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.download-song-item:hover .row-hover-show,
.download-song-item:focus-within .row-hover-show {
  opacity: 1;
  pointer-events: auto;
}

.download-song-item .row-hover-hide {
  opacity: 1;
  transition: opacity 0.15s ease;
}

.download-song-item:hover .row-hover-hide,
.download-song-item:focus-within .row-hover-hide {
  opacity: 0;
}

.download-song-item .row-default-more {
  opacity: 1;
  pointer-events: auto;
  transition: opacity 0.15s ease;
}

.download-song-item:hover .row-default-more,
.download-song-item:focus-within .row-default-more {
  opacity: 0;
  pointer-events: none;
}

.download-song-item .row-action-buttons {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.download-song-item:hover .row-action-buttons,
.download-song-item:focus-within .row-action-buttons {
  opacity: 1;
  pointer-events: auto;
}

@media (prefers-reduced-motion: reduce) {
  .playing-icon .bar {
    animation: none !important;
  }
}
</style>
