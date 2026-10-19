<script setup lang="ts">
import { useAudio } from '@/composables/useAudio'
import { useLyrics } from '@/composables/useLyrics'
import { useSettingsStore } from '@/stores/modules/settings'
import { useAudioStore } from '@/stores/modules/audio'
import MusicProgress from '@/components/Ui/MusicProgress.vue'
import VolumeControl from '@/components/Ui/VolumeControl.vue'
import Button from '@/components/Ui/Button.vue'
import AudioVisualizer from '@/components/Ui/AudioVisualizer.vue'
import PlaylistBubble from '@/components/Ui/PlaylistBubble.vue'
import { useAudioAnalyser } from '@/composables/useAudioAnalyser'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { getColorPalette } from '@/utils/colorExtractor'
import { adaptColorsForTheme } from '@/utils/colorThemeAdapter'
import { formatCoverUrl } from '@/utils/imageUrl'
import { gsap } from 'gsap'
import { useDownloadStore } from '@/stores/modules/download'

const { t } = useI18n()
const audioStore = useAudioStore()
const downloadStore = useDownloadStore()

// 使用音频播放器组合式API
const {
  // 状态
  currentSong,
  isPlaying,
  isLoading,
  currentTime,
  formattedCurrentTime,
  formattedDuration,
  playModeIcon,
  playModeText,

  // 播放控制
  togglePlay,
  next,
  previous,

  // 播放模式控制
  togglePlayMode,
} = useAudio()

// 音频分析器
const {
  frequencyData,
  timeDomainData,
  isInitialized: isAnalyserInitialized,
  init: initAnalyser,
  start: startAnalyser,
  stop: stopAnalyser,
  resume: resumeAnalyser,
} = useAudioAnalyser({
  fftSize: 2048,
  smoothingTimeConstant: 0.8,
})

const state = reactive({
  // 播放列表
  showQueue: false,
  // 当前歌词索引
  currentLyricIndex: 0,
  // 背景渐变颜色
  footerGradient: [] as string[],
  // 封面翻转状态
  isFlipping: false,
  // 当前显示的封面（用于翻转动画）
  displayCover: '' as string,
  // 前一个封面（用于翻转动画）
  prevCover: '' as string,
})
const { showQueue, currentLyricIndex } = toRefs(state)

// 封面容器引用
const coverRef = ref<HTMLElement | null>(null)

// 计算可视化器渐变颜色
const visualizerGradient = computed(() => {
  if (state.footerGradient.length === 0) {
    return ['#3b82f6', '#8b5cf6', '#ec4899']
  }
  // 提取渐变中的颜色
  const colors = state.footerGradient.map((color: string) => {
    const match = color.match(/rgba?\(([^)]+)\)/)
    if (match) {
      const values = match[1].split(',').slice(0, 3)
      return `rgb(${values.join(',')})`
    }
    return color
  })

  // 根据主题调整颜色
  return adaptColorsForTheme(colors)
})

// 提取封面颜色
const extractCoverColors = async (coverUrl?: string) => {
  if (!coverUrl) return
  try {
    const palette = await getColorPalette(formatCoverUrl(coverUrl, { size: 128 }))
    state.footerGradient = palette.gradient
  } catch (error) {
    console.error('Failed to extract footer colors:', error)
  }
}

const { mergedLines, activeTimeline, fetchLyrics } = useLyrics()
const settingsStore = useSettingsStore()
const { footerLyrics, audioVisualizer } = storeToRefs(settingsStore)

const updateLyricIndex = () => {
  const times = activeTimeline.value
  if (!times.length) {
    state.currentLyricIndex = 0
    return
  }
  const t = currentTime.value
  let idx = times.findIndex((time: number, i: number) => {
    const next = times[i + 1]
    return t >= time && (next === undefined || t < next)
  })
  if (idx === -1) {
    if (t < times[0]) idx = 0
    else if (t >= times[times.length - 1]) idx = times.length - 1
    else idx = times.findIndex(time => time > t)
  }
  if (idx !== -1) state.currentLyricIndex = idx
}

