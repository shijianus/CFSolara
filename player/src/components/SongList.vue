<script setup lang="ts">
import { useAudio } from '@/composables/useAudio'
import { useSharedElement } from '@/composables/useSharedElement'
import type { Song } from '@/stores/interface'
import { formatDuration } from '@/utils/time'
import { RouterLink, useRouter } from 'vue-router'
import LazyImage from '@/components/Ui/LazyImage.vue'
import Button from '@/components/Ui/Button.vue'
import { useI18n } from 'vue-i18n'
import { formatCoverUrl } from '@/utils/imageUrl'
import { useDownloadStore } from '@/stores/modules/download'

interface Props {
  songs: Song[]
  currentPlayingIndex?: number
  showHeader?: boolean
  showControls?: boolean
  emptyMessage?: string
  loading?: boolean
}

interface Emits {
  (e: 'play', song: Song, index: number): void
  (e: 'like', song: Song, index: number): void
  (e: 'more', song: Song, index: number): void
  (e: 'sort'): void
  (e: 'filter'): void
  (e: 'mv', song: Song, index: number): void
  (e: 'download', song: Song, index: number): void
}

const props = withDefaults(defineProps<Props>(), {
  currentPlayingIndex: -1,
  showHeader: true,
  showControls: true,
  emptyMessage: '',
  loading: false,
})

const emit = defineEmits<Emits>()
const router = useRouter()
const { setPlaylist, play, currentSong, isPlaying } = useAudio()
const { t } = useI18n()
const { flyTo, createRipple } = useSharedElement()

// 歌曲封面飞行动画
const playSongWithAnimation = async (song: Song, index: number, event?: MouseEvent) => {
  try {
    // 获取源封面元素和目标元素
    const sourceCover = document.getElementById(`song-cover-${song.id}`)
    const targetCover = document.getElementById('footer-cover')

    // 如果有点击事件，添加涟漪效果
    if (event && sourceCover) {
      const container = sourceCover.closest('.song-item') as HTMLElement
      if (container) {
        createRipple(event, container, 'rgba(236, 72, 153, 0.3)')
      }
    }

    // 如果能获取到元素，执行飞行动画
    if (sourceCover && targetCover && song.cover) {
      // 先设置播放列表
      setPlaylist(props.songs, index)

      // 执行抛物线飞行动画
      await flyTo(sourceCover, targetCover, formatCoverUrl(song.cover, { size: 128, artist: song.artist }), {
        duration: 0.55,
        ease: 'power2.out',
        borderRadius: { from: '8px', to: '8px' },
        scale: { from: 1, to: 1 },
        onComplete: () => {
          // 动画完成后播放
          play(props.songs[index], index)
        }
      })
    } else {
      // 降级：直接播放
      setPlaylist(props.songs, index)
      play(props.songs[index], index)
    }

    emit('play', song, index)
  } catch {}
}

