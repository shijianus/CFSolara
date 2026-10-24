<script setup lang="ts">
import { cloudSearch, searchSuggest, searchDefault, searchHotDetail } from '@/api'
import LazyImage from '@/components/Ui/LazyImage.vue'
import Pagination from '@/components/Ui/Pagination.vue'
import { Song } from '@/stores/interface'
import { useAudio } from '@/composables/useAudio'
import { useGlobalStore } from '@/stores/modules/global'
import { storeToRefs } from 'pinia'
import { useDebounceFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Swiper, SwiperSlide } from 'swiper/vue'
import { EffectCreative } from 'swiper/modules'
import Button from '@/components/Ui/Button.vue'
import 'swiper/css'
import 'swiper/css/effect-creative'
import {
  transformSearchSongs,
  transformSearchPlaylists,
  transformSearchMVs,
  normalizeDurationMs,
  type SongData,
  type PlaylistData,
  type MVData,
} from '@/utils/transformers'
import { formatCoverUrl } from '@/utils/imageUrl'

const creativeEffect = {
  prev: {
    shadow: false,
    translate: ['-20px', 0, 0],
    opacity: 0,
  },
  next: {
    translate: ['20px', 0, 0],
    opacity: 0,
  },
}

type SearchTab = 'song' | 'playlist' | 'mv'

const { t } = useI18n()
const { setPlaylist, play, currentSong } = useAudio()
const route = useRoute()
const router = useRouter()
const globalStore = useGlobalStore()
const { searchHistory } = storeToRefs(globalStore)

interface MobileSearchState {
  q: string
  placeholder: string
  tab: SearchTab
  suggest: string[]
  loading: boolean
  suggestVisible: boolean
  hasSearched: boolean
  hotSearches: Array<{ searchWord: string; score?: number; iconType?: number }>
  loadingHot: boolean
  songs: SongData[]
  songPage: number
  songPageSize: number
  songTotal: number
  playlists: PlaylistData[]
  playlistPage: number
  playlistPageSize: number
  playlistTotal: number
  mvs: MVData[]
  mvPage: number
  mvPageSize: number
  mvTotal: number
}
const state = reactive<MobileSearchState>({
  q: '',
  placeholder: '',
  tab: 'song',
  suggest: [],
  loading: false,
  suggestVisible: false,
  hasSearched: false,
  hotSearches: [],
  loadingHot: false,
  songs: [],
  songPage: 1,
  songPageSize: 20,
  songTotal: 0,
  playlists: [],
  playlistPage: 1,
  playlistPageSize: 12,
  playlistTotal: 0,
  mvs: [],
  mvPage: 1,
  mvPageSize: 12,
  mvTotal: 0,
})
const {
  q,
  placeholder,
  tab,
  suggest,
  loading,
  suggestVisible,
  hasSearched,
  hotSearches,
  loadingHot,
  songs,
  songPage,
  songPageSize,
  songTotal,
  playlists,
  playlistPage,
  playlistPageSize,
  playlistTotal,
  mvs,
  mvPage,
  mvPageSize,
  mvTotal,
} = toRefs(state)

const fetchDefault = async () => {
  const res = await searchDefault()
  const def = (res as any)?.data?.realkeyword || (res as any)?.data?.showKeyword || ''
  state.placeholder = def || ''
}

const fetchHot = async () => {
  if (state.loadingHot || state.hotSearches.length) return
  state.loadingHot = true
  try {
    const res: any = await searchHotDetail()
    state.hotSearches = Array.isArray(res?.data) ? res.data.slice(0, 10) : []
  } catch {
    state.hotSearches = []
  } finally {
    state.loadingHot = false
  }
}

