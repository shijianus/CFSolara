<script setup lang="ts">
import { onMounted } from 'vue'
import DownloadQualityDialog from '@/components/Dialog/DownloadQualityDialog.vue'
import GlobalToast from '@/components/Ui/GlobalToast.vue'

onMounted(() => {
  try {
    const isPerf = localStorage.getItem('sonic-perf-mode') === 'true'
    if (isPerf) {
      document.documentElement.classList.add('perf-mode')
    }
  } catch (_) {}
})
</script>

<template>
  <RouterView />
  <DownloadQualityDialog />
  <GlobalToast />
</template>
