<script setup lang="ts">
import TabGroup from '@/components/Ui/TabGroup.vue'
import Button from '@/components/Ui/Button.vue'
import LazyImage from '@/components/Ui/LazyImage.vue'
import { useI18n } from 'vue-i18n'
import { useLibraryStore } from '@/stores/modules/library'
import { usePlayActions } from '@/composables/usePlayActions'
import { formatCoverUrl } from '@/utils/imageUrl'
import { formatDate } from '@/utils/time'

const { t } = useI18n()
const libraryStore = useLibraryStore()
const { playAll: playAllAction } = usePlayActions()

const tabs = [
  { key: 'all', labelKey: 'likes.tabs.all', icon: 'icon-[mdi--heart]' },
  { key: 'song', labelKey: 'likes.tabs.song', icon: 'icon-[mdi--music]' },
  { key: 'playlist', labelKey: 'likes.tabs.playlist', icon: 'icon-[mdi--playlist-music]' },
  { key: 'mv', labelKey: 'likes.tabs.mv', icon: 'icon-[mdi--video]' },
]

const state = reactive({
  active: 'all',
})
const { active } = toRefs(state)

const likedSongs = computed(() => libraryStore.likedSongs)
const collectedPlaylists = computed(() => libraryStore.collectedPlaylists)
const likedMvs = computed(() => libraryStore.likedMvs)

const isEmpty = computed(
  () =>
    !likedSongs.value.length &&
    !collectedPlaylists.value.length &&
    !likedMvs.value.length
)

const playLiked = () => {
  const songs = libraryStore.toPlayableSongs()
  if (songs.length) playAllAction(songs)
}

const playSongAt = (id: string | number) => {
  const songs = libraryStore.toPlayableSongs()
  const index = songs.findIndex(s => String(s.id) === String(id))
  if (index >= 0) playAllAction(songs, index)
}
</script>