// 搜索建议：300ms 防抖，并用 AbortController 丢弃过期请求
let suggestAbort: AbortController | null = null
const fetchSuggest = async () => {
  const term = state.q.trim()
  suggestAbort?.abort()
  if (!term) {
    state.suggest = []
    return
  }
  const controller = new AbortController()
  suggestAbort = controller
  try {
    const res = await searchSuggest({ keywords: term, type: 'mobile' }, controller.signal)
    if (controller.signal.aborted) return
    const list = (res as any)?.result?.allMatch || []
    state.suggest = list.map((i: any) => i.keyword).slice(0, 8)
  } catch {
    if (!controller.signal.aborted) state.suggest = []
  }
}
const debouncedFetchSuggest = useDebounceFn(fetchSuggest, 300)

const syncQueryToUrl = (term: string) => {
  const current = String(route.query.q || '').trim()
  if (current === term) return
  const query = { ...route.query } as Record<string, any>
  if (term) query.q = term
  else delete query.q
  router.replace({ path: '/search', query })
}

let suppressPagingFetch = false
const resetResults = () => {
  suppressPagingFetch = true
  state.songs = []
  state.playlists = []
  state.mvs = []
  state.songTotal = 0
  state.playlistTotal = 0
  state.mvTotal = 0
  state.songPage = 1
  state.playlistPage = 1
  state.mvPage = 1
  nextTick(() => {
    suppressPagingFetch = false
  })
}

const runSearch = async (keyword: string) => {
  const term = keyword.trim()
  if (!term) return
  suggestAbort?.abort()
  state.q = term
  state.hasSearched = true
  state.suggestVisible = false
  globalStore.addSearchHistory(term)
  syncQueryToUrl(term)
  resetResults()
  await searchAll()
}

const fetchSongs = async () => {
  const term = state.q.trim()
  if (!term) {
    state.songs = []
    state.songTotal = 0
    return
  }

  // 1. 优先调用 Sonic 统一多源 SHA 聚合与音质分级搜索网关
  try {
    const sonicRes = await fetch(
      `/api/sonic/search/nexus?q=${encodeURIComponent(term)}&page=${state.songPage}&count=${state.songPageSize}`
    ).then((r) => r.json())
    const tracks = sonicRes?.data?.tracks || []
    if (tracks.length > 0) {
      state.songs = tracks.map((t: any) => ({
        id: t.platformId || t.id,
        name: t.title || t.name,
        artist: t.artist,
        // 保留真实歌手 ID；缺失时留空，由列表降级为纯文本展示
        artistId: t.artistId ?? undefined,
        artists: t.artistId ? [{ id: t.artistId, name: t.artist || '' }] : undefined,
        album: t.album || '',
        albumId: 0,
        cover: formatCoverUrl(t.cover || t.coverUrl || t.artistPic || '', { size: 300, artist: t.artist }),
        duration: normalizeDurationMs(t.duration),
        dt: normalizeDurationMs(t.duration),
        url: t.streamUrl || `/api/music/stream?id=${encodeURIComponent(t.platformId || t.id)}&title=${encodeURIComponent(t.title || '')}&artist=${encodeURIComponent(t.artist || '')}`,
        sha: t.sha || '',
        qualityBadge: t.qualityBadge || undefined,
        qualities: t.qualities || [],
        liked: false,
      }))
      state.songTotal = sonicRes?.data?.total || tracks.length
      return
    }
  } catch (err) {
    console.warn('[Sonic Mobile Search] Nexus gateway warning:', err)
  }

  // 2. 备用兜底检索通道
  try {
    const res = await cloudSearch({
      keywords: term,
      type: 1,
      limit: state.songPageSize,
      offset: (state.songPage - 1) * state.songPageSize,
    })
    const { songs, total } = transformSearchSongs(res as Record<string, unknown>)
    state.songs = songs
    state.songTotal = total
  } catch {
    state.songs = []
    state.songTotal = 0
  }
}

