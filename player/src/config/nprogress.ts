import NProgress from 'nprogress'
import 'nprogress/nprogress.css'

NProgress.configure({
  easing: 'ease', // 动画方式
  speed: 500, // 递增进度条的速度
  showSpinner: false, // 纯进度条，避免额外的 role 节点
  trickleSpeed: 200, // 自动递增间隔
  minimum: 0.3, // 初始化时的最小百分比
})

// NProgress 自带 role="bar" 不是合法 ARIA role，且加载条属于装饰性动画；
// 将其从无障碍树中隐藏，避免屏幕阅读器播报无意义节点。
const hideProgressFromA11y = () => {
  if (typeof document === 'undefined') return
  const el = document.getElementById('nprogress')
  el?.setAttribute('aria-hidden', 'true')
}
if (typeof document !== 'undefined') {
  const startObserving = () => {
    hideProgressFromA11y()
    new MutationObserver(hideProgressFromA11y).observe(document.body, {
      childList: true,
      subtree: true,
    })
  }
  if (document.body) startObserving()
  else document.addEventListener('DOMContentLoaded', startObserving, { once: true })
}

export default NProgress
