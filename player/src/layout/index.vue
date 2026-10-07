<script setup lang="ts">
import Header from './header.vue'
import Aside from './aside.vue'
import Footer from './footer.vue'

import Aurora from '@/components/Background/Aurora.vue'
import ColorBends from '@/components/Background/ColorBends.vue'
import Ultimate from '@/components/Background/Ultimate.vue'
import ShadowBling from '@/components/Background/ShadowBling.vue'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import type { Component } from 'vue'
import { useSettingsStore } from '@/stores/modules/settings'

const settings = useSettingsStore()
const { aurora, colorBends, ultimate, shadowBling, backgroundType } = storeToRefs(settings)

// 抽屉状态
const state = reactive({
  // 播放器抽屉是否打开
  isDrawerOpen: false,
})
const { isDrawerOpen } = toRefs(state)

const colorStops = computed(() => {
  const stops = (aurora.value.colorStops || []).slice(0, 3)
  return stops.map((s: string) => (s.startsWith('#') ? s : `#${s}`))
})

const positions = computed(() => {
  const p = aurora.value.colorPositions || [0, 0.5, 1]
  return [p[0] ?? 0, p[1] ?? 0.5, p[2] ?? 1]
})

const openPlayerDrawer = () => {
  state.isDrawerOpen = true
}

type BackgroundType = 'colorbends' | 'ultimate' | 'aurora' | 'shadowBling'

const backgroundComponents: Record<BackgroundType, Component> = {
  colorbends: ColorBends,
  ultimate: Ultimate,
  aurora: Aurora,
  shadowBling: ShadowBling,
}

const backgroundPropsMap = computed<Record<BackgroundType, any>>(() => ({
  colorbends: colorBends.value,
  ultimate: ultimate.value,
  aurora: {
    ...aurora.value,
    colorPositions: positions.value,
    colorStops: colorStops.value,
  },
  shadowBling: shadowBling.value,
}))

const currentBackgroundType = computed<BackgroundType>(() => backgroundType.value as BackgroundType)

const currentBackgroundComponent = computed<Component>(
  () => backgroundComponents[currentBackgroundType.value]
)
const currentBackgroundProps = computed(() => backgroundPropsMap.value[currentBackgroundType.value])
</script>

<template>
  <div class="relative flex h-full w-full overflow-hidden">
    <div class="custom-theme absolute inset-0 h-full w-full">
      <component
        :is="currentBackgroundComponent"
        v-bind="currentBackgroundProps"
        class="h-full w-full"
      />
    </div>

    <!-- Sonic 风格氛围光晕流光层 (Ambient Glowing Drift Blobs) -->
    <div class="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden="true">
      <div class="absolute -top-[15%] -left-[10%] size-[65vmax] rounded-full blur-[110px] animate-drift-a opacity-35 dark:opacity-40" style="background: #8b5cf6;"></div>
      <div class="absolute -bottom-[20%] -right-[15%] size-[60vmax] rounded-full blur-[120px] animate-drift-b opacity-30 dark:opacity-35" style="background: #ec4899;"></div>
      <div class="absolute top-[30%] left-[35%] size-[38vmax] rounded-full blur-[100px] animate-drift-c opacity-20 dark:opacity-25" style="background: #3b82f6;"></div>
    </div>

    <!-- 主容器 -->
    <div class="z-50 flex h-full w-full flex-col px-2 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-2 sm:py-4 md:py-6 max-w-[1800px] mx-auto">
      <div
        class="glass-container flex flex-1 flex-col overflow-hidden backdrop-blur-xl backdrop-filter"
      >
        <!-- 头部区域 -->
        <Header />
        <!-- 主内容区域 -->
        <main class="flex h-full overflow-x-hidden">
          <!-- 左侧边栏 -->
          <Aside />
          <!-- 右侧主内容 -->
          <router-view v-slot="{ Component }">
            <transition appear name="fade-transform" mode="out-in">
              <keep-alive>
                <component :is="Component" />
              </keep-alive>
            </transition>
          </router-view>
          <!-- 播放器抽屉 -->
          <PlayerDrawer v-model="isDrawerOpen" />
        </main>
        <Footer @show="openPlayerDrawer" />
      </div>
    </div>
  </div>
</template>
<style>
.fade-transform-enter-active,
.fade-transform-leave-active {
  transition: all 0.3s ease;
}

.fade-transform-enter-from {
  opacity: 0;
  transform: translateX(-20px);
}

.fade-transform-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
