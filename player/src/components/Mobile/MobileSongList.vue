<script setup lang="ts">
import LazyImage from '@/components/Ui/LazyImage.vue'
import { useAudio } from '@/composables/useAudio'
import type { Song } from '@/stores/interface'
import { formatDurationOrDash } from '@/utils/time'
import { formatCoverUrl } from '@/utils/imageUrl'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

type ListVariant = 'compact' | 'card'

interface Props {
  songs: Song[]
  variant?: ListVariant
  showIndex?: boolean
  context?: 'queue' | 'generic'
}
const { playByIndex, setPlaylist, play } = useAudio()

const props = withDefaults(defineProps<Props>(), {
  variant: 'compact',
  showIndex: true,
  context: 'generic',
})

const emit = defineEmits<{
  play: [song: Song, index: number]
}>()

const { currentSong, isPlaying } = useAudio()

const isCurrent = (s: Song) => {
  const cur = currentSong.value
  if (!cur) return false
  return String(s.id) === String(cur.id)
}

const handleClick = (_song: Song, i: number) => {
  if (props.context === 'queue') {
    playByIndex(i)
    return
  }
  // 通用列表：把当前列表整体设为播放队列，并从点击位置开始播放
  const queue = props.songs.slice() as Song[]
  setPlaylist(queue, i)
  play(queue[i], i)
}

const getQualityBadgeInfo = (song: Song) => {
  const isLossless = song.qualityBadge === 'SQ' || song.qualities?.[0]?.level === 'lossless'
  const isExhigh = song.qualityBadge === 'HQ' || song.qualities?.[0]?.level === 'exhigh'
  if (isLossless) {
    return {
      label: t('quality.lossless'),
      title: t('quality.tips.lossless'),
      badgeClass: 'bg-gradient-to-r from-blue-600/30 to-sky-600/30 text-sky-300 border border-sky-500/40',
    }
  }
  if (isExhigh) {
    return {
      label: t('quality.exhigh'),
      title: t('quality.tips.exhigh'),
      badgeClass: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
    }
  }
  return {
    label: t('quality.standard'),
    title: t('quality.tips.standard'),
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  }
}
</script>