const fetchPlaylists = async () => {
  if (!state.q.trim()) return
  try {
    const res = await cloudSearch({
      keywords: state.q,
      type: 1000,
      limit: state.playlistPageSize,
      offset: (state.playlistPage - 1) * state.playlistPageSize,
    })
    const { playlists, total } = transformSearchPlaylists(res as Record<string, unknown>)
    state.playlists = playlists
    state.playlistTotal = total
  } catch {
    state.playlists = []
    state.playlistTotal = 0
  }
}

const fetchMVs = async () => {
  if (!state.q.trim()) return
  try {
    const res = await cloudSearch({
      keywords: state.q,
      type: 1004,
      limit: state.mvPageSize,
      offset: (state.mvPage - 1) * state.mvPageSize,
    })
    const { mvs, total } = transformSearchMVs(res as Record<string, unknown>)
    state.mvs = mvs
    state.mvTotal = total
  } catch {
    state.mvs = []
    state.mvTotal = 0
  }
}

const searchAll = async () => {
  if (!state.q.trim()) return
  state.hasSearched = true
  state.loading = true
  try {
    await Promise.all([fetchSongs(), fetchPlaylists(), fetchMVs()])
  } finally {
    state.loading = false
  }
}

onMounted(async () => {
  await fetchDefault()
  const initial = String(route.query.q || '').trim()
  if (initial) {
    state.q = initial
    globalStore.addSearchHistory(initial)
    await searchAll()
  } else {
    fetchHot()
  }
  document.addEventListener('click', handleDocClick)
})

watch(
  () => state.q,
  value => {
    if (!value.trim()) {
      suggestAbort?.abort()
      state.suggest = []
      return
    }
    debouncedFetchSuggest()
  }
)

// 地址栏/浏览器前后退改变关键词时保持页面同步
watch(
  () => route.query.q,
  async raw => {
    const next = String(raw || '').trim()
    if (next === state.q.trim()) return
    state.suggestVisible = false
    resetResults()
    if (next) {
      state.q = next
      state.hasSearched = true
      await searchAll()
    } else {
      state.q = ''
      state.hasSearched = false
      fetchHot()
    }
  }
)

watch(
  () => state.songPage,
  () => {
    if (state.hasSearched && !suppressPagingFetch) fetchSongs()
  }
)
watch(
  () => state.playlistPage,
  () => {
    if (state.hasSearched && !suppressPagingFetch) fetchPlaylists()
  }
)
watch(
  () => state.mvPage,
  () => {
    if (state.hasSearched && !suppressPagingFetch) fetchMVs()
  }
)

const handleSuggestClick = (s: string) => {
  runSearch(s)
}

const clearQuery = () => {
  state.q = ''
  state.suggest = []
  state.suggestVisible = false
  state.hasSearched = false
  resetResults()
  syncQueryToUrl('')
  fetchHot()
}

const inputRef = useTemplateRef('inputRef')
const handleSearchClick = () => {
  const term = state.q.trim() || state.placeholder.trim()
  if (!term) return
  runSearch(term)
  state.suggestVisible = false
  inputRef.value?.blur()
}

const searchBoxRef = ref<HTMLElement | null>(null)
const handleInputFocus = () => {
  state.suggestVisible = true
}
const handleDocClick = (e: MouseEvent) => {
  const el = searchBoxRef.value
  const target = e.target as Node | null
  if (el && target && !el.contains(target)) state.suggestVisible = false
}
onUnmounted(() => {
  suggestAbort?.abort()
  document.removeEventListener('click', handleDocClick)
})

const mapToStoreSong = (s: SongData): Song => ({
  id: s.id,
  name: s.name,
  artist: s.artist,
  album: s.album,
  duration: s.duration,
  cover: s.cover,
})

const playSong = (s: SongData, index: number) => {
  const list: Song[] = state.songs.map(mapToStoreSong)
  setPlaylist(list, index)
  play(list[index], index)
}

const isCurrent = (s: SongData) => {
  const cur = currentSong.value
  if (!cur) return false
  return String(s.id) === String(cur.id)
}

