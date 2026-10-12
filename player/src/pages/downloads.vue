<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDownloadStore } from '@/stores/modules/download'
import { useAudioStore } from '@/stores/modules/audio'
import { formatCoverUrl } from '@/utils/imageUrl'
import { formatDuration } from '@/utils/time'
import Button from '@/components/Ui/Button.vue'
import type { Song } from '@/stores/interface'

const router = useRouter()
const downloadStore = useDownloadStore()
const audioStore = useAudioStore()

onMounted(() => {
  downloadStore.loadDownloads()
})

const downloads = computed(() => downloadStore.downloadedList)

// ══════ 状态：检索、筛选、排序与批量模式 ══════
const searchQuery = ref('')
const selectedQualityFilter = ref<'all' | 'lossless' | 'exhigh' | 'standard'>('all')
const sortBy = ref<'time' | 'name' | 'size' | 'duration'>('time')
const isBatchMode = ref(false)
const selectedIds = ref<Set<string | number>>(new Set())

// 音质分类统计
const sqCount = computed(() => downloads.value.filter((d) => d.qualityLevel === 'lossless' || d.qualityBadge === 'SQ').length)
const hqCount = computed(() => downloads.value.filter((d) => d.qualityLevel === 'exhigh' || d.qualityBadge === 'HQ').length)
const standardCount = computed(() => downloads.value.filter((d) => d.qualityLevel === 'standard' || d.qualityBadge === '标准').length)

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

  // 2. 关键词搜索过滤 (匹配歌名、歌手、专辑)
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
      return (b.fileSize || 0) - (a.fileSize || 0)
    }
    if (sortBy.value === 'duration') {
      return (b.duration || 0) - (a.duration || 0)
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
    url: URL.createObjectURL(d.file),
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
  audioStore.setPlaylist(songList, 0)
  audioStore.playSong(songList[0], 0)
}

// 随机播放
const shufflePlay = () => {
  if (!filteredDownloads.value.length) return
  const songList = toSongList(filteredDownloads.value)
  const shuffled = [...songList].sort(() => Math.random() - 0.5)
  audioStore.setPlaylist(shuffled, 0)
  audioStore.playSong(shuffled[0], 0)
}

// 播放单曲
const playSingle = (item: any, index: number) => {
  const songList = toSongList(filteredDownloads.value)
  audioStore.setPlaylist(songList, index)
  audioStore.playSong(songList[index], index)
}

// 当前歌曲是否正在播放
const isCurrentPlaying = (item: any) => {
  return String(audioStore.currentSong?.id || '') === String(item.id || '')
}

