<script setup lang="ts">
import { useIntersectionObserver } from '@vueuse/core'
import { formatCoverUrl, getProxyCoverUrl, DEFAULT_COVER_DATA_URI } from '@/utils/imageUrl'

interface Props {
  src?: string
  fallbackSrc?: string
  alt?: string
  imgClass?: string
  wrapperClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  src: '',
  fallbackSrc: '',
  alt: '',
  imgClass: '',
  wrapperClass: '',
})

const el = ref<HTMLElement | null>(null)
const isIntersected = ref(false)
const activeSrc = ref<string>('')
const isLoading = ref(false)
const hasError = ref(false)
const attemptStage = ref<'primary' | 'proxy' | 'fallback' | 'failed'>('primary')

const resolveInitialSrc = () => {
  const primary = formatCoverUrl(props.src)
  if (primary) {
    attemptStage.value = 'primary'
    activeSrc.value = primary
    hasError.value = false
    isLoading.value = true
    return
  }
  const fallback = formatCoverUrl(props.fallbackSrc)
  if (fallback) {
    attemptStage.value = 'fallback'
    activeSrc.value = fallback
    hasError.value = false
    isLoading.value = true
    return
  }
  activeSrc.value = ''
  hasError.value = true
  isLoading.value = false
}

useIntersectionObserver(
  el,
  ([entry]) => {
    if (entry.isIntersecting && !isIntersected.value) {
      isIntersected.value = true
      resolveInitialSrc()
    }
  },
  { rootMargin: '300px' }
)

// Watch for prop changes to update activeSrc immediately
watch(
  () => [props.src, props.fallbackSrc],
  () => {
    if (isIntersected.value) {
      resolveInitialSrc()
    }
  }
)

const handleLoad = () => {
  isLoading.value = false
  hasError.value = false
}

const handleError = () => {
  isLoading.value = false

  // Step 1: If primary external image failed, try proxying through Cloudflare Gateway
  if (attemptStage.value === 'primary') {
    const rawPrimary = props.src ? formatCoverUrl(props.src) : ''
    if (rawPrimary && rawPrimary.startsWith('http') && !rawPrimary.includes('/api/music/cover')) {
      attemptStage.value = 'proxy'
      activeSrc.value = getProxyCoverUrl(rawPrimary)
      isLoading.value = true
      return
    }
    // No proxy candidate, try fallback
    const fallback = formatCoverUrl(props.fallbackSrc)
    if (fallback && fallback !== activeSrc.value) {
      attemptStage.value = 'fallback'
      activeSrc.value = fallback
      isLoading.value = true
      return
    }
  }

  // Step 2: If proxy failed, try fallback
  if (attemptStage.value === 'proxy') {
    const fallback = formatCoverUrl(props.fallbackSrc)
    if (fallback && fallback !== activeSrc.value) {
      attemptStage.value = 'fallback'
      activeSrc.value = fallback
      isLoading.value = true
      return
    }
  }

  // Step 3: Default inline SVG placeholder
  if (attemptStage.value !== 'failed' && activeSrc.value !== DEFAULT_COVER_DATA_URI) {
    attemptStage.value = 'failed'
    activeSrc.value = DEFAULT_COVER_DATA_URI
    hasError.value = false
    return
  }

  hasError.value = true
}
</script>

<template>
  <div ref="el" :class="['relative h-full w-full select-none overflow-hidden', wrapperClass]">
    <img
      v-if="activeSrc && !hasError"
      :src="activeSrc"
      :alt="alt"
      :class="imgClass"
      decoding="async"
      referrerpolicy="no-referrer"
      @load="handleLoad"
      @error="handleError"
    />
    <!-- 优雅渐变回退占位符 (替代生硬的断图图标) -->
    <div
      v-else
      class="flex h-full w-full items-center justify-center bg-gradient-to-br from-purple-500/30 via-pink-500/20 to-blue-500/30 backdrop-blur-sm"
    >
      <span class="icon-[mdi--music-note] text-white/50 h-6 w-6"></span>
    </div>
    <!-- 加载中指示器 -->
    <div v-if="isLoading && !activeSrc.startsWith('data:')" class="absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-[1px]">
      <span class="icon-[mdi--loading] text-glass-70 h-5 w-5 animate-spin"></span>
    </div>
  </div>
</template>