<template>
  <div class="relative flex-1 overflow-hidden">
    <div class="absolute inset-0 -z-10">
      <div class="glow top-16 left-24 bg-sky-500/30"></div>
      <div class="glow right-24 bottom-20 bg-blue-500/30"></div>
    </div>

    <div class="h-full overflow-auto p-6">
      <div class="mb-8">
        <div class="glass-container relative overflow-hidden rounded-3xl p-6">
          <div class="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 class="text-3xl font-bold text-primary">{{ t('likes.title') }}</h1>
              <p class="mt-1 text-sm text-primary/70">{{ t('likes.subtitle') }}</p>
            </div>
            <div class="flex items-center gap-3">
              <Button
                v-if="likedSongs.length"
                variant="solid"
                size="sm"
                rounded="full"
                class="gap-2"
                @click="playLiked"
              >
                <span class="icon-[mdi--play] h-4 w-4" />
                {{ t('actions.playAll') }}
              </Button>
              <TabGroup
                v-model="active"
                :tabs="tabs"
                variant="gradient"
                size="sm"
                :show-count="false"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 全空状态 -->
      <div v-if="isEmpty" class="glass-card flex flex-col items-center justify-center py-20">
        <span class="icon-[mdi--heart-outline] text-primary/20 mb-4 h-16 w-16"></span>
        <p class="text-primary/50 text-sm font-medium">{{ t('likes.emptyAll') }}</p>
      </div>

      <template v-else>
        <!-- 歌曲 -->
        <section
          v-if="active === 'all' || active === 'song'"
          :class="active === 'all' ? 'mb-8' : ''"
        >
          <h2 v-if="active === 'all'" class="text-primary mb-4 text-base font-semibold">
            {{ t('likes.tabs.song') }}
            <span class="text-primary/50 ml-1 text-sm font-normal">({{ likedSongs.length }})</span>
          </h2>
          <div v-if="likedSongs.length" class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div
              v-for="item in likedSongs"
              :key="item.id"
              class="glass-card group flex items-center gap-4 p-4 transition-all duration-300 hover:scale-[1.01]"
            >
              <div class="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl">
                <LazyImage
                  :src="formatCoverUrl(item.cover, { size: 120, artist: item.artist })"
                  :alt="item.name"
                  imgClass="h-full w-full object-cover"
                  wrapperClass="h-full w-full"
                />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-primary truncate text-sm font-semibold group-hover:text-sky-300">
                  {{ item.name }}
                </p>
                <p class="truncate text-xs text-primary/60">{{ item.artist }}</p>
                <p class="mt-0.5 truncate text-[11px] text-primary/40">
                  {{ formatDate(item.likedAt) }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  rounded="full"
                  class="h-11 w-11"
                  :title="t('actions.play')"
                  @click="playSongAt(item.id)"
                >
                  <span class="icon-[mdi--play] h-4 w-4"></span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  rounded="full"
                  class="h-11 w-11 hover:text-red-400"
                  :title="t('common.unlike')"
                  @click="libraryStore.removeLikedSong(item.id)"
                >
                  <span class="icon-[mdi--heart-off-outline] h-4 w-4"></span>
                </Button>
              </div>
            </div>
          </div>
          <p v-else-if="active === 'song'" class="text-primary/50 py-10 text-center text-sm">
            {{ t('likes.empty') }}
          </p>
        </section>

        <!-- 歌单 -->
        <section
          v-if="active === 'all' || active === 'playlist'"
          :class="active === 'all' ? 'mb-8' : ''"
        >
          <h2 v-if="active === 'all'" class="text-primary mb-4 text-base font-semibold">
            {{ t('likes.tabs.playlist') }}
            <span class="text-primary/50 ml-1 text-sm font-normal">
              ({{ collectedPlaylists.length }})
            </span>
          </h2>
          <div
            v-if="collectedPlaylists.length"
            class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
          >
            <router-link
              v-for="pl in collectedPlaylists"
              :key="pl.id"
              :to="`/playlist/${pl.id}`"
              class="group"
            >
              <div class="glass-card overflow-hidden transition-all duration-300 hover:scale-105">
                <div class="relative aspect-square overflow-hidden">
                  <LazyImage
                    :src="formatCoverUrl(pl.coverImgUrl, { size: 300 })"
                    :alt="pl.name"
                    imgClass="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    wrapperClass="h-full w-full"
                  />
                </div>
                <div class="p-3">
                  <p class="text-primary mb-1 line-clamp-2 text-sm leading-snug font-semibold">
                    {{ pl.name }}
                  </p>
                  <p class="text-primary/60 text-xs">
                    {{ t('commonUnits.songsShort', { count: pl.trackCount || 0 }) }}
                    <span v-if="pl.creator"> · {{ pl.creator }}</span>
                  </p>
                </div>
              </div>
            </router-link>
          </div>
          <p v-else-if="active === 'playlist'" class="text-primary/50 py-10 text-center text-sm">
            {{ t('likes.emptyPlaylist') }}
          </p>
        </section>

        <!-- MV -->
        <section v-if="active === 'all' || active === 'mv'">
          <h2 v-if="active === 'all'" class="text-primary mb-4 text-base font-semibold">
            {{ t('likes.tabs.mv') }}
            <span class="text-primary/50 ml-1 text-sm font-normal">({{ likedMvs.length }})</span>
          </h2>
          <div v-if="likedMvs.length" class="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-4">
            <router-link
              v-for="mv in likedMvs"
              :key="mv.id"
              :to="`/mv-player/${mv.id}`"
              class="glass-card group flex gap-4 p-3 transition-all hover:bg-hover-glass"
            >
              <div class="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg">
                <LazyImage
                  :src="formatCoverUrl(mv.cover, { size: 200 })"
                  :alt="mv.name"
                  imgClass="h-full w-full object-cover"
                  wrapperClass="h-full w-full"
                />
              </div>
              <div class="min-w-0 flex-1 py-1">
                <p class="text-primary mb-1 line-clamp-2 text-sm font-medium group-hover:text-sky-300">
                  {{ mv.name }}
                </p>
                <p class="text-primary/50 truncate text-xs">{{ mv.artist }}</p>
              </div>
            </router-link>
          </div>
          <p v-else-if="active === 'mv'" class="text-primary/50 py-10 text-center text-sm">
            {{ t('likes.emptyMv') }}
          </p>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.glow {
  position: absolute;
  width: 22rem;
  height: 22rem;
  border-radius: 9999px;
  filter: blur(80px);
  animation: float 10s ease-in-out infinite;
}
@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-12px);
  }
}
</style>
