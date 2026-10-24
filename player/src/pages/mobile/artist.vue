<script setup lang="ts">
import { artistDetail, artistTopSong, artistAlbum, artistSongs } from '@/api'
import { usePlayActions } from '@/composables/usePlayActions'
import Button from '@/components/Ui/Button.vue'
import { useI18n } from 'vue-i18n'
import { formatCount } from '@/utils/time'
import {
  transformArtistDetail,
  transformSongs,
  transformAlbums,
  type SongData,
  type AlbumData,
} from '@/utils/transformers'
import { formatCoverUrl } from '@/utils/imageUrl'
import { useLibraryStore } from '@/stores/modules/library'

const { t } = useI18n()
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
  activeTab: 0,
  followed: false,
  songTotal: 0,
  hasMoreSongs: false,
  isLoadingMoreSongs: false,
  isSongLoadError: false,
  albumTotal: 0,
  hasMoreAlbums: false,
  isLoadingMoreAlbums: false,
  isAlbumLoadError: false,
})

const { playAll: playAllAction, shufflePlay: shufflePlayAction } = usePlayActions()

const SONG_PAGE_SIZE = 50
const ALBUM_PAGE_SIZE = 10

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

    // 歌手详情
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

    // 歌曲列表
    state.songs = transformSongs(songsRes as Record<string, unknown>, SONG_PAGE_SIZE)
    state.hasMoreSongs =
      state.songs.length >= SONG_PAGE_SIZE &&
      (state.songTotal === 0 || state.songs.length < state.songTotal)

    // 专辑列表
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

const goToAlbum = (id: number | string) => {
  router.push(`/album/${id}`)
}

const tabs = ['artistPage.tabs.hotSongs', 'artistPage.tabs.albums']
</script>

<template>
  <div class="artist-page flex flex-1 flex-col overflow-hidden">
    <div v-if="state.loading" class="flex-1 overflow-auto px-4 py-6">
      <PageSkeleton :sections="['hero', 'list']" :list-count="8" />
    </div>
    <template v-else>
      <div class="header-section relative">
        <div class="header-bg absolute inset-0 overflow-hidden">
          <LazyImage
            v-if="state.info.picUrl"
            :src="formatCoverUrl(state.info.picUrl, { size: 400, artist: state.info.name })"
            :alt="$t('components.songList.coverAlt')"
            imgClass="h-full w-full object-cover scale-110"
          />
          <div class="header-overlay absolute inset-0"></div>
        </div>

        <div class="header-content relative z-10 px-4 pt-6 pb-6">
          <div class="flex flex-col items-center">
            <div class="avatar-wrapper relative mb-4">
              <LazyImage
                v-if="state.info.picUrl"
                :src="formatCoverUrl(state.info.picUrl, { size: 300, artist: state.info.name })"
                :alt="$t('layout.aside.menu.artists')"
                imgClass="artist-avatar h-28 w-28 rounded-full object-cover"
              />
            </div>

            <h1 class="mb-1 text-xl font-bold text-accent">{{ state.info.name }}</h1>
            <p v-if="state.info.alias?.length" class="mb-3 text-xs text-accent/60">
              {{ state.info.alias.join(' / ') }}
            </p>

            <div class="mb-4 flex items-center gap-6 text-center text-xs text-accent/70">
              <div class="flex flex-col items-center">
                <span class="text-base font-semibold text-accent">{{ state.info.musicSize }}</span>
                <span>{{ $t('artistPage.stats.songs') }}</span>
              </div>
              <div class="flex flex-col items-center">
                <span class="text-base font-semibold text-accent">{{ state.info.albumSize }}</span>
                <span>{{ $t('artistPage.stats.albums') }}</span>
              </div>
              <div v-if="state.info.fansCount" class="flex flex-col items-center">
                <span class="text-base font-semibold text-accent">{{
                  formatCount(state.info.fansCount)
                }}</span>
                <span>{{ $t('artistPage.stats.fans') }}</span>
              </div>
            </div>

            <p
              v-if="state.info.briefDesc"
              class="mb-4 line-clamp-2 max-w-xs text-center text-xs leading-relaxed text-accent/60"
            >
              {{ state.info.briefDesc }}
            </p>
          </div>
        </div>
      </div>

      <div class="action-bar flex items-center gap-3 px-4 py-3">
        <Button
          variant="gradient"
          size="md"
          rounded="full"
          class="play-all-btn flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-medium"
          icon="icon-[mdi--play-circle]"
          icon-class="h-5 w-5"
          @click="playAll"
        >
          {{ t('actions.playAll') }}
        </Button>
        <Button
          variant="glass"
          size="md"
          rounded="full"
          class="shuffle-btn flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-medium"
          icon="icon-[mdi--shuffle-variant]"
          icon-class="h-5 w-5"
          @click="shufflePlay"
        >
          {{ t('actions.shufflePlay') }}
        </Button>
        <Button
          variant="glass"
          size="icon-lg"
          rounded="full"
          class="follow-btn"
          :class="state.followed ? 'followed' : ''"
          :icon="state.followed ? 'icon-[mdi--account-check]' : 'icon-[mdi--account-plus]'"
          icon-class="h-5 w-5"
          @click="toggleFollow"
        />
      </div>

      <div class="tabs-bar flex gap-1 px-4 pb-2">
        <Button
          v-for="(tab, i) in tabs"
          :key="i"
          variant="ghost"
          size="none"
          rounded="full"
          class="tab-btn px-4 py-1.5 text-xs font-medium transition-all"
          :class="state.activeTab === i ? 'active' : ''"
          @click="state.activeTab = i"
        >
          {{ $t(tab) }}
        </Button>
      </div>

      <div class="flex-1 overflow-auto px-4 pb-6">
        <section v-if="state.activeTab === 0">
          <MobileSongList :songs="state.songs" :show-index="true" />
          <div class="mt-3 flex flex-col items-center gap-2">
            <p v-if="state.songTotal" class="text-[11px] text-primary/50">
              {{ $t('artistPage.loadedSongs', { loaded: state.songs.length, total: state.songTotal }) }}
            </p>
            <Button
              v-if="state.hasMoreSongs"
              variant="glass"
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
        </section>

        <section v-else-if="state.activeTab === 1" class="albums-section">
          <div class="grid grid-cols-2 gap-3">
            <div
              v-for="album in state.albums"
              :key="album.id"
              class="album-card overflow-hidden rounded-2xl"
              @click="goToAlbum(album.id)"
            >
              <div class="relative aspect-square">
                <LazyImage
                  :src="formatCoverUrl(album.picUrl, { size: 200, artist: state.info.name })"
                  :alt="album.name"
                  imgClass="h-full w-full object-cover"
                />
                <div class="absolute inset-0 bg-linear-to-t from-black/60 to-transparent"></div>
                <div class="absolute right-2 bottom-2 left-2">
                  <p class="text-primary truncate text-xs font-medium">{{ album.name }}</p>
                  <p class="text-primary/60 text-[11px]">
                    {{ album.publishTime }} · {{ $t('commonUnits.songsShort', { count: album.size || 0 }) }}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div v-if="!state.albums.length" class="empty-text py-12 text-center">{{ $t('artistPage.albumsEmpty') }}</div>
          <div class="mt-3 flex flex-col items-center gap-2">
            <p v-if="state.albumTotal" class="text-[11px] text-primary/50">
              {{ $t('artistPage.loadedAlbums', { loaded: state.albums.length, total: state.albumTotal }) }}
            </p>
            <Button
              v-if="state.hasMoreAlbums"
              variant="glass"
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
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.header-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  backdrop-filter: blur(40px) saturate(1.5);
  -webkit-backdrop-filter: blur(40px) saturate(1.5);
}

