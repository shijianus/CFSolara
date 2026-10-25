<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useLyrics } from '@/composables/useLyrics'
import SongCommentsDialog from '@/components/Comments/SongCommentsDialog.vue'
import { songDetail, search } from '@/api'
import { useAudio } from '@/composables/useAudio'
import { formatDuration } from '@/utils/time'
import LazyImage from '@/components/Ui/LazyImage.vue'
import {
  transformSearchSongs,
  transformSearchPlaylists,
  normalizeDurationMs,
  type SongData,
  type PlaylistData,
} from '@/utils/transformers'
import { formatCoverUrl } from '@/utils/imageUrl'
import { fetchRecommendSimilar, type RecommendSongItem } from '@/api/recommend'
import { useRecommendStore } from '@/stores/modules/recommend'

const route = useRoute()
const router = useRouter()
const songId = computed(() => route.params.id as string | number)
const { mergedLines, fetchLyrics } = useLyrics()
const { play, pause, resume, setPlaylist, currentSong, isPlaying } = useAudio()
const recommendStore = useRecommendStore()
const showComments = ref(false)

const state = reactive({
  info: null as any,
  similarSongs: [] as RecommendSongItem[],
  similarArtists: [] as string[],
  similarPlaylists: [] as PlaylistData[],
})

onMounted(() => fetchLyrics(songId.value))
watch(
  () => route.params.id,
  id => fetchLyrics(id as any)
)

const artistName = computed(() => {
  if (!state.info) return ''
  return Array.isArray(state.info?.ar)
    ? state.info.ar.map((a: any) => a.name).join(' / ')
    : state.info?.artists?.map((a: any) => a.name).join(' / ')
})

const albumName = computed(() => state.info?.al?.name || state.info?.album?.name || '')
const albumCover = computed(() => state.info?.al?.picUrl || state.info?.album?.picUrl || '')
const duration = computed(() => normalizeDurationMs(state.info?.dt ?? state.info?.duration ?? 0))

const playCurrent = () => {
  if (!state.info) return
  const song = {
    id: state.info.id,
    name: state.info.name,
    artist: artistName.value,
    album: albumName.value,
    duration: duration.value,
    cover: albumCover.value,
  }
  const isSameSong = String(currentSong.value?.id ?? '') === String(state.info.id)
  if (isSameSong) {
    if (isPlaying.value) {
      pause()
    } else {
      resume()
    }
    return
  }
  setPlaylist([song], 0)
  play(song, 0)
}

const isCurrent = computed(() => {
  if (!currentSong.value || !state.info) return false
  return String(state.info.id) === String(currentSong.value.id)
})

const startCurrentRadio = async () => {
  if (!state.info) return
  await recommendStore.startSongRadio({
    id: state.info.id,
    name: state.info.name,
    artist: artistName.value,
    album: albumName.value,
    duration: duration.value,
    cover: albumCover.value,
  })
}

const playSimilarAt = (song: RecommendSongItem, idx: number, e: Event) => {
  e.stopPropagation()
  setPlaylist(state.similarSongs as any, idx)
  play(song as any, idx)
}

const loadInfo = async () => {
  try {
    const rawId = String(songId.value)
    const formattedIds = rawId.startsWith('[') ? rawId : `[${rawId}]`
    const res: any = await songDetail({ ids: formattedIds })
    const song = Array.isArray(res?.songs) ? res.songs[0] : res?.songs
    state.info = song
    const artistNameVal = Array.isArray(song?.ar)
      ? song.ar.map((a: any) => a.name).join(' / ')
      : song?.artists?.map((a: any) => a.name).join(' / ')

    // 优先通过智能内容相似度与共现引擎获取相似歌曲与相似歌手，失败时自动降级到关键词检索
    let loadedSmartSim = false
    try {
      const simRes = await fetchRecommendSimilar(
        {
          trackId: rawId,
          title: song?.name || '',
          artist: artistNameVal || '',
          album: song?.al?.name || song?.album?.name || '',
          count: 12,
        },
        recommendStore.buildRequestHeaders(true)
      )
      if (simRes.tracks.length > 0) {
        state.similarSongs = simRes.tracks
        state.similarArtists = simRes.similarArtists
        loadedSmartSim = true
      }
    } catch {}

    if (!loadedSmartSim) {
      const resSimSongs = await search({ keywords: artistNameVal || song?.name || '', type: 1 })
      const { songs } = transformSearchSongs(resSimSongs as Record<string, unknown>, 12)
      state.similarSongs = songs as RecommendSongItem[]
      state.similarArtists = []
    }

    // 搜索相关歌单
    const resSimPls = await search({ keywords: song?.name || '', type: 1000 })
    const { playlists } = transformSearchPlaylists(resSimPls as Record<string, unknown>, 6)
    state.similarPlaylists = playlists

    if (song) {
      fetchLyrics(songId.value, false, {
        name: song.name,
        artist: artistNameVal,
        album: albumName.value,
        duration: duration.value,
      })
      if (route.query.autoplay === '1') {
        playCurrent()
      }
    }
  } catch {}
}

