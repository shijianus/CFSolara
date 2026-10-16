<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useDownloadStore, DEFAULT_QUALITY_CHOICES, type QualityChoice } from '@/stores/modules/download'
import { formatCoverUrl } from '@/utils/imageUrl'
import Button from '@/components/Ui/Button.vue'

const downloadStore = useDownloadStore()
const selectedLevel = ref<string>('lossless')

// 根据当前歌曲的 qualities 列表展示音质选项，不展示未经验证的采样率/位深，保留真实码率与体积区间
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

// ════════════ 可访问性、键盘导航与焦点管理 ════════════
const dialogCardRef = ref<HTMLElement | null>(null)
const radioItemRefs = ref<HTMLElement[]>([])
const returnTriggerElement = ref<HTMLElement | null>(null)

// 上下/左右方向键在 radiogroup 中切换并聚焦
const selectNext = (delta: number) => {
  const list = availableChoices.value
  if (!list.length) return
  const currentIndex = list.findIndex((c) => c.level === selectedLevel.value)
  const nextIndex = (currentIndex + delta + list.length) % list.length
  selectedLevel.value = list[nextIndex].level
  nextTick(() => {
    const targetEl = radioItemRefs.value[nextIndex]
    targetEl?.focus()
  })
}

// 焦点陷阱与按键监听
const handleKeydown = (e: KeyboardEvent) => {
  if (!downloadStore.dialogVisible) return

  // 1. Esc 键安全退出
  if (e.key === 'Escape') {
    e.preventDefault()
    downloadStore.closeDownloadDialog()
    return
  }

  // 2. Tab 键焦点循环陷阱 (Focus Trap)
  if (e.key === 'Tab' && dialogCardRef.value) {
    const focusableElements = dialogCardRef.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [role="radio"][tabindex="0"], [tabindex="0"]:not([disabled])'
    )
    if (!focusableElements.length) return

    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault()
        lastElement.focus()
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault()
        firstElement.focus()
      }
    }
  }
}

