<script setup lang="ts">
import { artistList } from '@/api'
import { useI18n } from 'vue-i18n'
import { transformArtists, type ArtistData } from '@/utils/transformers'
import { formatCoverUrl } from '@/utils/imageUrl'
import InfiniteScroll from '@/components/Ui/InfiniteScroll.vue'

const { t } = useI18n()

interface ArtistItem extends Omit<ArtistData, 'alias'> {
  alias?: string
}

const state = reactive({
  artists: [] as ArtistItem[],
  isPageLoading: false,
  isLoadingMore: false,
  isLoadError: false,
  type: -1,
  area: -1,
  initial: '',
  offset: 0,
  limit: 30,
  hasMore: true,
})

const { type, area, initial } = toRefs(state)

const typeOptions = [
  { key: -1, labelKey: 'artists.types.all' },
  { key: 1, labelKey: 'artists.types.male' },
  { key: 2, labelKey: 'artists.types.female' },
  { key: 3, labelKey: 'artists.types.band' },
]

const areaOptions = [
  { key: -1, labelKey: 'artists.areas.all' },
  { key: 7, labelKey: 'artists.areas.zh' },
  { key: 96, labelKey: 'artists.areas.ea' },
  { key: 8, labelKey: 'artists.areas.jp' },
  { key: 16, labelKey: 'artists.areas.kr' },
  { key: 0, labelKey: 'artists.areas.other' },
]

const initialOptions = [
  { key: '', labelKey: 'artists.initials.hot' },
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => ({ key: c, labelKey: c })),
]

const loadArtists = async (reset = false) => {
  if (state.isLoadingMore) return
  if (reset) {
    state.offset = 0
    state.artists = []
    state.hasMore = true
    state.isPageLoading = true
  } else {
    if (!state.hasMore) return
    state.isLoadingMore = true
  }
  state.isLoadError = false

  try {
    const params: any = {
      limit: state.limit,
      offset: state.offset,
    }
    if (state.type !== -1) params.type = state.type
    if (state.area !== -1) params.area = state.area
    if (state.initial) params.initial = state.initial

    const res = await artistList(params)
    const artists = transformArtists(res as Record<string, unknown>)

    const mapped: ArtistItem[] = artists.map(it => ({
      ...it,
      alias: it.alias?.join(' / ') || '',
    }))

    state.artists = reset ? mapped : [...state.artists, ...mapped]
    state.hasMore = artists.length === state.limit
    state.offset += state.limit
  } catch {
    state.isLoadError = true
    state.hasMore = false
  } finally {
    if (reset) state.isPageLoading = false
    state.isLoadingMore = false
  }
}

const resetFilters = () => {
  const changed = state.type !== -1 || state.area !== -1 || state.initial !== ''
  if (!changed) {
    loadArtists(true)
    return
  }
  state.type = -1
  state.area = -1
  state.initial = ''
}

watch([type, area, initial], () => loadArtists(true))

onMounted(() => loadArtists(true))
</script>

<template>
  <div class="flex h-full flex-1 flex-col overflow-hidden">
    <div class="glass-card mx-1 sm:mx-2 mt-1 mb-3 shrink-0 p-4">
      <div class="flex flex-wrap items-center gap-6">
        <div class="flex items-center gap-2">
          <span class="text-primary/60 text-sm">{{ t('artists.type') }}:</span>
          <div class="flex gap-1">
            <button
              v-for="opt in typeOptions"
              :key="opt.key"
              class="rounded-lg px-3 py-1.5 text-xs transition-all"
              :class="type === opt.key ? 'bg-sky-500/20 text-sky-400' : 'text-primary/60 hover:bg-white/5'"
              @click="type = opt.key"
            >
              {{ t(opt.labelKey) }}
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-primary/60 text-sm">{{ t('artists.area') }}:</span>
          <div class="flex gap-1">
            <button
              v-for="opt in areaOptions"
              :key="opt.key"
              class="rounded-lg px-3 py-1.5 text-xs transition-all"
              :class="area === opt.key ? 'bg-sky-500/20 text-sky-400' : 'text-primary/60 hover:bg-white/5'"
              @click="area = opt.key"
            >
              {{ t(opt.labelKey) }}
            </button>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-1">
          <span class="text-primary/60 mr-1 text-sm">{{ t('artists.initial') }}:</span>
          <button
            v-for="opt in initialOptions"
            :key="opt.key"
            class="rounded px-2 py-1 text-xs transition-all"
            :class="initial === opt.key ? 'bg-sky-500/20 text-sky-400' : 'text-primary/60 hover:bg-white/5'"
            @click="initial = opt.key"
          >
            {{ opt.key || t(opt.labelKey) }}
          </button>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-auto px-1 sm:px-2 pb-6">
      <PageSkeleton v-if="state.isPageLoading && !state.artists.length" :sections="['grid']" />
      <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        <router-link
          v-for="artist in state.artists"
          :key="artist.id"
          :to="`/artist/${artist.id}`"
          class="glass-card group cursor-pointer overflow-hidden p-3 transition-all hover:bg-white/10"
        >
          <div class="relative mb-3 aspect-square overflow-hidden rounded-full">
            <LazyImage
              :src="formatCoverUrl(artist.picUrl, { size: 300, artist: artist.name })"
              :alt="artist.name"
              class="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          </div>
          <div class="text-center">
            <p class="text-primary truncate text-sm font-medium">{{ artist.name }}</p>
            <p v-if="artist.alias" class="text-primary/40 truncate text-xs">{{ artist.alias }}</p>
            <p class="text-primary/40 mt-1 text-xs">
              {{ artist.albumSize }} {{ t('artists.albums') }} · {{ artist.mvSize }} MV
            </p>
          </div>
        </router-link>
      </div>

      <!-- 自动流式触底加载与超时自愈重试 -->
      <InfiniteScroll
        :loading="state.isLoadingMore"
        :has-more="state.hasMore"
        :error="state.isLoadError"
        :empty="!state.artists.length"
        :loading-text="t('common.loading')"
        :retry-text="t('artists.loadMore')"
        :reset-text="$t('components.infiniteScroll.reset')"
        @load="loadArtists(false)"
        @retry="loadArtists(false)"
        @reset="resetFilters"
      />
    </div>
  </div>
</template>
