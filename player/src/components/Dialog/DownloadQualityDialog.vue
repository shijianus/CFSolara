<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useDownloadStore, type QualityChoice } from '@/stores/modules/download'
import { useAudioStore } from '@/stores/modules/audio'
import { formatCoverUrl } from '@/utils/imageUrl'
import {
  probeSongQualities,
  cancelSongProbe,
  getCachedProbeResult,
  type SongProbeResult,
  type QualityLevel,
  QUALITY_LEVELS,
} from '@/utils/qualityProbe'

const downloadStore = useDownloadStore()
const audioStore = useAudioStore()
const selectedLevel = ref<QualityLevel>('lossless')
const coverLoadFailed = ref(false)

// 与底栏使用相同的封面解析来源：优先歌曲自带封面，其次当前播放同曲封面，再回退歌手封面接口
const dialogCoverUrl = computed(() => {
  const song = downloadStore.currentDownloadSong
  if (!song) return ''
  const curPlaying = audioStore.currentSong
  const rawCover =
    song.cover ||
    (curPlaying && String(curPlaying.id) === String(song.id) ? curPlaying.cover : '') ||
    ''
  return formatCoverUrl(rawCover, { size: 128, artist: song.artist })
})

// 真实探测状态
const probeResult = ref<SongProbeResult | null>(null)
const isProbing = ref(false)

// 触发探测逻辑
const runProbe = async (song: any) => {
  if (!song || !song.id) return

  const songId = String(song.id)
  const cached = getCachedProbeResult(songId)
  if (cached) {
    probeResult.value = cached
    isProbing.value = false
    adjustSelectedIfUnavailable(cached)
    return
  }

  probeResult.value = null
  isProbing.value = true
  try {
    const res = await probeSongQualities(song)
    if (downloadStore.currentDownloadSong && String(downloadStore.currentDownloadSong.id) === songId) {
      probeResult.value = res
      isProbing.value = false
      adjustSelectedIfUnavailable(res)
    }
  } catch {
    isProbing.value = false
  }
}

// 若默认选中的档位不可用，自动切换到下一个最高可用档位
const adjustSelectedIfUnavailable = (res: SongProbeResult) => {
  if (selectedLevel.value === 'lossless' && !res.lossless.isAvailable) {
    if (res.exhigh.isAvailable) {
      selectedLevel.value = 'exhigh'
    } else if (res.standard.isAvailable) {
      selectedLevel.value = 'standard'
    }
  } else if (selectedLevel.value === 'exhigh' && !res.exhigh.isAvailable) {
    if (res.lossless.isAvailable) {
      selectedLevel.value = 'lossless'
    } else if (res.standard.isAvailable) {
      selectedLevel.value = 'standard'
    }
  }
  if (downloadStore.dialogVisible) {
    nextTick(() => {
      const idx = QUALITY_LEVELS.findIndex((q) => q.level === selectedLevel.value)
      if (idx >= 0) radioItemRefs.value[idx]?.focus()
    })
  }
}

// 记录最近探测中的歌曲 ID，避免弹窗关闭时 currentDownloadSong 被先设为 null 导致无法取消
const lastProbingSongId = ref<string | null>(null)

// 弹窗可见性监听
watch(
  () => [downloadStore.dialogVisible, downloadStore.currentDownloadSong?.id],
  ([visible, songId], [prevVisible, prevSongId] = [false, undefined]) => {
    if (visible && downloadStore.currentDownloadSong) {
      coverLoadFailed.value = false
      lastProbingSongId.value = String(downloadStore.currentDownloadSong.id)
      selectedLevel.value = 'lossless'
      runProbe(downloadStore.currentDownloadSong)
      nextTick(() => {
        const idx = QUALITY_LEVELS.findIndex((q) => q.level === selectedLevel.value)
        if (idx >= 0) radioItemRefs.value[idx]?.focus()
      })
    } else if (!visible) {
      const idToCancel = songId || prevSongId || lastProbingSongId.value
      if (idToCancel) {
        cancelSongProbe(idToCancel)
      }
      isProbing.value = false
    }
  },
  { immediate: true }
)

