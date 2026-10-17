<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useDownloadStore, type QualityChoice } from '@/stores/modules/download'
import { formatCoverUrl } from '@/utils/imageUrl'
import Button from '@/components/Ui/Button.vue'

const downloadStore = useDownloadStore()
const selectedLevel = ref<string>('lossless')

interface QualityMeta {
  level: string
  label: string
  formatTag: string
  bitrateLabel: string
  bitrateNum: number
  format: string
}

const QUALITY_ITEMS: QualityMeta[] = [
  {
    level: 'lossless',
    label: 'SQ 无损',
    formatTag: 'FLAC',
    bitrateLabel: 'FLAC 无损',
    bitrateNum: 900,
    format: 'flac',
  },
  {
    level: 'exhigh',
    label: 'HQ 极高',
    formatTag: 'MP3 320k',
    bitrateLabel: 'MP3 · 320 kbps',
    bitrateNum: 320,
    format: 'mp3',
  },
  {
    level: 'standard',
    label: '标准',
    formatTag: 'MP3 128k',
    bitrateLabel: 'MP3 · 128 kbps',
    bitrateNum: 128,
    format: 'mp3',
  },
]

// ════════════ 真实探测与估算机制 (P1.1 - P1.3) ════════════
interface ProbeInfo {
  sizeText: string
  subText: string
  isAvailable: boolean
  isProbing: boolean
}

// 歌曲 id + 音质 level 的内存缓存
const probeCache = new Map<string, ProbeInfo>()
const probeStates = ref<Record<string, ProbeInfo>>({})

let activeAbortController: AbortController | null = null

const getEstimateText = (level: string, durationSec: number): { sizeText: string; subText: string } => {
  if (level === 'lossless') {
    if (durationSec > 0) {
      const minMb = ((durationSec * 700 * 1000) / 8 / 1024 / 1024).toFixed(1)
      const maxMb = ((durationSec * 1000 * 1000) / 8 / 1024 / 1024).toFixed(1)
      return {
        sizeText: `约 ${minMb}–${maxMb} MB 预估`,
        subText: '实际音质以音源返回为准',
      }
    }
    return { sizeText: '约 25–40 MB 预估', subText: '实际音质以音源返回为准' }
  }

  const kbps = level === 'exhigh' ? 320 : 128
  if (durationSec > 0) {
    const mb = ((durationSec * kbps * 1000) / 8 / 1024 / 1024).toFixed(1)
    return {
      sizeText: `≈ ${mb} MB`,
      subText: `MP3 · ${kbps} kbps`,
    }
  }
  return {
    sizeText: level === 'exhigh' ? '≈ 8.0 MB' : '≈ 3.2 MB',
    subText: `MP3 · ${kbps} kbps`,
  }
}

