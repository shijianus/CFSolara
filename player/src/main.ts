import { createApp } from 'vue'
import App from './App.vue'

// Global style
import './style/base.scss'
// router
import router from './routers'

// vue i18n
import I18n from '@/languages'

// pinia
import Pinia from '@/stores'

// svg icon
import 'virtual:svg-icons-register'
import { useGlobalStore } from '@/stores/modules/global'
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import { useWindowSize, useDebounceFn, usePreferredDark } from '@vueuse/core'

// 动画指令
import { animationDirectives } from '@/directives/animations'

const app = createApp(App)

app.use(Pinia)
app.use(router)
app.use(I18n)

// 注册全局动画指令
Object.entries(animationDirectives).forEach(([name, directive]) => {
  app.directive(name, directive)
})

app.mount('#app')

const globalStore = useGlobalStore()
const { theme, lang } = storeToRefs(globalStore)
const preferredDark = usePreferredDark()
const applyThemeClass = (t: 'light' | 'dark') => {
  const root = document.documentElement
  if (t === 'dark') {
    root.classList.add('dark')
    root.style.colorScheme = 'dark'
  } else {
    root.classList.remove('dark')
    root.style.colorScheme = 'light'
  }
}
const resolveTheme = (t?: 'light' | 'dark' | 'system') => (t === 'system' ? (preferredDark.value ? 'dark' : 'light') : t || 'dark')
applyThemeClass(resolveTheme(theme.value))
watch([theme, preferredDark], () => applyThemeClass(resolveTheme(theme.value)))

// 动态同步 html lang
const updateHtmlLang = (locale?: string) => {
  const langMap: Record<string, string> = {
    zh: 'zh-CN',
    en: 'en-US',
    ja: 'ja-JP',
  }
  const l = locale || lang.value || 'zh'
  document.documentElement.lang = langMap[l] || l || 'zh-CN'
}
updateHtmlLang(lang.value)
watch(lang, v => updateHtmlLang(v))

const { width } = useWindowSize()
// 16px 下限保证 text-xs(0.75rem) ≥ 12px、正文(1rem) ≥ 16px；
// 同时让 text-sm(0.875rem) 保持在 14px 以上。
const MIN_ROOT_FONT_SIZE = 16
const setRootFontSize = (w: number) => {
  let size: number
  if (w < 768) {
    // < 768px 保持当前公式
    const raw = 13 + (w - 1280) / 960
    size = Math.max(MIN_ROOT_FONT_SIZE, Math.round(raw * 10) / 10)
  } else if (w <= 1280) {
    // 768px 到 1280px 之间平滑线性过渡（768px 保持当前值，1280px 为 15px）
    const val768 = 13 + (768 - 1280) / 960
    const raw = val768 + ((w - 768) / (1280 - 768)) * (15 - val768)
    size = Math.max(MIN_ROOT_FONT_SIZE, Math.round(raw * 10) / 10)
  } else {
    // >= 1280px 保持原公式
    const raw = 15 + (w - 1280) / 960
    size = Math.min(18, Math.max(MIN_ROOT_FONT_SIZE, Math.round(raw * 10) / 10))
  }
  document.documentElement.style.fontSize = `${size}px`
}
setRootFontSize(window.innerWidth)
watch(
  width,
  useDebounceFn(w => setRootFontSize(w), 100)
)
const setLocale = (l?: 'zh' | 'en' | 'ja') => {
  const cur = I18n.global.locale as any
  if (cur && typeof cur === 'object' && 'value' in cur) cur.value = l || cur.value
  else (I18n.global.locale as any) = l || cur

  const langMap: Record<string, string> = {
    zh: 'zh-CN',
    ja: 'ja',
    en: 'en',
  }
  const effectiveLang = l || (typeof cur === 'object' && 'value' in cur ? cur.value : cur) || 'zh'
  if (typeof document !== 'undefined') {
    document.documentElement.lang = langMap[effectiveLang] || 'zh-CN'
  }
}
setLocale(lang.value || 'zh')
watch(lang, (l) => setLocale(l))
