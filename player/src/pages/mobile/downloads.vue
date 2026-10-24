<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDownloadStore } from '@/stores/modules/download'
import { useAudioStore } from '@/stores/modules/audio'
import { formatCoverUrl } from '@/utils/imageUrl'
import { formatDuration } from '@/utils/time'
import type { Song } from '@/stores/interface'
import type { DownloadedSong } from '@/utils/indexedDB'
import { parseAudioBlob, type ParsedAudioMeta, type ResolvedBlobTier } from '@/utils/blobMetadataParser'

const router = useRouter()
const downloadStore = useDownloadStore()
const audioStore = useAudioStore()

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
    // 保持标准默认回退
  }
}

const getParsedMeta = (item: DownloadedSong): ParsedAudioMeta => {
  const idStr = String(item.id)
  return (
    parsedMetaMap.value[idStr] || {
      displayTag: '—',
      detailText: '',
      mismatchWarning: null,
      isLossless: false,
      resolvedTier: 'standard',
    }
  )
}

const getSongActualTier = (item: DownloadedSong): ResolvedBlobTier => {
  return getParsedMeta(item).resolvedTier
}

onMounted(() => {
  downloadStore.loadDownloads()
})

const downloads = computed(() => downloadStore.downloadedList)
const searchQuery = ref('')
const selectedQuality = ref<'all' | 'lossless' | 'exhigh' | 'standard'>('all')

watch(
  downloads,
  (list) => {
    if (list && list.length > 0) {
      list.forEach((item) => parseBlobMetadata(item))
    }
  },
  { immediate: true, deep: true }
)

const filteredDownloads = computed(() => {
  let list = [...downloads.value]
  if (selectedQuality.value === 'lossless') {
    list = list.filter((d) => getSongActualTier(d) === 'lossless')
  } else if (selectedQuality.value === 'exhigh') {
    list = list.filter((d) => getSongActualTier(d) === 'exhigh')
  } else if (selectedQuality.value === 'standard') {
    list = list.filter((d) => getSongActualTier(d) === 'standard')
  }

  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (d) =>
        (d.name || '').toLowerCase().includes(q) ||
        (d.artist || '').toLowerCase().includes(q) ||
        (d.album || '').toLowerCase().includes(q)
    )
  }
  return list
})

