<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useDownloadStore, DEFAULT_QUALITY_CHOICES, type QualityChoice } from '@/stores/modules/download'
import { formatCoverUrl } from '@/utils/imageUrl'

const downloadStore = useDownloadStore()
const selectedLevel = ref<string>('lossless')

// 根据当前歌曲的 qualities 列表动态展示音质选项
const availableChoices = computed<QualityChoice[]>(() => {
  const song = downloadStore.currentDownloadSong
  if (!song) return DEFAULT_QUALITY_CHOICES

  if (song.qualities && song.qualities.length > 0) {
    return song.qualities.map((q) => {
      const def = DEFAULT_QUALITY_CHOICES.find((d) => d.level === q.level)
      return {
        level: q.level,
        label: q.label || (def?.label ?? '高品质'),
        bitrate: q.bitrate || (def?.bitrate ?? '320kbps'),
        format: q.format || (def?.format ?? 'mp3'),
        desc: q.desc || (def?.desc ?? '超清高品质音频'),
        estimatedSize:
          q.level === 'lossless'
            ? '约 25MB - 50MB'
            : q.level === 'exhigh'
              ? '约 8MB - 12MB'
              : '约 3MB - 5MB',
        streamUrl: q.streamUrl,
      }
    })
  }

  return DEFAULT_QUALITY_CHOICES
})

// 当歌曲改变时，默认选中最高音质
watch(
  () => downloadStore.currentDownloadSong,
  (newSong) => {
    if (newSong) {
      if (newSong.qualities && newSong.qualities.length > 0) {
        selectedLevel.value = newSong.qualities[0].level
      } else {
        selectedLevel.value = 'lossless'
      }
    }
  },
  { immediate: true }
)

const handleConfirm = async () => {
  const song = downloadStore.currentDownloadSong
  if (!song) return
  const choice = availableChoices.value.find((c) => c.level === selectedLevel.value) || availableChoices.value[0]
  try {
    await downloadStore.startDownload(song, choice)
  } catch (e) {
    // 错误信息已保存在 downloadStore.errorMsg
  }
}

// 歌名最大字符上限保护
const displayTitle = computed(() => {
  const title = downloadStore.currentDownloadSong?.name || ''
  const MAX_LEN = 26
  return title.length > MAX_LEN ? title.slice(0, MAX_LEN) + '...' : title
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="downloadStore.dialogVisible"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
        @click.self="downloadStore.closeDownloadDialog"
      >
        <div
          class="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/15 bg-neutral-900/90 p-6 shadow-2xl backdrop-blur-2xl transition-all duration-300"
          style="box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 40px rgba(236, 72, 153, 0.15);"
        >
          <!-- 顶部标题与关闭按钮 -->
          <div class="flex items-center justify-between pb-4 border-b border-white/10">
            <div class="flex items-center gap-2">
              <span class="icon-[mdi--tray-arrow-down] h-6 w-6 text-pink-400"></span>
              <h3 class="text-base font-bold text-white tracking-wide">下载音质选择</h3>
            </div>
            <button
              @click="downloadStore.closeDownloadDialog"
              class="rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
            >
              <span class="icon-[mdi--close] h-4 w-4"></span>
            </button>
          </div>

          <!-- 当前歌曲信息 -->
          <div
            v-if="downloadStore.currentDownloadSong"
            class="my-4 flex items-center gap-3.5 rounded-2xl bg-white/5 p-3 border border-white/5"
          >
            <img
              :src="formatCoverUrl(downloadStore.currentDownloadSong.cover, { size: 120, artist: downloadStore.currentDownloadSong.artist })"
              alt="cover"
              class="h-12 w-12 rounded-xl object-cover shadow-md"
            />
            <div class="min-w-0 flex-1">
              <h4
                :title="downloadStore.currentDownloadSong.name"
                class="truncate text-sm font-semibold text-white"
              >
                {{ displayTitle }}
              </h4>
              <p class="truncate text-xs text-white/60 mt-0.5">
                {{ downloadStore.currentDownloadSong.artist }}
                <span v-if="downloadStore.currentDownloadSong.album"> · 《{{ downloadStore.currentDownloadSong.album }}》</span>
              </p>
            </div>
          </div>

          <!-- 音质选项卡片列表 -->
          <div class="space-y-2.5 my-4">
            <label
              v-for="choice in availableChoices"
              :key="choice.level"
              class="relative flex cursor-pointer items-center justify-between rounded-2xl border p-3.5 transition-all duration-200 select-none"
              :class="[
                selectedLevel === choice.level
                  ? 'border-pink-500/60 bg-gradient-to-r from-pink-500/15 via-purple-500/10 to-transparent shadow-[0_0_20px_rgba(236,72,153,0.15)] ring-1 ring-pink-500/40'
                  : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/20'
              ]"
            >
              <input
                type="radio"
                name="audioQuality"
                :value="choice.level"
                v-model="selectedLevel"
                class="sr-only"
              />
              <div class="flex items-center gap-3 min-w-0">
                <div
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all"
                  :class="[
                    selectedLevel === choice.level
                      ? 'border-pink-500 bg-pink-500 text-white shadow-sm'
                      : 'border-white/30 bg-transparent'
                  ]"
                >
                  <span
                    v-if="selectedLevel === choice.level"
                    class="icon-[mdi--check] h-3.5 w-3.5"
                  ></span>
                </div>
                <div>
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-bold text-white">{{ choice.label }}</span>
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px] font-mono font-bold leading-none"
                      :class="[
                        choice.level === 'lossless'
                          ? 'bg-pink-500/25 text-pink-300 border border-pink-500/30'
                          : choice.level === 'exhigh'
                            ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/30'
                            : 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/30'
                      ]"
                    >
                      {{ choice.bitrate }}
                    </span>
                  </div>
                  <p class="text-xs text-white/50 mt-0.5 leading-snug">{{ choice.desc }}</p>
                </div>
              </div>
              <span class="shrink-0 text-xs text-white/40 font-mono">{{ choice.estimatedSize }}</span>
            </label>
          </div>

          <!-- 提示与错误展示 -->
          <div v-if="downloadStore.errorMsg" class="mb-3 rounded-xl bg-red-500/15 border border-red-500/30 p-2.5 text-xs text-red-300 flex items-center gap-2">
            <span class="icon-[mdi--alert-circle] h-4 w-4 shrink-0"></span>
            <span>{{ downloadStore.errorMsg }}</span>
          </div>

          <p class="text-[11px] text-white/40 mb-4 leading-relaxed">
            ✨ 下载后音乐将自动永久保存在本地离线库（下载列表），同时自动保存至本地文件夹。
          </p>

          <!-- 底部操作按钮 -->
          <div class="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
            <button
              @click="downloadStore.closeDownloadDialog"
              :disabled="downloadStore.isDownloading"
              class="rounded-xl px-4 py-2 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            >
              取消
            </button>
            <button
              @click="handleConfirm"
              :disabled="downloadStore.isDownloading"
              class="relative flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-pink-500/25 hover:opacity-95 active:scale-95 transition-all disabled:opacity-50"
            >
              <span
                v-if="downloadStore.isDownloading"
                class="icon-[mdi--loading] h-4 w-4 animate-spin"
              ></span>
              <span v-else class="icon-[mdi--download] h-4 w-4"></span>
              <span>{{ downloadStore.isDownloading ? '正在下载...' : '确认下载' }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
