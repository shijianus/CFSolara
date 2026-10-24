<script setup lang="ts">
import { artistDetail, artistTopSong, artistAlbum, artistSongs } from '@/api'
import { usePlayActions } from '@/composables/usePlayActions'
import { formatCount } from '@/utils/time'
import TabGroup from '@/components/Ui/TabGroup.vue'
import Button from '@/components/Ui/Button.vue'
import {
  transformArtistDetail,
  transformSongs,
  transformAlbums,
  type SongData,
  type AlbumData,
} from '@/utils/transformers'
import { formatCoverUrl } from '@/utils/imageUrl'
import { useLibraryStore } from '@/stores/modules/library'

const route = useRoute()
const router = useRouter()
const artistId = computed(() => Number(route.params.id))
const libraryStore = useLibraryStore()

type ArtistInfo = {
  id: number
  name: string
  alias: string[]
  picUrl: string
  briefDesc: string
  albumSize: number
  musicSize: number
  mvSize: number
  followed: boolean
  fansCount: number
}

const state = reactive({
  info: {} as ArtistInfo,
  songs: [] as SongData[],
  albums: [] as AlbumData[],
  loading: true,
  followed: false,
  activeTab: 'songs' as 'songs' | 'albums',
  songTotal: 0,
  hasMoreSongs: false,
  isLoadingMoreSongs: false,
  isSongLoadError: false,
  albumTotal: 0,
  hasMoreAlbums: false,
  isLoadingMoreAlbums: false,
  isAlbumLoadError: false,
})

const { activeTab } = toRefs(state)

const { playAll: playAllAction, shufflePlay: shufflePlayAction } = usePlayActions()

const SONG_PAGE_SIZE = 50
const ALBUM_PAGE_SIZE = 12

const load = async (id: number) => {
  state.loading = true
  state.songTotal = 0
  state.hasMoreSongs = false
  state.isLoadingMoreSongs = false
  state.isSongLoadError = false
  state.albumTotal = 0
  state.hasMoreAlbums = false
  state.isLoadingMoreAlbums = false
  state.isAlbumLoadError = false
  try {
    const [detailRes, songsRes, albumsRes] = await Promise.all([
      artistDetail({ id }),
      artistTopSong({ id }),
      artistAlbum({ id, limit: ALBUM_PAGE_SIZE, offset: 0 }),
    ])

    const artist = transformArtistDetail(detailRes as Record<string, unknown>)
    if (artist) {
      const raw = (detailRes as any)?.data?.artist || (detailRes as any)?.artist || {}
      state.info = {
        id: artist.id as number,
        name: artist.name,
        alias: artist.alias || [],
        picUrl: artist.picUrl,
        briefDesc: raw?.briefDesc || '',
        albumSize: artist.albumSize || 0,
        musicSize: artist.musicSize || 0,
        mvSize: artist.mvSize || 0,
        followed: raw?.followed || false,
        fansCount: raw?.fansCnt || 0,
      }
      state.songTotal = artist.musicSize || 0
      state.albumTotal = artist.albumSize || 0
      state.followed = libraryStore.isArtistFollowed(artist.id) || state.info.followed
    }

    state.songs = transformSongs(songsRes as Record<string, unknown>, SONG_PAGE_SIZE)
    state.hasMoreSongs =
      state.songs.length >= SONG_PAGE_SIZE &&
      (state.songTotal === 0 || state.songs.length < state.songTotal)
    state.albums = transformAlbums(albumsRes as Record<string, unknown>, ALBUM_PAGE_SIZE)
    state.hasMoreAlbums =
      state.albums.length >= ALBUM_PAGE_SIZE &&
      (state.albumTotal === 0 || state.albums.length < state.albumTotal)
  } finally {
    state.loading = false
  }
}

const loadMoreSongs = async () => {
  if (state.isLoadingMoreSongs || !state.hasMoreSongs) return
  state.isLoadingMoreSongs = true
  state.isSongLoadError = false
  try {
    const res = await artistSongs({
      id: artistId.value,
      limit: SONG_PAGE_SIZE,
      offset: state.songs.length,
      order: 'hot',
    })
    const page = transformSongs(res as Record<string, unknown>)
    const seen = new Set(state.songs.map(s => String(s.id)))
    state.songs.push(...page.filter(s => !seen.has(String(s.id))))
    state.hasMoreSongs =
      page.length === SONG_PAGE_SIZE &&
      (state.songTotal === 0 || state.songs.length < state.songTotal)
  } catch {
    state.isSongLoadError = true
  } finally {
    state.isLoadingMoreSongs = false
  }
}

