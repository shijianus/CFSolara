<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import GlassSelect from '@/components/Ui/GlassSelect.vue'
import GlassCheckbox from '@/components/Ui/GlassCheckbox.vue'
import { useSettingsStore } from '@/stores/modules/settings'
import { useGlobalStore } from '@/stores/modules/global'
import I18n from '@/languages'
import { useI18n } from 'vue-i18n'
import {
  getBackgroundOptions,
  getThemeOptions,
  getLangOptions,
  getShowHideOptions,
  getAudioQualityOptions,
  getVisualizerTypeOptions,
} from '@/config/settingsOptions'

// 动态导入背景设置面板组件,只在需要时加载
const AuroraSettingsPanel = defineAsyncComponent(
  () => import('@/components/Background/AuroraSettingsPanel.vue')
)
const ColorBendsSettingsPanel = defineAsyncComponent(
  () => import('@/components/Background/ColorBendsSettingsPanel.vue')
)
const UltimateSettingsPanel = defineAsyncComponent(
  () => import('@/components/Background/UltimateSettingsPanel.vue')
)
const ShadowBlingSettingsPanel = defineAsyncComponent(
  () => import('@/components/Background/ShadowBlingSettingsPanel.vue')
)
const settings = useSettingsStore()
const { backgroundType, footerLyrics, audioQuality, audioVisualizer } = storeToRefs(settings)
const globalStore = useGlobalStore()
const { theme, lang } = storeToRefs(globalStore)
const { t } = useI18n()
const bgOptions = computed(() => getBackgroundOptions(t))
const themeOptions = computed(() => getThemeOptions(t))
const langOptions = computed(() => getLangOptions(t))
const qualityOptions = computed(() => getAudioQualityOptions(t))
const visualizerTypeOptions = computed(() => getVisualizerTypeOptions(t))
const initialLocale = (() => {
  const cur = I18n.global.locale
  return typeof cur === 'object' && 'value' in cur ? (cur as any).value : (cur as any)
})()
if (!lang.value) lang.value = initialLocale || 'zh'
watch(lang, v => {
  const cur = I18n.global.locale
  if (typeof cur === 'object' && 'value' in cur) cur.value = v || 'zh'
  else I18n.global.locale = v || 'zh'
})
const state = reactive({ isPageLoading: false })

const toggleMode = (mode: 'original' | 'trans' | 'roma', checked: boolean) => {
  const modes = new Set(footerLyrics.value.modes)
  if (checked) {
    modes.add(mode)
    const arr = Array.from(modes).slice(0, 2)
    settings.setFooterLyricsModes(arr as Array<'original' | 'trans' | 'roma'>)
  } else {
    modes.delete(mode)
    const arr = Array.from(modes)
    settings.setFooterLyricsModes(arr as Array<'original' | 'trans' | 'roma'>)
  }
}

const originalChecked = computed({
  get: () => footerLyrics.value.modes.includes('original'),
  set: v => toggleMode('original', v as boolean),
})
const transChecked = computed({
  get: () => footerLyrics.value.modes.includes('trans'),
  set: v => toggleMode('trans', v as boolean),
})
const romaChecked = computed({
  get: () => footerLyrics.value.modes.includes('roma'),
  set: v => toggleMode('roma', v as boolean),
})

// 性能优先模式（关闭高斯模糊与背景流光特效）
const isPerformanceMode = ref(false)

const loadPerformanceMode = () => {
  try {
    isPerformanceMode.value = localStorage.getItem('sonic-perf-mode') === 'true'
  } catch (_) {}
}

const togglePerformanceMode = () => {
  const nextVal = !isPerformanceMode.value
  isPerformanceMode.value = nextVal
  try {
    localStorage.setItem('sonic-perf-mode', String(nextVal))
  } catch (_) {}
  document.documentElement.classList.toggle('perf-mode', nextVal)
}

const prefetchBackground = (bgKey: string) => {
  if (bgKey === 'colorbends') {
    import('@/components/Background/ColorBends.vue')
  } else if (bgKey === 'aurora') {
    import('@/components/Background/Aurora.vue')
  } else if (bgKey === 'shadowBling') {
    import('@/components/Background/ShadowBling.vue')
  } else if (bgKey === 'ultimate') {
    import('@/components/Background/Ultimate.vue')
  }
}

