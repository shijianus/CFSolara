<script setup lang="ts">
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

    <!-- 主工作区：几何对齐的 Studio 架构 (全组件限制在统一上下区间 [Y_top, Y_bottom] 内) -->
    <div class="z-50 flex h-full w-full p-3 sm:p-4 gap-3 sm:gap-4 overflow-hidden">
      <!-- 左侧边栏：单独占用左边所有空间，严格限制在上下区间内 -->
      <Aside />

      <!-- 右侧主区域：内容画板贯通至底缘 + 底部悬浮控制 Dock，与左侧边栏上下区间严格同步 -->
      <div class="relative flex flex-1 h-full min-h-0 min-w-0 overflow-hidden">
        <!-- 主内容区域：隐式限制框（限制框依然存在，但移除显式深色边框与阴影，保持尺寸与上下区间约束） -->
        <main class="relative flex-1 h-full min-h-0 w-full overflow-hidden">
          <router-view v-slot="{ Component }">
            <transition appear name="fade-transform" mode="out-in">
              <keep-alive>
                <component :is="Component" />
              </keep-alive>
            </transition>
          </router-view>
        </main>

        <!-- 底部磨砂玻璃柔和糊化与衰减过渡层 (Frosted Blur-Out Gradient Transition) -->
        <!-- 该层使向下流动的网格卡片在接近 Footer 处柔和糊化、向下渐变消失（若隐若现），不遮挡其色彩向 Footer 渗透 -->
        <div
          class="pointer-events-none absolute bottom-0 left-0 right-0 h-32 sm:h-36 z-10 overflow-hidden backdrop-blur-md"
          style="mask-image: linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.4) 35%, black 100%); -webkit-mask-image: linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.4) 35%, black 100%);"
        ></div>

        <!-- 底部播放栏：悬浮停靠在右侧底部，与左侧边栏底缘绝对齐平 -->
        <div class="pointer-events-none absolute bottom-0 left-0 right-0 z-20">
          <Footer @show="openPlayerDrawer" class="pointer-events-auto" />
        </div>

        <!-- 播放器全屏抽屉 -->
        <PlayerDrawer v-model="isDrawerOpen" />
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
