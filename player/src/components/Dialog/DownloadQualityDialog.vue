<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useDownloadStore, DEFAULT_QUALITY_CHOICES, type QualityChoice } from '@/stores/modules/download'
import { formatCoverUrl } from '@/utils/imageUrl'
import Button from '@/components/Ui/Button.vue'

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

const currentChoice = computed(() => {
  return availableChoices.value.find((c) => c.level === selectedLevel.value) || availableChoices.value[0]
})

const handleConfirm = async () => {
  const song = downloadStore.currentDownloadSong
  if (!song) return
  try {
    await downloadStore.startDownload(song, currentChoice.value)
  } catch (e) {
    // 错误信息已保存在 downloadStore.errorMsg
  }
}

// 歌名最大字符上限保护
const displayTitle = computed(() => {
  const title = downloadStore.currentDownloadSong?.name || ''
  const MAX_LEN = 28
  return title.length > MAX_LEN ? title.slice(0, MAX_LEN) + '...' : title
})

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && downloadStore.dialogVisible) {
    downloadStore.closeDownloadDialog()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="downloadStore.dialogVisible"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-dialog-title"
    >
      <!-- 背景毛玻璃遮罩 (克制通透度) -->
      <Transition name="mask" appear>
        <div
          class="absolute inset-0 bg-black/35 backdrop-blur-sm"
          @click="downloadStore.closeDownloadDialog"
        />
      </Transition>

      <!-- 弹窗容器 -->
      <Transition name="dialog" appear>
        <div class="relative z-10 w-full max-w-lg">
          <div
            class="glass-container-strong relative overflow-hidden rounded-[28px] border border-white/20 p-6 shadow-2xl backdrop-blur-2xl"
            style="box-shadow: 0 24px 60px -10px rgba(0, 0, 0, 0.75), 0 0 45px rgba(236, 72, 153, 0.2);"
          >
            <!-- 右上角关闭按钮 -->
            <button
              @click="downloadStore.closeDownloadDialog"
              class="absolute top-5 right-5 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-primary/60 transition-all hover:bg-white/15 hover:text-primary active:scale-95 cursor-pointer"
              title="关闭"
            >
              <span class="icon-[mdi--close] h-4 w-4"></span>
            </button>

            <!-- 顶部标题与规格 -->
            <div class="mb-5 flex items-center gap-3.5 pr-8">
              <div
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-purple-600 shadow-lg shadow-pink-500/25"
              >
                <span class="icon-[mdi--tray-arrow-down] h-6 w-6 text-white" />
              </div>
              <div>
                <h3 id="download-dialog-title" class="text-base font-bold text-primary tracking-wide">
                  下载音质选择
                </h3>
                <p class="mt-0.5 text-xs text-primary/60">
                  支持无损母带编码，自动持久化至本地离线音乐库
                </p>
              </div>
            </div>

            <!-- 当前歌曲信息卡片 -->
            <div
              v-if="downloadStore.currentDownloadSong"
              class="relative mb-5 flex items-center gap-3.5 overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-sm"
            >
              <!-- 封面艺术图 (黑胶外环效果) -->
              <div class="relative h-13 w-13 shrink-0 overflow-hidden rounded-xl shadow-md border border-white/10">
                <img
                  :src="formatCoverUrl(downloadStore.currentDownloadSong.cover, { size: 120, artist: downloadStore.currentDownloadSong.artist })"
                  alt="cover"
                  class="h-full w-full object-cover"
                />
                <div class="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-white/15 pointer-events-none"></div>
              </div>

              <!-- 歌曲与歌手信息 -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h4
                    :title="downloadStore.currentDownloadSong.name"
                    class="truncate text-sm font-bold text-primary"
                  >
                    {{ displayTitle }}
                  </h4>
                  <span class="shrink-0 rounded bg-pink-500/15 px-1.5 py-0.5 text-[9px] font-bold text-pink-300 border border-pink-500/30">
                    多源高保真
                  </span>
                </div>
                <p class="mt-0.5 truncate text-xs text-primary/60">
                  {{ downloadStore.currentDownloadSong.artist }}
                  <span v-if="downloadStore.currentDownloadSong.album"> · 《{{ downloadStore.currentDownloadSong.album }}》</span>
                </p>
              </div>
            </div>

            <!-- 音质档位选择卡片 -->
            <div class="mb-4 space-y-2.5">
              <label
                v-for="choice in availableChoices"
                :key="choice.level"
                class="group relative flex cursor-pointer items-center justify-between rounded-2xl border p-3.5 transition-all duration-200 select-none"
                :class="[
                  selectedLevel === choice.level
                    ? 'border-pink-500/60 shadow-[0_0_24px_rgba(236,72,153,0.2)]'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
                ]"
                :style="selectedLevel === choice.level ? 'background: linear-gradient(135deg, rgba(236, 72, 153, 0.16) 0%, rgba(139, 92, 246, 0.14) 100%);' : ''"
              >
                <input
                  type="radio"
                  name="audioQuality"
                  :value="choice.level"
                  v-model="selectedLevel"
                  class="sr-only"
                />

                <!-- 左侧：单选按钮 + 规格信息 -->
                <div class="flex items-center gap-3.5 min-w-0 flex-1 pr-2">
                  <div
                    class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all"
                    :class="[
                      selectedLevel === choice.level
                        ? 'border-pink-400 bg-pink-500 text-white shadow-sm ring-2 ring-pink-500/30'
                        : 'border-white/30 bg-transparent group-hover:border-white/50'
                    ]"
                  >
                    <span
                      v-if="selectedLevel === choice.level"
                      class="icon-[mdi--check] h-3.5 w-3.5"
                    ></span>
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-sm font-bold text-primary">{{ choice.label }}</span>
                      <!-- 专属规格 Tag -->
                      <span
                        class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold leading-none"
                        :class="[
                          choice.level === 'lossless'
                            ? 'bg-gradient-to-r from-violet-600/35 to-pink-600/35 text-pink-300 border border-pink-500/40 shadow-[0_0_8px_rgba(236,72,153,0.25)]'
                            : choice.level === 'exhigh'
                              ? 'bg-indigo-500/25 text-indigo-300 border border-indigo-500/30'
                              : 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/30'
                        ]"
                      >
                        {{ choice.bitrate }}
                      </span>
                      <span class="hidden sm:inline-block rounded bg-white/5 px-1 py-0.5 font-mono text-[9px] text-primary/50 uppercase">
                        {{ choice.format }}
                      </span>
                    </div>
                    <p class="mt-1 text-xs text-primary/50 leading-snug truncate">
                      {{ choice.desc }}
                    </p>
                  </div>
                </div>

                <!-- 右侧：预估体积 -->
                <div class="shrink-0 text-right">
                  <span class="font-mono text-xs font-semibold text-primary/70">
                    {{ choice.estimatedSize }}
                  </span>
                  <p class="text-[10px] text-primary/40 mt-0.5">本地存储</p>
                </div>
              </label>
            </div>

            <!-- 离线存储提示 -->
            <div class="mb-5 flex items-start gap-2 rounded-xl bg-white/5 p-2.5 border border-white/5 text-[11px] text-primary/60 leading-relaxed">
              <span class="icon-[mdi--shield-check] h-4 w-4 shrink-0 text-emerald-400 mt-0.5"></span>
              <span>
                下载后文件将<strong>自动永久持久化于本地离线库</strong>，可在「下载列表」随时免流重放，同时触发浏览器文件保存。
              </span>
            </div>

            <!-- 错误提示（若有） -->
            <div
              v-if="downloadStore.errorMsg"
              class="mb-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/15 p-2.5 text-xs text-red-300"
            >
              <span class="icon-[mdi--alert-circle] h-4 w-4 shrink-0"></span>
              <span>{{ downloadStore.errorMsg }}</span>
            </div>

            <!-- 底部操作按钮 -->
            <div class="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
              <Button
                variant="ghost"
                size="md"
                rounded="xl"
                class="px-4 text-xs font-semibold text-primary/70 hover:text-primary"
                :disabled="downloadStore.isDownloading"
                @click="downloadStore.closeDownloadDialog"
              >
                取消
              </Button>

              <Button
                variant="gradient"
                size="md"
                rounded="xl"
                class="px-6 text-xs font-bold shadow-lg shadow-pink-500/25 hover:shadow-xl hover:shadow-pink-500/35 transition-all"
                :disabled="downloadStore.isDownloading"
                @click="handleConfirm"
              >
                <span
                  v-if="downloadStore.isDownloading"
                  class="icon-[mdi--loading] mr-1.5 h-4 w-4 animate-spin"
                ></span>
                <span v-else class="icon-[mdi--download] mr-1.5 h-4 w-4"></span>
                <span>{{ downloadStore.isDownloading ? '正在下载中...' : `确认下载 (${currentChoice.label})` }}</span>
              </Button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.mask-enter-active,
.mask-leave-active {
  transition: opacity 0.25s ease;
}
.mask-enter-from,
.mask-leave-to {
  opacity: 0;
}

.dialog-enter-active,
.dialog-leave-active {
  transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(12px);
}
</style>
