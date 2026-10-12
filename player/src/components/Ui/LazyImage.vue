<script setup lang="ts">
import { useIntersectionObserver } from '@vueuse/core'
import { formatCoverUrl, getProxyCoverUrl, DEFAULT_COVER_DATA_URI } from '@/utils/imageUrl'

interface Props {
  src?: string
  fallbackSrc?: string
  alt?: string
  title?: string
  seed?: string
  imgClass?: string
  wrapperClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  src: '',
  fallbackSrc: '',
  alt: '',
  title: '',
  seed: '',
  imgClass: '',
  wrapperClass: '',
})

const initialChar = computed(() => {
  const t = (props.title || props.alt || '').trim()
  if (!t) return ''
  return t.charAt(0).toUpperCase()
})

const gradientPalette = computed(() => {
  const seedStr = props.seed || props.title || props.alt || 'music'
  let hash = 0
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i)
    hash |= 0
  }
  const palettes = [
    'from-violet-600/50 via-purple-600/40 to-pink-500/50',
    'from-rose-500/50 via-pink-600/40 to-amber-500/40',
    'from-cyan-500/50 via-blue-600/40 to-indigo-500/50',
    'from-emerald-500/50 via-teal-600/40 to-cyan-500/50',
    'from-fuchsia-600/50 via-purple-500/40 to-indigo-600/50',
    'from-amber-500/50 via-orange-500/40 to-rose-500/50',
  ]
  return palettes[Math.abs(hash) % palettes.length]
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
    <!-- 优雅生成式艺术回退占位符 (歌名首字 + 专辑派生底色) -->
    <div
      v-else
      class="flex h-full w-full items-center justify-center bg-gradient-to-br backdrop-blur-sm select-none border border-white/10"
      :class="gradientPalette"
    >
      <span v-if="initialChar" class="text-sm font-bold text-white/90 drop-shadow-sm font-sans select-none">
        {{ initialChar }}
      </span>
      <span v-else class="icon-[mdi--music-note] text-white/50 h-5 w-5"></span>
    </div>
    <!-- 加载中骨架指示器 -->
    <div
      v-if="isLoading && !activeSrc.startsWith('data:')"
      class="absolute inset-0 flex items-center justify-center bg-white/5 backdrop-blur-[2px] animate-pulse"
    >
      <div class="h-3 w-3 rounded-full border border-pink-400/60 border-t-transparent animate-spin"></div>
    </div>
  </div>
</template>
