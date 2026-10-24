/**
 * 时间与数字格式化工具
 * 提供歌曲时长、播放次数、日期等格式化方法
 * 所有面向界面的数字与日期均通过 Intl 格式化，并跟随当前界面语言
 */
import i18n from '@/languages'

/** 读取当前 vue-i18n locale，兼容 composition / legacy 两种模式 */
const getLocale = (): string => {
  const locale = i18n.global.locale as unknown
  if (locale && typeof locale === 'object' && 'value' in locale) {
    return String((locale as { value: string }).value)
  }
  return String(locale || 'zh')
}

/**
 * 格式化歌曲时长（毫秒 → m:ss）
 * @param ms - 毫秒数
 * @returns 格式化后的时间字符串，如 "3:05"
 */
export const formatDuration = (ms: number) => {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * 格式化歌曲时长（毫秒 → m:ss），时长缺失时返回占位符 "--:--"
 */
export const formatDurationOrDash = (ms?: number) => {
  if (!ms || ms <= 0 || !Number.isFinite(ms)) return '--:--'
  return formatDuration(ms)
}

/**
 * 使用 Intl.NumberFormat 格式化普通数字（千分位等，跟随当前语言）
 */
export const formatNumber = (value: number | string) => {
  const num = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(num)) return String(value)
  return new Intl.NumberFormat(getLocale()).format(num)
}

/**
 * 格式化播放次数等大数字（Intl compact notation，自动使用 万/亿、K/M 等）
 * @param count - 数字或字符串
 * @returns 格式化后的字符串，如 "3.2万"、"1.5M"
 */
export const formatCount = (count: number | string) => {
  const num = typeof count === 'string' ? Number(count) : count
  if (!Number.isFinite(num)) return String(count)
  if (Math.abs(num) < 1000) return new Intl.NumberFormat(getLocale()).format(num)
  return new Intl.NumberFormat(getLocale(), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(num)
}

/**
 * 格式化时间戳：1 小时内使用相对时间，超过 24 小时使用本地化日期
 * @param time 时间戳（毫秒）
 * @returns 格式化后的时间字符串
 */
export const formatDate = (time: number) => {
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return ''

  const locale = getLocale()
  const diff = Date.now() - date.getTime()

  if (diff < 60000) {
    return i18n.global.t('common.justNow')
  }

  if (diff < 3600000) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }).format(
      -Math.floor(diff / 60000),
      'minute'
    )
  }

  if (diff < 86400000) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }).format(
      -Math.floor(diff / 3600000),
      'hour'
    )
  }

  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(
    locale,
    sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' }
  ).format(date)
}

/**
 * 本地化长日期（用于评论、发行日期等需要完整年份的场景）
 */
export const formatDateLong = (value: number | string | Date) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * 本地化日期 + 时间
 */
export const formatDateTime = (value: number | string | Date) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