// 可选档位列表计算属性
const choices = computed(() => {
  const p = probeResult.value

  return QUALITY_LEVELS.map(({ level, label, nominalFormat, nominalBitrate }) => {
    const item = p ? p[level] : null
    const isAvailable = item ? item.isAvailable : true
    const unavailableReason = item?.unavailableReason
    const sizeFormatted = item?.sizeFormatted || '—'
    const bitrateLabel = item?.bitrateLabel || nominalBitrate
    const formatLabel = item?.formatLabel || nominalFormat

    return {
      level,
      label,
      format: formatLabel.toLowerCase(),
      formatLabel,
      bitrateLabel,
      isAvailable,
      unavailableReason,
      sizeFormatted,
      isItemProbing: isProbing.value && !item,
    }
  })
})

const currentChoice = computed(() => {
  return choices.value.find((c) => c.level === selectedLevel.value) || choices.value[0]
})

const hasAnyAvailable = computed(() => {
  return choices.value.some((c) => c.isAvailable)
})

const handleConfirm = async () => {
  const song = downloadStore.currentDownloadSong
  if (!song || !currentChoice.value.isAvailable || downloadStore.isDownloading) return

  try {
    const choice: QualityChoice = {
      level: currentChoice.value.level,
      label: currentChoice.value.label,
      bitrate: currentChoice.value.bitrateLabel,
      format: currentChoice.value.format,
      desc: currentChoice.value.bitrateLabel,
      estimatedSize: currentChoice.value.sizeFormatted,
    }
    await downloadStore.startDownload(song, choice)
  } catch {
    // 错误信息已保存在 downloadStore.errorMsg
  }
}

// 歌名展示
const displayTitle = computed(() => {
  const title = downloadStore.currentDownloadSong?.name || ''
  const MAX_LEN = 28
  return title.length > MAX_LEN ? title.slice(0, MAX_LEN) + '...' : title
})

// ════════════ 可访问性、键盘导航与焦点管理 ════════════
const dialogCardRef = ref<HTMLElement | null>(null)
const radioItemRefs = ref<HTMLElement[]>([])
const returnTriggerElement = ref<HTMLElement | null>(null)

const selectLevel = (level: QualityLevel) => {
  const target = choices.value.find((c) => c.level === level)
  if (!target || !target.isAvailable) return
  selectedLevel.value = level
}

const selectNext = (delta: number) => {
  const availableList = choices.value.filter((c) => c.isAvailable)
  if (!availableList.length) return
  const currentIndex = availableList.findIndex((c) => c.level === selectedLevel.value)
  const nextIndex = (currentIndex + delta + availableList.length) % availableList.length
  selectedLevel.value = availableList[nextIndex].level
  nextTick(() => {
    const fullIndex = choices.value.findIndex((c) => c.level === selectedLevel.value)
    radioItemRefs.value[fullIndex]?.focus()
  })
}