const playAllSongs = () => {
  if (!state.songs.length) return
  const list: Song[] = state.songs.map(mapToStoreSong)
  setPlaylist(list, 0)
  play(list[0], 0)
}

const tabs = computed(() => [
  { key: 'song' as const, icon: 'icon-[mdi--music-circle]', label: t('search.tabs.song') },
  {
    key: 'playlist' as const,
    icon: 'icon-[mdi--playlist-music]',
    label: t('search.tabs.playlist'),
  },
  { key: 'mv' as const, icon: 'icon-[mdi--video]', label: 'MV' },
])

const swiperInstance = ref<any>(null)
const onSwiper = (swiper: any) => {
  swiperInstance.value = swiper
}
const onSlideChange = (swiper: any) => {
  const tabKey = tabs.value[swiper.activeIndex]?.key
  if (tabKey) state.tab = tabKey
}
watch(
  () => state.tab,
  val => {
    const index = tabs.value.findIndex(t => t.key === val)
    if (index >= 0 && swiperInstance.value) {
      swiperInstance.value.slideTo(index)
    }
  }
)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="mobile-search-top shrink-0 px-4 pb-3">
      <div ref="searchBoxRef" class="relative">
        <div class="glass-card flex items-center gap-2 px-3 py-2.5">
          <span class="icon-[mdi--magnify] search-icon h-5 w-5 shrink-0"></span>
          <input
            ref="inputRef"
            v-model="q"
            @keyup.enter="handleSearchClick"
            @focus="handleInputFocus"
            type="text"
            :placeholder="placeholder || $t('common.search.placeholder')"
            class="search-input min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <Button
            v-if="q"
            variant="ghost"
            size="none"
            class="clear-btn flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all"
            icon="icon-[mdi--close-circle]"
            icon-class="h-4 w-4"
            :title="$t('common.clear')"
            :aria-label="$t('common.clear')"
            @click="clearQuery"
          />
          <Button
            variant="gradient"
            size="none"
            class="search-btn flex h-11 items-center gap-1.5 rounded-full px-4 text-xs font-medium text-white transition-all active:scale-95"
            icon="icon-[mdi--magnify]"
            icon-class="h-4 w-4"
            @click="handleSearchClick"
          >
            {{ $t('common.search.label') }}
          </Button>
        </div>

        <Transition name="dropdown">
          <div
            v-if="suggestVisible && suggest.length"
            class="suggest-dropdown absolute top-full right-0 left-0 z-20 mt-2 rounded-2xl p-3"
          >
            <p class="suggest-title mb-2 px-1 text-[11px] font-medium tracking-wider uppercase">
              {{ $t('common.search.suggest') }}
            </p>
            <div class="flex flex-wrap gap-2">
              <Button
                v-for="s in suggest"
                :key="s"
                variant="ghost"
                size="none"
                class="suggest-tag rounded-full px-3 py-1.5 text-xs transition-all active:scale-95"
                @click="handleSuggestClick(s)"
              >
                {{ s }}
              </Button>
            </div>
          </div>
        </Transition>
      </div>

      <div v-if="hasSearched" class="mobile-search-tabs glass-card mt-3 inline-flex w-full gap-1.5 p-1.5">
        <Button
          v-for="tabItem in tabs"
          :key="tabItem.key"
          variant="ghost"
          size="none"
          class="tab-button flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-all duration-300"
          :class="tab === tabItem.key ? 'tab-button-active' : ''"
          :icon="tabItem.icon"
          icon-class="h-4 w-4"
          @click="state.tab = tabItem.key"
        >
          <span>{{ tabItem.label }}</span>
        </Button>
      </div>
    </div>

    <!-- 未搜索：热门搜索 + 搜索历史 -->
    <div v-if="!hasSearched" class="flex-1 overflow-y-auto px-4 pb-6">
      <section v-if="searchHistory.length" class="mb-6">
        <div class="mb-3 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="icon-[mdi--history] h-4 w-4 text-primary/40"></span>
            <h2 class="text-primary/60 text-xs font-bold tracking-wider uppercase">
              {{ $t('search.recentSearches') }}
            </h2>
          </div>
          <button
            type="button"
            class="text-primary/40 hover:text-primary/70 flex min-h-11 min-w-11 items-center justify-center px-2 text-xs font-medium transition-colors"
            @click="globalStore.clearSearchHistory()"
          >
            {{ $t('common.clear') }}
          </button>
        </div>
        <div class="flex flex-wrap gap-2">
          <div
            v-for="keyword in searchHistory"
            :key="keyword"
            class="history-chip flex min-h-12 items-center rounded-full border border-white/10 bg-white/5 text-xs font-medium transition-colors"
          >
            <button
              type="button"
              class="flex min-h-12 min-w-0 items-center gap-1.5 pr-1 pl-3.5 text-xs font-medium"
              @click="runSearch(keyword)"
            >
              <span class="icon-[mdi--history] size-3.5 shrink-0 text-primary/40"></span>
              <span class="text-primary/80 truncate">{{ keyword }}</span>
            </button>
            <button
              type="button"
              class="text-primary/40 hover:text-primary/80 flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors"
              :aria-label="$t('search.removeHistory', { keyword })"
              :title="$t('common.delete')"
              @click="globalStore.removeSearchHistory(keyword)"
            >
              <span class="icon-[mdi--close] h-4 w-4"></span>
            </button>
          </div>
        </div>
      </section>

      <section>
        <div class="mb-3 flex items-center gap-2">
          <span class="icon-[mdi--fire] h-4 w-4 text-orange-500/60"></span>
          <h2 class="text-primary/40 text-xs font-medium">{{ $t('search.hotSearches') }}</h2>
        </div>

        <div v-if="loadingHot" class="space-y-2">
          <div
            v-for="i in 8"
            :key="i"
            class="flex min-h-11 items-center gap-3 rounded-xl px-3"
          >
            <div class="h-5 w-5 animate-pulse rounded bg-white/[0.05]"></div>
            <div
              class="h-3 animate-pulse rounded bg-white/[0.05]"
              :style="{ width: `${30 + Math.random() * 35}%` }"
            ></div>
          </div>
        </div>

        <div v-else class="space-y-1">
          <button
            v-for="(item, index) in hotSearches"
            :key="item.searchWord"
            type="button"
            class="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors active:bg-white/[0.04]"
            @click="runSearch(item.searchWord)"
          >
            <span
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
              :class="index < 3 ? 'bg-sky-500/15 text-sky-400' : 'text-primary/30'"
            >
              {{ index + 1 }}
            </span>
            <span class="text-primary/75 min-w-0 flex-1 truncate text-sm">
              {{ item.searchWord }}
            </span>
            <span
              v-if="item.iconType === 1"
              class="text-primary/70 shrink-0 rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-bold"
            >
              HOT
            </span>
          </button>
        </div>

        <p v-if="!loadingHot && !hotSearches.length" class="text-primary/40 py-8 text-center text-sm">
          {{ $t('search.enterKeyword') }}
        </p>
      </section>
    </div>

    <div v-else class="flex-1 overflow-hidden">
      <div v-if="loading" class="h-full overflow-auto px-4 py-6">
        <PageSkeleton :sections="['list']" :list-count="10" />
      </div>

      <swiper
        v-else
        class="h-full w-full"
        :initial-slide="0"
        :modules="[EffectCreative]"
        effect="creative"
        :creative-effect="creativeEffect"
        :speed="500"
        @swiper="onSwiper"
        @slideChange="onSlideChange"
      >
        <!-- Songs Slide -->
        <swiper-slide>
          <div class="h-full min-h-11 w-full space-y-3 overflow-auto px-4 pb-6" tabindex="0">
            <div v-if="songs.length > 0" class="search-results-summary flex items-center justify-between py-2">
              <p class="info-text text-xs">
                {{ t('search.result', { count: songTotal }) }}
              </p>
              <Button
                variant="gradient"
                size="none"
                class="play-all-button flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium text-white shadow-lg transition-all duration-200 active:scale-95"
                icon="icon-[mdi--play]"
                icon-class="h-4 w-4"
                @click="playAllSongs"
              >
                {{ t('actions.playAll') }}
              </Button>
            </div>

            <div
              v-if="hasSearched && songs.length === 0"
              class="empty-state flex flex-col items-center py-16"
            >
              <div class="empty-icon mb-4 flex h-20 w-20 items-center justify-center rounded-full">
                <span class="icon-[mdi--music-note-off] h-10 w-10 opacity-40" />
              </div>
              <p class="empty-title text-sm font-medium">{{ t('search.empty') }}</p>
            </div>

            <MobileSongList v-else :songs="songs" variant="compact" :show-index="true" />

            <Pagination
              v-if="songTotal > songPageSize"
              v-model="songPage"
              :total="songTotal"
              :page-size="songPageSize"
            />
          </div>
        </swiper-slide>

        <!-- Playlists Slide -->
        <swiper-slide>
          <div class="h-full min-h-11 w-full space-y-3 overflow-auto px-4 pb-6" tabindex="0">
            <div v-if="playlists.length > 0" class="py-2">
              <p class="info-text text-xs">
                {{ t('search.result', { count: playlistTotal }) }}
              </p>
            </div>

            <div
              v-if="hasSearched && playlists.length === 0"
              class="empty-state flex flex-col items-center py-16"
            >
              <div class="empty-icon mb-4 flex h-20 w-20 items-center justify-center rounded-full">
                <span class="icon-[mdi--playlist-remove] h-10 w-10 opacity-40" />
              </div>
              <p class="empty-title text-sm font-medium">{{ t('search.empty') }}</p>
            </div>

            <div v-else class="grid grid-cols-2 gap-4">
              <router-link
                v-for="p in playlists"
                :key="p.id"
                :to="`/playlist/${p.id}`"
                class="playlist-card group"
              >
                <div class="playlist-cover relative mb-3 aspect-square overflow-hidden rounded-2xl">
                  <LazyImage
                    :src="formatCoverUrl(p.coverImgUrl, { size: 300 })"
                    :alt="p.name"
                    imgClass="h-full w-full object-cover transition-all duration-500 group-active:scale-110"
                  />
                  <div class="playlist-cover-overlay absolute inset-0"></div>
                  <div
                    class="bg-overlay/50 text-primary/90 absolute top-2 right-2 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium backdrop-blur-md"
                  >
                    <span class="icon-[mdi--music-note] h-3 w-3"></span>
                    {{ p.trackCount }}
                  </div>
                  <div
                    class="playlist-play-btn absolute right-2 bottom-2 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-all duration-300"
                  >
                    <span class="icon-[mdi--play] text-primary h-5 w-5"></span>
                  </div>
                </div>
                <p class="playlist-name line-clamp-2 px-1 text-[13px] leading-snug font-medium">
                  {{ p.name }}
                </p>
              </router-link>
            </div>

            <Pagination
              v-if="playlistTotal > playlistPageSize"
              v-model="playlistPage"
              :total="playlistTotal"
              :page-size="playlistPageSize"
            />
          </div>
        </swiper-slide>

        <!-- MVs Slide -->
        <swiper-slide>
          <div class="h-full min-h-11 w-full space-y-3 overflow-auto px-4 pb-6" tabindex="0">
            <div v-if="mvs.length > 0" class="py-2">
              <p class="info-text text-xs">
                {{ t('search.result', { count: mvTotal }) }}
              </p>
            </div>

            <div
              v-if="hasSearched && mvs.length === 0"
              class="empty-state flex flex-col items-center py-16"
            >
              <div class="empty-icon mb-4 flex h-20 w-20 items-center justify-center rounded-full">
                <span class="icon-[mdi--video-off] h-10 w-10 opacity-40" />
              </div>
              <p class="empty-title text-sm font-medium">{{ t('search.empty') }}</p>
            </div>

            <div v-else class="grid grid-cols-1 gap-4">
              <router-link
                v-for="m in mvs"
                :key="m.id"
                :to="`/mv-player/${m.id}`"
                class="mv-card group"
              >
                <div class="mv-cover relative aspect-video overflow-hidden rounded-2xl">
                  <LazyImage
                    :src="formatCoverUrl(m.cover, { size: 480 })"
                    :alt="m.name"
                    imgClass="h-full w-full object-cover transition-all duration-500 group-active:scale-105"
                  />
                  <div class="mv-cover-overlay absolute inset-0"></div>
                  <div
                    class="mv-play-btn absolute top-1/2 left-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-xl transition-all duration-300"
                  >
                    <span class="icon-[mdi--play] text-primary h-7 w-7"></span>
                  </div>
                  <div class="absolute right-0 bottom-0 left-0 p-3">
                    <p class="mv-title text-primary truncate text-sm font-semibold">{{ m.name }}</p>
                    <p class="mv-artist text-primary/70 mt-0.5 truncate text-xs">{{ m.artist }}</p>
                  </div>
                  <div
                    class="bg-overlay/50 text-primary/90 absolute top-2 left-2 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium backdrop-blur-md"
                  >
                    <span class="icon-[mdi--video] h-3 w-3"></span>
                    MV
                  </div>
                </div>
              </router-link>
            </div>

            <Pagination
              v-if="mvTotal > mvPageSize"
              v-model="mvPage"
              :total="mvTotal"
              :page-size="mvPageSize"
            />
          </div>
        </swiper-slide>
      </swiper>
    </div>
  </div>
