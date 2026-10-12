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

// ═══════ 音质切换与下载控制 ═══════
const showQualityMenu = ref(false)
const qualityMenuRef = ref<HTMLElement | null>(null)
const qualityToastMsg = ref('')
let qualityToastTimer: any = null

const availableQualities = computed(() => {
  if (currentSong.value?.qualities && currentSong.value.qualities.length > 0) {
    return currentSong.value.qualities.map((q) => ({
      level: q.level,
      label: q.label,
      bitrate: q.bitrate,
      desc: q.desc || (q.level === 'lossless' ? '超清无损母带音质' : q.level === 'exhigh' ? '极高品质MP3' : '标准流畅音质'),
    }))
  }
  return [
    { level: 'lossless', label: 'SQ 无损', bitrate: 'FLAC 24bit', desc: '超清无损母带音质 (FLAC / 24-bit)' },
    { level: 'exhigh', label: 'HQ 极高', bitrate: '320kbps', desc: '极高品质MP3 (320kbps 饱满声场)' },
    { level: 'standard', label: '标准', bitrate: '128kbps', desc: '标准流畅音质 (128kbps 快速省流)' },
  ]
})

const currentQualityLevel = computed(() => {
  const badge = currentSong.value?.qualityBadge
  if (badge === 'SQ' || currentSong.value?.qualities?.[0]?.level === 'lossless') return 'lossless'
  if (badge === 'HQ' || currentSong.value?.qualities?.[0]?.level === 'exhigh') return 'exhigh'
  return 'standard'
})

const activeQualityBadge = computed(() => {
  if (currentQualityLevel.value === 'lossless') return 'SQ 无损'
  if (currentQualityLevel.value === 'exhigh') return 'HQ 极高'
  return '标准'
})

const isLosslessActive = computed(() => currentQualityLevel.value === 'lossless')

const qualityBtnRef = ref<HTMLButtonElement | null>(null)
const menuCoords = ref({ bottom: 0, right: 0 })

const updateQualityMenuPosition = () => {
  if (!qualityBtnRef.value) return
  const rect = qualityBtnRef.value.getBoundingClientRect()
  menuCoords.value = {
    bottom: Math.max(16, window.innerHeight - rect.top + 10),
    right: Math.max(16, window.innerWidth - rect.right),
  }
}

const toggleQualityMenu = () => {
  if (!showQualityMenu.value) {
    updateQualityMenuPosition()
  }
  showQualityMenu.value = !showQualityMenu.value
}

const selectQuality = async (level: string) => {
  showQualityMenu.value = false
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
    showQualityMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentClick)
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', updateQualityMenuPosition)
  window.addEventListener('scroll', updateQualityMenuPosition, true)
})

onUnmounted(() => {
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
    <!-- 音频可视化器背景 -->
    <div
      v-if="isAnalyserInitialized && audioVisualizer.enabledInFooter"
      class="pointer-events-none absolute bottom-0 w-full left-0 z-0 opacity-30"
    >
      <AudioVisualizer
        :frequency-data="frequencyData"
        :time-domain-data="timeDomainData"
        type="bars"
        :bar-count="64"
        :bar-width="3"
        :bar-gap="2"
        :gradient-colors="visualizerGradient"
        :height="80"
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
            ref="qualityBtnRef"
            @click.stop="toggleQualityMenu"
            class="group flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition-all duration-300 border border-white/10 bg-white/5 hover:bg-white/15 text-primary hover:border-pink-500/40 select-none shadow-sm cursor-pointer"
            :title="'当前音质: ' + activeQualityBadge + ' (点击切换音质)'"
          >
            <span
              class="w-1.5 h-1.5 rounded-full"
              :class="isLosslessActive ? 'bg-pink-400 animate-pulse shadow-[0_0_6px_#ec4899]' : 'bg-cyan-400'"
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
              ref="qualityMenuRef"
              :style="{
                position: 'fixed',
                bottom: `${menuCoords.bottom}px`,
                right: `${menuCoords.right}px`,
                zIndex: 45,
              }"
              class="quality-panel-popover w-52 overflow-hidden rounded-2xl select-none"
            >
              <!-- 顶部标题 -->
              <div
                class="px-3 py-2 flex items-center justify-between border-b border-white/10"
                style="background: linear-gradient(135deg, rgba(236, 72, 153, 0.12), rgba(139, 92, 246, 0.10));"
              >
                <div class="flex items-center gap-1.5">
                  <span class="icon-[mdi--waveform] h-3.5 w-3.5 text-pink-400"></span>
                  <span class="text-[11px] font-semibold text-primary/80 tracking-wider">音频规格</span>
                </div>
                <span class="text-[11px] font-mono font-medium text-pink-300">
                  {{ activeQualityBadge }}
                </span>
              </div>

              <!-- 音质选项列表 -->
              <div class="p-1.5 space-y-1">
                <button
                  v-for="q in availableQualities"
                  :key="q.level"
                  @click.stop="selectQuality(q.level)"
                  class="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-left transition-all duration-150 group cursor-pointer"
                  :class="[
                    currentQualityLevel === q.level
                      ? 'bg-pink-500/15 border border-pink-500/40 text-pink-200 font-semibold shadow-sm'
                      : 'border border-transparent text-primary/80 hover:bg-white/10 hover:text-primary'
                  ]"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-xs font-semibold">{{ q.label }}</span>
                    <span class="text-[11px] font-mono text-primary/60 group-hover:text-primary/80">{{ q.bitrate }}</span>
                  </div>
                  <span v-if="currentQualityLevel === q.level" class="icon-[mdi--check] h-3.5 w-3.5 text-pink-400 shrink-0"></span>
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

    <!-- 进度条 -->
    <div v-if="currentSong" class="relative z-10 mt-3 flex items-center space-x-3">
      <span class="text-primary/60 text-xs">{{
        isLoading ? t('player.loading') : formattedCurrentTime
      }}</span>
      <MusicProgress class="flex-1" />
      <span class="text-primary/60 text-xs">{{ formattedDuration }}</span>
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

/* 音质菜单与反馈弹窗过渡 */
.quality-pop-enter-active,
.quality-pop-leave-active {
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
.quality-pop-enter-from,
.quality-pop-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

/* 音质规格上浮菜单毛玻璃容器 */
.quality-panel-popover {
  background-color: light-dark(rgba(255, 255, 255, 0.90), rgba(20, 16, 36, 0.92));
  border: 1px solid light-dark(rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0.18));
  box-shadow:
    0 24px 60px -12px rgba(0, 0, 0, 0.65),
    0 0 35px -8px rgba(139, 92, 246, 0.35),
    inset 0 1px 1px 0 rgba(255, 255, 255, 0.22);
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
