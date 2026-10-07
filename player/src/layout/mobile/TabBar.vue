<script setup lang="ts">
import MiniPlayerMobile from '@/components/Mobile/MiniPlayerMobile.vue'

import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const items = [
  { to: '/', icon: 'icon-[mdi--home]', labelKey: 'layout.nav.home' },
  { to: '/search', icon: 'icon-[mdi--magnify]', labelKey: 'common.search.label' },
  { to: '/recent', icon: 'icon-[mdi--music-circle-outline]', labelKey: 'layout.nav.myMusic' },
  { to: '/settings', icon: 'icon-[mdi--cog-outline]', labelKey: 'layout.aside.menu.settings' },
]

const emit = defineEmits(['show-player'])

const tabbarRef = useTemplateRef('tabbarRef')
let ro: ResizeObserver | null = null
const updateTabbarHeight = () => {
  const h = tabbarRef.value?.offsetHeight ?? 0
  document.documentElement.style.setProperty('--mobile-tabbar-h', `${h}px`)
}
onMounted(() => {
  updateTabbarHeight()
  if (tabbarRef.value) {
    ro = new ResizeObserver(updateTabbarHeight)
    ro.observe(tabbarRef.value)
  }
  window.addEventListener('resize', updateTabbarHeight)
})
onUnmounted(() => {
  ro?.disconnect()
  ro = null
  window.removeEventListener('resize', updateTabbarHeight)
})
</script>

<template>
  <MiniPlayerMobile @open="emit('show-player')" />

  <nav ref="tabbarRef" class="fixed left-3 right-3 bottom-3 z-50 rounded-[26px] glass-container-strong border border-white/15 px-2 py-1 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.5)]">
    <div class="mx-auto flex items-center justify-around">
      <RouterLink
        v-for="it in items"
        :key="it.to"
        :to="it.to"
        class="relative flex flex-1 flex-col items-center justify-center py-2 text-[11px] font-semibold transition-all duration-200"
        :class="$route.path === it.to || ($route.path.startsWith(it.to) && it.to !== '/') ? 'text-primary' : 'text-primary/50 hover:text-primary/80'"
      >
        <div
          v-if="$route.path === it.to || ($route.path.startsWith(it.to) && it.to !== '/')"
          class="absolute inset-0 rounded-2xl bg-white/10 border border-white/10"
        ></div>
        <component
          :is="'span'"
          :class="[
            it.icon,
            'relative mb-1 h-5 w-5 transition-transform',
            ($route.path === it.to || ($route.path.startsWith(it.to) && it.to !== '/')) && 'text-[#8b5cf6] drop-shadow-[0_0_8px_rgba(139,92,246,0.8)] scale-110'
          ]"
        />
        <span class="relative">{{ t(it.labelKey) }}</span>
      </RouterLink>
    </div>
  </nav>
</template>
