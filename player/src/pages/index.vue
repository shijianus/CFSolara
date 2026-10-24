<script setup lang="ts">
import { banner, topPlaylist, topSong, topArtists, personalizedMv } from '@/api'
import { BRAND_PRODUCT } from '@/config/brand'
import { useI18n } from 'vue-i18n'
import { usePreferredReducedMotion } from '@vueuse/core'
import { Swiper, SwiperSlide } from 'swiper/vue'
import { Navigation, Pagination, Autoplay, EffectCoverflow } from 'swiper/modules'
import type SwiperClass from 'swiper'
import 'swiper/css'
import 'swiper/css/navigation'
import 'swiper/css/pagination'
import 'swiper/css/effect-coverflow'

import HeroCard from '@/components/Ui/HeroCard.vue'
import ArtistCard from '@/components/Ui/ArtistCard.vue'
import MVCard from '@/components/Ui/MVCard.vue'
import SongCard from '@/components/Ui/SongCard.vue'
import {
  transformBanners,
  transformPlaylists,
  transformTopSongs,
  transformArtists,
  transformMVs,
  type BannerData,
  type PlaylistData,
  type SongData,
  type ArtistData,
  type MVData,
} from '@/utils/transformers'

import { useAudio } from '@/composables/useAudio'
import type { Song as StoreSong } from '@/stores/interface'

const { t } = useI18n()
const router = useRouter()
const { play, setPlaylist } = useAudio()

const state = reactive({
  banners: [] as BannerData[],
  recommendPlaylists: [] as PlaylistData[],
  hotSongs: [] as SongData[],
  artists: [] as ArtistData[],
  mvs: [] as MVData[],
  isLoading: true,
  swiper: null as SwiperClass | null,
})

const { banners, recommendPlaylists, hotSongs, artists, mvs, isLoading } = toRefs(state)

const loadData = async () => {
  state.isLoading = true
  try {
    const [bRes, pRes, sRes, aRes, mRes] = await Promise.allSettled([
      banner({ type: 0 }),
      topPlaylist({ order: 'hot', limit: 20 }),
      topSong({ type: 0 }),
      topArtists({ limit: 16 }),
      personalizedMv(),
    ])

    if (bRes.status === 'fulfilled' && bRes.value) {
      state.banners = transformBanners(bRes.value as Record<string, unknown>, 6)
    }
    if (pRes.status === 'fulfilled' && pRes.value) {
      state.recommendPlaylists = transformPlaylists(
        pRes.value as Record<string, unknown>,
        20,
        t('home.playlistFallback')
      )
    }
    if (sRes.status === 'fulfilled' && sRes.value) {
      state.hotSongs = transformTopSongs(sRes.value as Record<string, unknown>, 12)
    }
    if (aRes.status === 'fulfilled' && aRes.value) {
      state.artists = transformArtists(aRes.value as Record<string, unknown>, 16)
    }
    if (mRes.status === 'fulfilled' && mRes.value) {
      state.mvs = transformMVs(mRes.value as Record<string, unknown>, 6)
    }
  } finally {
    state.isLoading = false
  }
}

const reducedMotion = usePreferredReducedMotion()
const prefersReduced = computed(() => reducedMotion.value === 'reduce')
const autoplayPaused = ref(false)
const hoverPaused = ref(false)

const syncAutoplay = () => {
  const swiper = state.swiper
  if (!swiper?.autoplay) return
  if (prefersReduced.value || autoplayPaused.value || hoverPaused.value) {
    swiper.autoplay.stop()
  } else {
    swiper.autoplay.start()
  }
}

const onSwiper = (sw: SwiperClass) => {
  state.swiper = sw
  syncAutoplay()
}

const toggleAutoplay = () => {
  autoplayPaused.value = !autoplayPaused.value
  syncAutoplay()
}

const pauseForInteraction = () => {
  hoverPaused.value = true
  syncAutoplay()
}

const resumeAfterInteraction = () => {
  hoverPaused.value = false
  syncAutoplay()
}

watch(prefersReduced, syncAutoplay)

const handleBannerClick = (item: BannerData) => {
  if (item.targetType === 1 && item.targetId) {
    const storeSong: StoreSong = {
      id: Number(item.targetId),
      name: item.description || item.title || t('home.bannerSongFallback', { brand: BRAND_PRODUCT }),
      artist: item.title || t('home.bannerArtistFallback', { brand: BRAND_PRODUCT }),
      cover: item.coverImgUrl,
      duration: 0,
    }
    setPlaylist([storeSong], 0)
    play(storeSong, 0)
    router.push(`/song/${item.targetId}?autoplay=1`)
  } else if (item.targetType === 10 && item.targetId) {
    router.push(`/album/${item.targetId}?autoplay=1`)
  } else if (item.internalTo) {
    router.push(item.internalTo)
  }
}