const playSong = async (song: Song, index: number) => {
  await playSongWithAnimation(song, index)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _playSong = playSong // 保留以备将来使用

const isCurrent = (s: Song) => {
  const cur = currentSong.value
  if (!cur) return false
  return String(s.id ?? '') === String(cur.id ?? '')
}

const openMV = (song: Song, index: number) => {
  const id = song.mvId || song.id
  if (id) {
    router.push(`/mv-player/${id}`)
  } else {
    emit('mv', song, index)
  }
}

const downloadStore = useDownloadStore()

const downloadSong = (song: Song, index: number) => {
  emit('download', song, index)
  downloadStore.openDownloadDialog(song)
}

const MAX_TITLE_LEN = 28
const formatSongTitle = (title: string, maxLen = MAX_TITLE_LEN) => {
  if (!title) return ''
  return title.length > maxLen ? title.slice(0, maxLen) + '...' : title
}

const isPredominantlyLossless = computed(() => {
  if (!props.songs || props.songs.length === 0) return false
  const sqCount = props.songs.filter(
    s => s.qualityBadge === 'SQ' || s.qualities?.[0]?.level === 'lossless'
  ).length
  return sqCount / props.songs.length >= 0.8
})

const getQualityBadgeInfo = (song: Song) => {
  const isLossless = song.qualityBadge === 'SQ' || song.qualities?.[0]?.level === 'lossless'
  const isExhigh = song.qualityBadge === 'HQ' || song.qualities?.[0]?.level === 'exhigh'
  const hasMultiple = Boolean(song.qualities && song.qualities.length > 1)

  // 当绝大多数（80%以上）曲目均为 SQ 无损时，不逐行重复贴大徽章；仅标明例外或留作底栏切换
  if (isPredominantlyLossless.value && isLossless) {
    return null
  }

  if (isLossless) {
    return {
      label: 'SQ',
      title: hasMultiple
        ? `SQ: 超清无损母带 (含 ${song.qualities?.length} 档音质可在底栏切换)`
        : 'SQ: 超清无损母带音质 (FLAC / 16~24bit)',
      badgeClass: 'bg-pink-500/10 text-pink-300/90 border border-pink-500/25',
    }
  }
  if (isExhigh) {
    return {
      label: 'HQ',
      title: hasMultiple
        ? `HQ: 极高音质 (含 ${song.qualities?.length} 档音质可在底栏切换)`
        : 'HQ: 极高音质 (320Kbps MP3)',
      badgeClass: 'bg-cyan-500/15 text-cyan-300/90 border border-cyan-500/25',
    }
  }
  return {
    label: '标准',
    title: '标准: 标清流畅音质 (128Kbps MP3)',
    badgeClass: 'bg-emerald-500/15 text-emerald-300/90 border border-emerald-500/25',
  }
}
</script>

<style scoped>
/* 歌曲项悬停效果 - 移除位移，改用更平滑的背景过渡 */
.song-item {
  transition: all 0.2s ease;
  content-visibility: auto;
  contain-intrinsic-size: 0 56px;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .song-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .song-item .w-12,
  .song-item .w-24,
  .song-item .w-20 {
    width: auto;
  }
}
</style>
<template>
  <div class="flex h-full flex-col overflow-hidden">
    <div class="glass-card flex flex-1 flex-col overflow-hidden p-2">
      <!-- 列表头部 -->
      <div
        v-if="showHeader"
        class="text-primary/60 mb-2 hidden items-center border-b border-white/5 py-3 text-xs font-medium tracking-wider uppercase md:flex"
      >
        <div class="w-14 text-center">#</div>
        <div class="grid min-w-0 flex-1 grid-cols-12 items-center gap-4 px-4">
          <div class="col-span-4">{{ t('components.songList.headers.song') }}</div>
          <div class="col-span-3 hidden md:block">
            {{ t('components.songList.headers.artist') }}
          </div>
          <div class="col-span-2 hidden text-center md:block">
            {{ t('components.songList.headers.album') }}
          </div>
          <div class="col-span-1 text-right">{{ t('components.songList.headers.duration') }}</div>
          <div class="col-span-2 text-center">{{ t('components.songList.headers.actions') }}</div>
        </div>
      </div>

      <!-- Loading 骨架屏 -->
      <div v-if="loading" class="custom-scrollbar h-full space-y-1 overflow-x-hidden overflow-y-auto pr-2">
        <div
          v-for="i in 12"
          :key="i"
          class="flex items-center rounded-xl p-2"
        >
          <div class="flex w-14 shrink-0 items-center justify-center">
            <div class="h-4 w-4 animate-pulse rounded bg-white/10"></div>
          </div>
          <div class="grid min-w-0 flex-1 grid-cols-12 items-center gap-4">
            <div class="col-span-4 flex items-center space-x-4">
              <div class="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-white/10"></div>
              <div class="min-w-0 flex-1 space-y-2">
                <div class="h-4 w-3/4 animate-pulse rounded bg-white/10"></div>
                <div class="h-3 w-1/2 animate-pulse rounded bg-white/10 md:hidden"></div>
              </div>
            </div>
            <div class="col-span-3 hidden md:block">
              <div class="h-4 w-2/3 animate-pulse rounded bg-white/10"></div>
            </div>
            <div class="col-span-2 hidden md:block">
              <div class="mx-auto h-4 w-1/2 animate-pulse rounded bg-white/10"></div>
            </div>
            <div class="col-span-1 flex justify-end">
              <div class="h-4 w-10 animate-pulse rounded bg-white/10"></div>
            </div>
            <div class="col-span-2 flex justify-center gap-1">
              <div class="h-8 w-8 animate-pulse rounded-full bg-white/10"></div>
              <div class="h-8 w-8 animate-pulse rounded-full bg-white/10"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 歌曲列表 -->
      <div
        v-else-if="songs.length > 0"
        class="custom-scrollbar h-full space-y-1 overflow-x-hidden overflow-y-auto pr-2"
      >
        <div
          v-for="(song, index) in songs"
          :key="song.id || index"
          class="song-item group flex cursor-pointer items-center rounded-xl p-2 hover:bg-white/10"
          :class="isCurrent(song) ? 'bg-white/10' : ''"
          @dblclick="(e) => playSongWithAnimation(song, index, e)"
        >
          <!-- 序号/播放状态 -->
          <div class="relative flex w-14 shrink-0 items-center justify-center text-center select-none">
            <!-- 未悬停且非当前播放：显示纯数字序号 -->
            <span
              v-if="!isCurrent(song)"
              class="font-mono text-xs text-primary/60 transition-opacity duration-150 group-hover:opacity-0"
            >
              {{ index + 1 }}
            </span>

            <!-- 当前播放状态：动效均衡器柱 -->
            <div v-else class="playing-icon flex items-center justify-center gap-0.5">
              <span class="bar" :class="{ animate: isPlaying }"></span>
              <span class="bar" :class="{ animate: isPlaying }"></span>
              <span class="bar" :class="{ animate: isPlaying }"></span>
            </div>

            <!-- 悬停时：平滑浮现播放三角按钮 -->
            <button
              v-if="!isCurrent(song)"
              type="button"
              class="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 text-primary hover:text-pink-400 active:scale-90 cursor-pointer"
              :title="t('actions.play') || '播放'"
              @click.stop="(e: MouseEvent) => playSongWithAnimation(song, index, e)"
            >
              <span class="icon-[mdi--play] h-5 w-5"></span>
            </button>
          </div>

          <div class="grid min-w-0 flex-1 grid-cols-12 items-center gap-4">
            <div class="col-span-4 flex items-center space-x-4">
              <div
                :id="`song-cover-${song.id}`"
                class="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg shadow-md transition-shadow group-hover:shadow-lg"
              >
                <LazyImage
                  :src="formatCoverUrl(song.cover, { size: 90, artist: song.artist })"
                  :fallback-src="formatCoverUrl('', { artist: song.artist })"
                  :alt="t('components.songList.coverAlt')"
                  :title="song.name"
                  :seed="song.album || song.artist || song.name"
                  imgClass="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  wrapperClass="h-full w-full"
                />
                <div
                  class="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                ></div>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h3
                    :title="song.name"
                    class="text-primary truncate text-base font-medium transition-colors group-hover:text-pink-300"
                  >
                    {{ formatSongTitle(song.name) }}
                  </h3>
                  <!-- 精炼降噪音质徽章 (全列表以SQ为主时不重复显眼刷屏，只标出例外；多音质收归进交互提示) -->
                  <span
                    v-if="getQualityBadgeInfo(song)"
                    :title="getQualityBadgeInfo(song)!.title"
                    class="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-medium leading-none select-none transition-all cursor-help"
                    :class="getQualityBadgeInfo(song)!.badgeClass"
                  >
                    {{ getQualityBadgeInfo(song)!.label }}
                  </span>
                </div>
                <div class="mt-0.5 flex items-center gap-2 md:hidden">
                  <span class="text-primary/60 truncate text-xs">{{ song.artist }}</span>
                </div>
              </div>
            </div>

            <div class="col-span-3 hidden overflow-hidden md:block">
              <template v-if="song.artists && song.artists.length > 0">
                <span class="text-primary/80 truncate text-sm">
                  <template v-for="(ar, idx) in song.artists" :key="ar.id">
                    <RouterLink
                      :to="`/artist/${ar.id}`"
                      :title="ar.name"
                      class="transition-colors hover:text-pink-400"
                    >
                      {{ ar.name }}
                    </RouterLink>
                    <span v-if="idx < song.artists.length - 1" class="text-primary/50"> / </span>
                  </template>
                </span>
              </template>
              <template v-else-if="song.artistId">
                <RouterLink
                  :to="`/artist/${song.artistId}`"
                  :title="song.artist"
                  class="text-primary/80 truncate text-sm transition-colors hover:text-pink-400"
                >
                  {{ song.artist }}
                </RouterLink>
              </template>
              <span v-else :title="song.artist" class="text-primary/80 truncate text-sm">
                {{ song.artist }}
              </span>
            </div>

            <div class="col-span-2 hidden overflow-hidden text-center md:block">
              <RouterLink
                v-if="song.albumId"
                :to="`/album/${song.albumId}`"
                :title="song.album || '-'"
                class="text-primary/60 hover:text-primary truncate text-sm transition-colors"
              >
                {{ song.album || '-' }}
              </RouterLink>
              <span v-else :title="song.album || '-'" class="text-primary/60 truncate text-sm">
                {{ song.album || '-' }}
              </span>
            </div>
            <div class="col-span-1 flex items-center justify-end">
              <span class="text-primary/50 hidden font-mono text-sm md:inline-block">{{
                formatDuration(song.duration)
              }}</span>
            </div>
            <!-- 操控按钮 (悬停或键盘聚焦时渐现，触屏设备常驻) -->
            <div
              class="col-span-2 flex items-center justify-center gap-1 transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100"
            >
              <Button
                v-if="song.mvId"
                variant="ghost"
                size="icon-sm"
                rounded="full"
                class="h-8 w-8 text-primary/70 hover:text-pink-400"
                icon="icon-[mdi--movie-open-play]"
                iconClass="h-4 w-4"
                :title="t('common.playMV')"
                @click.stop="openMV(song, index)"
              />
              <Button
                v-if="song.id"
                variant="ghost"
                size="icon-sm"
                rounded="full"
                class="h-8 w-8 text-primary/70 hover:text-primary"
                icon="icon-[mdi--information-outline]"
                iconClass="h-4 w-4"
                :title="t('common.detail')"
                @click.stop="router.push(`/song/${song.id}`)"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                rounded="full"
                class="h-8 w-8 text-primary/70 hover:text-pink-400"
                icon="icon-[mdi--tray-arrow-down]"
                iconClass="h-4 w-4"
                :title="t('common.download')"
                @click.stop="downloadSong(song, index)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div
        v-if="!loading && (!songs || songs.length === 0)"
        class="flex h-full flex-col items-center justify-center py-12 text-center"
      >
        <div class="mb-6 rounded-full bg-white/5 p-6">
          <span class="icon-[mdi--music-note-off] text-primary/20 h-12 w-12"></span>
        </div>
        <p class="text-primary/60 text-lg font-medium">
          {{ emptyMessage || t('components.songList.empty') }}
        </p>
      </div>
    </div>
  </div>
</template>