onMounted(() => {
  loadPerformanceMode()
})
</script>

<template>
  <div class="h-full w-full overflow-auto p-6">
    <PageSkeleton v-if="state.isPageLoading" :sections="['list']" :list-count="6" />
    <div v-else>
      <div class="mb-8">
        <h1 class="text-primary text-2xl font-bold">{{ t('components.settings.title') }}</h1>
        <p class="text-primary/50 mt-1 text-sm">{{ t('components.settings.desc') }}</p>
      </div>

      <div class="grid grid-cols-2 gap-6">
        <div class="glass-card space-y-5 rounded-2xl p-5">
          <div class="flex items-center gap-3 border-b border-white/10 pb-4">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 to-blue-600"
            >
              <span class="icon-[mdi--palette-outline] h-5 w-5 text-white" />
            </div>
            <div>
              <h3 class="text-primary text-sm font-semibold">
                {{ t('components.settings.themeMode') }}
              </h3>
              <p class="text-primary/50 text-xs">{{ t('components.settings.themeModeDesc') }}</p>
            </div>
          </div>
          <GlassSelect v-model="theme" :options="themeOptions" />
        </div>

        <div class="glass-card space-y-5 rounded-2xl p-5">
          <div class="flex items-center gap-3 border-b border-white/10 pb-4">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 to-cyan-600"
            >
              <span class="icon-[mdi--translate] h-5 w-5 text-white" />
            </div>
            <div>
              <h3 class="text-primary text-sm font-semibold">
                {{ t('components.settings.uiLanguage') }}
              </h3>
              <p class="text-primary/50 text-xs">{{ t('components.settings.uiLanguageDesc') }}</p>
            </div>
          </div>
          <GlassSelect v-model="lang" :options="langOptions" />
        </div>

        <div class="glass-card space-y-5 rounded-2xl p-5">
          <div class="flex items-center gap-3 border-b border-white/10 pb-4">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-sky-500 to-blue-600"
            >
              <span class="icon-[mdi--image-filter-hdr] h-5 w-5 text-white" />
            </div>
            <div>
              <h3 class="text-primary text-sm font-semibold">
                {{ t('components.settings.backgroundType') }}
              </h3>
              <p class="text-primary/50 text-xs">
                {{ t('components.settings.backgroundTypeDesc') }}
              </p>
            </div>
          </div>
          <GlassSelect
            v-model="backgroundType"
            :options="bgOptions"
            @hover-option="prefetchBackground"
          />
        </div>

        <div class="glass-card space-y-5 rounded-2xl p-5">
          <div class="flex items-center gap-3 border-b border-white/10 pb-4">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-cyan-500 to-blue-600"
            >
              <span class="icon-[mdi--music-circle] h-5 w-5 text-white" />
            </div>
            <div>
              <h3 class="text-primary text-sm font-semibold">
                {{ t('components.settings.audioQuality.title') }}
              </h3>
              <p class="text-primary/50 text-xs">{{ t('components.settings.audioQuality.desc') }}</p>
            </div>
          </div>
          <GlassSelect v-model="audioQuality" :options="qualityOptions" />
        </div>

        <div class="glass-card space-y-5 rounded-2xl p-5">
          <div class="flex items-center gap-3 border-b border-white/10 pb-4">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-sky-500 to-blue-600"
            >
              <span class="icon-[mdi--subtitles-outline] h-5 w-5 text-white" />
            </div>
            <div>
              <h3 class="text-primary text-sm font-semibold">
                {{ t('components.settings.footerLyricsTitle') }}
              </h3>
              <p class="text-primary/50 text-xs">{{ t('components.settings.footerLyricsDesc') }}</p>
            </div>
          </div>
          <div class="space-y-4">
            <div class="flex items-center justify-between gap-2">
              <span class="text-primary/70 text-xs text-nowrap"
                >{{ t('common.show') }}/{{ t('common.hide') }}</span
              >
              <GlassSelect
                :options="getShowHideOptions(t)"
                v-model="footerLyrics.enabled"
                class="w-32"
              />
            </div>
            <div>
              <span class="text-primary/70 mb-2 block text-xs">{{
                t('components.settings.footerLyricsModes')
              }}</span>
              <div class="text-primary/80 flex flex-wrap gap-3">
                <GlassCheckbox v-model="originalChecked" :label="t('common.original')" />
                <GlassCheckbox v-model="transChecked" :label="t('common.trans')" />
                <GlassCheckbox v-model="romaChecked" :label="t('common.roma')" />
              </div>
            </div>
          </div>
        </div>

        <div class="glass-card space-y-5 rounded-2xl p-5">
          <div class="flex items-center gap-3 border-b border-white/10 pb-4">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-cyan-500 to-blue-600"
            >
              <span class="icon-[mdi--waveform] h-5 w-5 text-white" />
            </div>
            <div>
              <h3 class="text-primary text-sm font-semibold">
                {{ t('components.settings.audioVisualizer.title') }}
              </h3>
              <p class="text-primary/50 text-xs">{{ t('components.settings.audioVisualizer.desc') }}</p>
            </div>
          </div>
          <div class="space-y-4">
            <div class="flex items-center justify-between gap-2">
              <span class="text-primary/70 text-xs text-nowrap">{{
                t('components.settings.audioVisualizer.footer')
              }}</span>
              <GlassSelect
                :options="getShowHideOptions(t)"
                v-model="audioVisualizer.enabledInFooter"
                class="w-32"
              />
            </div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-primary/70 text-xs text-nowrap">{{
                t('components.settings.audioVisualizer.drawer')
              }}</span>
              <GlassSelect
                :options="getShowHideOptions(t)"
                v-model="audioVisualizer.enabledInDrawer"
                class="w-32"
              />
            </div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-primary/70 text-xs text-nowrap">{{
                t('components.settings.audioVisualizer.type')
              }}</span>
              <GlassSelect
                :options="visualizerTypeOptions"
                v-model="audioVisualizer.visualizerType"
                class="w-32"
              />
            </div>
          </div>
        </div>

        <!-- 性能优先模式 (Performance Mode) -->
        <div class="glass-card space-y-5 rounded-2xl p-5">
          <div class="flex items-center justify-between border-b border-white/10 pb-4">
            <div class="flex items-center gap-3">
              <div
                class="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-cyan-500 to-blue-600"
              >
                <span class="icon-[mdi--speedometer] h-5 w-5 text-white" />
              </div>
              <div>
                <h3 class="text-primary text-sm font-semibold">
                  性能优先模式
                </h3>
                <p class="text-primary/50 text-xs">
                  关闭毛玻璃高斯模糊与背景流光特效，降低低配设备 CPU/GPU 负载
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="isPerformanceMode"
              :aria-label="t('components.settings.performanceMode')"
              @click="togglePerformanceMode"
              class="relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50"
            >
              <span
                class="relative inline-flex h-6 w-11 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out"
                :class="isPerformanceMode ? 'bg-sky-500' : 'bg-white/20'"
              >
                <span
                  class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out"
                  :class="isPerformanceMode ? 'translate-x-5' : 'translate-x-0'"
                />
              </span>
            </button>
          </div>
          <div class="text-primary/60 text-xs">
            当前状态：<span :class="isPerformanceMode ? 'text-sky-400 font-bold' : 'text-primary/80 font-medium'">{{ isPerformanceMode ? '已开启 (零模糊高帧率)' : '标准模式 (全特效玻璃质感)' }}</span>
          </div>
        </div>
      </div>

      <div class="mt-6">
        <component
          :is="
            backgroundType === 'colorbends'
              ? ColorBendsSettingsPanel
              : backgroundType === 'aurora'
                ? AuroraSettingsPanel
                : backgroundType === 'shadowBling'
                  ? ShadowBlingSettingsPanel
                  : UltimateSettingsPanel
          "
        />
      </div>
    </div>
  </div>
</template>
