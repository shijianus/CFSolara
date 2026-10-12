<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDownloadStore } from '@/stores/modules/download'
import { useAudioStore } from '@/stores/modules/audio'
import { formatCoverUrl } from '@/utils/imageUrl'
import { formatDuration } from '@/utils/time'
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

const handleDelete = async (id: string | number) => {
  if (confirm('从本地下载列表删除此歌曲？')) {
    await downloadStore.deleteDownload(id)
  }
}

const formatSongTitle = (title: string, maxLen = 18) => {
  if (!title) return ''
  return title.length > maxLen ? title.slice(0, maxLen) + '...' : title
}
</script>

<template>
  <div class="h-full flex-1 overflow-auto px-4 pb-20 pt-2">
    <!-- 顶部概览 -->
    <div class="mb-5 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-primary flex items-center gap-2">
          <span class="icon-[mdi--tray-arrow-down] h-6 w-6 text-pink-400"></span>
          下载列表
        </h1>
        <p class="mt-1 text-xs text-primary/50">
          共 {{ downloadStore.totalCount }} 首 · 占用 {{ downloadStore.totalSizeFormatted }}
        </p>
      </div>
      <button
        v-if="downloads.length > 0"
        @click="playAll"
        class="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-pink-500/25 active:scale-95 transition-all"
      >
        <span class="icon-[mdi--play] h-4 w-4"></span>
        播放全部
      </button>
    </div>

    <!-- 歌曲列表 -->
    <div v-if="downloads.length > 0" class="space-y-2">
      <div
        v-for="(item, index) in downloads"
        :key="item.id"
        @click="playSingle(item, index)"
        class="flex items-center justify-between rounded-2xl bg-white/[0.03] border border-white/5 p-2.5 active:bg-white/10 transition-colors"
      >
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <img
            :src="formatCoverUrl(item.cover, { size: 100, artist: item.artist })"
            alt="cover"
            class="h-11 w-11 shrink-0 rounded-xl object-cover shadow-sm"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <h4 class="truncate text-sm font-semibold text-primary">
                {{ formatSongTitle(item.name, 16) }}
              </h4>
              <span
                class="shrink-0 rounded px-1.5 py-0.2 text-[9px] font-bold leading-none"
                :class="[
                  item.qualityBadge === 'SQ'
                    ? 'bg-pink-500/25 text-pink-300 border border-pink-500/30'
                    : item.qualityBadge === 'HQ'
                      ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/30'
                      : 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/30'
                ]"
              >
                {{ item.qualityBadge === 'SQ' ? 'SQ 无损' : item.qualityBadge === 'HQ' ? 'HQ 极高' : '标准' }}
              </span>
            </div>
            <p class="truncate text-xs text-primary/50 mt-0.5">
              {{ item.artist }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0 pl-2">
          <span class="text-[11px] text-primary/40 font-mono">
            {{ formatDuration((item.duration || 0) * 1000) }}
          </span>
          <button
            @click.stop="handleDelete(item.id)"
            class="p-1.5 text-primary/40 hover:text-red-400 active:scale-95 transition-colors"
            title="删除"
          >
            <span class="icon-[mdi--trash-can-outline] h-4 w-4"></span>
          </button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="flex flex-col items-center justify-center py-20 text-center">
      <span class="icon-[mdi--download-off-outline] h-12 w-12 text-primary/20 mb-3"></span>
      <p class="text-sm font-semibold text-primary/60">暂无下载音乐</p>
      <p class="text-xs text-primary/40 mt-1 max-w-xs">
        在歌曲列表中点击下载即可离线保存音乐
      </p>
      <button
        @click="router.push('/search')"
        class="mt-4 rounded-full bg-white/10 px-5 py-2 text-xs font-semibold text-primary hover:bg-white/15 active:scale-95 transition-all"
      >
        去搜索歌曲
      </button>
    </div>
  </div>
</template>
