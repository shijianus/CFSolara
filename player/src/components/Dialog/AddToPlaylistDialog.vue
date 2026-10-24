<script setup lang="ts">
/**
 * 加入本地歌单弹窗
 * 播放器抽屉“加入歌单”入口:选择一个本地歌单写入当前歌曲,或就地新建歌单。
 * 本地歌单全部持久化在 library store(localStorage),无服务端写接口。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLibraryStore } from '@/stores/modules/library'
import { useAudioStore } from '@/stores/modules/audio'
import { useToastStore } from '@/stores/modules/toast'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', value: boolean): void }>()

const { t } = useI18n()
const libraryStore = useLibraryStore()
const audioStore = useAudioStore()
const toastStore = useToastStore()

const newPlaylistName = ref('')
const addedPlaylistId = ref('')

const song = computed(() => audioStore.audio.currentSong)
const playlists = computed(() => libraryStore.userPlaylists)

const close = () => emit('update:show', false)

watch(
  () => props.show,
  visible => {
    if (visible) {
      newPlaylistName.value = ''
      addedPlaylistId.value = ''
    }
  }
)

const createAndAdd = () => {
  if (!song.value) return
  const created = libraryStore.createUserPlaylist(newPlaylistName.value)
  if (!created) return
  const added = libraryStore.addSongToUserPlaylist(created.id, song.value)
  newPlaylistName.value = ''
  addedPlaylistId.value = created.id
  toastStore.show({
    message: added
      ? t('player.addedToPlaylist', { name: created.name })
      : t('player.playlistCreated', { name: created.name }),
    type: 'success',
  })
}

const addTo = (playlistId: string, name: string) => {
  if (!song.value) return
  const added = libraryStore.addSongToUserPlaylist(playlistId, song.value)
  if (!added) {
    toastStore.show({ message: t('player.alreadyInPlaylist'), type: 'info' })
    return
  }
  addedPlaylistId.value = playlistId
  toastStore.show({ message: t('player.addedToPlaylist', { name }), type: 'success' })
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') close()
}
watch(
  () => props.show,
  visible => {
    if (visible) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  }
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      :aria-label="t('player.addToPlaylist')"
      @keydown.escape="close"
    >
      <div
        class="absolute inset-0"
        style="background-color: rgba(0, 0, 0, 0.40); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px)"
        @click="close"
      ></div>

      <div
        class="relative z-10 w-full max-w-[380px] rounded-[20px] border border-white/10 bg-[#101b2e]/95 p-5 shadow-2xl"
      >
        <div class="mb-3 flex items-center justify-between border-b border-white/10 pb-3">
          <h3 class="text-primary text-[16px] font-semibold leading-tight">
            {{ t('player.addToPlaylist') }}
          </h3>
          <button
            type="button"
            class="text-primary/60 hover:text-primary hover:bg-hover-glass flex h-11 w-11 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="close"
          >
            <span class="icon-[mdi--close] h-4 w-4"></span>
          </button>
        </div>

        <p v-if="song" class="text-primary/70 mb-3 truncate text-xs">
          {{ song.name }}<span v-if="song.artist"> · {{ song.artist }}</span>
        </p>

        <!-- 歌单列表 -->
        <div class="custom-scrollbar mb-3 max-h-52 space-y-1 overflow-y-auto">
          <p v-if="!playlists.length" class="text-primary/50 py-4 text-center text-xs">
            {{ t('player.emptyUserPlaylists') }}
          </p>
          <button
            v-for="pl in playlists"
            :key="pl.id"
            type="button"
            class="hover:bg-hover-glass focus-visible:ring-sky-400/60 flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2"
            @click="addTo(pl.id, pl.name)"
          >
            <span class="min-w-0">
              <span class="text-primary block truncate text-[13px] font-medium">{{ pl.name }}</span>
              <span class="text-primary/50 text-[11px]">
                {{ t('player.playlistSongCount', { count: pl.songs.length }) }}
              </span>
            </span>
            <span
              v-if="addedPlaylistId === pl.id"
              class="text-sky-400 shrink-0 text-[11px] font-semibold"
            >
              {{ t('player.addedTag') }}
            </span>
            <span v-else class="icon-[mdi--plus] text-primary/50 h-4 w-4 shrink-0"></span>
          </button>
        </div>

        <!-- 新建歌单 -->
        <form class="flex items-center gap-2" @submit.prevent="createAndAdd">
          <input
            v-model="newPlaylistName"
            type="text"
            maxlength="30"
            :placeholder="t('player.newPlaylistName')"
            class="text-primary placeholder:text-primary/40 bg-hover-glass focus:ring-sky-400/60 min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 px-3 text-[13px] outline-none focus:ring-2"
            :aria-label="t('player.newPlaylistName')"
          />
          <button
            type="submit"
            :disabled="!newPlaylistName.trim() || !song"
            class="min-h-11 shrink-0 rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 px-4 text-[13px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {{ t('player.createPlaylist') }}
          </button>
        </form>
      </div>
    </div>
  </Teleport>
</template>