// 封面翻转动画
const flipCover = (newCover: string) => {
  if (!coverRef.value || state.isFlipping || !state.displayCover) {
    state.displayCover = newCover
    return
  }

  state.isFlipping = true
  state.prevCover = state.displayCover

  // 创建翻转动画
  const tl = gsap.timeline({
    onComplete: () => {
      state.isFlipping = false
      state.prevCover = ''
    },
  })

  // 翻转到背面
  tl.to(coverRef.value, {
    rotateY: 90,
    scale: 0.9,
    duration: 0.2,
    ease: 'power2.in',
    onComplete: () => {
      state.displayCover = newCover
    },
  })

  // 翻转回正面
  tl.to(coverRef.value, {
    rotateY: 0,
    scale: 1,
    duration: 0.3,
    ease: 'back.out(1.5)',
  })
}

watch(currentTime, updateLyricIndex)
watch(
  () => [footerLyrics.value.enabled, currentSong.value?.id],
  ([enabled]) => {
    if (enabled) fetchLyrics(currentSong.value)
  },
  { immediate: true }
)

// 监听歌曲变化，提取颜色并触发翻转动画
watch(
  () => currentSong.value,
  (song, oldSong) => {
    if (song) {
      const resolved = formatCoverUrl(song.cover, { size: 128, artist: song.artist })
      if (resolved) {
        extractCoverColors(resolved)
        if (oldSong && oldSong.id !== song.id) {
          flipCover(resolved)
        } else if (!state.displayCover) {
          state.displayCover = resolved
        }
      }
    }
  },
  { immediate: true }
)

// 监听播放状态，控制音频分析
watch(
  isPlaying,
  (playing: any) => {
    if (playing && audioVisualizer.value.enabledInFooter) {
      if (isAnalyserInitialized.value) {
        startAnalyser()
        resumeAnalyser()
      }
    } else {
      stopAnalyser()
    }
  },
  { immediate: true }
)

// 初始化音频分析器
onMounted(() => {
  const audioElement = audioStore.audio.audio
  if (audioElement && !isAnalyserInitialized.value) {
    initAnalyser(audioElement)
  }
})

// 监听音频元素变化
watch(
  () => audioStore.audio.audio,
  audioElement => {
    if (audioElement && !isAnalyserInitialized.value) {
      initAnalyser(audioElement)
      if (isPlaying.value && audioVisualizer.value.enabledInFooter) {
        startAnalyser()
        resumeAnalyser()
      }
    }
  }
)

onUnmounted(() => {
  stopAnalyser()
  document.removeEventListener('click', handleDocumentClick)
  if (qualityToastTimer) clearTimeout(qualityToastTimer)
})

import {
  probeSongQualities,
  getCachedProbeResult,
  cancelSongProbe,
  type SongProbeResult,
  type QualityLevel,
} from '@/utils/qualityProbe'

// ═══════ 音质切换与下载控制 ═══════
const showQualityMenu = ref(false)
const qualityMenuRef = ref<HTMLElement | null>(null)
const qualityBtnRef = ref<HTMLButtonElement | null>(null)
const qualityItemRefs = ref<HTMLButtonElement[]>([])
const focusedQualityIndex = ref(0)
const qualityToastMsg = ref('')
let qualityToastTimer: any = null

// 歌曲真实音质探测结果
const currentSongProbe = ref<SongProbeResult | null>(null)

const currentQualityLevel = computed<QualityLevel>(() => {
  const badge = currentSong.value?.qualityBadge
  if (badge === 'SQ') return 'lossless'
  if (badge === 'HQ') return 'exhigh'
  if (badge === '标准' || badge === 'STANDARD') return 'standard'
  const firstLevel = currentSong.value?.qualities?.[0]?.level
  if (firstLevel === 'lossless' || firstLevel === 'exhigh' || firstLevel === 'standard') return firstLevel
  return 'lossless'
})

let probingSongId = ''

