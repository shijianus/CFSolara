<script setup lang="ts">
import { onMounted, computed } from 'vue'
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

const playAll = () => {
  if (!downloads.value.length) return
  const songList: Song[] = downloads.value.map((d) => ({
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
  audioStore.setPlaylist(songList, 0)
  audioStore.playSong(songList[0], 0)
}

const playSingle = (item: any, index: number) => {
  const songList: Song[] = downloads.value.map((d) => ({
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
  audioStore.setPlaylist(songList, index)
  audioStore.playSong(songList[index], index)
}

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
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000)
}

const handleDelete = async (id: string | number) => {
  if (confirm('确定要从本地下载列表中删除这首歌曲吗？')) {
    await downloadStore.deleteDownload(id)
  }
}

const handleClearAll = async () => {
  if (confirm('确定要清空所有已下载音乐吗？这会释放本地存储。')) {
    await downloadStore.clearDownloads()
  }
}

const formatSize = (bytes: number) => {
  if (!bytes) return '0 B'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatDate = (timestamp: number) => {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const formatSongTitle = (title: string, maxLen = 28) => {
  if (!title) return ''
  return title.length > maxLen ? title.slice(0, maxLen) + '...' : title
}
</script>

<template>
  <div class="flex flex-1 flex-col overflow-hidden p-4">
    <!-- 头部卡片 -->
    <section class="relative mb-6 shrink-0 overflow-hidden">
      <!-- 渐变光晕背景 -->
      <div class="absolute inset-0 overflow-hidden rounded-3xl">
        <div class="h-full w-full scale-110 bg-gradient-to-br from-pink-500/20 via-purple-600/20 to-blue-500/20 blur-3xl"></div>
      </div>

      <!-- 内容区 -->
      <div class="relative z-10 overflow-hidden rounded-3xl">
        <div class="glass-container p-6 md:p-8">
          <div class="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
            <div class="flex items-center gap-4">
              <div
                class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-purple-600 shadow-xl shadow-pink-500/25"
              >
                <span class="icon-[mdi--tray-arrow-down] h-8 w-8 text-white" />
              </div>
              <div>
                <h1 class="text-2xl font-bold text-primary md:text-3xl">
                  下载列表
                </h1>
                <p class="mt-1 text-sm text-primary/60">
                  本地离线音乐库 · 随时随地高保真原声播放
                </p>
                <div class="mt-3 flex flex-wrap items-center gap-4 text-xs text-primary/60">
                  <div class="flex items-center gap-1.5">
                    <span class="icon-[mdi--music-note] h-4 w-4 text-pink-400"></span>
                    <span>共 {{ downloadStore.totalCount }} 首音乐</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="icon-[mdi--database] h-4 w-4 text-purple-400"></span>
                    <span>已占用 {{ downloadStore.totalSizeFormatted }} 空间</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="icon-[mdi--check-decagram] h-4 w-4 text-emerald-400"></span>
                    <span>离线可用</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 操作按钮组 -->
            <div class="flex items-center gap-3">
              <Button
                variant="solid"
                size="md"
                rounded="full"
                class="px-6 py-2.5 shadow-lg shadow-pink-500/30 hover:shadow-xl hover:shadow-pink-500/40"
                :disabled="!downloads.length"
                @click="playAll"
              >
                <span class="icon-[mdi--play] mr-1.5 h-4 w-4"></span>
                播放全部
              </Button>
              <Button
                v-if="downloads.length > 0"
                variant="ghost"
                size="md"
                rounded="full"
                class="text-primary/70 hover:text-red-400"
                @click="handleClearAll"
                title="清空全部下载记录"
              >
                <span class="icon-[mdi--delete-outline] mr-1 h-4 w-4"></span>
                清空
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 歌曲列表区 (滚动) -->
    <div class="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-0.5 custom-scrollbar">
      <!-- 存在已下载歌曲 -->
      <div v-if="downloads.length > 0" class="space-y-1.5 pb-6">
        <div
          v-for="(item, index) in downloads"
          :key="item.id"
          @dblclick="playSingle(item, index)"
          class="group relative flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.02] p-3 transition-all duration-200 hover:border-pink-500/30 hover:bg-white/[0.06] hover:shadow-md"
        >
          <!-- 左侧：序号、封面、歌名与标签 -->
          <div class="flex min-w-0 flex-1 items-center gap-3.5">
            <span class="w-6 shrink-0 text-center font-mono text-xs text-primary/40 group-hover:text-pink-400">
              {{ String(index + 1).padStart(2, '0') }}
            </span>
            <div class="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl shadow-md">
              <img
                :src="formatCoverUrl(item.cover, { size: 100, artist: item.artist })"
                alt="cover"
                class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <button
                @click.stop="playSingle(item, index)"
                class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <span class="icon-[mdi--play] h-6 w-6 text-white"></span>
              </button>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h3
                  :title="item.name"
                  class="truncate text-sm font-semibold text-primary transition-colors group-hover:text-pink-300"
                >
                  {{ formatSongTitle(item.name) }}
                </h3>
                <!-- 音质版本 Tag -->
                <span
                  class="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider leading-none select-none"
                  :class="[
                    item.qualityBadge === 'SQ'
                      ? 'bg-gradient-to-r from-violet-600/30 to-pink-600/30 text-pink-300 border border-pink-500/40 shadow-[0_0_8px_rgba(236,72,153,0.2)]'
                      : item.qualityBadge === 'HQ'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  ]"
                  :title="item.qualityBadge === 'SQ' ? '超清无损音质' : item.qualityBadge === 'HQ' ? '极高品质音质' : '标准音质'"
                >
                  {{ item.qualityBadge === 'SQ' ? 'SQ 无损' : item.qualityBadge === 'HQ' ? 'HQ 极高' : '标准' }}
                </span>
                <span class="hidden sm:inline-block rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-white/50 border border-white/5">
                  {{ item.bitrate || item.format.toUpperCase() }}
                </span>
              </div>
              <p class="mt-0.5 truncate text-xs text-primary/60">
                {{ item.artist }}
                <span v-if="item.album"> · 《{{ item.album }}》</span>
              </p>
            </div>
          </div>

          <!-- 右侧：文件大小、下载时间与操作按钮 -->
          <div class="flex items-center gap-4 shrink-0 pl-2">
            <span class="hidden md:inline-block font-mono text-xs text-primary/40">
              {{ formatSize(item.fileSize) }}
            </span>
            <span class="hidden lg:inline-block font-mono text-xs text-primary/30">
              {{ formatDate(item.downloadTime) }}
            </span>
            <span class="font-mono text-xs text-primary/50">
              {{ formatDuration((item.duration || 0) * 1000) }}
            </span>

            <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon-sm"
                rounded="full"
                class="text-primary/60 hover:text-pink-400"
                icon="icon-[mdi--play]"
                icon-class="h-4 w-4"
                title="播放"
                @click.stop="playSingle(item, index)"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                rounded="full"
                class="text-primary/60 hover:text-primary"
                icon="icon-[mdi--tray-arrow-down]"
                icon-class="h-4 w-4"
                title="导出文件到本地"
                @click.stop="handleExport(item)"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                rounded="full"
                class="text-primary/60 hover:text-red-400"
                icon="icon-[mdi--trash-can-outline]"
                icon-class="h-4 w-4"
                title="从下载列表删除"
                @click.stop="handleDelete(item.id)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div
        v-else
        class="flex h-full min-h-[300px] flex-col items-center justify-center py-16 text-center"
      >
        <div class="mb-4 rounded-3xl bg-white/5 p-6 border border-white/5">
          <span class="icon-[mdi--download-off-outline] h-14 w-14 text-primary/20"></span>
        </div>
        <h3 class="text-lg font-bold text-primary">暂无已下载音乐</h3>
        <p class="mt-1 text-xs text-primary/50 max-w-sm">
          在歌曲列表或播放底栏中点击下载按钮，即可选择无损、极高或标准音质保存到本地离线播放。
        </p>
        <Button
          variant="gradient"
          size="sm"
          rounded="full"
          class="mt-5 px-6 py-2"
          @click="router.push('/search')"
        >
          <span class="icon-[mdi--magnify] mr-1.5 h-4 w-4"></span>
          去发现音乐
        </Button>
      </div>
    </div>
  </div>
</template>
