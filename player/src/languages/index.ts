import { createI18n } from 'vue-i18n'

import zh from './modules/zh'
import en from './modules/en'
import ja from './modules/ja'

/** 读取浏览器语言（避免经由 @/utils 引入 transformers 造成循环依赖） */
function getBrowserLang(): string {
  const browserLang = (navigator.language || 'en').toLowerCase()
  if (['cn', 'zh', 'zh-cn', 'zh-hans'].includes(browserLang)) return 'zh'
  if (['ja', 'ja-jp'].includes(browserLang)) return 'ja'
  return 'en'
}

function getPersistedLang(): string | undefined {
  try {
    const raw = localStorage.getItem('global')
    if (!raw) return undefined
    const obj = JSON.parse(raw)
    const v = obj?.lang
    return typeof v === 'string' ? v : undefined
  } catch {
    return undefined
  }
}

const initialLocale = getPersistedLang() || getBrowserLang()

const i18n = createI18n({
  allowComposition: true,
  legacy: false,
  locale: initialLocale,
  messages: {
    zh,
    en,
    ja,
  },
  missing: (locale, key) => {
    if (import.meta.env.DEV) {
      console.error(`[i18n] missing message "${key}" for locale "${locale}"`)
      return `[missing:${key}]`
    }
    return key
  },
})

export default i18n