const triggerProbe = async (song: any) => {
  if (!song || !song.id) return

  // 终止上一次未完成的探测
  if (activeAbortController) {
    activeAbortController.abort()
  }
  activeAbortController = new AbortController()
  const signal = activeAbortController.signal

  const durationSec = song.duration ? song.duration / 1000 : 0
  const songId = String(song.id)

  const probeTasks = QUALITY_ITEMS.map(async (item) => {
    const cacheKey = `${songId}_${item.level}`
    if (probeCache.has(cacheKey)) {
      probeStates.value[item.level] = probeCache.get(cacheKey)!
      return
    }

    // 初始状态显示计算中
    probeStates.value[item.level] = {
      sizeText: '计算中…',
      subText: item.bitrateLabel,
      isAvailable: true,
      isProbing: true,
    }

    const br = item.level === 'lossless' ? 'lossless' : item.level === 'exhigh' ? '320' : '128'
    let streamUrl = ''
    const found = song.qualities?.find((q: any) => q.level === item.level)
    if (found && found.streamUrl) {
      streamUrl = found.streamUrl
    } else {
      streamUrl = `/api/music/stream?id=${encodeURIComponent(songId)}&source=netease&br=${br}&title=${encodeURIComponent(song.name || '')}&artist=${encodeURIComponent(song.artist || '')}`
    }

    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      if (probeStates.value[item.level]?.isProbing) {
        const est = getEstimateText(item.level, durationSec)
        probeStates.value[item.level] = {
          sizeText: est.sizeText,
          subText: est.subText,
          isAvailable: true,
          isProbing: false,
        }
      }
    }, 8000)

    try {
      const res = await fetch(streamUrl, {
        headers: { Range: 'bytes=0-0' },
        signal,
      })
      clearTimeout(timeoutId)

      if (signal.aborted) return

      let totalBytes: number | null = null
      const contentRange = res.headers.get('content-range')
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/)
        if (match) totalBytes = parseInt(match[1], 10)
      }
      if (!totalBytes) {
        const cl = res.headers.get('content-length')
        if (cl && res.status === 200) totalBytes = parseInt(cl, 10)
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase()

      // 规则 1.2: 无损可用性判断
      if (item.level === 'lossless') {
        const isMpegOrSmall =
          contentType.includes('mpeg') ||
          contentType.includes('audio/mp3') ||
          (totalBytes !== null && totalBytes < 9 * 1024 * 1024 && !contentType.includes('flac'))

        if (isMpegOrSmall) {
          const info: ProbeInfo = {
            sizeText: '—',
            subText: '该歌曲音源暂无无损',
            isAvailable: false,
            isProbing: false,
          }
          probeStates.value[item.level] = info
          probeCache.set(cacheKey, info)
          return
        }
      }

      let sizeText = ''
      if (totalBytes && totalBytes > 0) {
        const mb = (totalBytes / 1024 / 1024).toFixed(1)
        sizeText = `≈ ${mb} MB`
      } else {
        const est = getEstimateText(item.level, durationSec)
        sizeText = est.sizeText
      }

      const info: ProbeInfo = {
        sizeText,
        subText: item.bitrateLabel,
        isAvailable: true,
        isProbing: false,
      }
      probeStates.value[item.level] = info
      probeCache.set(cacheKey, info)
    } catch (e: any) {
      clearTimeout(timeoutId)
      if (signal.aborted) return

      // 超时或探测失败退回按时长估算 (1.1, 1.2)
      const est = getEstimateText(item.level, durationSec)
      const info: ProbeInfo = {
        sizeText: est.sizeText,
        subText: est.subText,
        isAvailable: true,
        isProbing: false,
      }
      probeStates.value[item.level] = info
      probeCache.set(cacheKey, info)
    }
  })

  await Promise.all(probeTasks)

  // 若当前选中的音质不可用（如无损被置灰），自动切换到下一个可用最高音质
  if (selectedLevel.value === 'lossless' && !probeStates.value['lossless']?.isAvailable) {
    if (probeStates.value['exhigh']?.isAvailable) {
      selectedLevel.value = 'exhigh'
    } else if (probeStates.value['standard']?.isAvailable) {
      selectedLevel.value = 'standard'
    }
  }
}

const getProbe = (level: string): ProbeInfo => {
  return (
    probeStates.value[level] || {
      sizeText: '计算中…',
      subText: '',
      isAvailable: true,
      isProbing: true,
    }
  )
}

// 可选档位列表
const availableChoices = computed(() => {
  return QUALITY_ITEMS.map((item) => {
    return {
      ...item,
      desc: getProbe(item.level).subText,
      estimatedSize: getProbe(item.level).sizeText,
    }
  })
})

const currentChoice = computed(() => {
  return availableChoices.value.find((c) => c.level === selectedLevel.value) || availableChoices.value[0]
})

const currentChoiceAvailable = computed(() => {
  return getProbe(selectedLevel.value).isAvailable
})

// 当歌曲改变或弹窗打开时探测
watch(
  () => downloadStore.currentDownloadSong,
  (newSong) => {
    if (newSong && downloadStore.dialogVisible) {
      selectedLevel.value = 'lossless'
      triggerProbe(newSong)
    }
  },
  { immediate: true }
)

watch(
  () => downloadStore.dialogVisible,
  (visible) => {
    if (visible && downloadStore.currentDownloadSong) {
      selectedLevel.value = 'lossless'
      triggerProbe(downloadStore.currentDownloadSong)
    } else if (!visible) {
      if (activeAbortController) {
        activeAbortController.abort()
        activeAbortController = null
      }
    }
  }
)

const handleConfirm = async () => {
  const song = downloadStore.currentDownloadSong
  if (!song || !currentChoiceAvailable.value) return
  try {
    const choice: QualityChoice = {
      level: currentChoice.value.level,
      label: currentChoice.value.label,
      bitrate: currentChoice.value.bitrateLabel,
      format: currentChoice.value.format,
      desc: currentChoice.value.desc,
      estimatedSize: currentChoice.value.estimatedSize,
    }
    await downloadStore.startDownload(song, choice)
  } catch (e) {
    // 错误信息已保存在 downloadStore.errorMsg
  }
}