// 触发音质探测（仅在打开浮层或当前档位非标准需判断降级时触发）
const triggerProbeIfNeeded = async () => {
  const song = currentSong.value
  if (!song || !song.id) {
    currentSongProbe.value = null
    return
  }

  const cached = getCachedProbeResult(song.id)
  if (cached) {
    currentSongProbe.value = cached
    return
  }

  if (probingSongId === String(song.id)) {
    return
  }

  // 只在用户打开音质浮层，或需要判断降级（当前请求档位不是标准）时才探测
  const needsProbe = showQualityMenu.value || currentQualityLevel.value !== 'standard'
  if (!needsProbe) {
    return
  }

  probingSongId = String(song.id)
  try {
    const res = await probeSongQualities(song)
    if (currentSong.value && String(currentSong.value.id) === String(song.id)) {
      currentSongProbe.value = res
    }
  } catch (e) {
    // 探测异常或中止维持兜底
  } finally {
    if (probingSongId === String(song.id)) {
      probingSongId = ''
    }
  }
}

// 监听当前歌曲变化，切歌时取消旧歌未完成探测
watch(
  () => currentSong.value,
  (newSong, oldSong) => {
    if (oldSong?.id && String(oldSong.id) !== String(newSong?.id)) {
      cancelSongProbe(oldSong.id)
    }
    if (!newSong || !newSong.id) {
      currentSongProbe.value = null
      return
    }
    const cached = getCachedProbeResult(newSong.id)
    if (cached) {
      currentSongProbe.value = cached
      return
    }
    currentSongProbe.value = null
    triggerProbeIfNeeded()
  },
  { immediate: true }
)

// 监听浮层展开状态：用户打开浮层时按需探测
watch(
  () => showQualityMenu.value,
  (isOpen) => {
    if (isOpen) {
      triggerProbeIfNeeded()
    }
  }
)

// 可用档位列表（由探测数据驱动）
const availableQualities = computed(() => {
  const probe = currentSongProbe.value
  const levels: { level: QualityLevel; defaultLabel: string }[] = [
    { level: 'lossless', defaultLabel: 'SQ 无损' },
    { level: 'exhigh', defaultLabel: 'HQ 极高' },
    { level: 'standard', defaultLabel: '标准' },
  ]

  return levels.map(({ level, defaultLabel }) => {
    const item = probe ? probe[level] : null
    const isAvailable = item ? item.isAvailable : true
    const unavailableReason = item?.unavailableReason

    let bitrateDisplay = ''
    if (item) {
      if (!isAvailable && unavailableReason) {
        bitrateDisplay = unavailableReason
      } else {
        bitrateDisplay = item.bitrateLabel
      }
    } else {
      bitrateDisplay = '探测中…'
    }

    return {
      level,
      label: item?.label || defaultLabel,
      bitrate: bitrateDisplay,
      isAvailable,
      unavailableReason,
      formatLabel: item?.formatLabel || '未知',
      sizeFormatted: item?.sizeFormatted || '—',
    }
  })
})

// 底栏标识与提示文本（检测是否发生静默降级）
const qualityDisplayInfo = computed(() => {
  const reqLevel = currentQualityLevel.value
  const probe = currentSongProbe.value

  const nominalBadge = reqLevel === 'lossless' ? 'SQ 无损' : reqLevel === 'exhigh' ? 'HQ 极高' : '标准'

  if (!probe) {
    const isProbing = reqLevel !== 'standard' || showQualityMenu.value
    return {
      badge: nominalBadge,
      tooltip: isProbing ? `当前音质: ${nominalBadge} (探测中…)` : `当前音质: ${nominalBadge}`,
      isDegraded: false,
      isLossless: reqLevel === 'lossless',
    }
  }

  const currentItem = probe[reqLevel]
  if (currentItem && currentItem.isAvailable) {
    // 请求档位真实可用
    return {
      badge: nominalBadge,
      tooltip: `当前音质: ${nominalBadge} (${currentItem.bitrateLabel})`,
      isDegraded: false,
      isLossless: reqLevel === 'lossless' && (currentItem.formatLabel === 'FLAC' || currentItem.formatLabel === 'WAV' || currentItem.formatLabel === 'ALAC'),
    }
  }

  // 请求档位不可用或被静默降级：寻找音源实际能提供的最高可用档位
  const fallbackTier = probe.exhigh.isAvailable
    ? probe.exhigh
    : probe.standard.isAvailable
      ? probe.standard
      : null

  if (fallbackTier) {
    const actualFmt = fallbackTier.formatLabel || 'MP3'
    const actualBitrateNum = fallbackTier.actualBitrateKbps || (fallbackTier.level === 'exhigh' ? 320 : 128)
    const actualBadge = `${actualFmt} ${actualBitrateNum}k`
    const tooltip = `请求 ${nominalBadge},音源实际提供 ${actualFmt} ${actualBitrateNum} kbps`

    return {
      badge: actualBadge,
      tooltip,
      isDegraded: true,
      isLossless: false,
    }
  }

  // 均不可用或探测失败
  return {
    badge: '未知',
    tooltip: `当前音质: ${nominalBadge} (音源状态未知)`,
    isDegraded: false,
    isLossless: false,
  }
})