</template>

<style scoped>
/* 横屏手机高度有限：搜索框与结果 Tab 同排，给结果区保留可滚动高度 */
@media (max-height: 500px) {
  .mobile-search-top {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding-bottom: 0.5rem;
  }

  .mobile-search-top > div:first-child {
    flex: 1;
    min-width: 0;
  }

  .mobile-search-tabs {
    width: auto;
    flex: 0 0 auto;
    margin-top: 0;
  }

  .mobile-search-tabs .tab-button {
    padding: 0.5rem;
    white-space: nowrap;
  }

  .search-results-summary {
    display: none;
  }
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.search-icon {
  color: var(--glass-text-primary);
  opacity: 0.5;
}

.search-input {
  color: var(--glass-text-primary);
}

.search-input::placeholder {
  color: var(--glass-text-primary);
  opacity: 0.4;
}

.clear-btn {
  color: var(--glass-text-primary);
  opacity: 0.4;
}

.clear-btn:active {
  opacity: 0.7;
  background: var(--glass-interactive-hover-muted);
}

.search-btn {
  background: linear-gradient(to right, #38bdf8, #2563eb);
  box-shadow: 0 4px 12px rgba(56,189,248, 0.3);
}

.suggest-dropdown {
  background: var(--glass-bg-overlay);
  border: 1px solid var(--glass-border-subtle);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
}

.suggest-title {
  color: var(--glass-text-primary);
  opacity: 0.7;
}

.suggest-tag {
  background: var(--glass-interactive-hover-muted);
  color: var(--glass-text-primary);
  opacity: 0.8;
}

.suggest-tag:active {
  background: linear-gradient(to right, rgba(56,189,248, 0.2), rgba(37,99,235, 0.2));
  opacity: 1;
}

.tab-button {
  color: var(--glass-text-primary);
  opacity: 0.78;
}

.tab-button-active {
  background: linear-gradient(to right, #38bdf8, #2563eb);
  color: white;
  opacity: 1;
  box-shadow: 0 4px 15px rgba(56,189,248, 0.3);
}

.info-text {
  color: var(--glass-text-primary);
  opacity: 0.7;
}

.play-all-button {
  background: linear-gradient(to right, #38bdf8, #2563eb);
  box-shadow: 0 4px 15px rgba(56,189,248, 0.3);
}

.play-all-button:active {
  box-shadow: 0 2px 8px rgba(56,189,248, 0.3);
}

.empty-icon {
  background: linear-gradient(to bottom right, rgba(56,189,248, 0.15), rgba(37,99,235, 0.15));
}

:root.dark .empty-icon,
html.dark .empty-icon {
  background: linear-gradient(to bottom right, rgba(56,189,248, 0.2), rgba(37,99,235, 0.2));
}

.empty-title {
  color: var(--glass-text-primary);
  opacity: 0.6;
}

.song-item:not(.song-item-active):active {
  background: var(--glass-interactive-hover-muted);
}

.song-item-active {
  background: linear-gradient(to right, rgba(56,189,248, 0.2), rgba(37,99,235, 0.2));
}

:root.dark .song-item-active,
html.dark .song-item-active {
  background: linear-gradient(to right, rgba(56,189,248, 0.25), rgba(37,99,235, 0.25));
}

.song-index {
  color: var(--glass-text-primary);
  opacity: 0.3;
}

.song-cover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

:root.dark .song-cover,
html.dark .song-cover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.song-name {
  color: var(--glass-text-primary);
}

.song-artist {
  color: var(--glass-text-primary);
  opacity: 0.5;
}

.song-duration {
  color: var(--glass-text-primary);
  opacity: 0.3;
}

.playlist-card {
  transition: transform 0.3s ease;
}

.playlist-card:active {
  transform: scale(0.97);
}

.playlist-cover {
  box-shadow:
    0 8px 24px -4px rgba(0, 0, 0, 0.15),
    0 4px 8px -2px rgba(0, 0, 0, 0.08);
}

:root.dark .playlist-cover,
html.dark .playlist-cover {
  box-shadow:
    0 8px 24px -4px rgba(0, 0, 0, 0.4),
    0 4px 8px -2px rgba(0, 0, 0, 0.25);
}

.playlist-cover-overlay {
  background: linear-gradient(to top, rgba(0, 0, 0, 0.4) 0%, transparent 40%, transparent 100%);
}

.playlist-play-btn {
  background: linear-gradient(135deg, #38bdf8, #2563eb);
  opacity: 0;
  transform: scale(0.8);
}

.playlist-card:active .playlist-play-btn {
  opacity: 1;
  transform: scale(1);
}

@media (hover: none) {
  .playlist-play-btn {
    opacity: 1;
    transform: scale(1);
  }
}

.playlist-name {
  color: var(--glass-text-primary);
  opacity: 0.9;
}

.mv-card {
  transition: transform 0.3s ease;
}

.mv-card:active {
  transform: scale(0.98);
}

.mv-cover {
  box-shadow:
    0 12px 32px -4px rgba(0, 0, 0, 0.2),
    0 4px 12px -2px rgba(0, 0, 0, 0.1);
}

:root.dark .mv-cover,
html.dark .mv-cover {
  box-shadow:
    0 12px 32px -4px rgba(0, 0, 0, 0.5),
    0 4px 12px -2px rgba(0, 0, 0, 0.3);
}

.mv-cover-overlay {
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.7) 0%,
    rgba(0, 0, 0, 0.2) 30%,
    transparent 60%,
    transparent 100%
  );
}

.mv-play-btn {
  background: linear-gradient(135deg, rgba(56,189,248, 0.9), rgba(37,99,235, 0.9));
  backdrop-filter: blur(8px);
}

.mv-card:active .mv-play-btn {
  transform: translate(-50%, -50%) scale(1.1);
}

.mv-title {
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}

.mv-artist {
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
</style>
