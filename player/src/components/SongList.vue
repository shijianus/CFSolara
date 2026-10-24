<script setup lang="ts">
import { useAudio } from '@/composables/useAudio'
import { useSharedElement } from '@/composables/useSharedElement'
import type { Song } from '@/stores/interface'
import { formatDurationOrDash } from '@/utils/time'
import { RouterLink, useRouter } from 'vue-router'
import LazyImage from '@/components/Ui/LazyImage.vue'
import { useI18n } from 'vue-i18n'
import { formatCoverUrl } from '@/utils/imageUrl'
import { useDownloadStore } from '@/stores/modules/download'
import { useLibraryStore } from '@/stores/modules/library'
import { prefersReducedMotion } from '@/utils/motion'

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
        createRipple(event, container, 'rgba(56,189,248, 0.3)')
      }
    }

    // 减少动效偏好下直接播放，不执行飞行动画
    if (prefersReducedMotion()) {
      setPlaylist(props.songs, index)
      play(props.songs[index], index)
      emit('play', song, index)
      return
    }

    // 如果能获取到元素，执行飞行动画
    if (sourceCover && targetCover && song.cover) {
      // 先设置播放列表
      setPlaylist(props.songs, index)

      // 执行抛物线飞行动画
      await flyTo(sourceCover, targetCover, formatCoverUrl(song.cover, { size: 128, artist: song.artist }), {
        duration: 0.25,
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

const isCurrent = (s: Song) => {
  const cur = currentSong.value
  if (!cur) return false
  return String(s.id ?? '') === String(cur.id ?? '')
}

// 整行单击即播放；行内链接/按钮保留各自行为
const handleRowActivate = (song: Song, index: number, event: MouseEvent) => {
  const target = event.target as HTMLElement | null
  if (target?.closest('a, button, input, [role="button"]')) return
  playSongWithAnimation(song, index, event)
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
const libraryStore = useLibraryStore()

const isLiked = (song: Song) => libraryStore.isSongLiked(song.id)

const toggleLike = (song: Song) => {
  libraryStore.toggleLikeSong(song)
}

const downloadSong = (song: Song, index: number) => {
  emit('download', song, index)
  downloadStore.openDownloadDialog(song)
}

const isPredominantlyLossless = computed(() => {
  if (!props.songs || props.songs.length === 0) return false
  const sqCount = props.songs.filter(
    s => s.qualityBadge === 'SQ' || s.qualities?.[0]?.level === 'lossless'
  ).length
  return sqCount / props.songs.length >= 0.8
})

const getQualityBadgeInfo = (song: Song) => {
  // 无任何音质数据时不渲染徽章，避免伪造档位
  if (!song.qualityBadge && !(song.qualities && song.qualities.length > 0)) {
    return null
  }
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
        ? `${t('quality.tips.lossless')} · ${t('player.playMode')}`
        : t('quality.tips.lossless'),
      badgeClass: 'bg-sky-500/10 text-sky-300/90 border border-sky-500/25',
    }
  }
  if (isExhigh) {
    return {
      label: 'HQ',
      title: hasMultiple
        ? `${t('quality.tips.exhigh')} · ${t('player.playMode')}`
        : t('quality.tips.exhigh'),
      badgeClass: 'bg-cyan-500/15 text-cyan-300/90 border border-cyan-500/25',
    }
  }
  return {
    label: t('quality.standard'),
    title: t('quality.tips.standard'),
    badgeClass: 'bg-emerald-500/15 text-emerald-300/90 border border-emerald-500/25',
  }
}
</script>

<style scoped>
/* 歌曲项悬停效果 - 移除位移，改用更平滑的背景过渡 */
.song-item {
  transition: all 0.2s ease;
  content-visibility: auto;
  contain-intrinsic-size: auto 53px;
}

/* 窄桌面/平板：隐藏歌手、专辑、时长列，为 44px 操作按钮让出空间 */
@media (max-width: 1100px) {
  .song-list-header {
    display: none;
  }

  .song-grid {
    display: flex;
    align-items: center;
  }

  .song-col-song {
    flex: 1 1 auto;
  }

  .song-col-artist,
  .song-col-album,
  .song-col-duration {
    display: none !important;
  }

  .song-col-actions {
    flex: 0 0 auto;
  }
}

/* 触屏设备没有 hover：行内播放按钮常显，序号让位 */
@media (hover: none) {
  .song-row-play {
    opacity: 1;
  }

  .song-row-index {
    opacity: 0;
  }

  .song-actions-dots {
    display: none;
  }

  .song-actions-toolbar {
    position: static;
    opacity: 1;
  }
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
        class="song-list-header text-primary/60 mb-2 hidden items-center border border-transparent border-b-white/5 py-3 text-xs font-medium tracking-wider uppercase md:flex"
      >
        <div class="w-14 text-center">#</div>
        <div class="song-grid grid min-w-0 flex-1 grid-cols-12 items-center gap-4 px-4">
          <div class="song-col-song col-span-4">{{ t('components.songList.headers.song') }}</div>
          <div class="song-col-artist col-span-2 hidden md:block">
            {{ t('components.songList.headers.artist') }}
          </div>
          <div class="song-col-album col-span-2 hidden text-center md:block">
            {{ t('components.songList.headers.album') }}
          </div>
          <div class="song-col-duration col-span-1 text-right">{{ t('components.songList.headers.duration') }}</div>
          <div class="song-col-actions col-span-3 text-center">{{ t('components.songList.headers.actions') }}</div>
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
          <div class="song-grid grid min-w-0 flex-1 grid-cols-12 items-center gap-4">
            <div class="song-col-song col-span-4 flex items-center space-x-4">
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
          class="song-item group relative flex cursor-pointer items-center rounded-xl p-2 border transition-colors duration-150 overflow-hidden"
          :class="[
            isCurrent(song)
              ? 'border-sky-500/25'
              : 'border-transparent hover:bg-white/10 hover:border-white/10'
          ]"
          :style="isCurrent(song) ? { backgroundColor: 'rgba(56,189,248, 0.14)' } : {}"
          @click="(e: MouseEvent) => handleRowActivate(song, index, e)"
        >
          <!-- 左侧 2px 强调色指示条 (当前播放行) -->
          <span
            v-if="isCurrent(song)"
            class="absolute left-0 top-2 bottom-2 w-[2px] bg-sky-500 rounded-r"
            aria-hidden="true"
          ></span>
          <!-- 序号/播放状态 -->
          <div class="relative flex min-h-11 w-14 shrink-0 items-center justify-center text-center select-none">
            <!-- 未悬停且非当前播放：显示纯数字序号 -->
            <span
              v-if="!isCurrent(song)"
              class="song-row-index font-mono text-xs text-primary/60 transition-opacity duration-150 group-hover:opacity-0"
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
              class="song-row-play absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 text-primary hover:text-sky-400 active:scale-90 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
              :title="t('actions.play')"
              :aria-label="t('actions.play')"
              @click.stop="(e: MouseEvent) => playSongWithAnimation(song, index, e)"
            >
              <span class="icon-[mdi--play] h-5 w-5"></span>
            </button>
          </div>

          <div class="song-grid grid min-w-0 flex-1 grid-cols-12 items-center gap-4">
            <div class="song-col-song col-span-4 flex items-center space-x-4">
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
                    class="text-primary line-clamp-1 text-base font-medium transition-colors group-hover:text-sky-300"
                  >
                    <span class="line-clamp-1">{{ song.name }}</span>
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

            <div class="song-col-artist col-span-2 hidden overflow-hidden md:block">
              <template v-if="song.artists && song.artists.length > 0">
                <span class="text-primary/80 truncate text-sm">
                  <template v-for="(ar, idx) in song.artists" :key="ar.id">
                    <RouterLink
                      v-if="ar.id"
                      :to="`/artist/${ar.id}`"
                      :title="ar.name"
                      class="transition-colors hover:text-sky-400"
                    >
                      {{ ar.name }}
                    </RouterLink>
                    <span v-else :title="ar.name">{{ ar.name }}</span>
                    <span v-if="idx < song.artists.length - 1" class="text-primary/50"> / </span>
                  </template>
                </span>
              </template>
              <template v-else-if="song.artistId">
                <RouterLink
                  :to="`/artist/${song.artistId}`"
                  :title="song.artist"
                  class="text-primary/80 truncate text-sm transition-colors hover:text-sky-400"
                >
                  {{ song.artist }}
                </RouterLink>
              </template>
              <span v-else :title="song.artist" class="text-primary/80 truncate text-sm">
                {{ song.artist }}
              </span>
            </div>

            <div class="song-col-album col-span-2 hidden overflow-hidden text-center md:block">
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
            <div class="song-col-duration col-span-1 flex items-center justify-end">
              <span class="text-primary/50 hidden font-mono text-sm md:inline-block">{{
                formatDurationOrDash(song.duration)
              }}</span>
            </div>
            <!-- 操控按钮 (常态显示低透明度的"···"，悬停显示三个 32px 按钮，间距 8px) -->
            <div class="song-col-actions song-actions relative flex min-h-11 items-center justify-center">
              <!-- 常态：低透明度 (0.5) 更多图标 -->
              <div class="song-actions-dots flex items-center justify-center text-white/50 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">
                <span class="icon-[mdi--dots-horizontal] h-5 w-5"></span>
              </div>

              <!-- 悬停或键盘聚焦时：显示三个 32px 按钮，间距 8px (gap-2) -->
              <div class="song-actions-toolbar absolute inset-0 flex items-center justify-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  class="flex h-11 w-11 items-center justify-center rounded-lg text-white/70 hover:text-sky-400 hover:bg-white/10 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                  :title="t('actions.play')"
                  :aria-label="t('actions.play')"
                  @click.stop="(e: MouseEvent) => playSongWithAnimation(song, index, e)"
                >
                  <span class="icon-[mdi--play] h-4 w-4"></span>
                </button>
                <button
                  v-if="song.mvId"
                  type="button"
                  class="flex h-11 w-11 items-center justify-center rounded-lg text-white/70 hover:text-blue-300 hover:bg-white/10 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                  :title="t('common.playMV')"
                  @click.stop="openMV(song, index)"
                >
                  <span class="icon-[mdi--movie-open-play] h-4 w-4"></span>
                </button>
                <button
                  v-else-if="song.id"
                  type="button"
                  class="flex h-11 w-11 items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                  :title="t('common.detail')"
                  @click.stop="router.push(`/song/${song.id}`)"
                >
                  <span class="icon-[mdi--information-outline] h-4 w-4"></span>
                </button>
                <button
                  type="button"
                  class="flex h-11 w-11 items-center justify-center rounded-lg text-primary/70 hover:text-red-400 hover:bg-hover-glass transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                  :title="isLiked(song) ? t('common.unlike') : t('common.like')"
                  @click.stop="toggleLike(song)"
                >
                  <span
                    :class="isLiked(song) ? 'icon-[mdi--heart]' : 'icon-[mdi--heart-outline]'"
                    class="h-4 w-4"
                  ></span>
                </button>
                <button
                  type="button"
                  class="flex h-11 w-11 items-center justify-center rounded-lg text-white/70 hover:text-sky-400 hover:bg-white/10 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                  :title="t('common.download')"
                  @click.stop="downloadSong(song, index)"
                >
                  <span class="icon-[mdi--tray-arrow-down] h-4 w-4"></span>
                </button>
              </div>
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
