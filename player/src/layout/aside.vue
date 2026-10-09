<script setup lang="ts">
import { useUserStore } from '@/stores/modules/user'
import { useGlobalStore } from '@/stores/modules/global'
import { storeToRefs } from 'pinia'
import { gsap } from 'gsap'

import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()
const globalStore = useGlobalStore()
const { theme } = storeToRefs(globalStore)

// 侧边栏搜索框
const searchQuery = ref('')
const handleSearch = () => {
  const q = searchQuery.value.trim()
  if (!q) return
  globalStore.addSearchHistory(q)
  router.push({ path: '/search', query: { q } })
}

const themeList = [
  { val: 'dark' as const, icon: 'icon-[mdi--weather-night]', label: 'Dark' },
  { val: 'light' as const, icon: 'icon-[mdi--weather-sunny]', label: 'Light' },
  { val: 'system' as const, icon: 'icon-[mdi--theme-light-dark]', label: 'System' },
]

const sections = [
  {
    titleKey: 'layout.aside.explore',
    items: [
      { to: '/', labelKey: 'layout.aside.menu.home', icon: 'mdi--home' },
      { to: '/mv-list', labelKey: 'layout.aside.menu.mv', icon: 'mdi--video' },
      { to: '/charts', labelKey: 'layout.aside.menu.charts', icon: 'mdi--chart-line' },
      { to: '/artists', labelKey: 'layout.aside.menu.artists', icon: 'mdi--account-music' },
      { to: '/new-albums', labelKey: 'layout.aside.menu.newAlbums', icon: 'mdi--album' },
      { to: '/search', labelKey: 'layout.aside.menu.search', icon: 'ic--round-search' },
    ],
  },
  {
    titleKey: 'layout.aside.myMusic',
    items: [
      { to: '/my-music', labelKey: 'layout.aside.menu.recent', icon: 'mdi--music-box-multiple' },
      {
        to: '/local-music',
        labelKey: 'layout.aside.menu.localMusic',
        icon: 'mdi--folder-music-outline',
      },
    ],
  },
  {
    titleKey: 'layout.aside.system',
    items: [{ to: '/settings', labelKey: 'layout.aside.menu.settings', icon: 'mdi--cog' }],
  },
]

const state = reactive({
  // 用户创建的歌单列表
  userPlaylists: [
    { id: 1, name: '我喜欢的音乐' },
    { id: 2, name: '华语流行' },
    { id: 3, name: '二次元音乐' },
    { id: 4, name: '轻音乐' },
  ],
})
const { userPlaylists } = toRefs(state)
const userStore = useUserStore()

// 活动指示器相关
const indicatorRef = ref<HTMLElement | null>(null)
const navContainerRef = ref<HTMLElement | null>(null)

// 更新指示器位置
const updateIndicator = () => {
  if (!indicatorRef.value || !navContainerRef.value) return

  const activeLink = navContainerRef.value.querySelector('.nav-link-active') as HTMLElement
  if (!activeLink) {
    // 隐藏指示器
    gsap.to(indicatorRef.value, {
      opacity: 0,
      duration: 0.2,
    })
    return
  }

  const containerRect = navContainerRef.value.getBoundingClientRect()
  const linkRect = activeLink.getBoundingClientRect()

  gsap.to(indicatorRef.value, {
    y: linkRect.top - containerRect.top,
    height: linkRect.height,
    opacity: 1,
    duration: 0.3,
    ease: 'power3.out',
  })
}

// 监听路由变化
watch(
  () => route.path,
  () => {
    nextTick(() => {
      updateIndicator()
    })
  },
  { immediate: true }
)

// 组件挂载后初始化
onMounted(() => {
  nextTick(() => {
    updateIndicator()
  })
})

