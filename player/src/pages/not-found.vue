<script setup lang="ts">
import { useRouter } from 'vue-router'
import Button from '@/components/Ui/Button.vue'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const { t } = useI18n()

const goBack = () => {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}
</script>

<template>
  <div class="flex h-full w-full flex-col items-center justify-center p-6 text-center select-none">
    <div class="relative mb-6 flex h-32 w-32 items-center justify-center">
      <div class="absolute inset-0 rounded-full bg-linear-to-tr from-[#2563eb]/30 via-[#38bdf8]/20 to-transparent blur-2xl animate-pulse"></div>
      <span class="icon-[mdi--music-off] relative h-20 w-20 text-primary/40"></span>
    </div>
    
    <h1 class="text-4xl font-extrabold tracking-tight text-primary md:text-5xl">404</h1>
    <p class="mt-2 text-base font-semibold text-primary/80">页面走丢了，音符飘散在宇宙中</p>
    <p class="mt-1 max-w-md text-xs text-primary/50 leading-relaxed">
      您访问的链接可能已失效、不存在或已被迁移。您可以返回首页探索更多音乐，或使用搜索查找曲目。
    </p>

    <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
      <Button
        variant="gradient"
        size="md"
        rounded="full"
        class="gap-2 px-6 shadow-lg shadow-blue-500/20"
        @click="router.push('/')"
      >
        <span class="icon-[mdi--home] h-4 w-4"></span>
        返回首页
      </Button>
      <Button
        variant="glass"
        size="md"
        rounded="full"
        class="gap-2 px-5"
        @click="goBack"
      >
        <span class="icon-[mdi--arrow-left] h-4 w-4"></span>
        返回上一页
      </Button>
      <Button
        variant="ghost"
        size="md"
        rounded="full"
        class="gap-2 px-4"
        @click="router.push('/search')"
      >
        <span class="icon-[mdi--magnify] h-4 w-4"></span>
        去搜索
      </Button>
    </div>
  </div>
</template>
