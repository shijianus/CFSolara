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
  emptyText?: string
  errorText?: string
  resetText?: string
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
  emptyText: '',
  errorText: '',
  resetText: '',
})

const emit = defineEmits<{
  (e: 'load'): void
  (e: 'retry'): void
  (e: 'reset'): void
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
  () => props.retryText || t('components.infiniteScroll.retry')
)
const resolvedNoMoreText = computed(
  () => props.noMoreText || t('components.infiniteScroll.noMore')
)
const resolvedEmptyText = computed(
  () => props.emptyText || t('components.infiniteScroll.empty')
)
const resolvedResetText = computed(
  () => props.resetText || t('components.infiniteScroll.reset')
)
const resolvedErrorText = computed(() =>
  props.error
    ? props.errorText || t('components.infiniteScroll.error')
    : t('components.infiniteScroll.timeout')
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

const handleReset = () => {
  emit('reset')
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
      loading || isTimeout || error
        ? 'min-h-[56px] py-4'
        : empty
          ? 'min-h-[120px] py-8'
          : hasMore
            ? 'h-6'
            : 'py-6',
    ]"
  >
    <!-- 状态 1：加载中（无超时），展示自动微动效与极光光圈 -->
    <div
      v-if="loading && !isTimeout && !error"
      class="animate-in fade-in slide-in-from-bottom-2 duration-300 flex items-center justify-center gap-3 rounded-full border border-sky-500/20 bg-black/40 px-5 py-2 backdrop-blur-md shadow-lg shadow-sky-500/5"
    >
      <div class="relative flex h-4 w-4 items-center justify-center">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-25"></span>
        <div class="h-4 w-4 rounded-full border-2 border-blue-500/30 border-t-sky-500 animate-spin"></div>
      </div>
      <span class="text-xs font-medium tracking-wide text-primary/80">
        {{ resolvedLoadingText }}
      </span>
    </div>

    <!-- 状态 2：加载失败或超时，展示明确原因与重试按钮 -->
    <div
      v-else-if="isTimeout || error"
      class="animate-in zoom-in-95 duration-200 flex flex-col items-center gap-2"
    >
      <button
        type="button"
        class="group relative inline-flex min-h-11 items-center gap-2 rounded-full border border-sky-500/40 bg-gradient-to-r from-blue-600/20 to-sky-600/20 px-5 py-2 text-xs font-medium text-sky-300 backdrop-blur-md transition-all duration-300 hover:border-sky-500/80 hover:bg-sky-500/20 hover:text-primary hover:shadow-lg hover:shadow-sky-500/20 active:scale-95 cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-400/60"
        @click="handleManualRetry"
      >
        <span class="icon-[mdi--refresh] h-4 w-4 transition-transform duration-500 group-hover:rotate-180 text-sky-400"></span>
        <span>{{ resolvedRetryText }}</span>
        <span class="inline-flex items-center rounded-md bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300 group-hover:text-primary">
          {{ t('common.retry') }}
        </span>
      </button>
      <span class="text-[11px] text-primary/50 font-mono">
        {{ resolvedErrorText }}
      </span>
    </div>

    <!-- 状态 3：无结果，可选重置筛选 -->
    <div
      v-else-if="empty"
      class="animate-in fade-in duration-300 flex flex-col items-center gap-3 px-4 text-center"
    >
      <span class="icon-[mdi--playlist-remove] text-primary/20 h-10 w-10"></span>
      <p class="text-primary/60 text-sm font-medium">{{ resolvedEmptyText }}</p>
      <button
        v-if="resetText"
        type="button"
        class="min-h-11 rounded-full border border-sky-500/40 bg-sky-500/10 px-4 text-xs font-medium text-sky-400 transition-colors hover:bg-sky-500/20 hover:text-primary focus-visible:ring-2 focus-visible:ring-sky-400/60"
        @click="handleReset"
      >
        {{ resolvedResetText }}
      </button>
    </div>

    <!-- 状态 4：已加载全部数据且列表非空 -->
    <div
      v-else-if="!hasMore"
      class="animate-in fade-in duration-500 flex items-center justify-center gap-3 text-xs text-primary/30"
    >
      <span class="h-px w-10 sm:w-16 bg-gradient-to-r from-transparent to-primary/20"></span>
      <span class="flex items-center gap-1.5 font-medium tracking-wider text-[11px]">
        <span class="h-1 w-1 rounded-full bg-sky-500/50"></span>
        {{ resolvedNoMoreText }}
        <span class="h-1 w-1 rounded-full bg-blue-500/50"></span>
      </span>
      <span class="h-px w-10 sm:w-16 bg-gradient-to-l from-transparent to-primary/20"></span>
    </div>
  </div>
</template>