const activeQualityBadge = computed(() => qualityDisplayInfo.value.badge)
const activeQualityTooltip = computed(() => qualityDisplayInfo.value.tooltip)
const isLosslessActive = computed(() => qualityDisplayInfo.value.isLossless)
const isDegradedQuality = computed(() => qualityDisplayInfo.value.isDegraded)

const menuCoords = ref({ bottom: 0, right: 0 })

const updateQualityMenuPosition = () => {
  if (!qualityBtnRef.value) return
  const rect = qualityBtnRef.value.getBoundingClientRect()
  menuCoords.value = {
    bottom: Math.max(16, window.innerHeight - rect.top + 10),
    right: Math.max(16, window.innerWidth - rect.right),
  }
}

const openAndFocusQualityMenu = () => {
  updateQualityMenuPosition()
  showQualityMenu.value = true
  const activeIdx = availableQualities.value.findIndex(q => q.level === currentQualityLevel.value)
  focusedQualityIndex.value = activeIdx >= 0 ? activeIdx : 0
  nextTick(() => {
    qualityItemRefs.value[focusedQualityIndex.value]?.focus()
  })
}

const closeQualityMenuAndRestoreFocus = () => {
  showQualityMenu.value = false
  nextTick(() => {
    qualityBtnRef.value?.focus()
  })
}

const toggleQualityMenu = () => {
  if (!showQualityMenu.value) {
    openAndFocusQualityMenu()
  } else {
    closeQualityMenuAndRestoreFocus()
  }
}

const moveQualityFocus = (delta: number) => {
  if (availableQualities.value.length === 0) return
  focusedQualityIndex.value =
    (focusedQualityIndex.value + delta + availableQualities.value.length) % availableQualities.value.length
  nextTick(() => {
    qualityItemRefs.value[focusedQualityIndex.value]?.focus()
  })
}

const handleQualityMenuKeydown = (e: KeyboardEvent) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    e.stopPropagation()
    moveQualityFocus(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    e.stopPropagation()
    moveQualityFocus(-1)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeQualityMenuAndRestoreFocus()
  } else if (e.key === 'Tab') {
    closeQualityMenuAndRestoreFocus()
  }
}

const selectQuality = async (level: string) => {
  const target = availableQualities.value.find((q) => q.level === level)
  if (target && !target.isAvailable) return
  closeQualityMenuAndRestoreFocus()
  if (level === currentQualityLevel.value) return
  await audioStore.switchQuality(level)
  const labelMap: Record<string, string> = {
    lossless: 'SQ 无损音质',
    exhigh: 'HQ 极高音质',
    standard: '标准音质',
  }
  qualityToastMsg.value = `已切换至 ${labelMap[level] || '目标音质'}`
  if (qualityToastTimer) clearTimeout(qualityToastTimer)
  qualityToastTimer = setTimeout(() => {
    qualityToastMsg.value = ''
  }, 2200)
}

const downloadCurrentSong = () => {
  if (currentSong.value) {
    downloadStore.openDownloadDialog(currentSong.value)
  }
}

const formatSongTitle = (title?: string, maxLen = 22) => {
  if (!title) return ''
  return title.length > maxLen ? title.slice(0, maxLen) + '...' : title
}