// 检查是否是当前路由
const isActive = (path: string) => {
  if (path === '/') {
    return route.path === '/'
  }
  return route.path.startsWith(path)
}
</script>
<template>
  <aside class="hidden md:flex w-64 xl:w-72 shrink-0 h-full flex-col">
    <div class="glass-card relative flex h-full w-full flex-col justify-between rounded-[28px] p-4 border border-white/15 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.4)] overflow-hidden">
      <div class="flex flex-col min-h-0 flex-1">
        <!-- 顶部：Sonic 品牌 Logo + 前进后退导航按钮 -->
        <div class="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
          <router-link to="/" class="group flex items-center gap-2.5">
            <span class="relative flex h-8.5 w-8.5 items-center justify-center rounded-2xl bg-linear-to-br from-[#8b5cf6] via-[#ec4899] to-[#3b82f6] p-0.5 shadow-[0_0_16px_rgba(139,92,246,0.6)] transition-transform duration-300 group-hover:scale-105">
              <span class="flex h-full w-full items-center justify-center rounded-[13px] bg-black/25 backdrop-blur-xs">
                <span class="h-2 w-2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)] animate-pulse"></span>
              </span>
            </span>
            <div class="flex flex-col">
              <div class="flex items-center gap-1.5">
                <span class="text-primary text-base font-extrabold tracking-tight">Sonic</span>
                <span class="rounded bg-linear-to-r from-[#8b5cf6]/30 to-[#ec4899]/30 px-1 py-0.2 text-[8px] font-bold text-white/90 border border-white/20">STUDIO</span>
              </div>
              <span class="text-[9px] text-primary/40 font-semibold tracking-wider">AUDIO ENGINE</span>
            </div>
          </router-link>

          <!-- 前进 / 后退紧凑按钮组 -->
          <div class="flex items-center gap-0.5 rounded-full bg-white/5 border border-white/10 p-0.5">
            <button
              @click="router.back()"
              title="Back"
              class="flex h-6 w-6 items-center justify-center rounded-full text-primary/60 hover:text-primary hover:bg-white/10 transition-colors"
            >
              <span class="icon-[mdi--chevron-left] h-3.5 w-3.5"></span>
            </button>
            <button
              @click="router.forward()"
              title="Forward"
              class="flex h-6 w-6 items-center justify-center rounded-full text-primary/60 hover:text-primary hover:bg-white/10 transition-colors"
            >
              <span class="icon-[mdi--chevron-right] h-3.5 w-3.5"></span>
            </button>
          </div>
        </div>

        <!-- 快速搜索框 -->
        <div class="pt-3 pb-2 shrink-0">
          <div
            class="flex items-center gap-2 rounded-2xl bg-white/5 px-3 py-2 border border-white/10 text-primary transition-all duration-200 focus-within:border-[#8b5cf6]/60 focus-within:bg-white/10 focus-within:ring-2 focus-within:ring-[#8b5cf6]/20"
          >
            <span class="icon-[mdi--magnify] h-3.5 w-3.5 shrink-0 text-primary/40"></span>
            <input
              v-model="searchQuery"
              @keyup.enter="handleSearch"
              type="text"
              :placeholder="$t('common.search.placeholder')"
              class="w-full bg-transparent text-[11px] font-medium outline-none placeholder:text-primary/35"
            />
            <button
              v-if="searchQuery"
              @click="searchQuery = ''"
              class="text-primary/40 hover:text-primary shrink-0"
            >
              <span class="icon-[mdi--close] h-3 w-3"></span>
            </button>
            <span
              v-else
              class="rounded bg-white/10 px-1 py-0.2 text-[8px] font-semibold text-primary/40"
            >↵</span>
          </div>
        </div>

        <!-- 导航菜单区域 (滚动容器) -->
        <div class="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-0.5 custom-scrollbar pt-1">
          <!-- 滑动指示器 -->
          <div
            ref="indicatorRef"
            class="nav-indicator pointer-events-none absolute right-1.5 left-1.5 rounded-2xl bg-white/10 border border-white/10 opacity-0"
            style="height: 38px; z-index: 0"
          ></div>

          <div ref="navContainerRef">
            <div v-for="sec in sections" :key="sec.titleKey" class="mb-4">
              <h3 class="text-primary/40 mb-1.5 px-2 text-[10px] font-bold tracking-[.18em] uppercase">
                {{ $t(sec.titleKey) }}
              </h3>
              <nav class="relative space-y-0.5">
                <router-link
                  v-for="item in sec.items"
                  :key="item.to"
                  :to="item.to"
                  class="nav-link text-primary/70 hover:text-primary relative z-10 flex items-center space-x-2.5 rounded-2xl px-2.5 py-2 text-xs transition-all duration-200"
                  :class="{
                    'nav-link-active text-primary font-semibold': isActive(item.to),
                    'hover:bg-white/5': !isActive(item.to),
                  }"
                >
                  <span
                    class="h-4.5 w-4.5 transition-transform duration-200"
                    :class="[
                      `icon-[${item.icon}]`,
                      isActive(item.to) ? 'text-[#8b5cf6] drop-shadow-[0_0_8px_rgba(139,92,246,0.8)] scale-110' : ''
                    ]"
                  ></span>
                  <span>{{ $t(item.labelKey) }}</span>
                </router-link>
              </nav>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部主题胶囊切换 -->
      <div class="pt-3 border-t border-white/10 shrink-0">
        <div class="flex items-center justify-between rounded-full p-1 bg-white/5 border border-white/10">
          <button
            v-for="t in themeList"
            :key="t.val"
            @click="globalStore.setTheme(t.val)"
            :class="[
              'flex-1 h-7 rounded-full grid place-items-center text-xs font-semibold transition-all',
              theme === t.val ? 'bg-white/15 text-primary shadow-sm' : 'text-primary/40 hover:text-primary'
            ]"
            :title="t.label"
          >
            <span :class="[t.icon, 'h-3.5 w-3.5']"></span>
          </button>
        </div>
      </div>
      <div class="hidden">
        <span class="icon-[mdi--home] h-5 w-5"></span>
        <span class="icon-[mdi--video] h-5 w-5"></span>
        <span class="icon-[mdi--chart-line] h-5 w-5"></span>
        <span class="icon-[ic--round-search] h-5 w-5"></span>
        <span class="icon-[mdi--music-box-multiple] h-5 w-5"></span>
        <span class="icon-[mdi--heart-outline] h-5 w-5"></span>
        <span class="icon-[mdi--cog] h-5 w-5"></span>
        <span class="icon-[mdi--chevron-right] h-5 w-5"></span>
        <span class="icon-[mdi--account-music] h-5 w-5"></span>
        <span class="icon-[mdi--album] h-5 w-5"></span>
        <span class="icon-[mdi--folder-music-outline] h-5 w-5"></span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* 导航指示器过渡 */
.nav-indicator {
  transition: opacity 0.2s ease;
}

/* 导航链接悬停效果 */
.nav-link {
  position: relative;
}

.nav-link::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 0.5rem;
  background: transparent;
  transition: background 0.2s ease;
}

.nav-link:hover::before {
  background: rgba(255, 255, 255, 0.05);
}

.nav-link-active::before {
  background: transparent;
}
</style>
