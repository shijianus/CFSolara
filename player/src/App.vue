<script setup lang="ts">
import { onMounted } from 'vue'
import DownloadQualityDialog from '@/components/Dialog/DownloadQualityDialog.vue'

onMounted(() => {
  try {
    const raw = localStorage.getItem('settings')
    if (raw && JSON.parse(raw).performanceMode) {
      document.documentElement.classList.add('perf-mode')
    }
  } catch (_) {}
})
</script>

<template>
  <RouterView />
  <DownloadQualityDialog />
</template>