const swiperModules = [Navigation, Pagination, Autoplay, EffectCoverflow]

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="flex-1 overflow-hidden">
    <div class="custom-scrollbar h-full overflow-y-auto">
      <HomeSkeleton v-if="isLoading" />
      <div v-else class="space-y-10 p-5 pb-8">
        <!-- ═══════ Banner 轮播 ═══════ -->
        <section
          v-if="banners.length"
          v-scroll-in="{ direction: 'up', duration: 0.8 }"
          class="relative max-h-[50vh]"
          @mouseenter="pauseForInteraction"
          @mouseleave="resumeAfterInteraction"
          @focusin="pauseForInteraction"
          @focusout="resumeAfterInteraction"
        >
          <button
            type="button"
            class="absolute top-3 right-3 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-glass bg-[var(--glass-bg-overlay)] text-primary shadow-lg transition-colors hover:bg-[var(--glass-interactive-hover)] focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none"
            :aria-label="autoplayPaused ? t('home.playCarousel') : t('home.pauseCarousel')"
            :title="autoplayPaused ? t('home.playCarousel') : t('home.pauseCarousel')"
            @click="toggleAutoplay"
          >
            <span :class="autoplayPaused ? 'icon-[mdi--play]' : 'icon-[mdi--pause]'" class="h-5 w-5"></span>
          </button>
          <Swiper
            @swiper="onSwiper"
            :modules="swiperModules"
            :slides-per-view="1"
            :space-between="20"
            :centered-slides="true"
            :loop="true"
            :speed="prefersReduced ? 0 : 300"
            :autoplay="prefersReduced ? false : { delay: 5000, disableOnInteraction: false }"
            :pagination="{ clickable: true, el: '.home-pagination' }"
            :breakpoints="{
              640: { slidesPerView: 1.15 },
              1024: { slidesPerView: 1.4 },
              1280: { slidesPerView: 1.7 },
            }"
            class="overflow-hidden rounded-2xl"
          >
            <SwiperSlide v-for="(item, idx) in banners" :key="idx">
              <div
                role="button"
                tabindex="0"
                @click="handleBannerClick(item)"
                @keydown.enter="handleBannerClick(item)"
                class="group relative block aspect-[1080/400] max-h-[46vh] cursor-pointer overflow-hidden rounded-2xl select-none"
              >
                <LazyImage
                  :src="item.coverImgUrl"
                  alt="banner"
                  img-class="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                />
                <div class="absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent opacity-80 transition-opacity duration-300 group-hover:opacity-90" />
                <div v-if="item.description" class="pointer-events-none absolute bottom-3.5 left-4 z-10 max-w-[65%] lg:bottom-4 lg:left-5">
                  <h3 class="line-clamp-1 text-sm font-semibold tracking-tight text-white/95 drop-shadow-md lg:text-base">
                    {{ item.description }}
                  </h3>
                </div>
                <div v-if="item.title" class="pointer-events-none absolute right-3.5 bottom-3.5 z-10 flex items-center gap-2 lg:right-4 lg:bottom-4">
                  <span
                    class="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[11px] font-medium tracking-wide text-white/95 shadow-sm backdrop-blur-md"
                  >
                    <span class="icon-[mdi--fire] h-3 w-3 text-orange-400" />
                    {{ item.title }}
                  </span>
                </div>
              </div>
            </SwiperSlide>
          </Swiper>
          <div class="home-pagination mt-4 flex justify-center gap-1.5"></div>
        </section>

        <!-- ═══════ 推荐歌单 ═══════ -->
        <section v-if="recommendPlaylists.length" v-scroll-in="{ direction: 'up', delay: 0.1 }">
          <div class="mb-6 flex items-baseline justify-between">
            <h2 class="text-primary flex items-center gap-2.5 text-xl font-bold tracking-tight">
              <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-sky-500 to-blue-600">
                <span class="icon-[mdi--playlist-star] h-5 w-5 text-white"></span>
              </span>
              {{ t('home.recommendPlaylists') }}
            </h2>
          </div>
          <div
            v-scroll-in="{ stagger: true, staggerDelay: 0.04 }"
            class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
          >
            <HeroCard
              v-for="item in recommendPlaylists"
              :key="item.id"
              :id="item.id"
              :cover-url="item.coverImgUrl"
              :title="item.name"
              :play-count="item.playCount"
              :track-count="item.trackCount"
              :to="`/playlist/${item.id}`"
              class="stagger-item"
            />
          </div>
        </section>

        <!-- ═══════ 热门歌手 ═══════ -->
        <section v-if="artists.length" v-scroll-in="{ direction: 'up', delay: 0.1 }">
          <div class="mb-6 flex items-baseline justify-between">
            <h2 class="text-primary flex items-center gap-2.5 text-xl font-bold tracking-tight">
              <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-sky-500 to-blue-600">
                <span class="icon-[mdi--account-music] h-5 w-5 text-white"></span>
              </span>
              {{ t('components.discover.hotArtists') }}
            </h2>
            <router-link
              v-magnetic="{ strength: 0.3, distance: 60 }"
              to="/artists"
              class="text-primary/40 hover:text-primary/70 flex min-h-11 items-center gap-1 text-[13px] font-medium transition-all duration-200 hover:gap-1.5"
            >
              {{ t('common.viewAll') }}
              <span class="icon-[mdi--chevron-right] h-4 w-4" />
            </router-link>
          </div>
          <div
            v-scroll-in="{ stagger: true, staggerDelay: 0.03 }"
            class="grid grid-cols-4 gap-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12"
          >
            <ArtistCard
              v-for="artist in artists.slice(0, 12)"
              :key="artist.id"
              :id="artist.id"
              :name="artist.name"
              :pic-url="artist.picUrl"
              :to="`/artist/${artist.id}`"
              class="stagger-item"
            />
          </div>
        </section>

        <!-- ═══════ 热门歌曲 ═══════ -->
        <section v-if="hotSongs.length" v-scroll-in="{ direction: 'up', delay: 0.1 }">
          <div class="mb-6 flex items-baseline justify-between">
            <h2 class="text-primary flex items-center gap-2.5 text-xl font-bold tracking-tight">
              <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-cyan-500 to-blue-600">
                <span class="icon-[mdi--music-note-plus] h-5 w-5 text-white"></span>
              </span>
              {{ t('home.hotSongs') }}
            </h2>
            <router-link
              v-magnetic="{ strength: 0.3, distance: 60 }"
              to="/charts"
              class="text-primary/40 hover:text-primary/70 flex min-h-11 items-center gap-1 text-[13px] font-medium transition-all duration-200 hover:gap-1.5"
            >
              {{ t('common.viewAll') }}
              <span class="icon-[mdi--chevron-right] h-4 w-4" />
            </router-link>
          </div>
          <div class="songs-container overflow-hidden rounded-2xl">
            <div
              v-scroll-in="{ stagger: true, staggerDelay: 0.03, distance: 20 }"
              class="grid md:grid-cols-2"
            >
              <SongCard
                v-for="(song, idx) in hotSongs"
                :key="song.id"
                :song="song"
                :index="idx"
                :to="`/song/${song.id}`"
                class="stagger-item song-divider"
              />
            </div>
          </div>
        </section>

        <!-- ═══════ 推荐MV ═══════ -->
        <section v-if="mvs.length" v-scroll-in="{ direction: 'up', delay: 0.1 }">
          <div class="mb-6 flex items-baseline justify-between">
            <h2 class="text-primary flex items-center gap-2.5 text-xl font-bold tracking-tight">
              <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-cyan-500 to-blue-600">
                <span class="icon-[mdi--video] h-5 w-5 text-white"></span>
              </span>
              {{ t('components.discover.recommendMv') }}
            </h2>
            <router-link
              v-magnetic="{ strength: 0.3, distance: 60 }"
              to="/mv-list"
              class="text-primary/40 hover:text-primary/70 flex min-h-11 items-center gap-1 text-[13px] font-medium transition-all duration-200 hover:gap-1.5"
            >
              {{ t('common.viewAll') }}
              <span class="icon-[mdi--chevron-right] h-4 w-4" />
            </router-link>
          </div>
          <div
            v-scroll-in="{ stagger: true, staggerDelay: 0.06 }"
            class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
          >
            <MVCard
              v-for="mv in mvs"
              :key="mv.id"
              :id="mv.id"
              :name="mv.name"
              :artist="mv.artist"
              :cover="mv.cover"
              :play-count="mv.playCount as number"
              :to="`/mv-player/${mv.id}`"
              class="stagger-item"
            />
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "../style/tailwind.css";

/* ── 轮播图分页指示器 ── */
.home-pagination :deep(.swiper-pagination-bullet) {
  width: 6px;
  height: 6px;
  background: var(--glass-text-primary);
  opacity: 0.2;
  border-radius: 9999px;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.home-pagination :deep(.swiper-pagination-bullet-active) {
  width: 20px;
  opacity: 0.6;
  border-radius: 3px;
}

/* ── 歌曲列表容器 ── */
.songs-container {
  background: transparent;
  border: none;
}

/* ── 歌曲分隔线 ── */
.song-divider {
  border-bottom: 1px solid var(--glass-border-subtle);
}

.song-divider:last-child,
.song-divider:nth-last-child(2):nth-child(odd) {
  border-bottom: none;
}

@media (min-width: 768px) {
  .song-divider:nth-last-child(1),
  .song-divider:nth-last-child(2):nth-child(odd) {
    border-bottom: none;
  }
}
</style>