// 歌名展示
const displayTitle = computed(() => {
  const title = downloadStore.currentDownloadSong?.name || ''
  const MAX_LEN = 26
  return title.length > MAX_LEN ? title.slice(0, MAX_LEN) + '...' : title
})

// ════════════ 可访问性、键盘导航与焦点管理 ════════════
const dialogCardRef = ref<HTMLElement | null>(null)
const radioItemRefs = ref<HTMLElement[]>([])
const returnTriggerElement = ref<HTMLElement | null>(null)

const selectLevel = (level: string) => {
  if (!getProbe(level).isAvailable) return
  selectedLevel.value = level
}

const selectNext = (delta: number) => {
  const availableList = availableChoices.value.filter((c) => getProbe(c.level).isAvailable)
  if (!availableList.length) return
  const currentIndex = availableList.findIndex((c) => c.level === selectedLevel.value)
  const nextIndex = (currentIndex + delta + availableList.length) % availableList.length
  selectedLevel.value = availableList[nextIndex].level
  nextTick(() => {
    const fullIndex = availableChoices.value.findIndex((c) => c.level === selectedLevel.value)
    const targetEl = radioItemRefs.value[fullIndex]
    targetEl?.focus()
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
  if (activeAbortController) {
    activeAbortController.abort()
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
      <!-- 背景遮罩 -->
      <Transition name="mask" appear>
        <div
          class="absolute inset-0 bg-black/40 backdrop-blur-sm"
          @click="downloadStore.closeDownloadDialog"
        />
      </Transition>

      <!-- 弹窗容器 (P3.3 严格 440px 宽度、20px 圆角) -->
      <Transition name="dialog" appear>
        <div class="relative z-10 w-full max-w-[440px]">
          <div
            ref="dialogCardRef"
            class="download-dialog-panel relative overflow-hidden p-5 shadow-2xl backdrop-blur-2xl"
          >
            <!-- 头部：标题 18px/600 + 关闭按钮，去掉副标题 -->
            <div class="flex items-center justify-between pb-3 border-b border-white/10 select-none">
              <h3 id="download-dialog-title" class="text-[18px] font-semibold text-white/95 leading-tight tracking-tight">
                选择下载音质
              </h3>
              <button
                @click="downloadStore.closeDownloadDialog"
                class="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-pink-400/60"
                title="关闭"
                aria-label="关闭弹窗"
              >
                <span class="icon-[mdi--close] h-4 w-4"></span>
              </button>
            </div>

            <!-- 歌曲行：封面 48px 圆角 10px，歌名 15px/600，歌手·专辑 13px (>=64% 白)，不重复显示徽标 -->
            <div
              v-if="downloadStore.currentDownloadSong"
              class="my-3.5 flex items-center gap-3 select-none"
            >
              <div class="relative h-12 w-12 shrink-0 overflow-hidden rounded-[10px] border border-white/10 bg-white/5 shadow-sm">
                <img
                  :src="formatCoverUrl(downloadStore.currentDownloadSong.cover, { size: 96, artist: downloadStore.currentDownloadSong.artist })"
                  alt="cover"
                  class="h-full w-full object-cover"
                />
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

            <!-- 三个选项：每行高 64px，无发光，格式标签中性统一 -->
            <div
              class="space-y-2 select-none"
              role="radiogroup"
              aria-labelledby="download-dialog-title"
            >
              <div
                v-for="(choice, index) in availableChoices"
                :key="choice.level"
                :ref="el => { if (el) radioItemRefs[index] = el as HTMLElement }"
                role="radio"
                :aria-checked="selectedLevel === choice.level"
                :aria-disabled="!getProbe(choice.level).isAvailable"
                :tabindex="getProbe(choice.level).isAvailable ? (selectedLevel === choice.level ? 0 : -1) : -1"
                @click="selectLevel(choice.level)"
                @keydown.arrow-down.prevent="selectNext(1)"
                @keydown.arrow-right.prevent="selectNext(1)"
                @keydown.arrow-up.prevent="selectNext(-1)"
                @keydown.arrow-left.prevent="selectNext(-1)"
                @keydown.space.prevent="selectLevel(choice.level)"
                @keydown.enter.prevent="handleConfirm"
                class="relative h-[64px] min-h-[64px] px-3.5 flex items-center justify-between rounded-xl transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-pink-400/60"
                :class="[
                  !getProbe(choice.level).isAvailable
                    ? 'opacity-40 cursor-not-allowed bg-white/[0.02] border border-white/[0.04]'
                    : selectedLevel === choice.level
                      ? 'bg-pink-500/[0.12] border border-pink-500/50 cursor-pointer'
                      : 'bg-transparent border border-white/[0.08] hover:bg-white/[0.04] hover:border-white/15 cursor-pointer'
                ]"
              >
                <!-- 左侧：第一行名称 15px/600 + 中性标签，第二行格式·码率或不可用原因 13px -->
                <div class="flex flex-col justify-center min-w-0 pr-2">
                  <div class="flex items-center gap-2">
                    <span
                      class="text-[15px] font-semibold"
                      :class="selectedLevel === choice.level && getProbe(choice.level).isAvailable ? 'text-white' : 'text-white/85'"
                    >
                      {{ choice.label }}
                    </span>
                    <span class="rounded px-1.5 py-0.5 text-[11px] font-mono font-medium leading-none bg-white/10 text-white/70 border border-white/10">
                      {{ choice.formatTag }}
                    </span>
                  </div>
                  <div
                    class="mt-1 text-[13px] font-medium leading-none truncate"
                    :class="!getProbe(choice.level).isAvailable ? 'text-red-300/90' : 'text-white/60'"
                  >
                    {{ getProbe(choice.level).subText }}
                  </div>
                </div>

                <!-- 右侧：大小 14px/500 等宽数字 + 勾选圆标 -->
                <div class="flex items-center gap-3 shrink-0">
                  <span class="text-[14px] font-medium font-mono text-white/80 tabular-nums">
                    {{ getProbe(choice.level).sizeText }}
                  </span>
                  <div
                    class="flex h-5 w-5 items-center justify-center rounded-full border transition-all"
                    :class="[
                      !getProbe(choice.level).isAvailable
                        ? 'border-white/10 bg-transparent'
                        : selectedLevel === choice.level
                          ? 'border-pink-500 bg-pink-500 text-white'
                          : 'border-white/20 bg-transparent'
                    ]"
                  >
                    <span
                      v-if="selectedLevel === choice.level && getProbe(choice.level).isAvailable"
                      class="icon-[mdi--check] h-3.5 w-3.5"
                    ></span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 提示：列表下方一行 13px (60% 白) 文字，去掉独立方框 -->
            <p class="my-3.5 text-[13px] text-white/60 font-medium text-center select-none">
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

            <!-- 底部操作按钮：右对齐，取消为幽灵按钮，主按钮为下载(音质)，均 40px 高、14px/600 -->
            <div class="flex items-center justify-end gap-3 pt-2 select-none">
              <button
                type="button"
                class="h-[40px] px-4 text-[14px] font-semibold text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-pink-400/60"
                :disabled="downloadStore.isDownloading"
                @click="downloadStore.closeDownloadDialog"
              >
                取消
              </button>

              <Button
                v-if="currentChoiceAvailable"
                variant="gradient"
                size="none"
                rounded="xl"
                class="h-[40px] px-5 text-[14px] font-semibold shadow-md shadow-pink-500/20 hover:shadow-lg hover:shadow-pink-500/30 transition-all outline-none focus-visible:ring-2 focus-visible:ring-pink-400/60 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="downloadStore.isDownloading"
                @click="handleConfirm"
              >
                <span
                  v-if="downloadStore.isDownloading"
                  class="icon-[mdi--loading] mr-1.5 h-4 w-4 animate-spin"
                ></span>
                <span v-else class="icon-[mdi--tray-arrow-down] mr-1.5 h-4 w-4"></span>
                <span>{{ downloadStore.isDownloading ? '正在下载...' : `下载 (${currentChoice.label})` }}</span>
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
  background: rgba(30, 26, 52, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 20px;
  box-shadow: 0 20px 48px -8px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
}

.mask-enter-active,
.mask-leave-active {
  transition: opacity 200ms ease;
}
.mask-enter-from,
.mask-leave-to {
  opacity: 0;
}

.dialog-enter-active,
.dialog-leave-active {
  transition: all 200ms cubic-bezier(0.16, 1, 0.3, 1);
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(6px);
}
</style>
