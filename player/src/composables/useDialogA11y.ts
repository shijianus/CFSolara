import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface DialogA11yOptions {
  /** 弹窗开关 */
  isOpen: Ref<boolean>
  /** 弹窗根容器，需带 tabindex="-1" 以承接初始焦点 */
  containerRef: Ref<HTMLElement | null | undefined>
  /** Esc / 遮罩关闭入口 */
  onClose: () => void
  /** 是否锁定页面滚动，默认 true */
  lockScroll?: boolean
  /** 关闭后是否把焦点还给触发元素，默认 true */
  restoreFocus?: boolean
}

const isVisible = (el: HTMLElement) =>
  !el.hasAttribute('hidden') && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)

/**
 * 为自绘弹窗补齐 dialog 语义所需的交互：
 * Esc 关闭、Tab 焦点陷阱、打开时聚焦容器、关闭后焦点还原、可选滚动锁。
 */
export function useDialogA11y(options: DialogA11yOptions) {
  const { isOpen, containerRef, onClose, lockScroll = true, restoreFocus = true } = options

  let previousFocus: HTMLElement | null = null
  let previousOverflow = ''
  let listening = false

  const getFocusable = () => {
    const root = containerRef.value
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible)
  }

  const handleKeydown = (event: KeyboardEvent) => {
    if (!isOpen.value) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const root = containerRef.value
    if (!root) return
    const focusable = getFocusable()
    if (focusable.length === 0) {
      event.preventDefault()
      root.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement as HTMLElement | null
    const inside = !!active && root.contains(active)

    if (event.shiftKey && (!inside || active === first)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (!inside || active === last)) {
      event.preventDefault()
      first.focus()
    }
  }

  const activate = async () => {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (lockScroll) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    document.addEventListener('keydown', handleKeydown, true)
    listening = true
    await nextTick()
    containerRef.value?.focus()
  }

  const deactivate = () => {
    if (listening) {
      document.removeEventListener('keydown', handleKeydown, true)
      listening = false
    }
    if (lockScroll) document.body.style.overflow = previousOverflow
    if (restoreFocus) {
      const target = previousFocus
      previousFocus = null
      if (target?.isConnected) target.focus()
    }
  }

  watch(
    isOpen,
    async open => {
      if (open) await activate()
      else deactivate()
    }
  )

  onBeforeUnmount(() => {
    if (listening) {
      document.removeEventListener('keydown', handleKeydown, true)
      listening = false
    }
    if (lockScroll) document.body.style.overflow = previousOverflow
  })
}