// 打开弹窗时捕获触发按钮，聚焦当前选中项；关闭时焦点恢复至触发源
watch(
  () => downloadStore.dialogVisible,
  (visible) => {
    if (visible) {
      returnTriggerElement.value = document.activeElement as HTMLElement | null
      nextTick(() => {
        // 初始聚焦落在当前选中的单选卡片上
        const currentIndex = availableChoices.value.findIndex((c) => c.level === selectedLevel.value)
        const targetCard = radioItemRefs.value[currentIndex >= 0 ? currentIndex : 0]
        targetCard?.focus()
      })
    } else {
      nextTick(() => {
        returnTriggerElement.value?.focus?.()
        returnTriggerElement.value = null
      })
    }
  }
)

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
      <!-- 背景毛玻璃遮罩 -->
      <Transition name="mask" appear>
        <div
          class="absolute inset-0 bg-black/30 backdrop-blur-sm"
          @click="downloadStore.closeDownloadDialog"
        />
      </Transition>

      <!-- 弹窗容器 -->
      <Transition name="dialog" appear>
        <div class="relative z-10 w-full max-w-lg">
          <div
            ref="dialogCardRef"
            class="download-dialog-panel relative overflow-hidden rounded-[var(--glass-r-xl,24px)] p-5 sm:p-6 shadow-2xl backdrop-blur-2xl"
            style="box-shadow: 0 24px 60px -10px rgba(0, 0, 0, 0.65), 0 0 28px rgba(139, 92, 246, 0.15);"
          >
            <!-- 右上角关闭按钮 -->
            <button
              @click="downloadStore.closeDownloadDialog"
              class="absolute top-5 right-5 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-primary/60 transition-all hover:bg-white/15 hover:text-primary active:scale-95 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-pink-400/60"
              title="关闭"
              aria-label="关闭弹窗"
            >
              <span class="icon-[mdi--close] h-4 w-4"></span>
            </button>

            <!-- 顶部标题与规格说明 -->
            <div class="mb-4 flex items-center gap-3 pr-8">
              <div
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--glass-r-md,12px)] bg-gradient-to-br from-pink-500 to-purple-600 shadow-md shadow-pink-500/25"
              >
                <span class="icon-[mdi--tray-arrow-down] h-5 w-5 text-white" />
              </div>
              <div>
                <h3 id="download-dialog-title" class="text-base font-bold text-primary tracking-wide">
                  下载音质规格选择
                </h3>
                <p class="mt-0.5 text-xs text-primary/60">
                  选择音频规格以启动下载并导入离线音乐库
                </p>
              </div>
            </div>

            <!-- 当前歌曲信息卡片 -->
            <div
              v-if="downloadStore.currentDownloadSong"
              class="dialog-inner-card relative mb-4 flex items-center gap-3 overflow-hidden rounded-[var(--glass-r-md,12px)] p-3 backdrop-blur-sm"
            >
              <!-- 封面图：严格 8px 圆角规范 -->
              <div class="relative h-12 w-12 shrink-0 overflow-hidden rounded-[var(--glass-r-sm,8px)] shadow-md border border-white/10">
                <img
                  :src="formatCoverUrl(downloadStore.currentDownloadSong.cover, { size: 100, artist: downloadStore.currentDownloadSong.artist })"
                  alt="cover"
                  class="h-full w-full object-cover"
                />
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
                  <span class="shrink-0 rounded-[var(--glass-r-sm,8px)] bg-pink-500/15 px-1.5 py-0.5 text-[11px] font-mono font-medium text-pink-300 border border-pink-500/30">
                    {{ currentChoice.label }}
                  </span>
                </div>
                <p class="mt-0.5 truncate text-xs text-primary/60">
                  {{ downloadStore.currentDownloadSong.artist }}
                  <span v-if="downloadStore.currentDownloadSong.album"> · 《{{ downloadStore.currentDownloadSong.album }}》</span>
                </p>
              </div>
            </div>

            <!-- 音质档位选择卡片 (语义化 radiogroup，去掉大单选圆圈，选中态采用高光边框加勾选) -->
            <div
              class="mb-4 space-y-2 select-none"
              role="radiogroup"
              aria-labelledby="download-dialog-title"
            >
              <div
                v-for="(choice, index) in availableChoices"
                :key="choice.level"
                :ref="el => { if (el) radioItemRefs[index] = el as HTMLElement }"
                role="radio"
                :aria-checked="selectedLevel === choice.level"
                :tabindex="selectedLevel === choice.level ? 0 : -1"
                @click="selectedLevel = choice.level"
                @keydown.arrow-down.prevent="selectNext(1)"
                @keydown.arrow-right.prevent="selectNext(1)"
                @keydown.arrow-up.prevent="selectNext(-1)"
                @keydown.arrow-left.prevent="selectNext(-1)"
                @keydown.space.prevent="selectedLevel = choice.level"
                @keydown.enter.prevent="handleConfirm"
                class="group relative flex cursor-pointer items-center justify-between rounded-[var(--glass-r-lg,16px)] border p-3 transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-pink-400/60"
                :class="[
                  selectedLevel === choice.level
                    ? 'border-[var(--glass-accent-border,rgba(236,72,153,0.5))] bg-gradient-to-r from-pink-500/15 via-purple-500/10 to-transparent shadow-[var(--glass-accent-glow)]'
                    : 'dialog-inner-card hover:border-white/20 hover:bg-white/[0.08]'
                ]"
              >
                <!-- 左侧：规格名 + 码率/格式 + 描述 (不编造位深/采样率) -->
                <div class="flex items-center gap-3 min-w-0 flex-1 pr-2">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span
                        class="text-sm font-bold transition-colors"
                        :class="selectedLevel === choice.level ? 'text-primary font-bold' : 'text-primary/85'"
                      >
                        {{ choice.label }}
                      </span>
                      <!-- 格式与码率标签 -->
                      <span
                        class="shrink-0 rounded-[var(--glass-r-sm,8px)] px-1.5 py-0.5 text-[11px] font-mono font-medium leading-none"
                        :class="[
                          choice.level === 'lossless'
                            ? 'bg-pink-500/20 text-pink-300 border border-pink-500/35'
                            : choice.level === 'exhigh'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : 'bg-white/10 text-primary/70 border border-white/15'
                        ]"
                      >
                        {{ choice.bitrate }}
                      </span>
                      <span class="rounded bg-white/5 px-1 py-0.5 font-mono text-[11px] text-primary/50 uppercase">
                        {{ choice.format }}
                      </span>
                    </div>
                    <p class="mt-1 text-xs text-primary/55 leading-tight truncate">
                      {{ choice.desc }}
                    </p>
                  </div>
                </div>

                <!-- 右侧：预估体积区间 + 选中勾标 (无表单单选圆圈) -->
                <div class="flex items-center gap-3 shrink-0">
                  <div class="text-right">
                    <span class="font-mono text-xs font-semibold text-primary/75">
                      {{ choice.estimatedSize }}
                    </span>
                  </div>
                  <!-- 勾选指示器 (仅在选中态优雅浮现) -->
                  <div class="w-5 flex items-center justify-center">
                    <span
                      v-if="selectedLevel === choice.level"
                      class="icon-[mdi--check] h-4.5 w-4.5 text-pink-400 shrink-0 drop-shadow-[0_0_6px_rgba(236,72,153,0.5)]"
                    ></span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 底部存储与导出提示文案 -->
            <div class="dialog-inner-card mb-4 flex items-center gap-2 rounded-[var(--glass-r-md,12px)] px-3 py-2 text-[11px] text-primary/65 leading-relaxed">
              <span class="icon-[mdi--shield-check] h-4 w-4 shrink-0 text-emerald-400"></span>
              <span>
                音频将<strong>存入应用内离线库</strong>（可在下载列表随时免流播放），并<strong>同步唤起本地文件保存</strong>。
              </span>
            </div>

            <!-- 错误提示（若有） -->
            <div
              v-if="downloadStore.errorMsg"
              class="mb-3 flex items-center gap-2 rounded-[var(--glass-r-md,12px)] border border-red-500/30 bg-red-500/15 p-2.5 text-xs text-red-300"
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
                class="px-4 text-xs font-semibold text-primary/70 hover:text-primary outline-none focus-visible:ring-2 focus-visible:ring-pink-400/60"
                :disabled="downloadStore.isDownloading"
                @click="downloadStore.closeDownloadDialog"
              >
                取消
              </Button>

              <Button
                variant="gradient"
                size="md"
                rounded="xl"
                class="px-6 text-xs font-bold shadow-lg shadow-pink-500/25 hover:shadow-xl hover:shadow-pink-500/35 transition-all outline-none focus-visible:ring-2 focus-visible:ring-pink-400/60"
                :disabled="downloadStore.isDownloading"
                @click="handleConfirm"
              >
                <span
                  v-if="downloadStore.isDownloading"
                  class="icon-[mdi--loading] mr-1.5 h-4 w-4 animate-spin"
                ></span>
                <span v-else class="icon-[mdi--tray-arrow-down] mr-1.5 h-4 w-4"></span>
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
.download-dialog-panel {
  background: linear-gradient(180deg, rgba(38, 30, 62, 0.90) 0%, rgba(30, 26, 52, 0.92) 100%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(28px) saturate(1.7);
  -webkit-backdrop-filter: blur(28px) saturate(1.7);
}

.dialog-inner-card {
  background-color: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.10);
}

.mask-enter-active,
.mask-leave-active {
  transition: opacity var(--glass-duration-normal, 200ms) var(--glass-ease, ease);
}
.mask-enter-from,
.mask-leave-to {
  opacity: 0;
}

.dialog-enter-active,
.dialog-leave-active {
  transition: all var(--glass-duration-normal, 200ms) cubic-bezier(0.16, 1, 0.3, 1);
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}
</style>