<template>
  <div v-if="variant === 'card'" class="space-y-2">
    <button
      v-for="(song, index) in songs"
      :key="song.id + '-' + index"
      type="button"
      class="group flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-all duration-300"
      :class="isCurrent(song) ? 'song-item-active' : ''"
      :aria-label="`${song.name} - ${song.artist}`"
      @click="handleClick(song, index)"
    >
      <div class="song-cover relative h-14 w-14 shrink-0 overflow-hidden rounded-xl">
        <LazyImage
          :src="formatCoverUrl(song.cover, { size: 200, artist: song.artist })"
          :fallback-src="formatCoverUrl('', { artist: song.artist })"
          alt="cover"
          imgClass="h-full w-full object-cover"
        />
        <div
          v-if="isCurrent(song)"
          class="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        >
          <span
            class="text-primary h-6 w-6"
            :class="isPlaying ? 'icon-[mdi--pause] animate-pulse' : 'icon-[mdi--play]'"
          />
        </div>
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <p
            :title="song.name"
            class="song-name line-clamp-1 text-sm font-medium"
            :class="isCurrent(song) ? 'text-sky-400' : ''"
          >
            {{ song.name }}
          </p>
          <span
            v-if="song.qualityBadge || (song.qualities && song.qualities.length > 0)"
            :title="getQualityBadgeInfo(song).title"
            class="shrink-0 inline-flex items-center px-1.5 py-0.2 rounded text-[11px] font-bold leading-none select-none"
            :class="getQualityBadgeInfo(song).badgeClass"
          >
            {{ getQualityBadgeInfo(song).label }}
          </span>
        </div>
        <p class="song-artist mt-0.5 truncate text-xs">
          {{ song.artist }}<template v-if="song.album"> - 《{{ song.album }}》</template>
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span class="song-duration text-xs">{{ formatDurationOrDash(song.duration) }}</span>
        <div v-if="isCurrent(song)" class="playing-icon">
          <span class="bar" :class="{ animate: isPlaying }"></span>
          <span class="bar" :class="{ animate: isPlaying }"></span>
          <span class="bar" :class="{ animate: isPlaying }"></span>
        </div>
      </div>
    </button>
  </div>

  <div v-else class="overflow-hidden py-2">
    <button
      v-for="(song, index) in songs"
      :key="song.id"
      type="button"
      class="song-item-compact group flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-all duration-200"
      :class="isCurrent(song) ? 'song-item-active' : ''"
      :aria-label="`${song.name} - ${song.artist}`"
      @click="handleClick(song, index)"
    >
      <div v-if="showIndex" class="w-6 shrink-0 text-center">
        <div v-if="isCurrent(song)" class="playing-icon">
          <span class="bar" :class="{ animate: isPlaying }"></span>
          <span class="bar" :class="{ animate: isPlaying }"></span>
          <span class="bar" :class="{ animate: isPlaying }"></span>
        </div>
        <span
          v-else
          class="song-index text-xs font-bold"
          :class="index < 3 ? 'text-sky-400' : ''"
          >{{ index + 1 }}</span
        >
      </div>
      <div class="song-cover-small relative h-11 w-11 shrink-0 overflow-hidden rounded-lg">
        <LazyImage
          :src="formatCoverUrl(song.cover, { size: 100, artist: song.artist })"
          :fallback-src="formatCoverUrl('', { artist: song.artist })"
          alt="cover"
          imgClass="h-full w-full object-cover"
        />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <p
            :title="song.name"
            class="song-name line-clamp-1 text-sm font-medium"
            :class="isCurrent(song) ? 'text-sky-400' : ''"
          >
            {{ song.name }}
          </p>
          <span
            v-if="song.qualityBadge || (song.qualities && song.qualities.length > 0)"
            :title="getQualityBadgeInfo(song).title"
            class="shrink-0 inline-flex items-center px-1.5 py-0.2 rounded text-[11px] font-bold leading-none select-none"
            :class="getQualityBadgeInfo(song).badgeClass"
          >
            {{ getQualityBadgeInfo(song).label }}
          </span>
        </div>
        <p class="song-artist mt-0.5 truncate text-xs">
          {{ song.artist }}<template v-if="song.album"> - 《{{ song.album }}》</template>
        </p>
      </div>
      <span class="song-duration shrink-0 text-xs">{{ formatDurationOrDash(song.duration) }}</span>
    </button>
  </div>
</template>

<style scoped>
.song-item,
.song-item-compact {
  content-visibility: auto;
  contain-intrinsic-size: auto 64px;
}

.song-item {
  background: var(--glass-interactive-hover-muted);
}

.song-item:active:not(.song-item-active) {
  background: var(--glass-interactive-bg);
}

.song-item-active {
  background: linear-gradient(to right, rgba(56,189,248, 0.2), rgba(37,99,235, 0.2));
}

:root.dark .song-item-active,
html.dark .song-item-active {
  background: linear-gradient(to right, rgba(56,189,248, 0.25), rgba(37,99,235, 0.25));
}

.song-item-compact:not(.song-item-active):active {
  background: var(--glass-interactive-hover-muted);
}

.song-cover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

:root.dark .song-cover,
html.dark .song-cover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.song-cover-small {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

:root.dark .song-cover-small,
html.dark .song-cover-small {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.song-name {
  color: var(--glass-text-primary);
}

.song-artist {
  color: var(--glass-text-primary);
  opacity: 0.66;
}

.song-duration {
  color: var(--glass-text-primary);
  opacity: 0.65;
}

.song-index {
  color: var(--glass-text-primary);
  opacity: 0.72;
}
</style>
