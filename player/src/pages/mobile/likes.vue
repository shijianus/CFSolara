<script setup lang="ts">
import { useAudio } from '@/composables/useAudio'
import LazyImage from '@/components/Ui/LazyImage.vue'
import { formatCoverUrl } from '@/utils/imageUrl'
import { useLibraryStore } from '@/stores/modules/library'
import { formatDate } from '@/utils/time'

const { setPlaylist, play } = useAudio()
const libraryStore = useLibraryStore()

const likedSongs = computed(() => libraryStore.likedSongs)

const playSong = (s: (typeof libraryStore.likedSongs)[number]) => {
  const songs = libraryStore.toPlayableSongs()
  const index = songs.findIndex(x => String(x.id) === String(s.id))
  if (index >= 0) {
    setPlaylist(songs, index)
    play(songs[index], index)
  }
}
</script>

<template>
  <div class="flex-1 overflow-auto px-3 pb-6">
    <template v-if="!likedSongs.length">
      <div class="py-10 text-center text-primary/70">{{ $t('likes.empty') }}</div>
    </template>
    <div v-else class="space-y-3">
      <div
        v-for="s in likedSongs"
        :key="s.id"
        class="glass-card flex items-center gap-3 p-3"
        @click="playSong(s)"
      >
        <div class="h-12 w-12 shrink-0 overflow-hidden rounded-lg">
          <LazyImage
            v-if="s.cover"
            :src="formatCoverUrl(s.cover, { size: 200, artist: s.artist })"
            alt="cover"
            imgClass="h-full w-full object-cover"
          />
          <div v-else class="flex h-full w-full items-center justify-center rounded-lg glass-button">
            🎵
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-primary">{{ s.name }}</p>
          <p class="truncate text-xs text-primary/70">{{ s.artist }}</p>
          <p class="truncate text-[11px] text-primary/40">{{ formatDate(s.likedAt) }}</p>
        </div>
        <button
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-red-400/80 transition-colors hover:text-red-400"
          :title="$t('common.unlike')"
          @click.stop="libraryStore.removeLikedSong(s.id)"
        >
          <span class="icon-[mdi--heart-off-outline] h-5 w-5"></span>
        </button>
      </div>
    </div>
  </div>
</template>
