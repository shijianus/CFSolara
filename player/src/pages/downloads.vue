<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useDownloadStore } from '@/stores/modules/download'
import { useAudio } from '@/composables/useAudio'
import { formatCoverUrl } from '@/utils/imageUrl'
import Button from '@/components/Ui/Button.vue'
import GlassSelect from '@/components/Ui/GlassSelect.vue'
import LazyImage from '@/components/Ui/LazyImage.vue'
import type { Song } from '@/stores/interface'
import type { DownloadedSong } from '@/utils/indexedDB'

const router = useRouter()
const downloadStore = useDownloadStore()
const { currentSong, setPlaylist, play } = useAudio()

// ══════ 状态：检索、筛选与排序 ══════
const searchQuery = ref('')
const selectedQualityFilter = ref<'all' | 'lossless' | 'exhigh' | 'standard'>('all')
const sortBy = ref<'time' | 'name' | 'size'>('time')

// 排序选项
const sortOptions = [
  { label: '最新下载', value: 'time' },
  { label: '歌曲名称', value: 'name' },
  { label: '文件大小', value: 'size' },
]

// 页面可见性（页面隐藏时停止动效）
const isPageVisible = ref(typeof document !== 'undefined' ? !document.hidden : true)
const handleVisibilityChange = () => {
  isPageVisible.value = !document.hidden
}

