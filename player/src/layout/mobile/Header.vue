<script setup lang="ts">
// 移动端头部：epocanvas sonic 品牌 Logo/标题，搜索与主题切换（无外部文档及登录）
const router = useRouter()
import { useI18n } from 'vue-i18n'
import { useGlobalStore } from '@/stores/modules/global'
import { storeToRefs } from 'pinia'
import { BRAND_FULL, BRAND_PARENT, BRAND_PRODUCT } from '@/config/brand'

const { t } = useI18n()
const globalStore = useGlobalStore()
const { theme } = storeToRefs(globalStore)

const goSearch = () => router.push('/search')

const themeIcon = computed(() => {
  if (theme.value === 'system') return 'icon-[mdi--theme-light-dark]'
  if (theme.value === 'dark') return 'icon-[mdi--weather-night]'
  return 'icon-[mdi--weather-sunny]'
})

const cycleTheme = () => {
  const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']
  const idx = order.indexOf(theme.value)
  globalStore.setTheme(order[(idx + 1) % 3])
}
</script>

<template>
  <header class="glass-nav m-2 flex items-center justify-between rounded-2xl px-3.5 py-2.5">
    <div class="flex items-center gap-2.5">
      <router-link to="/" class="flex items-center gap-2.5" :aria-label="BRAND_FULL">
        <span class="relative flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#2563eb] via-[#38bdf8] to-[#3b82f6] shadow-[0_0_12px_rgba(37,99,235,0.6)]">
          <span class="h-2 w-2 rounded-full bg-white/95"></span>
          <span class="absolute inset-0 rounded-full ring-1 ring-white/50"></span>
        </span>
        <div class="flex flex-col leading-none">
          <span class="text-[8px] font-semibold tracking-[0.16em] text-primary/55">{{ BRAND_PARENT }}</span>
          <h1 class="mt-0.5 text-primary text-base font-extrabold tracking-tight">{{ BRAND_PRODUCT }}</h1>
        </div>
      </router-link>
    </div>
    <div class="flex items-center gap-1.5">
      <button
        class="text-primary/70 hover:text-primary rounded-full p-2 transition-colors hover:bg-white/10"
        :title="t('common.search.label')"
        @click="goSearch"
      >
        <span class="icon-[mdi--magnify] h-5 w-5"></span>
      </button>
      <button
        class="text-primary/70 hover:text-primary rounded-full p-2 transition-colors hover:bg-white/10"
        :title="t('components.settings.themeMode')"
        @click="cycleTheme"
      >
        <span :class="[themeIcon, 'h-5 w-5']"></span>
      </button>
    </div>
  </header>
</template>
