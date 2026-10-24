<script setup lang="ts">
import { useIntersectionObserver } from '@vueuse/core'
import { useI18n } from 'vue-i18n'

interface Props {
  loading?: boolean
  hasMore?: boolean
  error?: boolean
  timeout?: number
  rootMargin?: string
  disabled?: boolean
  empty?: boolean
  loadingText?: string
  retryText?: string
  noMoreText?: string
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  hasMore: true,
  error: false,
  timeout: 7000,
  rootMargin: '200px',
  disabled: false,
  empty: false,
  loadingText: '',
  retryText: '',
  noMoreText: '',
})

const emit = defineEmits<{
  (e: 'load'): void
  (e: 'retry'): void
}>()

const { t } = useI18n()

const targetRef = ref<HTMLElement | null>(null)
const isIntersecting = ref(false)
const isTimeout = ref(false)
let timeoutTimer: ReturnType<typeof setTimeout> | null = null

const resolvedLoadingText = computed(
  () => props.loadingText || t('common.loading') || '正在加载更多...'
)
const resolvedRetryText = computed(
  () => props.retryText || '加载较慢，点击重新加载'
)
const resolvedNoMoreText = computed(
  () => props.noMoreText || '已加载全部精彩内容'
)

// 触发加载处理
const tryTriggerLoad = () => {
  if (
    isIntersecting.value &&
    props.hasMore &&
    !props.loading &&
    !props.disabled &&
    !isTimeout.value &&
    !props.error
  ) {
    emit('load')
  }
}

// 超时计时器管理
const clearTimer = () => {
  if (timeoutTimer) {
    clearTimeout(timeoutTimer)
    timeoutTimer = null
  }
}

const startTimer = () => {
  clearTimer()
  if (props.loading && props.timeout > 0) {
    timeoutTimer = setTimeout(() => {
      if (props.loading) {
        isTimeout.value = true
      }
    }, props.timeout)
  }
}

watch(
  () => props.loading,
  val => {
    if (val) {
      isTimeout.value = false
      startTimer()
    } else {
      clearTimer()
      isTimeout.value = false
      // 加载完成后如果依然在可视区域且还有更多，延迟尝试下一轮触发
      nextTick(() => {
        if (isIntersecting.value && props.hasMore) {
          tryTriggerLoad()
        }
      })
    }
  },
  { immediate: true }
)

// 手动点击重新加载 / 强制刷新
const handleManualRetry = () => {
  isTimeout.value = false
  emit('retry')
  emit('load')
  startTimer()
}

// 监听视口交叉状态
useIntersectionObserver(
  targetRef,
  ([entry]) => {
    isIntersecting.value = entry?.isIntersecting ?? false
    if (isIntersecting.value) {
      tryTriggerLoad()
    }
  },
  {
    rootMargin: props.rootMargin,
  }
)

onUnmounted(() => {
  clearTimer()
})
</script>

<template>
  <div
    ref="targetRef"
    class="sonic-infinite-scroll flex w-full flex-col items-center justify-center transition-all duration-300 ease-out select-none"
    :class="[
      loading || isTimeout || error ? 'min-h-[56px] py-4' : hasMore ? 'h-6' : 'py-6',
    ]"
  >
    <!-- 状态 1：加载中（无超时），展示自动微动效与极光光圈 -->
    <div
      v-if="loading && !isTimeout && !error"
      class="animate-in fade-in slide-in-from-bottom-2 duration-300 flex items-center justify-center gap-3 rounded-full border border-pink-500/20 bg-black/40 px-5 py-2 backdrop-blur-md shadow-lg shadow-pink-500/5"
    >
      <div class="relative flex h-4 w-4 items-center justify-center">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-pink-400 opacity-25"></span>
        <div class="h-4 w-4 rounded-full border-2 border-violet-500/30 border-t-pink-500 animate-spin"></div>
      </div>
      <span class="text-xs font-medium tracking-wide text-primary/80">
        {{ resolvedLoadingText }}
      </span>
    </div>

    <!-- 状态 2：长时间未响应（超时）或加载失败，自适应降级为显式重试按钮 -->
    <div
      v-else-if="isTimeout || error"
      class="animate-in zoom-in-95 duration-200 flex flex-col items-center gap-2"
    >
      <button
        type="button"
        class="group relative inline-flex items-center gap-2 rounded-full border border-pink-500/40 bg-gradient-to-r from-violet-600/20 to-pink-600/20 px-5 py-2 text-xs font-medium text-pink-300 backdrop-blur-md transition-all duration-300 hover:border-pink-500/80 hover:bg-pink-500/20 hover:text-white hover:shadow-lg hover:shadow-pink-500/20 active:scale-95 cursor-pointer"
        @click="handleManualRetry"
      >
        <span class="icon-[mdi--refresh] h-4 w-4 transition-transform duration-500 group-hover:rotate-180 text-pink-400"></span>
        <span>{{ resolvedRetryText }}</span>
        <span class="inline-flex items-center rounded-md bg-pink-500/20 px-1.5 py-0.5 text-[10px] text-pink-300 group-hover:text-white">
          重试
        </span>
      </button>
      <span class="text-[11px] text-primary/40 font-mono">
        {{ error ? '数据连接异常' : '网络响应延迟，可点击强制刷新' }}
      </span>
    </div>

    <!-- 状态 3：已加载全部数据且列表非空 -->
    <div
      v-else-if="!hasMore && !empty"
      class="animate-in fade-in duration-500 flex items-center justify-center gap-3 text-xs text-primary/30"
    >
      <span class="h-px w-10 sm:w-16 bg-gradient-to-r from-transparent to-primary/20"></span>
      <span class="flex items-center gap-1.5 font-medium tracking-wider text-[11px]">
        <span class="h-1 w-1 rounded-full bg-pink-500/50"></span>
        {{ resolvedNoMoreText }}
        <span class="h-1 w-1 rounded-full bg-violet-500/50"></span>
      </span>
      <span class="h-px w-10 sm:w-16 bg-gradient-to-l from-transparent to-primary/20"></span>
    </div>
  </div>
</template>
