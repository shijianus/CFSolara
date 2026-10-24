<script setup lang="ts">
import { albumNew } from '@/api'
import { useI18n } from 'vue-i18n'
import { transformAlbums, type AlbumData } from '@/utils/transformers'
import { formatCoverUrl } from '@/utils/imageUrl'
import InfiniteScroll from '@/components/Ui/InfiniteScroll.vue'

const { t } = useI18n()

interface AlbumItem extends AlbumData {
  cover: string
}

const state = reactive({
  albums: [] as AlbumItem[],
  isPageLoading: false,
  isLoadingMore: false,
  isLoadError: false,
  area: 'ALL' as 'ALL' | 'ZH' | 'EA' | 'KR' | 'JP',
  offset: 0,
  limit: 30,
  hasMore: true,
})

const { area } = toRefs(state)

const areaOptions = [
  { key: 'ALL', labelKey: 'newAlbums.areas.all' },
  { key: 'ZH', labelKey: 'newAlbums.areas.zh' },
  { key: 'EA', labelKey: 'newAlbums.areas.ea' },
  { key: 'JP', labelKey: 'newAlbums.areas.jp' },
  { key: 'KR', labelKey: 'newAlbums.areas.kr' },
]

const loadAlbums = async (reset = false) => {
  if (state.isLoadingMore) return
  if (reset) {
    state.offset = 0
    state.albums = []
    state.hasMore = true
    state.isPageLoading = true
  } else {
    if (!state.hasMore) return
    state.isLoadingMore = true
  }
  state.isLoadError = false

  try {
    const res = await albumNew({
      area: state.area,
      limit: state.limit,
      offset: state.offset,
    })
    const albums = transformAlbums(res as Record<string, unknown>)

    const mapped: AlbumItem[] = albums.map(it => ({
      ...it,
      cover: it.picUrl,
    }))

    state.albums = reset ? mapped : [...state.albums, ...mapped]
    state.hasMore = albums.length === state.limit
    state.offset += state.limit
  } catch {
    if (!reset) {
      state.isLoadError = true
    } else {
      state.hasMore = false
    }
  } finally {
    if (reset) state.isPageLoading = false
    state.isLoadingMore = false
  }
}

const formatDate = (timestamp: string) => {
  if (!timestamp) return ''
  return timestamp
}

watch(area, () => loadAlbums(true))

onMounted(() => loadAlbums(true))
</script>

<template>
  <div class="flex h-full flex-1 flex-col overflow-hidden">
    <div class="glass-card mx-1 sm:mx-2 mt-1 mb-3 shrink-0 p-4">
      <div class="flex items-center gap-4">
        <h2 class="text-primary text-lg font-bold">{{ t('newAlbums.title') }}</h2>
        <div class="flex gap-1">
          <button
            v-for="opt in areaOptions"
            :key="opt.key"
            class="rounded-lg px-3 py-1.5 text-xs transition-all"
            :class="area === opt.key ? 'bg-pink-500/20 text-pink-400' : 'text-primary/60 hover:bg-white/5'"
            @click="area = opt.key as any"
          >
            {{ t(opt.labelKey) }}
          </button>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-auto px-1 sm:px-2 pb-6">
      <PageSkeleton v-if="state.isPageLoading && !state.albums.length" :sections="['grid']" />
      <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        <router-link
          v-for="album in state.albums"
          :key="album.id"
          :to="`/album/${album.id}`"
          class="glass-card group cursor-pointer overflow-hidden p-3 transition-all hover:bg-white/10"
        >
          <div class="relative mb-3 aspect-square overflow-hidden rounded-lg">
            <LazyImage
              :src="formatCoverUrl(album.cover, { size: 300, artist: album.artist })"
              :alt="album.name"
              class="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
            <div class="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
              <span class="icon-[mdi--play-circle] h-12 w-12 text-white" />
            </div>
          </div>
          <div>
            <p class="text-primary truncate text-sm font-medium">{{ album.name }}</p>
            <router-link
              :to="`/artist/${album.artistId}`"
              class="text-primary/60 hover:text-primary truncate text-xs"
              @click.stop
            >
              {{ album.artist }}
            </router-link>
            <p class="text-primary/40 mt-1 text-xs">{{ formatDate(album.publishTime) }}</p>
          </div>
        </router-link>
      </div>

      <!-- 自动流式预加载与超时自愈重试 -->
      <InfiniteScroll
        :loading="state.isLoadingMore"
        :has-more="state.hasMore"
        :error="state.isLoadError"
        :empty="!state.albums.length"
        :loading-text="t('common.loading')"
        :retry-text="t('newAlbums.loadMore')"
        @load="loadAlbums(false)"
        @retry="loadAlbums(false)"
      />
    </div>
  </div>
</template>
