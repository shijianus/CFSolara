<script setup lang="ts">
import { cloudSearch } from '@/api'
import { useAudio } from '@/composables/useAudio'
import { transformSearchSongs, type SongData } from '@/utils/transformers'

interface Props {
  keywords: string
  limit?: number
  offset?: number
}
const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'loaded', count: number): void
  (e: 'total', count: number): void
}>()

interface SongsState {
  results: SongData[]
  isLoading: boolean
}

const state = reactive<SongsState>({ results: [], isLoading: false })
const { results, isLoading } = toRefs(state)

const { setPlaylist, play } = useAudio()

const playAll = () => {
  if (state.results.length === 0) return
  const playlist = state.results
  setPlaylist(playlist, 0)
  play(playlist[0], 0)
}

const fetchSongs = async () => {
  const term = props.keywords?.trim()
  if (!term) {
    state.results = []
    return
  }
  state.isLoading = true

  try {
    // 1. 优先调用 Sonic 统一多源 SHA 聚合与音质分级搜索网关
    try {
      const page = Math.floor((props.offset ?? 0) / (props.limit ?? 40)) + 1
      const count = props.limit ?? 40
      const sonicRes = await fetch(
        `/api/sonic/search/nexus?q=${encodeURIComponent(term)}&page=${page}&count=${count}`
      ).then(r => r.json())
      const tracks = sonicRes?.data?.tracks || []
      if (tracks.length > 0) {
        state.results = tracks.map((t: any) => ({
          id: t.platformId || t.id,
          name: t.title || t.name,
          artist: t.artist,
          artistId: 0,
          artists: [{ id: 0, name: t.artist }],
          album: t.album || '',
          albumId: 0,
          cover: t.cover || t.coverUrl || '',
          duration: (t.duration || 200) * 1000,
          dt: (t.duration || 200) * 1000,
          url: t.streamUrl || `/api/music/stream?id=${encodeURIComponent(t.platformId || t.id)}&title=${encodeURIComponent(t.title || '')}&artist=${encodeURIComponent(t.artist || '')}`,
          sha: t.sha || '',
          qualityBadge: t.qualityBadge || 'SQ',
          qualities: t.qualities || [],
          liked: false,
        }))
        emit('loaded', state.results.length)
        emit('total', sonicRes?.data?.total || state.results.length)
        return
      }
    } catch (err) {
      console.warn('[Sonic Search] Nexus gateway warning:', err)
    }

    // 2. 备用兜底检索通道
    try {
      const res = await cloudSearch({
        keywords: term,
        type: 1,
        limit: props.limit ?? 40,
        offset: props.offset ?? 0,
      })
      const { songs, total } = transformSearchSongs(res as Record<string, unknown>)
      if (songs && songs.length > 0) {
        state.results = songs
        emit('loaded', state.results.length)
        emit('total', total)
        return
      }
    } catch (err) {
      console.warn('[Sonic Search] CloudSearch fallback warning:', err)
    }

    state.results = []
    emit('loaded', 0)
    emit('total', 0)
  } finally {
    state.isLoading = false
  }
}

watch(
  [() => props.keywords, () => props.limit, () => props.offset],
  () => {
    fetchSongs()
  },
  { immediate: true }
)

defineExpose({
  playAll,
})
</script>
<template>
  <div class="flex h-full flex-col overflow-hidden">
    <SongList
      :songs="results"
      :loading="isLoading"
      :showHeader="true"
      :showControls="false"
      :emptyMessage="$t('components.songList.empty')"
    />
  </div>
</template>