const loadMoreAlbums = async () => {
  if (state.isLoadingMoreAlbums || !state.hasMoreAlbums) return
  state.isLoadingMoreAlbums = true
  state.isAlbumLoadError = false
  try {
    const res = await artistAlbum({
      id: artistId.value,
      limit: ALBUM_PAGE_SIZE,
      offset: state.albums.length,
    })
    const page = transformAlbums(res as Record<string, unknown>)
    const seen = new Set(state.albums.map(a => String(a.id)))
    state.albums.push(...page.filter(a => !seen.has(String(a.id))))
    state.hasMoreAlbums =
      page.length === ALBUM_PAGE_SIZE &&
      (state.albumTotal === 0 || state.albums.length < state.albumTotal)
  } catch {
    state.isAlbumLoadError = true
  } finally {
    state.isLoadingMoreAlbums = false
  }
}

watch(
  artistId,
  id => {
    if (!Number.isNaN(id) && id > 0) {
      load(id)
    }
  },
  { immediate: true }
)

const playAll = () => playAllAction(state.songs)

const shufflePlay = () => shufflePlayAction(state.songs)

const toggleFollow = () => {
  if (!state.info.id) return
  state.followed = libraryStore.toggleFollowArtist({
    id: state.info.id,
    name: state.info.name,
    picUrl: state.info.picUrl,
  })
}

const tabs = computed(() => [
  {
    key: 'songs',
    labelKey: 'artistPage.tabs.hotSongs',
    icon: 'icon-[mdi--music-note]',
    count: state.songTotal || state.songs.length,
  },
  {
    key: 'albums',
    labelKey: 'artistPage.tabs.albums',
    icon: 'icon-[mdi--album]',
    count: state.albumTotal || state.albums.length,
  },
])
</script>