onMounted(() => loadInfo())
watch(songId, () => loadInfo())
</script>

<template>
  <div class="text-primary flex-1 overflow-hidden">
    <div class="h-full overflow-auto pb-6">
      <div class="p-6">
        <div v-if="state.info" class="mb-8 flex gap-8">
          <div class="group relative h-72 w-72 shrink-0 overflow-hidden rounded-2xl shadow-2xl">
            <LazyImage
              :src="formatCoverUrl(albumCover, { size: 300 })"
              :alt="$t('song.coverAlt')"
              imgClass="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              wrapperClass="h-full w-full"
            />
            <div
              class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            >
              <button
                type="button"
                class="flex h-16 w-16 items-center justify-center rounded-full bg-sky-500/90 text-white shadow-lg transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-sky-400/60"
                :aria-label="isCurrent && isPlaying ? $t('player.pause') : $t('player.play')"
                @click="playCurrent"
              >
                <span v-if="isCurrent && isPlaying" class="icon-[mdi--pause] h-8 w-8"></span>
                <span v-else class="icon-[mdi--play] h-8 w-8"></span>
              </button>
            </div>
          </div>

          <div class="flex min-w-0 flex-1 flex-col justify-center">
            <h1 class="mb-4 text-4xl leading-tight font-bold">{{ state.info.name }}</h1>

            <div class="mb-6 flex flex-wrap items-center gap-3">
              <button
                class="glass-button inline-flex items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-white/20"
                @click="
                  router.push(
                    `/artist/${(Array.isArray(state.info?.ar) ? state.info.ar[0]?.id : state.info?.artists?.[0]?.id) || ''}`
                  )
                "
              >
                <span class="icon-[mdi--account-music] h-5 w-5"></span>
                {{ artistName }}
              </button>
              <button
                v-if="state.info?.al?.id || state.info?.album?.id"
                class="glass-button inline-flex items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-white/20"
                @click="router.push(`/album/${state.info?.al?.id || state.info?.album?.id}`)"
              >
                <span class="icon-[mdi--album] h-5 w-5"></span>
                {{ albumName }}
              </button>
              <span class="text-primary/60 text-sm">{{ formatDuration(duration) }}</span>
            </div>

            <div class="flex items-center gap-3">
              <button
                type="button"
                class="inline-flex min-h-11 items-center gap-2 rounded-full bg-sky-500 px-6 py-3 font-medium text-white shadow-lg transition-all hover:bg-sky-600 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-sky-400/60"
                @click="playCurrent"
              >
                <span v-if="isCurrent && isPlaying" class="icon-[mdi--pause] h-5 w-5"></span>
                <span v-else class="icon-[mdi--play] h-5 w-5"></span>
                {{ isCurrent && isPlaying ? $t('player.pause') : $t('player.play') }}
              </button>
              <button
                class="glass-button inline-flex items-center gap-2 px-5 py-3 transition-colors hover:bg-white/20"
                @click="showComments = true"
              >
                <span class="icon-[mdi--comment-outline] h-5 w-5"></span>
                {{ $t('song.comments') }}
              </button>
              <button
                type="button"
                class="glass-button hover:bg-hover-glass inline-flex items-center gap-2 px-5 py-3 text-[var(--glass-text-accent)] transition-colors"
                @click="startCurrentRadio"
              >
                <span class="icon-[mdi--radio-tower] h-5 w-5"></span>
                {{ $t('recommend.actions.startRadio') }}
              </button>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div class="lg:col-span-2">
            <div class="glass-card overflow-hidden rounded-2xl">
              <div class="border-b border-white/10 px-6 py-4">
                <h2 class="text-lg font-semibold">{{ $t('song.lyrics') }}</h2>
              </div>
              <div class="custom-scrollbar overflow-y-auto p-6">
                <div v-if="mergedLines.length" class="space-y-3">
                  <div
                    v-for="(m, i) in mergedLines"
                    :key="i"
                    class="rounded-xl p-3 transition-colors hover:bg-white/5"
                  >
                    <p class="text-primary text-base leading-relaxed">{{ m.ori }}</p>
                    <p v-if="m.tran" class="text-primary/70 mt-1 text-sm">{{ m.tran }}</p>
                    <p v-if="m.roma" class="text-primary/50 mt-1 text-xs italic">{{ m.roma }}</p>
                  </div>
                </div>
                <div v-else class="flex flex-col items-center justify-center py-12 text-center">
                  <span
                    class="icon-[mdi--text-box-remove-outline] text-primary/30 mb-3 h-12 w-12"
                  ></span>
                  <p class="text-primary/50">{{ $t('song.noLyrics') }}</p>
                </div>
              </div>
            </div>
          </div>

          <div class="space-y-6">
            <div v-if="state.similarSongs.length" class="glass-card overflow-hidden rounded-2xl">
              <div class="border-b border-white/10 px-6 py-4">
                <h2 class="text-lg font-semibold">{{ $t('recommend.actions.similarSongs') }}</h2>
                <div
                  v-if="state.similarArtists.length"
                  class="mt-2 flex flex-wrap items-center gap-1.5"
                >
                  <span class="text-primary/50 text-xs">{{ $t('recommend.actions.similarArtists') }}:</span>
                  <button
                    v-for="art in state.similarArtists"
                    :key="art"
                    type="button"
                    @click="router.push({ path: '/search', query: { q: art } })"
                    class="border-glass bg-hover-glass text-primary/75 hover:text-[var(--glass-text-accent)] rounded-full border px-2.5 py-0.5 text-[11px] transition-colors"
                  >
                    {{ art }}
                  </button>
                </div>
              </div>
              <div class="custom-scrollbar max-h-[420px] overflow-y-auto">
                <div
                  v-for="(song, index) in state.similarSongs"
                  :key="song.id"
                  class="group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-white/10"
                  @click="router.push(`/song/${song.id}`)"
                >
                  <span class="text-primary/40 w-6 text-center text-sm">{{ index + 1 }}</span>
                  <div class="min-w-0 flex-1">
                    <p class="text-primary truncate text-sm font-medium group-hover:text-sky-300">
                      {{ song.name }}
                    </p>
                    <p class="text-primary/60 truncate text-xs">{{ song.artist }}</p>
                    <p
                      v-if="song.recommendReason"
                      class="text-primary/45 mt-0.5 truncate text-[11px]"
                    >
                      {{ song.recommendReason }}
                    </p>
                  </div>
                  <button
                    type="button"
                    @click="playSimilarAt(song, index, $event)"
                    class="text-primary/50 hover:text-[var(--glass-text-accent)] flex h-7 w-7 items-center justify-center rounded-lg"
                  >
                    <span class="icon-[mdi--play] h-4 w-4" />
                  </button>
                  <span class="text-primary/40 text-xs">{{ formatDuration(song.duration) }}</span>
                </div>
              </div>
            </div>

            <div
              v-if="state.similarPlaylists.length"
              class="glass-card overflow-hidden rounded-2xl"
            >
              <div class="border-b border-white/10 px-6 py-4">
                <h2 class="text-lg font-semibold">{{ $t('song.relatedPlaylists') }}</h2>
              </div>
              <div class="grid grid-cols-2 gap-3 p-4">
                <router-link
                  v-for="pl in state.similarPlaylists"
                  :key="pl.id"
                  :to="`/playlist/${pl.id}`"
                  class="group overflow-hidden rounded-xl"
                >
                  <div class="relative aspect-square overflow-hidden rounded-lg">
                    <img
                      :src="formatCoverUrl(pl.coverImgUrl, { size: 200 })"
                      class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                      referrerpolicy="no-referrer"
                    />
                    <div
                      class="absolute inset-0 bg-linear-to-t from-black/60 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
                    ></div>
                  </div>
                  <p
                    class="text-primary mt-2 truncate text-xs font-medium group-hover:text-sky-300"
                  >
                    {{ pl.name }}
                  </p>
                  <p class="text-primary/50 truncate text-xs">{{ $t('song.trackCount', { count: pl.trackCount }) }}</p>
                </router-link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <SongCommentsDialog v-model:show="showComments" :song-id="songId" />
  </div>
</template>