.header-overlay {
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.3) 0%,
    rgba(0, 0, 0, 0.5) 50%,
    var(--glass-bg-base) 100%
  );
}

.avatar-wrapper {
  filter: drop-shadow(0 8px 24px rgba(0, 0, 0, 0.4));
}

.artist-avatar {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  border: 3px solid rgba(255, 255, 255, 0.2);
}

.play-all-btn {
  background: linear-gradient(135deg, #38bdf8, #2563eb);
  box-shadow: 0 4px 16px rgba(56,189,248, 0.35);
  transition: all 0.3s ease;
}

.play-all-btn:active {
  transform: scale(0.97);
  box-shadow: 0 2px 8px rgba(56,189,248, 0.3);
}

.shuffle-btn {
  background: var(--glass-bg-card);
  color: var(--glass-text-primary);
  border: 1px solid var(--glass-border-default);
  transition: all 0.3s ease;
}

.shuffle-btn:active {
  transform: scale(0.97);
  background: var(--glass-interactive-hover-muted);
}

.follow-btn {
  background: var(--glass-bg-card);
  color: var(--glass-text-primary);
  border: 1px solid var(--glass-border-default);
  transition: all 0.3s ease;
}

.follow-btn:active {
  transform: scale(0.95);
}

.follow-btn.followed {
  background: linear-gradient(135deg, rgba(56,189,248, 0.2), rgba(37,99,235, 0.2));
  border-color: rgba(56,189,248, 0.3);
  color: #38bdf8;
}

.tabs-bar {
  border-bottom: 1px solid var(--glass-border-default);
}

.tab-btn {
  color: var(--glass-text-primary);
  opacity: 0.6;
}

.tab-btn.active {
  background: linear-gradient(135deg, rgba(56,189,248, 0.2), rgba(37,99,235, 0.2));
  color: #38bdf8;
  opacity: 1;
}

.album-card {
  background: var(--glass-bg-card);
  border: 1px solid var(--glass-border-default);
  transition: all 0.2s ease;
}

.album-card:active {
  transform: scale(0.98);
  background: var(--glass-interactive-hover-muted);
}

.empty-text {
  color: var(--glass-text-primary);
  opacity: 0.4;
}
</style>