const handleDocumentClick = (e: MouseEvent | PointerEvent) => {
  const target = e.target as Node
  if (qualityBtnRef.value && qualityBtnRef.value.contains(target)) return
  if (qualityMenuRef.value && qualityMenuRef.value.contains(target)) return
  showQualityMenu.value = false
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && showQualityMenu.value) {
    e.preventDefault()
    closeQualityMenuAndRestoreFocus()
  }
}

const isPerfMode = ref(false)
const updatePerfModeState = () => {
  if (typeof document !== 'undefined') {
    isPerfMode.value = document.documentElement.classList.contains('perf-mode')
  }
}
let perfObserver: MutationObserver | null = null

onMounted(() => {
  updatePerfModeState()
  if (typeof MutationObserver !== 'undefined') {
    perfObserver = new MutationObserver(() => updatePerfModeState())
    perfObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  }
  document.addEventListener('pointerdown', handleDocumentClick)
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', updateQualityMenuPosition)
  window.addEventListener('scroll', updateQualityMenuPosition, true)
})

onUnmounted(() => {
  if (perfObserver) perfObserver.disconnect()
  document.removeEventListener('pointerdown', handleDocumentClick)
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', updateQualityMenuPosition)
  window.removeEventListener('scroll', updateQualityMenuPosition, true)
})

