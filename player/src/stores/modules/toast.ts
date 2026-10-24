/**
 * 全局反馈 Toast
 * 无第三方 UI 库，供播放错误、音质切换、撤销删除等场景复用
 */
import { defineStore } from 'pinia'
import i18n from '@/languages'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastAction {
  label: string
  handler: () => void | Promise<void>
  primary?: boolean
}

export interface ToastItem {
  id: number
  message: string
  type: ToastType
  duration: number
  actions: ToastAction[]
}

interface ToastOptions {
  message: string
  type?: ToastType
  duration?: number
  actions?: ToastAction[]
}

let nextToastId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export const useToastStore = defineStore('toast', {
  state: () => ({
    toasts: [] as ToastItem[],
  }),

  actions: {
    show(options: ToastOptions | string): number {
      const opts: ToastOptions = typeof options === 'string' ? { message: options } : options
      const id = nextToastId++
      const item: ToastItem = {
        id,
        message: opts.message,
        type: opts.type || 'info',
        duration: opts.duration ?? 4000,
        actions: opts.actions || [],
      }

      this.toasts.push(item)
      // 避免错误风暴堆满屏幕
      while (this.toasts.length > 4) {
        const oldest = this.toasts[0]
        this.dismiss(oldest.id)
      }

      if (item.duration > 0) {
        timers.set(
          id,
          setTimeout(() => this.dismiss(id), item.duration)
        )
      }
      return id
    },

    /** 撤销类反馈：默认 5 秒后自动消失 */
    showUndo(message: string, onUndo: () => void | Promise<void>, duration = 5000): number {
      return this.show({
        message,
        type: 'info',
        duration,
        actions: [
          {
            label: i18n.global.t('common.undo'),
            primary: true,
            handler: onUndo,
          },
        ],
      })
    },

    dismiss(id: number) {
      const timer = timers.get(id)
      if (timer) {
        clearTimeout(timer)
        timers.delete(id)
      }
      this.toasts = this.toasts.filter(t => t.id !== id)
    },

    clear() {
      timers.forEach(timer => clearTimeout(timer))
      timers.clear()
      this.toasts = []
    },
  },
})