<template>
  <div class="text-primary flex-1 overflow-hidden px-4">
    <div class="h-full overflow-auto pb-6">
      <PageSkeleton v-if="state.loading" :sections="['hero', 'list']" :list-count="12" />
      <template v-else>
        <section class="relative mb-8 flex shrink-0">
          <div class="absolute inset-0 overflow-hidden">
            <img
              v-if="state.info.picUrl"
              :src="formatCoverUrl(state.info.picUrl, { size: 800, artist: state.info.name })"
              class="h-full w-full scale-110 object-cover opacity-20 blur-2xl"
              referrerpolicy="no-referrer"
            />
            <div
              v-else
              class="h-full w-full bg-linear-to-br from-sky-500/30 to-blue-600/30"
            ></div>
          </div>

          <div class="absolute inset-0">
            <div class="floating-notes">
              <div v-for="i in 6" :key="i" class="note" :style="{ animationDelay: i * 1.2 + 's' }">
                {{ ['🎵', '🎶', '♪', '♫', '🎼', '🎤'][i - 1] }}
              </div>
            </div>
          </div>

          <div class="relative z-10 w-full p-8">
            <div class="flex flex-col items-start gap-8 lg:flex-row lg:items-center">
              <div class="shrink-0">
                <div class="group relative">
                  <div
                    class="h-48 w-48 overflow-hidden rounded-full ring-4 ring-white/20 transition-all group-hover:ring-sky-500/40"
                  >
                    <img
                      v-if="state.info.picUrl"
                      :src="formatCoverUrl(state.info.picUrl, { size: 400, artist: state.info.name })"
                      class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                      :alt="$t('layout.aside.menu.artists')"
                      referrerpolicy="no-referrer"
                    />
                    <div
                      v-else
                      class="flex h-full w-full items-center justify-center bg-linear-to-br from-sky-400 to-blue-500"
                    >
                      <span class="icon-[mdi--account-music] h-20 w-20"></span>
                    </div>
                  </div>
                  <div
                    class="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100"
                  >
                    <Button
                      variant="ghost"
                      size="icon-md"
                      rounded="full"
                      icon="icon-[mdi--play]"
                      icon-class="h-8 w-8 text-white"
                      @click="playAll"
                      class="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-transform hover:scale-110"
                    >
                    </Button>
                  </div>
                </div>
              </div>

              <div class="min-w-0 flex-1">
                <h1 class="animate-fade-in-up mb-2 text-4xl font-bold lg:text-5xl">
                  {{ state.info.name }}
                </h1>
                <p
                  v-if="state.info.alias?.length"
                  class="animate-fade-in-up text-primary/60 mb-4 text-lg"
                  style="animation-delay: 0.1s"
                >
                  {{ state.info.alias.join(' / ') }}
                </p>

                <div
                  class="animate-fade-in-up mb-6 flex flex-wrap items-center gap-4"
                  style="animation-delay: 0.2s"
                >
                  <div
                    class="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 backdrop-blur-sm"
                  >
                    <span class="icon-[mdi--music-note] h-5 w-5 text-sky-400"></span>
                    <span class="text-sm"
                      >{{ state.info.musicSize }} {{ $t('artistPage.stats.songs') }}</span
                    >
                  </div>
                  <div
                    class="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 backdrop-blur-sm"
                  >
                    <span class="icon-[mdi--album] h-5 w-5 text-blue-400"></span>
                    <span class="text-sm"
                      >{{ state.info.albumSize }} {{ $t('artistPage.stats.albums') }}</span
                    >
                  </div>
                  <div
                    v-if="state.info.fansCount"
                    class="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 backdrop-blur-sm"
                  >
                    <span class="icon-[mdi--account-group] h-5 w-5 text-blue-400"></span>
                    <span class="text-sm"
                      >{{ formatCount(state.info.fansCount) }}
                      {{ $t('artistPage.stats.fans') }}</span
                    >
                  </div>
                </div>

                <div
                  class="animate-fade-in-up flex flex-wrap items-center gap-3"
                  style="animation-delay: 0.3s"
                >
                  <Button
                    variant="solid"
                    size="md"
                    rounded="full"
                    class="gap-2 px-6 shadow-lg shadow-sky-500/25 hover:shadow-xl hover:shadow-sky-500/30"
                    @click="playAll"
                  >
                    <span class="icon-[mdi--play] h-5 w-5"></span>
                    {{ $t('artistPage.playTop') }}
                  </Button>
                  <Button
                    variant="soft"
                    size="md"
                    rounded="full"
                    class="gap-2"
                    @click="shufflePlay"
                  >
                    <span class="icon-[mdi--shuffle] h-4 w-4"></span>
                    {{ $t('actions.shufflePlay') }}
                  </Button>
                  <Button
                    variant="soft"
                    size="md"
                    rounded="full"
                    class="gap-2"
                    :class="state.followed ? 'bg-sky-500/20! text-sky-400!' : ''"
                    @click="toggleFollow"
                  >
                    <span
                      :class="state.followed ? 'icon-[mdi--heart]' : 'icon-[mdi--heart-outline]'"
                      class="h-4 w-4"
                    ></span>
                    {{ state.followed ? $t('common.followed') : $t('common.follow') }}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div class="pb-8">
          <div v-if="state.info.briefDesc" class="glass-card mb-6 p-5">
            <h3 class="mb-2 flex items-center gap-2 text-sm font-semibold">
              <span class="icon-[mdi--information-outline] h-4 w-4 text-sky-400"></span>
              {{ $t('artistPage.bioTitle') }}
            </h3>
            <p class="text-primary/70 line-clamp-3 text-sm leading-relaxed">
              {{ state.info.briefDesc }}
            </p>
          </div>

          <div class="mb-6">
            <TabGroup
              v-model="state.activeTab"
              :tabs="tabs"
              size="md"
              @click="val => (activeTab = val as 'songs' | 'albums')"
            />
          </div>

          <div v-show="state.activeTab === 'songs'" class="animate-fade-in">
            <SongList :songs="state.songs" :current-playing-index="-1" :show-header="true" />
            <div class="mt-4 flex flex-col items-center gap-2">
              <p v-if="state.songTotal" class="text-primary/50 text-xs">
                {{ $t('artistPage.loadedSongs', { loaded: state.songs.length, total: state.songTotal }) }}
              </p>
              <Button
                v-if="state.hasMoreSongs"
                variant="soft"
                size="sm"
                rounded="full"
                class="min-h-11"
                :loading="state.isLoadingMoreSongs"
                :disabled="state.isLoadingMoreSongs"
                @click="loadMoreSongs"
              >
                {{ state.isLoadingMoreSongs ? $t('common.loading') : $t('artistPage.loadMoreSongs') }}
              </Button>
              <button
                v-if="state.isSongLoadError && !state.isLoadingMoreSongs"
                type="button"
                class="min-h-11 rounded-lg px-3 text-xs font-medium text-sky-400 hover:text-sky-300 focus-visible:ring-2 focus-visible:ring-sky-400/60"
                @click="loadMoreSongs"
              >
                {{ $t('artistPage.loadFailedRetry') }}
              </button>
            </div>
          </div>

          <div v-show="state.activeTab === 'albums'" class="animate-fade-in">
            <div class="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              <div
                v-for="al in state.albums"
                :key="al.id"
                class="glass-card group cursor-pointer overflow-hidden p-3 transition-all hover:bg-white/10"
                @click="router.push(`/album/${al.id}`)"
              >
                <div class="relative mb-3 aspect-square w-full overflow-hidden rounded-xl">
                  <img
                    :src="formatCoverUrl(al.picUrl, { size: 400 })"
                    class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    referrerpolicy="no-referrer"
                  />
                  <div
                    class="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100"
                  >
                    <span class="icon-[mdi--play-circle] h-12 w-12 text-white"></span>
                  </div>
                </div>
                <p class="truncate text-sm font-medium">{{ al.name }}</p>
                <p class="text-primary/50 mt-1 truncate text-xs">
                  {{ al.publishTime }} · {{ $t('commonUnits.songsShort', { count: al.size || 0 }) }}
                </p>
              </div>
            </div>
            <div class="col-span-full mt-2 flex flex-col items-center gap-2">
              <p v-if="state.albumTotal" class="text-primary/50 text-xs">
                {{ $t('artistPage.loadedAlbums', { loaded: state.albums.length, total: state.albumTotal }) }}
              </p>
              <Button
                v-if="state.hasMoreAlbums"
                variant="soft"
                size="sm"
                rounded="full"
                class="min-h-11"
                :loading="state.isLoadingMoreAlbums"
                :disabled="state.isLoadingMoreAlbums"
                @click="loadMoreAlbums"
              >
                {{ state.isLoadingMoreAlbums ? $t('common.loading') : $t('artistPage.loadMoreAlbums') }}
              </Button>
              <button
                v-if="state.isAlbumLoadError && !state.isLoadingMoreAlbums"
                type="button"
                class="min-h-11 rounded-lg px-3 text-xs font-medium text-sky-400 hover:text-sky-300 focus-visible:ring-2 focus-visible:ring-sky-400/60"
                @click="loadMoreAlbums"
              >
                {{ $t('artistPage.loadFailedRetry') }}
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes noteFloat {
  0% {
    transform: translateY(100%) rotate(0deg);
    opacity: 0;
  }
  10% {
    opacity: 0.6;
  }
  90% {
    opacity: 0.6;
  }
  100% {
    transform: translateY(-100px) rotate(360deg);
    opacity: 0;
  }
}

.animate-fade-in-up {
  animation: fadeInUp 0.6s ease-out forwards;
}

.animate-fade-in {
  animation: fadeInUp 0.3s ease-out;
}

.floating-notes {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.note {
  position: absolute;
  font-size: 1.25rem;
  color: rgba(255, 255, 255, 0.15);
  animation: noteFloat 15s linear infinite;
}

.note:nth-child(1) {
  left: 5%;
  animation-duration: 14s;
}
.note:nth-child(2) {
  left: 20%;
  animation-duration: 16s;
}
.note:nth-child(3) {
  left: 40%;
  animation-duration: 12s;
}
.note:nth-child(4) {
  left: 60%;
  animation-duration: 18s;
}
.note:nth-child(5) {
  left: 75%;
  animation-duration: 13s;
}
.note:nth-child(6) {
  left: 90%;
  animation-duration: 15s;
}
</style>