const emit = defineEmits(['show'])
</script>
<template>
  <footer
    class="glass-dock player-panel relative w-full shrink-0 overflow-hidden rounded-[26px] p-3 sm:p-4"
    style="-webkit-backdrop-filter: blur(28px) saturate(190%) contrast(105%); backdrop-filter: blur(28px) saturate(190%) contrast(105%);"
  >
    <!-- 独立音频频谱带 (限定在进度条上方 20px 独立带内，不透明度 <= 0.25，仅播放时出现，性能模式下不渲染) -->
    <div
      v-if="isPlaying && isAnalyserInitialized && audioVisualizer.enabledInFooter && !isPerfMode"
      class="footer-visualizer-strip pointer-events-none absolute left-3 right-3 h-[20px] overflow-hidden select-none z-0 opacity-25"
      style="bottom: 34px;"
    >
      <AudioVisualizer
        :frequency-data="frequencyData"
        :time-domain-data="timeDomainData"
        type="bars"
        :bar-count="64"
        :bar-width="3"
        :bar-gap="2"
        :gradient-colors="visualizerGradient"
        :height="20"
      />
    </div>

    <div class="relative z-10 flex items-center justify-between">
      <!-- 左侧：当前歌曲信息 -->
      <div class="flex min-w-0 flex-1 space-x-4">
        <!-- 封面容器 - 3D 翻转效果 -->
        <div class="cover-container" style="perspective: 800px;">
          <div
            ref="coverRef"
            id="footer-cover"
            @click="emit('show')"
            class="cover-inner flex h-12 w-12 cursor-pointer items-center justify-center rounded-2xl bg-cover shadow-lg ring-1 ring-white/15 transition-all duration-300 hover:shadow-xl hover:scale-105"
            :class="{ 'animate-pulse-subtle': isPlaying }"
            :style="{
              backgroundImage: state.displayCover
                ? `url(${formatCoverUrl(state.displayCover, { size: 128 })})`
                : 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #3b82f6 100%)',
            }"
          >
            <!-- 播放状态指示器 -->
            <div
              v-if="isPlaying"
              class="absolute inset-0 flex items-center justify-center rounded-lg bg-black/20 opacity-0 transition-opacity hover:opacity-100"
            >
              <div class="flex items-end gap-0.5 h-4">
                <span class="w-1 bg-white rounded-full animate-equalizer-1"></span>
                <span class="w-1 bg-white rounded-full animate-equalizer-2"></span>
                <span class="w-1 bg-white rounded-full animate-equalizer-3"></span>
              </div>
            </div>
          </div>
        </div>
        <div id="footer-song-info" class="flex min-w-0 flex-col justify-around">
          <p :title="currentSong?.name" class="text-primary truncate text-sm font-medium">
            {{ formatSongTitle(currentSong?.name) || t('player.unknownSong') }}
          </p>
          <p class="text-primary/80 truncate text-xs">
            {{ currentSong?.artist || t('player.unknownArtist') }}
          </p>
        </div>
        <div
          v-if="footerLyrics.enabled && mergedLines.length"
          class="flex min-w-0 flex-col justify-around"
        >
          <template v-for="mode in footerLyrics.modes" :key="mode">
            <p v-if="mode === 'original'" class="text-primary/80 truncate text-sm">
              {{ mergedLines[currentLyricIndex]?.ori || '' }}
            </p>
            <p v-else-if="mode === 'trans'" class="text-primary/70 truncate text-xs">
              {{ mergedLines[currentLyricIndex]?.tran || '' }}
            </p>
            <p v-else-if="mode === 'roma'" class="text-primary/70 truncate text-xs">
              {{ mergedLines[currentLyricIndex]?.roma || '' }}
            </p>
          </template>
        </div>
      </div>

      <!-- 中间：播放控制 -->
      <div class="flex items-center space-x-4">
        <Button
          variant="text"
          size="none"
          @click="previous"
          icon="icon-[mdi--skip-previous]"
          icon-class="size-6"
        />
        <Button
          variant="gradient"
          size="icon-lg"
          rounded="full"
          class="play-btn-glow"
          @click="togglePlay"
          :title="isPlaying ? t('player.pause') : t('player.play')"
          :loading="isLoading"
          :pulse="true"
          :press3d="true"
        >
          <span
            v-if="!isLoading"
            :class="isPlaying ? 'icon-[mdi--pause]' : 'icon-[mdi--play]'"
            class="text-primary h-6 w-6"
          ></span>
        </Button>
        <Button
          variant="text"
          size="none"
          @click="next"
          icon="icon-[mdi--skip-next]"
          icon-class="size-6"
        />
        <Button
          variant="text"
          :icon="playModeIcon"
          icon-class="size-6"
          size="none"
          @click="togglePlayMode"
          :title="playModeText"
        />
      </div>

      <!-- 右侧：音质切换、下载、音量和其他控制 -->
      <div class="relative flex flex-1 items-center justify-end space-x-2.5 sm:space-x-3.5">
        <!-- 音质切换按钮 -->
        <div v-if="currentSong" class="relative">
          <button
            id="footer-quality-btn"
            ref="qualityBtnRef"
            @click.stop="toggleQualityMenu"
            @keydown.down.prevent="openAndFocusQualityMenu"
            @keydown.up.prevent="openAndFocusQualityMenu"
            aria-haspopup="true"
            :aria-expanded="showQualityMenu"
            aria-controls="quality-menu-panel"
            class="group flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition-all duration-300 border border-white/10 bg-white/5 hover:bg-white/15 text-primary hover:border-pink-500/40 select-none shadow-sm cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-pink-500/80"
            :title="activeQualityTooltip"
          >
            <span
              class="w-1.5 h-1.5 rounded-full"
              :class="isDegradedQuality ? 'bg-amber-400' : isLosslessActive ? 'bg-pink-400 animate-pulse shadow-[0_0_6px_#ec4899]' : 'bg-cyan-400'"
            ></span>
            <span class="text-[11px] tracking-wide">{{ activeQualityBadge }}</span>
            <span
              class="icon-[mdi--chevron-up] text-xs transition-transform duration-200"
              :class="{ 'rotate-180': showQualityMenu }"
            ></span>
          </button>
        </div>

        <!-- 向上浮动音质选择面板 (Teleport 至 body 避免被 footer overflow-hidden 截断) -->
        <Teleport to="body">
          <Transition name="quality-pop">
            <div
              v-if="showQualityMenu"
              id="quality-menu-panel"
              ref="qualityMenuRef"
              role="radiogroup"
              aria-labelledby="quality-menu-title"
              :style="{
                position: 'fixed',
                bottom: `${menuCoords.bottom}px`,
                right: `${menuCoords.right}px`,
                zIndex: 60,
              }"
              class="quality-panel-popover w-64 overflow-hidden rounded-2xl select-none"
              @keydown="handleQualityMenuKeydown"
            >
              <!-- 顶部标题 -->
              <div
                class="px-3 py-2 flex items-center justify-between border-b border-white/10"
                style="background: linear-gradient(135deg, rgba(236, 72, 153, 0.12), rgba(139, 92, 246, 0.10));"
              >
                <div class="flex items-center gap-1.5">
                  <span class="icon-[mdi--waveform] h-3.5 w-3.5 text-pink-400"></span>
                  <span id="quality-menu-title" class="text-[11px] font-semibold text-white/90 tracking-wider">音频规格</span>
                </div>
                <span class="text-[11px] font-mono font-medium text-pink-300">
                  {{ activeQualityBadge }}
                </span>
              </div>

              <!-- 音质选项列表 (不可用项置灰并展示原因，显示真实格式与码率) -->
              <div class="p-1.5 space-y-1">
                <button
                  v-for="(q, index) in availableQualities"
                  :key="q.level"
                  :ref="(el) => { if (el) qualityItemRefs[index] = el as HTMLButtonElement }"
                  role="radio"
                  :aria-checked="currentQualityLevel === q.level"
                  :aria-disabled="!q.isAvailable"
                  :disabled="!q.isAvailable"
                  :tabindex="q.isAvailable ? (focusedQualityIndex === index ? 0 : -1) : -1"
                  @click.stop="q.isAvailable && selectQuality(q.level)"
                  @keydown.enter.prevent.stop="q.isAvailable && selectQuality(q.level)"
                  @keydown.space.prevent.stop="q.isAvailable && selectQuality(q.level)"
                  class="w-full min-h-[36px] py-1.5 flex items-center justify-between px-2.5 rounded-xl text-left transition-all duration-150 group outline-none"
                  :class="[
                    !q.isAvailable
                      ? 'opacity-45 cursor-not-allowed border border-transparent'
                      : currentQualityLevel === q.level
                        ? 'bg-pink-500/15 border border-pink-500/40 text-pink-200 font-semibold shadow-sm cursor-pointer'
                        : 'border border-transparent text-white/85 hover:bg-white/10 hover:text-white cursor-pointer'
                  ]"
                >
                  <div class="flex items-center gap-2 min-w-0 pr-1">
                    <!-- 左侧指示条 -->
                    <span
                      class="w-1 h-3.5 rounded-full transition-all duration-150 shrink-0"
                      :class="currentQualityLevel === q.level && q.isAvailable ? 'bg-gradient-to-b from-pink-500 to-rose-500 shadow-[0_0_8px_rgba(236,72,153,0.6)]' : 'bg-transparent'"
                    ></span>
                    <span
                      class="text-xs transition-colors shrink-0"
                      :class="currentQualityLevel === q.level && q.isAvailable ? 'text-pink-200 font-bold' : 'text-white/90 font-medium'"
                    >
                      {{ q.label }}
                    </span>
                  </div>
                  <!-- 右侧：真实规格或置灰原因 -->
                  <span
                    class="text-[11px] shrink-0 transition-colors text-right pl-1"
                    :class="[
                      !q.isAvailable
                        ? 'text-white/65 font-normal font-sans'
                        : currentQualityLevel === q.level
                          ? 'text-pink-300 font-semibold font-mono'
                          : 'text-white/65 group-hover:text-white/85 font-mono'
                    ]"
                  >
                    {{ q.bitrate }}
                  </span>
                </button>
              </div>
            </div>
          </Transition>
        </Teleport>

        <!-- 当前歌曲下载按钮 -->
        <Button
          v-if="currentSong"
          variant="text"
          size="none"
          icon="icon-[mdi--tray-arrow-down]"
          icon-class="size-5"
          class="text-primary/70 hover:text-pink-400 flex items-center transition-colors cursor-pointer"
          :title="t('common.download') + '当前歌曲'"
          @click.stop="downloadCurrentSong"
        />

        <VolumeControl />
        <PlaylistBubble v-model:show="showQueue" placement="top-right" :offset-y="20">
          <template #trigger>
            <Button
              variant="text"
              size="none"
              icon="icon-[mdi--playlist-music]"
              icon-class="size-6"
              class="text-primary/70 hover:text-primary flex items-center transition-colors"
            >
            </Button>
          </template>
        </PlaylistBubble>
      </div>
    </div>

    <!-- 进度条与高对比度时间文字 (对比度 >= 4.5:1，独立层级不被频谱遮盖) -->
    <div v-if="currentSong" class="relative z-10 mt-3 flex items-center space-x-3">
      <span class="text-white/80 text-xs font-medium font-mono tabular-nums select-none">{{
        isLoading ? t('player.loading') : formattedCurrentTime
      }}</span>
      <MusicProgress class="flex-1" />
      <span class="text-white/80 text-xs font-medium font-mono tabular-nums select-none">{{ formattedDuration }}</span>
    </div>

    <!-- 音质切换即时反馈 Toast -->
    <Transition name="fade">
      <div
        v-if="qualityToastMsg"
        class="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border border-pink-500/30 bg-neutral-900/90 px-4 py-1.5 text-xs font-semibold text-pink-300 shadow-xl backdrop-blur-xl"
      >
        <span class="icon-[mdi--check-circle] h-4 w-4 text-pink-400"></span>
        <span>{{ qualityToastMsg }}</span>
      </div>
    </Transition>
  </footer>