// 导出文件到本地
const handleExport = (item: any) => {
  const blobUrl = URL.createObjectURL(item.file)
  const a = document.createElement('a')
  a.href = blobUrl
  const safeArtist = (item.artist || '未知歌手').replace(/[\\/:*?"<>|]/g, '_')
  const safeTitle = (item.name || '未知歌曲').replace(/[\\/:*?"<>|]/g, '_')
  a.download = `${safeArtist} - ${safeTitle} [${item.qualityBadge}].${item.format}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(blobUrl), 15000)
}

// 单首删除
const handleDelete = async (id: string | number) => {
  if (confirm('确定要从本地离线库删除这首音乐吗？')) {
    await downloadStore.deleteDownload(id)
    selectedIds.value.delete(id)
  }
}

// 清空全部
const handleClearAll = async () => {
  if (confirm('确定要清空全部离线下载音乐吗？这会释放本地存储。')) {
    await downloadStore.clearDownloads()
    selectedIds.value.clear()
    isBatchMode.value = false
  }
}

// ══════ 批量操作 ══════
const toggleBatchMode = () => {
  isBatchMode.value = !isBatchMode.value
  selectedIds.value.clear()
}

const toggleSelect = (id: string | number) => {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
}

const isAllSelected = computed(() => {
  return (
    filteredDownloads.value.length > 0 &&
    filteredDownloads.value.every((item) => selectedIds.value.has(item.id))
  )
})

const toggleSelectAll = () => {
  if (isAllSelected.value) {
    selectedIds.value.clear()
  } else {
    selectedIds.value = new Set(filteredDownloads.value.map((i) => i.id))
  }
}

const handleBatchDelete = async () => {
  if (selectedIds.value.size === 0) return
  if (confirm(`确定要批量删除选中的 ${selectedIds.value.size} 首音乐吗？`)) {
    await downloadStore.deleteMultiple(Array.from(selectedIds.value))
    selectedIds.value.clear()
  }
}

const handleBatchExport = () => {
  if (selectedIds.value.size === 0) return
  const toExport = downloads.value.filter((d) => selectedIds.value.has(d.id))
  toExport.forEach((item, idx) => {
    setTimeout(() => {
      handleExport(item)
    }, idx * 300)
  })
}

const formatSize = (bytes: number) => {
  if (!bytes) return '0 B'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatDate = (timestamp: number) => {
  if (!timestamp) return '-'
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const formatSongTitle = (title: string, maxLen = 28) => {
  if (!title) return ''
  return title.length > maxLen ? title.slice(0, maxLen) + '...' : title
}
</script>

<template>
  <div class="flex flex-1 flex-col overflow-hidden p-4 sm:p-6">
    <!-- 头部卡片 (Hero) -->
    <section class="relative mb-6 shrink-0 overflow-hidden">
      <!-- 渐变光晕背景 -->
      <div class="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
        <div class="h-full w-full scale-110 bg-gradient-to-br from-pink-500/20 via-purple-600/20 to-blue-500/20 blur-3xl"></div>
      </div>

      <!-- 内容区 -->
      <div class="relative z-10 overflow-hidden rounded-3xl">
        <div class="glass-container p-6 md:p-8">
          <div class="flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
            <div class="flex items-center gap-4.5">
              <div
                class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-purple-600 shadow-xl shadow-pink-500/25 ring-1 ring-white/20"
              >
                <span class="icon-[mdi--tray-arrow-down] h-8 w-8 text-white" />
              </div>
              <div>
                <div class="flex items-center gap-3">
                  <h1 class="text-2xl font-bold text-primary md:text-3xl">
                    下载列表 · 离线音乐库
                  </h1>
                  <span class="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
                    <span class="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    离线即播就绪
                  </span>
                </div>
                <p class="mt-1 text-sm text-primary/65">
                  本地 IndexedDB 高保真无损存储 · 断网免流无缝收听 · 原声独立文件导出
                </p>

                <!-- 统计徽章 (仅在库中有歌曲时展示) -->
                <div v-if="downloads.length > 0" class="mt-3.5 flex flex-wrap items-center gap-4 text-xs text-primary/65">
                  <div class="flex items-center gap-1.5">
                    <span class="icon-[mdi--music-note] h-4 w-4 text-pink-400"></span>
                    <span>共 {{ downloadStore.totalCount }} 首音乐</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="icon-[mdi--database] h-4 w-4 text-purple-400"></span>
                    <span>占用空间 {{ downloadStore.totalSizeFormatted }}</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="icon-[mdi--sparkles] h-4 w-4 text-amber-400"></span>
                    <span>SQ 无损 {{ sqCount }} 首</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 操作按钮组 -->
            <div class="flex flex-wrap items-center gap-2.5">
              <template v-if="downloads.length > 0">
                <Button
                  variant="gradient"
                  size="md"
                  rounded="full"
                  class="px-5 py-2.5 text-xs font-bold shadow-lg shadow-pink-500/30 hover:shadow-xl hover:shadow-pink-500/40"
                  @click="playAll"
                >
                  <span class="icon-[mdi--play] mr-1.5 h-4 w-4"></span>
                  播放全部
                </Button>
                <Button
                  variant="soft"
                  size="md"
                  rounded="full"
                  class="px-4 py-2.5 text-xs font-semibold text-primary/80"
                  @click="shufflePlay"
                >
                  <span class="icon-[mdi--shuffle] mr-1.5 h-4 w-4"></span>
                  随机播放
                </Button>
              </template>
              <Button
                v-else
                variant="gradient"
                size="md"
                rounded="full"
                class="px-5 py-2.5 text-xs font-bold shadow-lg shadow-pink-500/25"
                @click="router.push('/search')"
              >
                <span class="icon-[mdi--compass-outline] mr-1.5 h-4 w-4"></span>
                去发现优质音乐
              </Button>
              <Button
                v-if="downloads.length > 0"
                variant="glass"
                size="md"
                rounded="full"
                class="px-4 py-2.5 text-xs font-semibold"
                :class="isBatchMode ? 'border-pink-500 text-pink-300' : 'text-primary/75'"
                @click="toggleBatchMode"
              >
                <span class="icon-[mdi--checkbox-multiple-marked-outline] mr-1 h-4 w-4"></span>
                {{ isBatchMode ? '退出批量' : '批量管理' }}
              </Button>
              <Button
                v-if="downloads.length > 0"
                variant="ghost"
                size="md"
                rounded="full"
                class="text-primary/60 hover:text-red-400 text-xs px-3"
                @click="handleClearAll"
                title="清空离线音乐库"
              >
                <span class="icon-[mdi--delete-sweep-outline] mr-1 h-4 w-4"></span>
                清空
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 交互与过滤工具栏 -->
    <div
      v-if="downloads.length > 0"
      class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-md"
    >
      <!-- 左侧：搜索与音质筛选 -->
      <div class="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
        <!-- 搜索输入框 -->
        <div class="relative w-56 sm:w-64">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索歌名、歌手、专辑..."
            class="w-full rounded-xl border border-white/10 bg-white/5 py-1.5 pr-8 pl-8.5 text-xs text-primary placeholder-primary/40 focus:border-pink-500/50 focus:bg-white/10 focus:outline-none transition-all"
          />
          <span class="icon-[mdi--magnify] absolute top-1/2 left-2.5 -translate-y-1/2 h-4 w-4 text-primary/40"></span>
          <button
            v-if="searchQuery"
            @click="searchQuery = ''"
            class="absolute top-1/2 right-2 -translate-y-1/2 p-0.5 text-primary/40 hover:text-primary"
          >
            <span class="icon-[mdi--close-circle] h-3.5 w-3.5"></span>
          </button>
        </div>

        <!-- 音质过滤 Pills -->
        <div class="flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/5">
          <button
            @click="selectedQualityFilter = 'all'"
            class="rounded-lg px-2.5 py-1 text-xs font-medium transition-all"
            :class="selectedQualityFilter === 'all' ? 'bg-pink-500 text-white font-bold shadow-sm' : 'text-primary/60 hover:text-primary'"
          >
            全部 ({{ downloads.length }})
          </button>
          <button
            @click="selectedQualityFilter = 'lossless'"
            class="rounded-lg px-2.5 py-1 text-xs font-medium transition-all"
            :class="selectedQualityFilter === 'lossless' ? 'bg-pink-500 text-white font-bold shadow-sm' : 'text-primary/60 hover:text-primary'"
          >
            SQ 无损 ({{ sqCount }})
          </button>
          <button
            @click="selectedQualityFilter = 'exhigh'"
            class="rounded-lg px-2.5 py-1 text-xs font-medium transition-all"
            :class="selectedQualityFilter === 'exhigh' ? 'bg-pink-500 text-white font-bold shadow-sm' : 'text-primary/60 hover:text-primary'"
          >
            HQ 极高 ({{ hqCount }})
          </button>
          <button
            @click="selectedQualityFilter = 'standard'"
            class="rounded-lg px-2.5 py-1 text-xs font-medium transition-all"
            :class="selectedQualityFilter === 'standard' ? 'bg-pink-500 text-white font-bold shadow-sm' : 'text-primary/60 hover:text-primary'"
          >
            标准 ({{ standardCount }})
          </button>
        </div>
      </div>

      <!-- 右侧：排序方式 -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-primary/50">排序:</span>
        <select
          v-model="sortBy"
          class="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-primary/80 focus:border-pink-500/50 focus:outline-none"
        >
          <option value="time" class="bg-neutral-900 text-white">最新下载</option>
          <option value="name" class="bg-neutral-900 text-white">歌曲名称 (A-Z)</option>
          <option value="size" class="bg-neutral-900 text-white">文件体积 (大-小)</option>
          <option value="duration" class="bg-neutral-900 text-white">音频时长 (长-短)</option>
        </select>
      </div>
    </div>

    <!-- 批量管理操作条 (仅在批量模式下展示) -->
    <div
      v-if="isBatchMode && filteredDownloads.length > 0"
      class="mb-3 flex items-center justify-between rounded-xl border border-pink-500/30 bg-pink-500/10 px-4 py-2 backdrop-blur-md"
    >
      <div class="flex items-center gap-3">
        <button
          @click="toggleSelectAll"
          class="flex items-center gap-1.5 text-xs font-semibold text-primary/80 hover:text-primary"
        >
          <div
            class="flex h-4 w-4 items-center justify-center rounded border"
            :class="isAllSelected ? 'bg-pink-500 border-pink-500 text-white' : 'border-white/40'"
          >
            <span v-if="isAllSelected" class="icon-[mdi--check] h-3 w-3"></span>
          </div>
          <span>{{ isAllSelected ? '取消全选' : '全选所有' }}</span>
        </button>
        <span class="text-xs text-primary/50">|</span>
        <span class="text-xs font-semibold text-pink-300">已选中 {{ selectedIds.size }} 首</span>
      </div>

      <div class="flex items-center gap-2">
        <Button
          variant="glass"
          size="sm"
          rounded="lg"
          class="text-xs"
          :disabled="selectedIds.size === 0"
          @click="handleBatchExport"
        >
          <span class="icon-[mdi--tray-arrow-down] mr-1 h-3.5 w-3.5"></span>
          批量导出
        </Button>
        <Button
          variant="soft"
          size="sm"
          rounded="lg"
          class="text-xs text-red-400 hover:bg-red-500/20"
          :disabled="selectedIds.size === 0"
          @click="handleBatchDelete"
        >
          <span class="icon-[mdi--trash-can-outline] mr-1 h-3.5 w-3.5"></span>
          批量删除
        </Button>
      </div>
    </div>

    <!-- 歌曲列表区 (桌面端表格 + 滚动) -->
    <div class="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-0.5 custom-scrollbar">
      <!-- 存在已下载歌曲 -->
      <div v-if="filteredDownloads.length > 0" class="space-y-1.5 pb-6">
        <!-- 表头 (仅桌面端) -->
        <div class="hidden md:grid grid-cols-12 gap-3 px-4 py-2 text-xs font-medium text-primary/40 select-none border-b border-white/5">
          <div class="col-span-1 text-center">#</div>
          <div class="col-span-4">歌曲</div>
          <div class="col-span-2">歌手</div>
          <div class="col-span-2">专辑</div>
          <div class="col-span-1 text-center">音质规格</div>
          <div class="col-span-1 text-right">大小</div>
          <div class="col-span-1 text-center">操作</div>
        </div>

        <!-- 歌曲行 -->
        <div
          v-for="(item, index) in filteredDownloads"
          :key="item.id"
          @dblclick="playSingle(item, index)"
          class="group relative flex items-center justify-between rounded-2xl border p-2.5 md:p-3 transition-all duration-200"
          :class="[
            isCurrentPlaying(item)
              ? 'border-pink-500/40 bg-pink-500/10 shadow-[0_0_18px_rgba(236,72,153,0.15)]'
              : 'border-white/5 bg-white/[0.02] hover:border-pink-500/30 hover:bg-white/[0.06] hover:shadow-md'
          ]"
        >
          <!-- 批量选择框 (在批量模式下) -->
          <div
            v-if="isBatchMode"
            @click.stop="toggleSelect(item.id)"
            class="mr-3 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border transition-all"
            :class="selectedIds.has(item.id) ? 'bg-pink-500 border-pink-500 text-white' : 'border-white/30'"
          >
            <span v-if="selectedIds.has(item.id)" class="icon-[mdi--check] h-3.5 w-3.5"></span>
          </div>

          <!-- 左侧：序号与封面 -->
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <!-- 序号 / 播放动画 -->
            <div class="w-7 shrink-0 text-center">
              <div v-if="isCurrentPlaying(item)" class="flex items-center justify-center gap-0.5">
                <span class="w-0.5 h-3.5 bg-pink-400 rounded-full animate-pulse"></span>
                <span class="w-0.5 h-2 bg-pink-400 rounded-full animate-pulse delay-75"></span>
                <span class="w-0.5 h-3 bg-pink-400 rounded-full animate-pulse delay-150"></span>
              </div>
              <span v-else class="font-mono text-xs text-primary/40 group-hover:hidden">
                {{ String(index + 1).padStart(2, '0') }}
              </span>
              <button
                v-if="!isCurrentPlaying(item)"
                @click.stop="playSingle(item, index)"
                class="hidden group-hover:inline-flex items-center justify-center text-pink-400"
              >
                <span class="icon-[mdi--play] h-4 w-4"></span>
              </button>
            </div>

            <!-- 封面艺术图 -->
            <div class="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl shadow-md border border-white/10">
              <img
                :src="formatCoverUrl(item.cover, { size: 100, artist: item.artist })"
                alt="cover"
                class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <button
                @click.stop="playSingle(item, index)"
                class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <span class="icon-[mdi--play] h-5 w-5 text-white"></span>
              </button>
            </div>

            <!-- 歌名与标签 -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h3
                  :title="item.name"
                  class="truncate text-sm font-semibold transition-colors"
                  :class="isCurrentPlaying(item) ? 'text-pink-300 font-bold' : 'text-primary group-hover:text-pink-300'"
                >
                  {{ formatSongTitle(item.name) }}
                </h3>

                <!-- 音质版本 Tag -->
                <span
                  class="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider leading-none select-none"
                  :class="[
                    item.qualityBadge === 'SQ' || item.qualityLevel === 'lossless'
                      ? 'bg-gradient-to-r from-violet-600/35 to-pink-600/35 text-pink-300 border border-pink-500/40 shadow-[0_0_8px_rgba(236,72,153,0.2)]'
                      : item.qualityBadge === 'HQ' || item.qualityLevel === 'exhigh'
                        ? 'bg-indigo-500/25 text-indigo-300 border border-indigo-500/30'
                        : 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/30'
                  ]"
                >
                  {{ item.qualityBadge === 'SQ' || item.qualityLevel === 'lossless' ? 'SQ 无损' : item.qualityBadge === 'HQ' ? 'HQ 极高' : '标准' }}
                </span>
                <span class="hidden sm:inline-block rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-primary/50 uppercase border border-white/5">
                  {{ item.format }}
                </span>
              </div>
              <p class="mt-0.5 truncate text-xs text-primary/60 md:hidden">
                {{ item.artist }}
                <span v-if="item.album"> · 《{{ item.album }}》</span>
              </p>
            </div>
          </div>

          <!-- 桌面端中段：歌手、专辑 -->
          <div class="hidden md:flex items-center gap-4 flex-1 max-w-[38%] px-3">
            <span :title="item.artist" class="w-1/2 truncate text-xs text-primary/75">
              {{ item.artist || '-' }}
            </span>
            <span :title="item.album" class="w-1/2 truncate text-xs text-primary/55">
              {{ item.album || '-' }}
            </span>
          </div>

          <!-- 右侧：文件大小、时长与操作按钮 -->
          <div class="flex items-center gap-3 shrink-0 pl-2">
            <span class="hidden lg:inline-block font-mono text-xs text-primary/45 w-16 text-right">
              {{ formatSize(item.fileSize) }}
            </span>
            <span class="hidden sm:inline-block font-mono text-xs text-primary/50 w-12 text-right">
              {{ formatDuration((item.duration || 0) * 1000) }}
            </span>

            <!-- 操作按钮 -->
            <div class="flex items-center gap-1 opacity-90 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon-sm"
                rounded="full"
                class="text-primary/70 hover:text-pink-400"
                icon="icon-[mdi--play]"
                icon-class="h-4 w-4"
                title="播放"
                @click.stop="playSingle(item, index)"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                rounded="full"
                class="text-primary/70 hover:text-primary"
                icon="icon-[mdi--tray-arrow-down]"
                icon-class="h-4 w-4"
                title="导出独立音频文件"
                @click.stop="handleExport(item)"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                rounded="full"
                class="text-primary/60 hover:text-red-400"
                icon="icon-[mdi--trash-can-outline]"
                icon-class="h-4 w-4"
                title="从离线库删除"
                @click.stop="handleDelete(item.id)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态：搜索无结果 -->
      <div
        v-else-if="searchQuery"
        class="flex h-full min-h-[260px] flex-col items-center justify-center py-16 text-center"
      >
        <div class="mb-3 rounded-2xl bg-white/5 p-4 border border-white/5">
          <span class="icon-[mdi--text-search] h-10 w-10 text-primary/30"></span>
        </div>
        <h3 class="text-sm font-bold text-primary">未找到与 "{{ searchQuery }}" 匹配的已下载音乐</h3>
        <p class="mt-1 text-xs text-primary/50">请尝试更换检索关键词或音质筛选条件</p>
        <Button
          variant="glass"
          size="sm"
          rounded="full"
          class="mt-4 px-4 py-1.5 text-xs"
          @click="searchQuery = ''"
        >
          重置搜索条件
        </Button>
      </div>

      <!-- 空状态：暂无下载歌曲 -->
      <div
        v-else
        class="flex h-full min-h-[320px] flex-col items-center justify-center py-16 text-center"
      >
        <div class="mb-4 rounded-3xl bg-white/5 p-6 border border-white/10 shadow-lg">
          <span class="icon-[mdi--music-box-outline] h-14 w-14 text-pink-400/40"></span>
        </div>
        <h3 class="text-lg font-bold text-primary">暂无本地下载音乐</h3>
        <p class="mt-1.5 max-w-sm text-xs text-primary/55 leading-relaxed">
          在任意歌曲列表、检索结果或底部播放栏点击「下载」，即可选择无损、极高或标准音质保存到本地离线库。随时随地零流量播放！
        </p>
        <Button
          variant="gradient"
          size="md"
          rounded="full"
          class="mt-6 px-6 py-2.5 text-xs font-bold shadow-lg shadow-pink-500/25"
          @click="router.push('/search')"
        >
          <span class="icon-[mdi--compass-outline] mr-1.5 h-4 w-4"></span>
          去发现优质音乐
        </Button>
      </div>
    </div>
  </div>
</template>
