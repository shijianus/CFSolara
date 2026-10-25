<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAudioStore } from '@/stores/modules/audio'
import { useLibraryStore } from '@/stores/modules/library'
import { useRecommendStore } from '@/stores/modules/recommend'
import { useToastStore } from '@/stores/modules/toast'
import {
  fetchRecommendDiscover,
  fetchRecommendForYou,
  fetchRecommendTrending,
  type RecommendSongItem,
} from '@/api/recommend'
import LazyImage from '@/components/Ui/LazyImage.vue'
import { formatCoverUrl } from '@/utils/imageUrl'

const props = withDefaults(
  defineProps<{
    compact?: boolean
  }>(),
  {
    compact: false,
  }
)

const { t } = useI18n()
const router = useRouter()
const audioStore = useAudioStore()
const libraryStore = useLibraryStore()
const recommendStore = useRecommendStore()
const toastStore = useToastStore()

type RecommendTab = 'for-you' | 'trending' | 'discover'
type TrendingWindow = '24h' | '7d' | 'surging' | 'new'

const activeTab = ref<RecommendTab>('for-you')
const trendingWindow = ref<TrendingWindow>('7d')
const selectedGenre = ref<string>('')
const explorationTemp = ref<number>(0.55)
const loading = ref<boolean>(false)
const tracks = ref<RecommendSongItem[]>([])
const topProfileTags = ref<string[]>([])
const stationStats = ref<{ activeTracksWithPlays: number; totalCatalogTracks: number }>({
  activeTracksWithPlays: 0,
  totalCatalogTracks: 0,
})

const genreOptions = [
  { label: '全部风格', value: '' },
  { label: '华语流行', value: '华语流行' },
  { label: 'R&B', value: 'R&B' },
  { label: '粤语金曲', value: '粤语流行' },
  { label: '摇滚', value: '摇滚' },
  { label: '民谣', value: '民谣' },
  { label: '独立音乐', value: '独立音乐' },
  { label: '欧美流行', value: '欧美流行' },
  { label: '日语流行', value: '日语流行' },
  { label: '说唱', value: '说唱' },
  { label: '纯音乐', value: '纯音乐' },
]

const tempLevels = computed(() => [
  { label: t('recommend.temperature.safe'), value: 0.25 },
  { label: t('recommend.temperature.balanced'), value: 0.55 },
  { label: t('recommend.temperature.bold'), value: 0.85 },
])

const visibleTracks = computed(() => {
  const maxItems = props.compact ? 6 : 8
  return tracks.value
    .filter((item) => !recommendStore.isSongDisliked(item.canonicalTrackId || item.id))
    .slice(0, maxItems)
})

const currentSongId = computed(() => audioStore.audio.currentSong?.id)

const isCurrentPlaying = (id: string | number) =>
  String(currentSongId.value) === String(id) && audioStore.audio.isPlaying