</template>

<style scoped>
/* 封面容器 */
.cover-container {
  position: relative;
}

.cover-inner {
  transform-style: preserve-3d;
  backface-visibility: hidden;
  will-change: transform;
}

/* 播放时微微脉动 */
@keyframes pulse-subtle {
  0%, 100% {
    box-shadow: 0 4px 12px rgba(236, 72, 153, 0.2);
  }
  50% {
    box-shadow: 0 4px 20px rgba(236, 72, 153, 0.35);
  }
}

.animate-pulse-subtle {
  animation: pulse-subtle 2s ease-in-out infinite;
}

/* 音频均衡器动画 */
@keyframes equalizer-1 {
  0%, 100% { height: 4px; }
  50% { height: 16px; }
}

@keyframes equalizer-2 {
  0%, 100% { height: 8px; }
  50% { height: 12px; }
}

@keyframes equalizer-3 {
  0%, 100% { height: 6px; }
  50% { height: 14px; }
}

.animate-equalizer-1 {
  animation: equalizer-1 0.5s ease-in-out infinite;
}

.animate-equalizer-2 {
  animation: equalizer-2 0.5s ease-in-out infinite 0.1s;
}

.animate-equalizer-3 {
  animation: equalizer-3 0.5s ease-in-out infinite 0.2s;
}