const handleKeydown = (e: KeyboardEvent) => {
  if (!downloadStore.dialogVisible) return

  if (e.key === 'Escape') {
    e.preventDefault()
    downloadStore.closeDownloadDialog()
    return
  }

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

watch(
  () => downloadStore.dialogVisible,
  (visible) => {
    if (visible) {
      returnTriggerElement.value = document.activeElement as HTMLElement | null
      nextTick(() => {
        const currentIndex = choices.value.findIndex((c) => c.level === selectedLevel.value)
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
  if (downloadStore.currentDownloadSong) {
    cancelSongProbe(downloadStore.currentDownloadSong.id)
  }
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="downloadStore.dialogVisible"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-dialog-title"
    >
      <!-- 半透明遮罩 (rgba(0,0,0,0.40)，背景模糊不超过 6px) -->
      <Transition name="mask" appear>
        <div
          class="absolute inset-0"
          style="background-color: rgba(0, 0, 0, 0.40); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);"
          @click="downloadStore.closeDownloadDialog"
        />
      </Transition>

      <!-- 弹窗容器 (严格 460px 宽度、20px 圆角、深紫底色、1px 白色半透明边框、无外发光) -->
      <Transition name="dialog" appear>
        <div class="relative z-10 w-full max-w-[460px]">
          <div
            ref="dialogCardRef"
            class="download-dialog-panel relative overflow-hidden p-6 rounded-[20px] select-none"
          >
            <!-- 头部：标题 18px/600 + 关闭按钮，下方 1px 分隔线 -->
            <div class="flex items-center justify-between pb-3.5 border-b border-white/[0.08]">
              <h3
                id="download-dialog-title"
                class="text-[18px] font-semibold text-white/95 leading-tight tracking-tight"
              >
                选择下载音质
              </h3>
              <button
                @click="downloadStore.closeDownloadDialog"
                class="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                title="关闭"
                aria-label="关闭弹窗"
              >
                <span class="icon-[mdi--close] h-4 w-4"></span>
              </button>
            </div>

            <!-- 歌曲行：封面固定 48px × 48px 圆角 10px，歌名 15px/600，歌手·专辑 13px (颜色不低于 64% 白) -->
            <div
              v-if="downloadStore.currentDownloadSong"
              class="my-4 flex items-center gap-3.5"
            >
              <div
                class="relative shrink-0 overflow-hidden rounded-[10px] border border-white/10 bg-white/5"
                style="width: 48px; height: 48px; min-width: 48px; min-height: 48px;"
              >
                <img
                  v-if="dialogCoverUrl && !coverLoadFailed"
                  :src="dialogCoverUrl"
                  alt="cover"
                  class="h-full w-full object-cover"
                  style="width: 48px; height: 48px;"
                  @error="coverLoadFailed = true"
                />
                <div v-else class="h-full w-full flex items-center justify-center bg-white/5 text-white/40" style="width: 48px; height: 48px;">
                  <span class="icon-[mdi--music] h-6 w-6"></span>
                </div>
              </div>

              <div class="min-w-0 flex-1">
                <h4
                  :title="downloadStore.currentDownloadSong.name"
                  class="truncate text-[15px] font-semibold text-white/95"
                >
                  {{ displayTitle }}
                </h4>
                <p class="mt-0.5 truncate text-[13px] text-white/70 font-medium">
                  {{ downloadStore.currentDownloadSong.artist || '未知歌手' }}
                  <span v-if="downloadStore.currentDownloadSong.album"> · 《{{ downloadStore.currentDownloadSong.album }}》</span>
                </p>
              </div>
            </div>

            <!-- 三个选项：每行高度 68px，间距 8px -->
            <div
              class="space-y-2"
              role="radiogroup"
              aria-labelledby="download-dialog-title"
            >
              <div
                v-for="(choice, index) in choices"
                :key="choice.level"
                :ref="el => { if (el) radioItemRefs[index] = el as HTMLElement }"
                role="radio"
                :aria-checked="selectedLevel === choice.level"
                :aria-disabled="!choice.isAvailable"
                :tabindex="choice.isAvailable ? (selectedLevel === choice.level ? 0 : -1) : -1"
                @click="selectLevel(choice.level)"
                @keydown.arrow-down.prevent="selectNext(1)"
                @keydown.arrow-right.prevent="selectNext(1)"
                @keydown.arrow-up.prevent="selectNext(-1)"
                @keydown.arrow-left.prevent="selectNext(-1)"
                @keydown.space.prevent="selectLevel(choice.level)"
                @keydown.enter.prevent="handleConfirm"
                class="option-row relative h-[68px] min-h-[68px] px-4 flex items-center justify-between rounded-xl transition-colors duration-150 outline-none"
                :class="[
                  !choice.isAvailable
                    ? 'disabled-option cursor-not-allowed'
                    : selectedLevel === choice.level
                      ? 'selected-option cursor-pointer'
                      : 'unselected-option cursor-pointer'
                ]"
              >
                <!-- 左侧：第一行名称 15px/600，第二行格式·码率 13px (格式只出现一次，去掉重复小标签) -->
                <div class="flex flex-col justify-center min-w-0 pr-2">
                  <div class="text-[15px] font-semibold text-white/95 leading-snug">
                    {{ choice.label }}
                  </div>
                  <!-- 第二行：可用时显示格式·码率，不可用时显示中性灰原因与信息图标，探测中显示骨架 -->
                  <div class="mt-1 flex items-center gap-1.5 min-w-0">
                    <template v-if="choice.isItemProbing">
                      <span class="inline-block h-3 w-28 rounded bg-white/10 animate-pulse"></span>
                    </template>
                    <template v-else-if="!choice.isAvailable">
                      <span class="icon-[mdi--information-outline] h-3.5 w-3.5 shrink-0 text-white/55"></span>
                      <span class="text-[13px] font-normal text-white/55 truncate">
                        {{ choice.unavailableReason || '当前音源不可用' }}
                      </span>
                    </template>
                    <template v-else>
                      <span class="text-[13px] font-medium text-white/60 truncate">
                        {{ choice.bitrateLabel }}
                      </span>
                    </template>
                  </div>
                </div>

                <!-- 右侧：真实大小 (14px/500 等宽数字) + 强调色勾选圆标 (不可用档位显示"—"，不再保留空的单选圆圈) -->
                <div class="flex items-center gap-3 shrink-0">
                  <template v-if="choice.isItemProbing">
                    <span class="inline-block h-4 w-12 rounded bg-white/10 animate-pulse"></span>
                  </template>
                  <template v-else-if="choice.isAvailable">
                    <span class="text-[14px] font-medium font-mono text-white/80 tabular-nums">
                      {{ choice.sizeFormatted }}
                    </span>
                  </template>
                  <template v-else>
                    <span class="text-[14px] font-medium font-mono text-white/40 tabular-nums">
                      —
                    </span>
                  </template>

                  <!-- 勾选指示器：仅可用档位保留单选圆圈；不可用档位不保留圆圈 -->
                  <div
                    v-if="choice.isAvailable"
                    class="flex h-5 w-5 items-center justify-center rounded-full border transition-all"
                    :class="[
                      selectedLevel === choice.level
                        ? 'border-sky-400 bg-sky-500/20 text-sky-300'
                        : 'border-white/20 bg-transparent'
                    ]"
                  >
                    <span
                      v-if="selectedLevel === choice.level"
                      class="icon-[mdi--check] h-3.5 w-3.5"
                    ></span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 底部提示：列表下方一行 13px (60% 白) 居左文字，去掉独立方框 -->
            <p class="mt-3.5 mb-4 text-[13px] text-white/60 font-medium text-left">
              保存到离线库，并同时导出到本地文件
            </p>

            <!-- 错误提示（若有） -->
            <div
              v-if="downloadStore.errorMsg"
              class="mb-3 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/15 p-2.5 text-[13px] text-red-300"
            >
              <span class="icon-[mdi--alert-circle] h-4 w-4 shrink-0"></span>
              <span>{{ downloadStore.errorMsg }}</span>
            </div>

            <!-- 底部按钮：右对齐，取消为幽灵按钮，下载为唯一的渐变主按钮，均 40px 高、14px/600 -->
            <div class="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                class="h-[40px] px-4 text-[14px] font-semibold text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                :disabled="downloadStore.isDownloading"
                @click="downloadStore.closeDownloadDialog"
              >
                取消
              </button>

              <button
                type="button"
                class="download-btn-gradient h-[40px] px-5 rounded-xl text-[14px] font-semibold text-white shadow-md transition-all outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                :class="[
                  !hasAnyAvailable || !currentChoice.isAvailable || downloadStore.isDownloading
                    ? 'opacity-40 cursor-not-allowed pointer-events-none'
                    : 'cursor-pointer hover:brightness-110 active:scale-[0.98]'
                ]"
                :disabled="!hasAnyAvailable || !currentChoice.isAvailable || downloadStore.isDownloading"
                @click="handleConfirm"
              >
                {{
                  downloadStore.isDownloading
                    ? '正在下载…'
                    : !currentChoice.isAvailable
                      ? '当前音质不可用'
                      : `下载 (${currentChoice.label})`
                }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
/* 弹窗面板：深紫玻璃底色、1px 白描边、无外发光 */
.download-dialog-panel {
  background-color: rgba(10,31,61, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.65);
}

@supports (backdrop-filter: blur(24px)) or (-webkit-backdrop-filter: blur(24px)) {
  .download-dialog-panel {
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
  }
}

/* 唯一的渐变主按钮 */
.download-btn-gradient {
  background: linear-gradient(135deg, #38bdf8 0%, #3b82f6 100%);
}

/* 选项卡片状态样式 */
.option-row.unselected-option {
  background-color: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.option-row.unselected-option:hover {
  background-color: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.15);
}

.option-row.selected-option {
  background-color: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.28);
}

.option-row.disabled-option {
  background-color: transparent;
  border: 1px solid rgba(255, 255, 255, 0.06);
  opacity: 0.45;
}

/* 过渡动画遵守 prefers-reduced-motion */
.mask-enter-active,
.mask-leave-active,
.mask-appear-active {
  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.mask-enter-from,
.mask-leave-to,
.mask-appear-from {
  opacity: 0;
}
.mask-enter-to,
.mask-leave-from,
.mask-appear-to {
  opacity: 1;
}

.dialog-enter-active,
.dialog-leave-active {
  transition:
    opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .mask-enter-active,
  .mask-leave-active,
  .dialog-enter-active,
  .dialog-leave-active {
    transition: opacity 0.05s ease !important;
    transform: none !important;
  }
}
</style>