const formatDuration = (ms?: number) => {
  if (!ms || ms <= 0) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const getBadgeLabel = (song: RecommendSongItem): string => {
  const src = song.scoreSource || song.explanation?.scoreSource || ''
  if (src === 'cfsolara-internal') return t('recommend.badges.internalHot')
  if (src === 'external-chart') return t('recommend.badges.externalRef')
  if (src === 'personalized-interest' || src === 'hybrid-personalized') {
    return t('recommend.badges.personalizedTag')
  }
  if (src === 'content-similarity') return t('recommend.badges.contentMatch')
  return t('recommend.badges.coldStart')
}

const getBadgeClass = (song: RecommendSongItem): string => {
  const src = song.scoreSource || song.explanation?.scoreSource || ''
  if (src === 'cfsolara-internal') {
    return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  }
  if (src === 'external-chart') {
    return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  }
  if (src === 'personalized-interest' || src === 'hybrid-personalized') {
    return 'bg-sky-500/15 text-sky-400 border-sky-500/30'
  }
  return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
}

async function loadRecommendations() {
  loading.value = true
  const headers = recommendStore.buildRequestHeaders(true)
  const count = props.compact ? 8 : 12

  try {
    if (activeTab.value === 'for-you') {
      const res = await fetchRecommendForYou(
        {
          mode: 'for-you',
          count,
          temperature: explorationTemp.value,
        },
        headers
      )
      tracks.value = res.tracks
      const artists = Array.isArray(res.profileSummary?.topArtists)
        ? res.profileSummary.topArtists.slice(0, 3)
        : []
      const genres = Array.isArray(res.profileSummary?.topGenres)
        ? res.profileSummary.topGenres.slice(0, 2)
        : []
      topProfileTags.value = [...artists, ...genres]
    } else if (activeTab.value === 'trending') {
      const res = await fetchRecommendTrending(
        {
          window: trendingWindow.value,
          count,
          personalized: recommendStore.personalizationEnabled,
        },
        headers
      )
      tracks.value = res.tracks
      stationStats.value = res.stationStats
    } else {
      const res = await fetchRecommendDiscover(
        {
          genre: selectedGenre.value || undefined,
          temperature: explorationTemp.value,
          count,
        },
        headers
      )
      tracks.value = res.tracks
    }
  } catch (err) {
    console.warn('SmartDiscoverySection load failed:', err)
  } finally {
    loading.value = false
  }
}

function handlePlaySong(song: RecommendSongItem, idx: number) {
  const list = visibleTracks.value
  if (!list.length) return
  audioStore.setPlaylist(list, idx)
  audioStore.playSong(song, idx, true)
}

function handlePlayAll() {
  const list = visibleTracks.value
  if (!list.length) return
  audioStore.setPlaylist(list, 0)
  audioStore.playSong(list[0], 0, true)
}

async function handleStartRadio(song: RecommendSongItem, e: Event) {
  e.stopPropagation()
  await recommendStore.startSongRadio(song)
}

function handleToggleLike(song: RecommendSongItem, e: Event) {
  e.stopPropagation()
  libraryStore.toggleLikeSong(song)
}

function handleDislike(song: RecommendSongItem, e: Event) {
  e.stopPropagation()
  recommendStore.dislikeSong(song)
  toastStore.show({
    message: t('recommend.actions.dislikedToast'),
    type: 'info',
    duration: 2800,
  })
}

function goSongDetail(song: RecommendSongItem, e: Event) {
  e.stopPropagation()
  router.push(`/song/${song.id}`)
}

watch([activeTab, trendingWindow, selectedGenre, explorationTemp], () => {
  loadRecommendations()
})

// 布局对路由组件 keep-alive,在设置页关闭/开启个性化后返回时组件不会重新挂载;
// 必须监听开关变化立即重拉,否则页面仍显示旧的个性化结果,违背"关闭后立即切换纯公共模式"承诺。
watch(
  () => recommendStore.personalizationEnabled,
  () => {
    loadRecommendations()
  }
)

onMounted(() => {
  loadRecommendations()
})
</script>

<template>
  <section class="smart-discovery-section">
    <!-- 顶部标题与模式切换栏 -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h2
          class="text-primary flex items-center gap-2.5 font-bold tracking-tight"
          :class="compact ? 'text-base' : 'text-xl'"
        >
          <span
            class="flex items-center justify-center rounded-lg bg-linear-to-br from-sky-500 to-cyan-500 text-slate-950 shadow-sm"
            :class="compact ? 'h-7 w-7' : 'h-8 w-8'"
          >
            <span class="icon-[mdi--radar] h-4 w-4" :class="compact ? 'h-4 w-4' : 'h-5 w-5'" />
          </span>
          <span>{{ t('recommend.sectionTitle') }}</span>
        </h2>
        <p v-if="!compact" class="text-primary/55 mt-1 text-xs">
          {{ t('recommend.sectionSubtitle') }}
        </p>
      </div>

      <!-- 主模式切换胶囊 -->
      <div class="flex flex-wrap items-center gap-2">
        <div
          class="border-glass bg-[var(--glass-bg-overlay)] inline-flex items-center rounded-xl border p-1"
        >
          <button
            v-for="tab in (['for-you', 'trending', 'discover'] as RecommendTab[])"
            :key="tab"
            type="button"
            @click="activeTab = tab"
            class="rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200"
            :class="
              activeTab === tab
                ? 'bg-sky-500/20 text-[var(--glass-text-accent)] shadow-xs'
                : 'text-primary/65 hover:text-primary'
            "
          >
            {{
              tab === 'for-you'
                ? t('recommend.tabs.forYou')
                : tab === 'trending'
                  ? t('recommend.tabs.trending')
                  : t('recommend.tabs.discover')
            }}
          </button>
        </div>

        <button
          type="button"
          @click="loadRecommendations"
          :disabled="loading"
          class="border-glass bg-hover-glass text-primary/75 hover:text-primary inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all"
        >
          <span
            class="icon-[mdi--refresh] h-3.5 w-3.5"
            :class="loading ? 'animate-spin' : ''"
          />
          <span>{{ t('recommend.actions.refresh') }}</span>
        </button>

        <button
          v-if="visibleTracks.length > 0"
          type="button"
          @click="handlePlayAll"
          class="inline-flex items-center gap-1.5 rounded-xl bg-sky-500/20 px-3.5 py-1.5 text-xs font-semibold text-[var(--glass-text-accent)] transition-all hover:bg-sky-500/30"
        >
          <span class="icon-[mdi--play] h-4 w-4" />
          <span>{{ t('recommend.actions.playAll') }}</span>
        </button>
      </div>
    </div>

    <!-- 子过滤栏：根据当前 Tab 展示个人画像标签 / 热榜时间窗 / 风格与温度控制 -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <!-- 猜你喜欢画像标签 -->
      <div
        v-if="activeTab === 'for-you' && topProfileTags.length > 0"
        class="flex flex-wrap items-center gap-1.5"
      >
        <span class="text-primary/50 text-xs">偏好信号：</span>
        <span
          v-for="tag in topProfileTags"
          :key="tag"
          class="border-glass bg-[var(--glass-bg-overlay)] text-primary/80 rounded-full border px-2.5 py-0.5 text-[11px]"
        >
          # {{ tag }}
        </span>
      </div>

      <!-- 站内趋势时间窗切换 -->
      <div v-if="activeTab === 'trending'" class="flex flex-wrap items-center gap-1.5">
        <button
          v-for="win in (['24h', '7d', 'surging', 'new'] as TrendingWindow[])"
          :key="win"
          type="button"
          @click="trendingWindow = win"
          class="rounded-full border px-3 py-1 text-xs font-medium transition-all"
          :class="
            trendingWindow === win
              ? 'border-sky-400/50 bg-sky-500/20 text-[var(--glass-text-accent)]'
              : 'border-glass bg-hover-glass text-primary/65 hover:text-primary'
          "
        >
          {{ t(`recommend.windows.${win}`) }}
        </button>
      </div>

      <!-- 风格探索标签与探索温度 -->
      <div
        v-if="activeTab === 'discover'"
        class="flex w-full flex-wrap items-center justify-between gap-2"
      >
        <div class="scrollbar-hide flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            v-for="g in genreOptions"
            :key="g.value || 'all'"
            type="button"
            @click="selectedGenre = g.value"
            class="shrink-0 rounded-full border px-2.5 py-1 text-xs transition-all"
            :class="
              selectedGenre === g.value
                ? 'border-sky-400/50 bg-sky-500/20 font-medium text-[var(--glass-text-accent)]'
                : 'border-glass bg-hover-glass text-primary/65 hover:text-primary'
            "
          >
            {{ g.label }}
          </button>
        </div>

        <div class="flex items-center gap-1.5 text-xs">
          <span class="text-primary/50">{{ t('recommend.temperature.label') }}:</span>
          <button
            v-for="lv in tempLevels"
            :key="lv.value"
            type="button"
            @click="explorationTemp = lv.value"
            class="rounded-lg border px-2 py-0.5 text-[11px] transition-all"
            :class="
              Math.abs(explorationTemp - lv.value) < 0.05
                ? 'border-cyan-400/50 bg-cyan-500/20 text-[var(--glass-text-accent)]'
                : 'border-glass text-primary/60 hover:text-primary'
            "
          >
            {{ lv.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- 推荐歌曲网格 -->
    <div
      v-if="loading && visibleTracks.length === 0"
      class="grid gap-3"
      :class="compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'"
    >
      <div
        v-for="n in compact ? 4 : 8"
        :key="n"
        class="glass-card border-glass flex items-center gap-3 rounded-2xl border p-3 animate-pulse"
      >
        <div class="bg-hover-glass h-14 w-14 shrink-0 rounded-xl" />
        <div class="min-w-0 flex-1 space-y-2">
          <div class="bg-hover-glass h-3.5 w-3/4 rounded" />
          <div class="bg-hover-glass h-3 w-1/2 rounded" />
        </div>
      </div>
    </div>

    <div
      v-else
      class="grid gap-3"
      :class="compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'"
    >
      <div
        v-for="(song, idx) in visibleTracks"
        :key="`${song.canonicalTrackId || song.id}-${idx}`"
        @click="handlePlaySong(song, idx)"
        class="glass-card border-glass hover:bg-hover-glass group relative flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-all duration-200"
      >
        <!-- 封面与播放悬浮层 -->
        <div class="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl">
          <LazyImage
            :src="formatCoverUrl(song.cover, { size: 160, artist: song.artist })"
            :alt="song.name"
            img-class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          <div
            class="bg-overlay/45 absolute inset-0 flex items-center justify-center transition-opacity duration-200"
            :class="isCurrentPlaying(song.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
          >
            <span
              class="h-6 w-6 text-sky-400"
              :class="isCurrentPlaying(song.id) ? 'icon-[mdi--volume-high]' : 'icon-[mdi--play]'"
            />
          </div>
        </div>

        <!-- 歌曲信息与可解释原因标签 -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <p
              @click="goSongDetail(song, $event)"
              class="text-primary truncate text-sm font-semibold hover:text-[var(--glass-text-accent)]"
            >
              {{ song.name }}
            </p>
            <span
              class="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] leading-none font-medium"
              :class="getBadgeClass(song)"
            >
              {{ getBadgeLabel(song) }}
            </span>
          </div>

          <p class="text-primary/65 mt-0.5 truncate text-xs">
            {{ song.artist }}
            <span v-if="song.album" class="text-primary/40"> · {{ song.album }}</span>
          </p>

          <p
            v-if="song.recommendReason"
            class="text-primary/50 mt-1 flex items-center gap-1 truncate text-[11px]"
          >
            <span class="icon-[mdi--sparkles] h-3 w-3 shrink-0 text-sky-400" />
            <span class="truncate">{{ song.recommendReason }}</span>
          </p>
        </div>

        <!-- 快捷操作按钮：相似电台 / 喜欢 / 不感兴趣 -->
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            :title="t('recommend.actions.startRadio')"
            @click="handleStartRadio(song, $event)"
            class="text-primary/50 hover:bg-hover-glass hover:text-[var(--glass-text-accent)] flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
          >
            <span class="icon-[mdi--radio-tower] h-4 w-4" />
          </button>

          <button
            type="button"
            @click="handleToggleLike(song, $event)"
            class="hover:bg-hover-glass flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
            :class="
              libraryStore.isSongLiked(song.id)
                ? 'text-rose-500'
                : 'text-primary/50 hover:text-rose-400'
            "
          >
            <span
              class="h-4 w-4"
              :class="
                libraryStore.isSongLiked(song.id)
                  ? 'icon-[mdi--heart]'
                  : 'icon-[mdi--heart-outline]'
              "
            />
          </button>

          <button
            type="button"
            :title="t('recommend.actions.dislike')"
            @click="handleDislike(song, $event)"
            class="text-primary/40 hover:bg-hover-glass hover:text-primary/80 flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
          >
            <span class="icon-[mdi--close] h-3.5 w-3.5" />
          </button>

          <span v-if="!compact" class="text-primary/40 ml-1 text-[11px] tabular-nums">
            {{ formatDuration(song.duration) }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