/* 音质菜单与反馈弹窗过渡 (引用设计令牌并遵守 prefers-reduced-motion) */
.quality-pop-enter-active,
.quality-pop-leave-active {
  transition:
    opacity var(--glass-duration-normal, 200ms) var(--glass-ease, cubic-bezier(0.16, 1, 0.3, 1)),
    transform var(--glass-duration-normal, 200ms) var(--glass-ease, cubic-bezier(0.16, 1, 0.3, 1));
}
.quality-pop-enter-from,
.quality-pop-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .quality-pop-enter-active,
  .quality-pop-leave-active {
    transition: opacity 0.05s ease !important;
    transform: none !important;
  }
  .quality-pop-enter-from,
  .quality-pop-leave-to {
    opacity: 0;
    transform: none !important;
  }
}

/* 音质规格上浮菜单毛玻璃容器 (深紫玻璃底色，模糊半径限制在 24px 内) */
.quality-panel-popover {
  background-color: #1e1a34;
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow:
    0 16px 36px -8px rgba(0, 0, 0, 0.65),
    inset 0 1px 1px 0 rgba(255, 255, 255, 0.12);
}

@supports (backdrop-filter: blur(20px)) or (-webkit-backdrop-filter: blur(20px)) {
  .quality-panel-popover {
    background-color: rgba(30, 26, 52, 0.94);
    backdrop-filter: blur(var(--glass-blur, 24px));
    -webkit-backdrop-filter: blur(var(--glass-blur, 24px));
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
