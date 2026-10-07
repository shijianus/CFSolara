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
  } catch {}

  // Sonic 多源聚合网关智能兜底
  try {
    const sonicRes = await fetch(`/api/sonic/search/nexus?q=${encodeURIComponent(term)}&count=${props.limit ?? 30}`).then(r => r.json())
    const tracks = sonicRes?.data?.tracks || []
    state.results = tracks.map((t: any) => ({
      id: t.platformId || t.id,
      name: t.title || t.name,
      ar: [{ id: 0, name: t.artist }],
      al: { id: 0, name: t.album, picUrl: t.cover || t.coverUrl },
      dt: (t.duration || 200) * 1000,
      url: '',
    }))
    emit('loaded', state.results.length)
    emit('total', state.results.length)
  } catch {}
  finally {
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
