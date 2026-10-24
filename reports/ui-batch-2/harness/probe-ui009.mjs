// UI-009 探针:打开音质菜单,枚举菜单项,真实点击后监听 audio 事件与网络
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 9222
const BASE = 'http://127.0.0.1:5090'

const target = await (
  await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
let nextId = 1
const pending = new Map()
const eventWaiters = new Map()
ws.addEventListener('message', event => {
  const msg = JSON.parse(event.data)
  if (msg.id) {
    const waiter = pending.get(msg.id)
    if (!waiter) return
    pending.delete(msg.id)
    if (msg.error) waiter.reject(new Error(msg.error.message))
    else waiter.resolve(msg.result)
    return
  }
  const waiters = eventWaiters.get(msg.method)
  if (waiters?.length) waiters.shift()(msg.params)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
const waitEvent = (method, timeout = 15000) =>
  new Promise((resolve, reject) => {
    const list = eventWaiters.get(method) || []
    list.push(resolve)
    eventWaiters.set(method, list)
    setTimeout(() => reject(new Error('timeout ' + method)), timeout)
  })
const evaluate = async (fn, arg) => {
  const res = await send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text)
  return res.result.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const goto = async (route, wait = 1800) => {
  await send('Page.navigate', { url: `${BASE}/?s=${Date.now()}#${route}` })
  await waitEvent('Page.loadEventFired').catch(() => {})
  await sleep(wait)
}
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(600)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
const netEvents = []
const collectNet = () => {
  // Network events are delivered asynchronously; we just collect requestWillBeSent below via waitEvent loop
}
await goto('/', 1000)
await evaluate(() => {
  localStorage.clear()
  localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' }))
})
await goto('/playlist/1', 2000)
// 单击播放第 3 首(999999)
await evaluate(() => {
  const row = [...document.querySelectorAll('.song-item')].find(r => (r.textContent || '').includes('测试歌曲 3'))
  row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(2500)

// 打开音质菜单
await evaluate(() => document.querySelector('#footer-quality-btn')?.click())
await sleep(1200)
const menu = await evaluate(() =>
  [...document.querySelectorAll('button, [role="menuitem"], li')].map(b => ({
    text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    tag: b.tagName,
    rect: (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }))(b.getBoundingClientRect()),
  })).filter(b => b.text.includes('无损') || b.text.includes('标准') || b.text.includes('HQ'))
)
console.log('MENU ITEMS:', JSON.stringify(menu, null, 1))

// 监听 audio 错误与网络
await evaluate(() => {
  window.__net = []
  const origFetch = window.fetch
  window.fetch = (...args) => {
    window.__net.push(String(args[0]).slice(0, 120))
    return origFetch(...args)
  }
  const player = document.querySelector('#audioPlayer')
  ;['error', 'emptied', 'stalled'].forEach(ev =>
    player?.addEventListener(ev, () => window.__net.push(`audio:${ev}:${(player.src || '').slice(-60)}`))
  )
})

// 真实点击菜单中的 SQ 无损
const item = menu.find(b => b.text.includes('无损') && b.width > 0)
if (item) {
  await clickAt(item.x + item.width / 2, item.y + item.height / 2)
}
await sleep(6000)
const result = await evaluate(() => ({
  net: window.__net,
  src: document.querySelector('#audioPlayer')?.src,
  toasts: [...document.querySelectorAll('[role="alert"],[role="status"]')].map(e => e.innerText),
  menuStill: document.body.innerText.includes('SQ 无损'),
}))
console.log('RESULT:', JSON.stringify(result, null, 1))

// 收集 CDP 网络请求
for (let i = 0; i < 1; i++) {
  try {
    const ev = await waitEvent('Network.requestWillBeSent', 100)
    netEvents.push(ev.request.url)
  } catch {}
}
ws.close()
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {})
process.exit(0)