const toSongList = (items: typeof downloads.value): Song[] => {
  return items.map((d) => {
    const meta = getParsedMeta(d)
    const badge = meta.isLossless ? 'SQ' : meta.displayTag.includes('320') ? 'HQ' : '标准'
    return {
      id: d.id,
      name: d.name,
      artist: d.artist,
      album: d.album,
      duration: (d.duration || 0) * 1000,
      cover: d.cover,
      url: URL.createObjectURL(d.file),
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

const playAll = () => {
  if (!filteredDownloads.value.length) return
  const songList = toSongList(filteredDownloads.value)
  audioStore.setPlaylist(songList, 0)
  audioStore.playSong(songList[0], 0)
}

const playSingle = (item: any, index: number) => {
  const songList = toSongList(filteredDownloads.value)
  audioStore.setPlaylist(songList, index)
  audioStore.playSong(songList[index], index)
}

const isCurrentPlaying = (item: any) => {
  return String(audioStore.currentSong?.id || '') === String(item.id || '')
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
  if (confirm('确定从本地离线下载中删除此歌曲？')) {
    await downloadStore.deleteDownload(id)
  }
}

const formatSongTitle = (title: string, maxLen = 18) => {
  if (!title) return ''
  return title.length > maxLen ? title.slice(0, maxLen) + '...' : title
}
</script>

<template>
  <div class="h-full flex-1 overflow-auto px-4 pb-24 pt-3 custom-scrollbar">
    <!-- 顶部概览卡片 -->
    <div class="mb-4 rounded-3xl border border-white/10 bg-gradient-to-br from-sky-500/15 via-blue-600/10 to-transparent p-4 backdrop-blur-xl">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-lg shadow-sky-500/30">
            <span class="icon-[mdi--tray-arrow-down] h-6 w-6 text-white"></span>
          </div>
          <div>
            <h1 class="text-lg font-bold text-primary">
              下载列表
            </h1>
            <p v-if="downloads.length > 0" class="text-xs text-primary/60 mt-0.5">
              共 {{ downloadStore.totalCount }} 首 · 占用 {{ downloadStore.totalSizeFormatted }}
            </p>
            <p v-else class="text-xs text-primary/50 mt-0.5">
              暂无离线音乐 · 支持随时免流播放
            </p>
          </div>
        </div>

        <button
          v-if="downloads.length > 0"
          @click="playAll"
          class="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-md shadow-sky-500/30 active:scale-95 transition-all"
        >
          <span class="icon-[mdi--play] h-4 w-4"></span>
          播放全部
        </button>
      </div>

      <!-- 搜索栏 -->
      <div v-if="downloads.length > 0" class="mt-3.5 relative">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索已下载歌曲或歌手..."
          class="w-full rounded-xl border border-white/10 bg-white/5 py-1.5 pr-8 pl-8 text-xs text-primary placeholder-primary/40 focus:outline-none focus:border-sky-500/50"
        />
        <span class="icon-[mdi--magnify] absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-primary/40"></span>
      </div>

      <!-- 快捷标签 -->
      <div v-if="downloads.length > 0" class="mt-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <button
          @click="selectedQuality = 'all'"
          class="rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all shrink-0"
          :class="selectedQuality === 'all' ? 'bg-sky-500 text-white font-bold' : 'bg-white/5 text-primary/60'"
        >
          全部
        </button>
        <button
          @click="selectedQuality = 'lossless'"
          class="rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all shrink-0"
          :class="selectedQuality === 'lossless' ? 'bg-sky-500 text-white font-bold' : 'bg-white/5 text-primary/60'"
        >
          SQ 无损
        </button>
        <button
          @click="selectedQuality = 'exhigh'"
          class="rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all shrink-0"
          :class="selectedQuality === 'exhigh' ? 'bg-sky-500 text-white font-bold' : 'bg-white/5 text-primary/60'"
        >
          HQ 极高
        </button>
        <button
          @click="selectedQuality = 'standard'"
          class="rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all shrink-0"
          :class="selectedQuality === 'standard' ? 'bg-sky-500 text-white font-bold' : 'bg-white/5 text-primary/60'"
        >
          标准
        </button>
      </div>
    </div>

    <!-- 歌曲列表 -->
    <div v-if="filteredDownloads.length > 0" class="space-y-2">
      <div
        v-for="(item, index) in filteredDownloads"
        :key="item.id"
        @click="playSingle(item, index)"
        class="flex items-center justify-between rounded-2xl border p-2.5 transition-all active:scale-[0.99]"
        :class="[
          isCurrentPlaying(item)
            ? 'border-sky-500/50 bg-sky-500/10 shadow-[0_0_15px_rgba(56,189,248,0.15)]'
            : 'border-primary/10 bg-primary/[0.03] active:bg-primary/10'
        ]"
      >
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <!-- 封面艺术图 -->
          <div class="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl shadow-sm border border-primary/10">
            <img
              :src="formatCoverUrl(item.cover, { size: 100, artist: item.artist })"
              alt="cover"
              class="h-full w-full object-cover"
            />
            <div
              v-if="isCurrentPlaying(item)"
              class="absolute inset-0 flex items-center justify-center bg-black/40"
            >
              <div class="flex items-center gap-0.5">
                <span class="w-0.5 h-3 bg-sky-400 rounded-full animate-pulse"></span>
                <span class="w-0.5 h-2 bg-sky-400 rounded-full animate-pulse delay-75"></span>
                <span class="w-0.5 h-3 bg-sky-400 rounded-full animate-pulse delay-150"></span>
              </div>
            </div>
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <h4
                class="truncate text-sm font-semibold text-primary transition-colors"
                :class="{ 'font-bold': isCurrentPlaying(item) }"
              >
                {{ formatSongTitle(item.name, 18) }}
              </h4>
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-mono font-medium leading-none select-none whitespace-nowrap"
                :class="[
                  getParsedMeta(item).isLossless
                    ? 'bg-blue-600/15 text-primary border border-sky-500/50'
                    : getParsedMeta(item).displayTag.includes('320')
                      ? 'bg-blue-500/15 text-primary border border-blue-500/40'
                      : 'bg-primary/10 text-primary/70 border border-primary/20'
                ]"
              >
                {{ getParsedMeta(item).displayTag }}
              </span>
            </div>
            <p class="truncate text-xs text-primary/50 mt-0.5">
              {{ item.artist }}
              <span v-if="item.album"> · 《{{ item.album }}》</span>
            </p>
          </div>
        </div>

        <div class="flex items-center gap-1 shrink-0 pl-2">
          <span class="text-[11px] text-primary/40 font-mono hidden sm:inline-block">
            {{ formatDuration((item.duration || 0) * 1000) }}
          </span>
          <button
            @click.stop="handleExport(item)"
            class="p-1.5 text-primary/45 hover:text-primary active:scale-90 transition-all"
            title="导出音频"
          >
            <span class="icon-[mdi--tray-arrow-down] h-4 w-4"></span>
          </button>
          <button
            @click.stop="handleDelete(item.id)"
            class="p-1.5 text-primary/40 hover:text-red-400 active:scale-90 transition-all"
            title="删除"
          >
            <span class="icon-[mdi--trash-can-outline] h-4 w-4"></span>
          </button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="flex flex-col items-center justify-center py-20 text-center">
      <div class="mb-3 rounded-2xl bg-white/5 p-5 border border-white/5">
        <span class="icon-[mdi--music-box-outline] h-12 w-12 text-sky-400/40"></span>
      </div>
      <p class="text-sm font-semibold text-primary/70">暂无离线音乐</p>
      <p class="text-xs text-primary/40 mt-1 max-w-xs leading-relaxed">
        在歌曲列表或播放控制台点击下载，随时离线播放音乐。
      </p>
      <button
        @click="router.push('/search')"
        class="mt-4 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 px-6 py-2 text-xs font-bold text-white shadow-md shadow-sky-500/25 active:scale-95 transition-all"
      >
        去搜索歌曲
      </button>
    </div>
  </div>
</template>