onMounted(() => {
  downloadStore.loadDownloads()
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

const downloads = computed(() => downloadStore.downloadedList)

// 真实音质统计（直接来自 IndexedDB 数据）
const sqCount = computed(() =>
  downloads.value.filter((d) => d.qualityLevel === 'lossless' || d.qualityBadge === 'SQ').length
)
const hqCount = computed(() =>
  downloads.value.filter((d) => d.qualityLevel === 'exhigh' || d.qualityBadge === 'HQ').length
)
const standardCount = computed(() =>
  downloads.value.filter((d) => d.qualityLevel === 'standard' || d.qualityBadge === '标准').length
)

// 分段控件配置
const qualityOptions = computed(() => [
  { value: 'all', label: '全部', count: downloads.value.length },
  { value: 'lossless', label: 'SQ 无损', count: sqCount.value },
  { value: 'exhigh', label: 'HQ 极高', count: hqCount.value },
  { value: 'standard', label: '标准', count: standardCount.value },
])

// 真实总占用体积（累加真实文件 Blob 大小）
const totalSizeBytes = computed(() => {
  return downloads.value.reduce((sum, item) => {
    return sum + (item.fileSize || (item.file && item.file.size) || 0)
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

  // 1. 音质筛选
  if (selectedQualityFilter.value === 'lossless') {
    list = list.filter((d) => d.qualityLevel === 'lossless' || d.qualityBadge === 'SQ')
  } else if (selectedQualityFilter.value === 'exhigh') {
    list = list.filter((d) => d.qualityLevel === 'exhigh' || d.qualityBadge === 'HQ')
  } else if (selectedQualityFilter.value === 'standard') {
    list = list.filter((d) => d.qualityLevel === 'standard' || d.qualityBadge === '标准')
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
      return (a.name || '').localeCompare(b.name || '', 'zh-CN')
    }
    if (sortBy.value === 'size') {
      const sizeA = a.fileSize || a.file?.size || 0
      const sizeB = b.fileSize || b.file?.size || 0
      return sizeB - sizeA
    }
    return 0
  })

  return list
})

// 将 DownloadedSong 映射为播放器 Song 格式
const toSongList = (items: typeof downloads.value): Song[] => {
  return items.map((d) => ({
    id: d.id,
    name: d.name,
    artist: d.artist,
    album: d.album,
    duration: (d.duration || 0) * 1000,
    cover: d.cover,
    url: d.file ? URL.createObjectURL(d.file) : '',
    isLocal: true,
    qualityBadge: d.qualityBadge,
    qualities: [
      {
        level: d.qualityLevel,
        label: d.qualityBadge,
        bitrate: d.bitrate || '',
        format: d.format,
      },
    ],
  }))
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
const playSingle = (item: DownloadedSong, index: number) => {
  const songList = toSongList(filteredDownloads.value)
  setPlaylist(songList, index)
  play(songList[index], index)
}

// 当前歌曲是否正在播放
const isCurrentSong = (item: DownloadedSong) => {
  return String(currentSong.value?.id || '') === String(item.id || '')
}

// 导出文件到本地磁盘
const handleExport = (item: DownloadedSong) => {
  if (!item.file) return
  const blobUrl = URL.createObjectURL(item.file)
  const a = document.createElement('a')
  a.href = blobUrl
  const safeArtist = (item.artist || '未知歌手').replace(/[\\/:*?"<>|]/g, '_')
  const safeTitle = (item.name || '未知歌曲').replace(/[\\/:*?"<>|]/g, '_')
  const badge = item.qualityBadge ? ` [${item.qualityBadge}]` : ''
  a.download = `${safeArtist} - ${safeTitle}${badge}.${item.format || 'mp3'}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(blobUrl), 15000)
}

// ══════ 删除确认弹窗逻辑 (B5 必须二次确认) ══════
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

// 重置检索与筛选
const resetFilters = () => {
  searchQuery.value = ''
  selectedQualityFilter.value = 'all'
}

// 规格真实性徽章（只用实际数据，绝不编造）
const getQualityBadgeInfo = (item: DownloadedSong) => {
  if (item.qualityBadge === 'SQ' || item.qualityLevel === 'lossless') {
    return {
      label: 'SQ 无损',
      class: 'bg-pink-500/20 text-pink-300 border border-pink-500/35',
    }
  }
  if (item.qualityBadge === 'HQ' || item.qualityLevel === 'exhigh') {
    return {
      label: 'HQ 极高',
      class: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35',
    }
  }
  if (item.qualityBadge === '标准' || item.qualityLevel === 'standard') {
    return {
      label: '标准',
      class: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35',
    }
  }
  return null
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
      <!-- 扁平 Header (B2) -->
      <header class="flex items-baseline justify-between pb-3.5 border-b border-white/10 select-none shrink-0">
        <div class="flex items-baseline gap-3">
          <h1 class="text-[22px] font-semibold tracking-tight text-white/95 leading-tight">下载列表</h1>
          <p v-if="downloads.length > 0" class="text-[13px] text-white/75 font-normal">
            {{ downloads.length }} 首 · {{ totalSizeFormatted }} · 离线可用
          </p>
        </div>

        <div v-if="downloads.length > 0" class="flex items-baseline">
          <button
            class="group inline-flex items-center gap-1.5 text-[13px] font-medium text-white/70 hover:text-red-400 px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 hover:border-red-500/30 hover:bg-red-500/10 transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
            @click="openClearAllConfirm"
            title="清空离线音乐库"
            aria-label="清空离线音乐库"
          >
            <span class="icon-[mdi--delete-sweep-outline] h-3.5 w-3.5 text-white/60 group-hover:text-red-400 transition-colors"></span>
            <span>清空</span>
          </button>
        </div>
      </header>

      <!-- 操作栏 (B3) -->
      <section
        v-if="downloads.length > 0"
        aria-label="下载列表操作栏"
        class="my-3 flex flex-wrap items-center justify-between gap-4 shrink-0"
      >
        <!-- 左侧：播放全部 / 随机播放 -->
        <div class="flex items-center gap-2">
          <Button
            variant="gradient"
            size="none"
            rounded="full"
            class="h-[36px] px-4 text-[13px] font-semibold shadow-md shadow-pink-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="filteredDownloads.length === 0"
            @click="playAll"
            aria-label="播放全部"
          >
            <span class="icon-[mdi--play] mr-1.5 h-4 w-4"></span>
            播放全部
          </Button>
          <Button
            variant="soft"
            size="none"
            rounded="full"
            class="h-[36px] px-3.5 text-[13px] font-medium text-white/85 hover:text-white bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="filteredDownloads.length === 0"
            @click="shufflePlay"
            aria-label="随机播放"
          >
            <span class="icon-[mdi--shuffle] mr-1.5 h-4 w-4"></span>
            随机播放
          </Button>
        </div>

        <!-- 中间：分段控件 (B8 role="radiogroup") -->
        <div
          role="radiogroup"
          aria-label="按音质筛选"
          class="flex items-center h-[36px] rounded-xl bg-white/[0.04] p-1 border border-white/10 select-none gap-1"
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
            class="relative h-[28px] rounded-lg px-2.5 flex items-center text-[13px] font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/60 cursor-pointer"
            :class="[
              selectedQualityFilter === opt.value
                ? 'bg-pink-500 text-white font-medium shadow-sm'
                : 'text-white/75 hover:text-white hover:bg-white/[0.06]'
            ]"
            @click="selectedQualityFilter = (opt.value as any)"
          >
            {{ opt.label }} ({{ opt.count }})
          </button>
        </div>

        <!-- 右侧：搜索框与 GlassSelect 排序 -->
        <div class="flex items-center gap-2">
          <div class="relative w-48 sm:w-56 h-[36px]">
            <label for="download-search-input" class="sr-only">搜索歌名、歌手、专辑</label>
            <input
              id="download-search-input"
              v-model="searchQuery"
              type="text"
              placeholder="搜索歌名、歌手、专辑..."
              aria-label="搜索歌名、歌手、专辑"
              class="w-full h-[36px] rounded-xl border border-white/10 bg-white/[0.04] py-0 pr-8 pl-8 text-[13px] font-medium text-white/95 placeholder:text-white/50 focus:border-pink-500/50 focus:bg-white/[0.08] focus:outline-none transition-all"
            />
            <span class="icon-[mdi--magnify] absolute top-1/2 left-2.5 -translate-y-1/2 h-4 w-4 text-white/50 pointer-events-none"></span>
            <button
              v-if="searchQuery"
              type="button"
              @click="searchQuery = ''"
              class="absolute top-1/2 right-2 -translate-y-1/2 p-0.5 text-white/50 hover:text-white focus:outline-none cursor-pointer"
              aria-label="清空搜索内容"
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

      <!-- 歌曲列表区 (B4, B5, B9) -->
      <div class="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
        <!-- 列表有内容 (WAI-ARIA 表格体系) -->
        <div
          v-if="filteredDownloads.length > 0"
          role="table"
          aria-label="离线下载音乐列表"
          class="space-y-1 pb-4"
        >
          <!-- 表头 (桌面端) -->
          <div
            role="row"
            class="text-white/70 mb-1 hidden items-center border-b border-white/10 py-2.5 px-2.5 text-[13px] font-medium tracking-wider select-none md:grid md:grid-cols-12 md:gap-3"
          >
            <div role="columnheader" class="col-span-1 text-center font-mono text-[13px] font-medium text-white/70">#</div>
            <div role="columnheader" class="col-span-5 text-[13px] font-medium text-white/70">歌曲</div>
            <div role="columnheader" class="col-span-2 text-[13px] font-medium text-white/70">专辑</div>
            <div role="columnheader" class="col-span-1 text-center text-[13px] font-medium text-white/70">音质规格</div>
            <div role="columnheader" class="col-span-1 text-right font-mono text-[13px] font-medium text-white/70">大小</div>
            <div role="columnheader" class="col-span-2 text-center text-[13px] font-medium text-white/70">操作</div>
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
              class="download-song-item group relative grid grid-cols-12 items-center gap-3 rounded-xl p-2.5 transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-pink-500/50 cursor-pointer"
              :class="[
                isCurrentSong(item)
                  ? 'bg-pink-500/10 border border-pink-500/30 shadow-[0_0_16px_rgba(236,72,153,0.12)]'
                  : 'border border-transparent hover:bg-white/[0.06] hover:border-white/10'
              ]"
            >
              <!-- 序号 / 播放动效 / 悬停播放键 (Col 1) -->
              <div role="cell" class="col-span-1 relative flex items-center justify-center text-center select-none">
                <!-- 未播放：显示数字序号 -->
                <span
                  v-if="!isCurrentSong(item)"
                  class="row-hover-hide font-mono text-[13px] font-medium text-white/70 transition-opacity duration-150"
                >
                  {{ String(index + 1).padStart(2, '0') }}
                </span>

                <!-- 正在播放：CSS 均衡器柱动画 (B4 页面隐藏或 reduced-motion 时停止) -->
                <div
                  v-else
                  class="playing-icon flex items-center justify-center gap-0.5"
                  aria-label="正在播放"
                >
                  <span class="bar" :class="{ animate: isPageVisible }"></span>
                  <span class="bar" :class="{ animate: isPageVisible }"></span>
                  <span class="bar" :class="{ animate: isPageVisible }"></span>
                </div>

                <!-- 悬停或键盘聚焦：平滑浮现播放按钮 -->
                <button
                  v-if="!isCurrentSong(item)"
                  type="button"
                  class="row-hover-show absolute inset-0 flex items-center justify-center text-primary hover:text-pink-400 active:scale-95 cursor-pointer focus:outline-none"
                  aria-label="播放"
                  title="播放"
                  @click.stop="playSingle(item, index)"
                >
                  <span class="icon-[mdi--play] h-4 w-4"></span>
                </button>
              </div>

              <!-- 封面与歌曲标题 + 歌手 (Col 2: 5 cols) -->
              <div role="cell" class="col-span-5 flex min-w-0 items-center gap-3">
                <div class="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg shadow-sm border border-white/10 bg-white/5">
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
                  <div class="flex items-center gap-2">
                    <h3
                      :title="item.name"
                      class="truncate text-[15px] font-semibold transition-colors"
                      :class="isCurrentSong(item) ? 'text-pink-300' : 'text-white/95 group-hover:text-pink-300'"
                    >
                      {{ item.name }}
                    </h3>
                  </div>
                  <p :title="item.artist" class="mt-0.5 truncate text-[13px] text-white/75 font-normal">
                    {{ item.artist || '未知歌手' }}
                  </p>
                </div>
              </div>

              <!-- 专辑 (Col 3: 2 cols) -->
              <div role="cell" class="col-span-2 min-w-0 hidden md:block">
                <span :title="item.album" class="truncate text-[13px] text-white/75 font-normal block">
                  {{ item.album || '-' }}
                </span>
              </div>

              <!-- 音质规格徽章 (Col 4: 1 col) -->
              <div role="cell" class="col-span-1 text-center hidden md:flex items-center justify-center">
                <span
                  v-if="getQualityBadgeInfo(item)"
                  class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium font-mono select-none"
                  :class="getQualityBadgeInfo(item)!.class"
                >
                  {{ getQualityBadgeInfo(item)!.label }}
                </span>
                <span v-else class="text-[13px] text-white/50 font-mono">-</span>
              </div>

              <!-- 大小 (Col 5: 1 col) -->
              <div role="cell" class="col-span-1 text-right font-mono text-[13px] text-white/75 font-normal hidden md:block">
                {{ formatSize(item.fileSize || item.file?.size) }}
              </div>

              <!-- 操作按钮 (Col 6: 2 cols) (B5 悬停或键盘聚焦显示) -->
              <div
                role="cell"
                class="row-hover-show col-span-2 flex items-center justify-center gap-1 transition-opacity duration-150"
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  rounded="full"
                  class="h-8 w-8 text-primary/80 hover:text-pink-400 focus:opacity-100 focus:text-pink-400"
                  icon="icon-[mdi--play]"
                  icon-class="h-4 w-4"
                  aria-label="播放歌曲"
                  title="播放"
                  @click.stop="playSingle(item, index)"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  rounded="full"
                  class="h-8 w-8 text-primary/80 hover:text-primary focus:opacity-100 focus:text-primary"
                  icon="icon-[mdi--tray-arrow-down]"
                  icon-class="h-4 w-4"
                  aria-label="导出音频文件"
                  title="导出音频文件"
                  @click.stop="handleExport(item)"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  rounded="full"
                  class="h-8 w-8 text-primary/70 hover:text-red-400 focus:opacity-100 focus:text-red-400"
                  icon="icon-[mdi--trash-can-outline]"
                  icon-class="h-4 w-4"
                  aria-label="从离线库删除"
                  title="从离线库删除"
                  @click.stop="openDeleteConfirm(item)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态：搜索/筛选无结果 (B6) -->
        <div
          v-else-if="downloads.length > 0 && filteredDownloads.length === 0"
          class="flex h-full min-h-[260px] flex-col items-center justify-center py-14 text-center select-none"
        >
          <div class="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04] border border-white/10">
            <span class="icon-[mdi--text-search] h-7 w-7 text-primary/50"></span>
          </div>
          <h2 class="text-sm font-semibold text-primary">未找到匹配的音乐</h2>
          <p class="mt-1 text-xs text-primary/60">请尝试更换检索关键词或音质筛选条件</p>
          <Button
            variant="soft"
            size="sm"
            rounded="full"
            class="mt-4 px-4 py-1.5 text-xs text-primary/80 hover:text-primary"
            @click="resetFilters"
            aria-label="重置筛选条件"
          >
            重置筛选条件
          </Button>
        </div>

        <!-- 空状态：暂无下载歌曲 (B6) -->
        <div
          v-else
          class="flex h-full min-h-[320px] flex-col items-center justify-center py-16 text-center select-none"
        >
          <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.04] border border-white/10 shadow-inner">
            <span class="icon-[mdi--tray-arrow-down] h-8 w-8 text-primary/50"></span>
          </div>
          <h2 class="text-base font-semibold text-primary">暂无离线下载音乐</h2>
          <p class="mt-1.5 max-w-xs text-xs text-primary/70 leading-relaxed">
            在歌曲列表或播放控制栏点击「下载」，歌曲将持久化保存在本地，离线断网亦可随时收听。
          </p>
          <Button
            variant="gradient"
            size="md"
            rounded="full"
            class="mt-6 px-5 py-2.5 text-xs font-semibold shadow-md shadow-pink-500/20"
            @click="router.push('/search')"
            aria-label="去发现音乐"
          >
            <span class="icon-[mdi--compass-outline] mr-1.5 h-4 w-4"></span>
            去发现音乐
          </Button>
        </div>
      </div>
    </div>

    <!-- 二次确认删除弹窗 (B5 & B10) -->
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
            class="w-full max-w-sm rounded-2xl border border-white/20 bg-neutral-900 text-white p-6 shadow-2xl backdrop-blur-md"
            @click.stop
          >
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/20 text-red-400 border border-red-500/30">
                <span class="icon-[mdi--alert-circle-outline] h-5 w-5"></span>
              </div>
              <div>
                <h3 id="confirm-dialog-title" class="text-base font-semibold text-white">
                  {{ isClearAllConfirm ? '清空所有下载？' : '确认删除歌曲？' }}
                </h3>
                <p class="text-xs text-zinc-300 mt-1">
                  {{ isClearAllConfirm ? '此操作将释放所有离线存储空间，无法撤销。' : `将从离线库移除「${itemToDelete?.name || ''}」` }}
                </p>
              </div>
            </div>

            <div class="mt-6 flex items-center justify-end gap-3">
              <Button
                variant="soft"
                size="sm"
                rounded="xl"
                class="px-4 py-2 text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/10"
                @click="closeDeleteModal"
                aria-label="取消"
              >
                取消
              </Button>
              <Button
                id="confirm-delete-btn"
                variant="soft"
                size="sm"
                rounded="xl"
                class="bg-red-500/30 text-red-200 hover:bg-red-500/40 border border-red-500/40 px-4 py-2 text-xs font-semibold"
                @click="confirmDeleteAction"
                aria-label="确认删除"
              >
                确认删除
              </Button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* 滚动行不使用 backdrop-filter，严格满足同屏 <= 5 处性能规范 (B9) */
.download-song-item {
  content-visibility: auto;
  contain-intrinsic-size: auto 56px;
}

/* 序号悬停平滑切换为播放按钮，行操作悬停/聚焦显示 (B4, B5) */
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

/* 动效遵守 prefers-reduced-motion (B4, B9) */
@media (prefers-reduced-motion: reduce) {
  .playing-icon .bar {
    animation: none !important;
  }
}
</style>
