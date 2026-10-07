<script setup lang="ts">
import { useUserStore } from '@/stores/modules/user'
import { useGlobalStore } from '@/stores/modules/global'
import { storeToRefs } from 'pinia'
import { gsap } from 'gsap'

const route = useRoute()
const globalStore = useGlobalStore()
const { theme } = storeToRefs(globalStore)

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
  <aside class="hidden w-64 shrink-0 p-4 py-0 lg:block">
    <div class="glass-card relative flex h-full flex-col justify-between rounded-[28px] p-4">
      <div>
        <!-- 滑动指示器 -->
        <div
          ref="indicatorRef"
          class="nav-indicator pointer-events-none absolute right-2 left-2 rounded-2xl bg-white/10 border border-white/10 opacity-0"
          style="height: 40px; z-index: 0"
        ></div>

        <div ref="navContainerRef">
          <div v-for="sec in sections" :key="sec.titleKey" class="mb-5">
            <h3 class="text-primary/45 mb-2.5 px-2 text-[10px] font-bold tracking-[.18em] uppercase">
              {{ $t(sec.titleKey) }}
            </h3>
            <nav class="relative space-y-1">
              <router-link
                v-for="item in sec.items"
                :key="item.to"
                :to="item.to"
                class="nav-link text-primary/70 hover:text-primary relative z-10 flex items-center space-x-3 rounded-2xl p-2.5 transition-all duration-200"
                :class="{
                  'nav-link-active text-primary font-semibold': isActive(item.to),
                  'hover:bg-white/5': !isActive(item.to),
                }"
              >
                <span
                  class="h-5 w-5 transition-transform duration-200"
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

      <!-- 底部主题胶囊切换 -->
      <div class="pt-3 border-t border-white/10">
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
            <span :class="[t.icon, 'h-4 w-4']"></span>
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
