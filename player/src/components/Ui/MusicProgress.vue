<script setup lang="ts">
import { useAudio } from '@/composables/useAudio'
import { useEventListener } from '@vueuse/core'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  color: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
})

// 生成渐变样式
const gradientStyle = computed(() => {
  if (props.color.length === 0) {
    // 使用默认渐变
    return 'linear-gradient(90deg, #38bdf8, #2563eb)'
  }
  // 使用传入的颜色数组生成渐变
  return `linear-gradient(90deg, ${props.color.join(', ')})`
})

const { currentSong, currentTime, duration, progress, setProgress, setCurrentTime } = useAudio()

const progressBarRef = useTemplateRef('progressBarRef')

const state = reactive({
  isDragging: false,
  dragProgress: null as number | null,
  showTimePreview: false,
  previewTime: 0,
  previewPosition: 0,
})

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const totalSeconds = computed(() => {
  let total = duration.value
  if (!total && currentSong.value?.duration) {
    total = currentSong.value.duration
    if (total > 10000) total = total / 1000
  }
  return Math.max(0, total || 0)
})

const currentSeconds = computed(() =>
  Math.max(0, Math.min(totalSeconds.value, currentTime.value))
)

const progressValueText = computed(
  () => `${formatTime(currentSeconds.value)} / ${formatTime(totalSeconds.value)}`
)

const handleProgressKeydown = (event: KeyboardEvent) => {
  if (!currentSong.value) return
  const total = totalSeconds.value
  if (!total) return
  let next: number | null = null
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = currentTime.value - 5
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = currentTime.value + 5
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = total
  if (next === null) return
  event.preventDefault()
  setCurrentTime(Math.max(0, Math.min(total, next)))
}

const handleProgressHover = (event: MouseEvent) => {
  if (!progressBarRef.value || !currentSong.value) return
  const rect = progressBarRef.value.getBoundingClientRect()
  const hoverX = event.clientX - rect.left
  const hoverProgress = Math.max(0, Math.min(1, hoverX / rect.width))

  let d = duration.value
  if (!d && currentSong.value.duration) {
    d = currentSong.value.duration
    // 如果数值较大（大于10000），大概率是毫秒，转换为秒
    if (d > 10000) d = d / 1000
  }

  state.previewTime = hoverProgress * d
  state.previewPosition = hoverX
  state.showTimePreview = true
}

const handleProgressLeave = () => {
  state.showTimePreview = false
}

const handleProgressDrag = (clientX: number) => {
  if (!state.isDragging || !progressBarRef.value) return
  const rect = progressBarRef.value.getBoundingClientRect()
  const x = clientX - rect.left
  const newProgress = (x / rect.width) * 100
  state.dragProgress = Math.max(0, Math.min(100, newProgress))

  // 更新预览时间
  if (currentSong.value) {
    let d = duration.value
    if (!d && currentSong.value.duration) {
      d = currentSong.value.duration
      // 如果数值较大（大于10000），大概率是毫秒，转换为秒
      if (d > 10000) d = d / 1000
    }
    state.previewTime = (state.dragProgress / 100) * d
    state.previewPosition = x
  }
}

const startDrag = (event: MouseEvent | TouchEvent) => {
  if (event instanceof TouchEvent) {
    // 阻止默认滚动行为
    // event.preventDefault()
    // 注意：在 passive listener 中不能 preventDefault，这里假设在 template 中使用了 .prevent
  } else {
    event.preventDefault()
  }

  state.isDragging = true
  state.dragProgress = progress.value
  document.body.style.userSelect = 'none'

  const clientX = event instanceof MouseEvent ? event.clientX : event.touches[0].clientX
  handleProgressDrag(clientX)
}

const stopDrag = () => {
  if (state.isDragging && state.dragProgress !== null) {
    setProgress(state.dragProgress)
  }
  state.isDragging = false
  state.dragProgress = null
  document.body.style.userSelect = ''
}

const handleMouseMove = (event: MouseEvent) => {
  if (state.isDragging) {
    event.preventDefault()
    handleProgressDrag(event.clientX)
  }
}

const handleTouchMove = (event: TouchEvent) => {
  if (state.isDragging) {
    // event.preventDefault() // 由 .prevent 修饰符处理
    handleProgressDrag(event.touches[0].clientX)
  }
}

const handleProgressClick = (event: MouseEvent) => {
  if (state.isDragging) return
  if (!progressBarRef.value) return
  const rect = progressBarRef.value.getBoundingClientRect()
  const clickX = event.clientX - rect.left
  const newProgress = (clickX / rect.width) * 100
  setProgress(Math.max(0, Math.min(100, newProgress)))
}

useEventListener(document, 'mousemove', handleMouseMove)
useEventListener(document, 'mouseup', stopDrag)
useEventListener(document, 'touchmove', handleTouchMove, { passive: false })
useEventListener(document, 'touchend', stopDrag)

const displayProgress = computed(() => {
  return state.isDragging && state.dragProgress !== null ? state.dragProgress : progress.value
})

const previewPositionPercent = computed(() => {
  if (state.isDragging) {
    return displayProgress.value
  }
  if (!progressBarRef.value) return 0
  const width = progressBarRef.value.getBoundingClientRect().width
  return width > 0 ? (state.previewPosition / width) * 100 : 0
})
</script>

<template>
  <div
    ref="progressBarRef"
    role="slider"
    tabindex="0"
    aria-orientation="horizontal"
    :aria-label="t('player.progress')"
    aria-valuemin="0"
    :aria-valuemax="Math.round(totalSeconds)"
    :aria-valuenow="Math.round(currentSeconds)"
    :aria-valuetext="progressValueText"
    :aria-disabled="!currentSong || undefined"
    @click="handleProgressClick"
    @keydown="handleProgressKeydown"
    @mousemove="handleProgressHover"
    @mouseleave="handleProgressLeave"
    class="progress-wrapper group relative h-11 cursor-pointer select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
    @mousedown="startDrag"
    @touchstart.prevent="startDrag"
  >
    <!-- 时间预览提示 -->
    <Transition name="fade">
      <div
        v-if="state.showTimePreview || state.isDragging"
        class="time-preview absolute bottom-full mb-2 -translate-x-1/2 rounded-lg bg-black/80 px-3 py-1.5 text-xs whitespace-nowrap text-white shadow-lg backdrop-blur-sm"
        :style="{ left: `${previewPositionPercent}%` }"
      >
        {{ formatTime(state.previewTime) }}
        <div
          class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-black/80"
        ></div>
      </div>
    </Transition>

    <div
      class="progress-track absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 rounded-full transition-all group-hover:h-1.5"
      :class="state.isDragging ? 'h-1.5' : ''"
    >
      <div
        class="progress-fill absolute inset-y-0 left-0 rounded-full"
        :style="{ width: `${displayProgress}%`, background: gradientStyle }"
      ></div>
    </div>
  </div>
</template>

<style scoped>
@reference "../../style/tailwind.css";

.progress-wrapper {
  touch-action: none;
}

.progress-track {
  background: var(--glass-progress-track);
}

.progress-fill {
  box-shadow: 0 0 12px rgba(56,189,248, 0.35);
  transition: width 0.05s linear;
}

.time-preview {
  pointer-events: none;
  z-index: 100;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
