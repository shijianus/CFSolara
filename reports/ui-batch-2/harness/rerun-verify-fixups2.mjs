// UI-009 / UI-011 最终修正重跑
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 9222
const BASE = 'http://127.0.0.1:5090'
const OUT = path.resolve(__dirname, '../../../reports/final/rerun/batch-2-verify/shots')

const results = []
const record = (id, method, pass, detail, shots) => {
  results.push({ id, method, result: pass ? '通过' : '失败', detail, shots })
  console.log(`${pass ? '✅' : '❌'} ${id} ${detail}`)
}

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
const setViewport = (width, height, mobile = false) =>
  send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height })
const goto = async (route, wait = 1800) => {
  await send('Page.navigate', { url: `${BASE}/?s=${Date.now()}#${route}` })
  await waitEvent('Page.loadEventFired').catch(() => {})
  await sleep(wait)
}
const shot = async name => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  const file = path.join(OUT, `${name}.png`)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}
const clickTrusted = async (text, { exact = false, tag = 'button' } = {}) => {
  const point = await evaluate(
    ({ text, exact, tag }) => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim()
      const el = [...document.querySelectorAll(tag)].find(n =>
        exact ? norm(n.textContent) === text : norm(n.textContent).includes(text)
      )
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    },
    { text, exact, tag }
  )
  if (!point) return false
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(600)
  return true
}
const clickTitle = async label => {
  const point = await evaluate(l => {
    const el = document.querySelector(`button[title="${l}"]`) || document.querySelector(`button[aria-label="${l}"]`)
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, label)
  if (!point) return false
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(600)
  return true
}
const clickRow = async name => {
  const ok = await evaluate(n => {
    const row = [...document.querySelectorAll('.song-item')].find(r => (r.textContent || '').includes(n))
    if (!row) return false
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  }, name)
  await sleep(2500)
  return ok
}
const clearAudio = () => evaluate(() => localStorage.removeItem('audio'))
const playerState = () =>
  evaluate(() => {
    const audio = JSON.parse(localStorage.getItem('audio') || 'null')?.audio || null
    const player = document.querySelector('#audioPlayer')
    return {
      toasts: [...document.querySelectorAll('[role="alert"],[role="status"]')].map(e => e.innerText).filter(Boolean),
      paused: player ? player.paused : null,
      src: player ? player.src : '',
      current: audio?.currentSong || null,
      queue: audio?.playlist?.length ?? null,
    }
  })
const waitForToast = async (needle, timeoutMs = 9000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const t = await playerState()
    if (t.toasts.some(x => x.includes(needle))) return t
    await sleep(500)
  }
  return playerState()
}

await send('Page.enable')
await send('Runtime.enable')
await setViewport(1440, 900)
await goto('/', 1000)
await evaluate(() => {
  localStorage.clear()
  localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' }))
})

// ── UI-009:播放 999999(128 可播)→ 切 HQ 极高(320 档 mock 403)→ 失败回滚 ──
{
  await clearAudio()
  await goto('/playlist/1', 2000)
  await clickRow('测试歌曲 3')
  await sleep(1500)
  await evaluate(() => document.querySelector('#footer-quality-btn')?.click())
  await sleep(1500)
  await clickTrusted('HQ 极高')
  const st = await waitForToast('音质切换失败', 9000)
  const srcOk = st.src.includes('br=128')
  const menuOpen = await evaluate(() => document.body.innerText.includes('标准') && document.body.innerText.includes('MP3 · 277'))
  await shot('ui009-quality-rollback')
  record(
    'UI-009',
    'mock 曲目 999999:HQ 极高(320)档必 403,底栏切音质',
    st.toasts.some(x => x.includes('音质切换失败')) && srcOk,
    `toast="${st.toasts.join(' | ').slice(0, 50)}";src 仍 br=128=${srcOk};菜单保持打开=${menuOpen}`,
    ['ui009-quality-rollback.png']
  )
}

// ── UI-011:收藏(图标按钮,按 title)→ 关注(文本按钮)→ 喜欢 → 刷新 → 喜欢页 ──
{
  await evaluate(() => localStorage.clear())
  await evaluate(() => localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' })))
  await goto('/playlist/1', 2000)
  const collected = await clickTitle('收藏')
  await sleep(700)
  await goto('/artist/1', 2400)
  await clickTrusted('关注', { exact: true })
  await sleep(800)
  const followState = await evaluate(() => document.body.innerText.includes('已关注'))
  await goto('/playlist/1', 1800)
  await clickTitle('喜欢') // 第一行的喜欢按钮(title=喜欢)
  await sleep(700)
  const likedViaRow = await evaluate(() => {
    const row = [...document.querySelectorAll('.song-item')].find(r => (r.textContent || '').includes('测试歌曲 1'))
    const btn = row && [...row.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').includes('喜欢'))
    return btn ? btn.getAttribute('title') : null
  })
  await goto('/likes', 2200)
  const lib = await evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('library') || '{}')
    return {
      liked: (raw.likedSongs || []).length,
      playlists: (raw.collectedPlaylists || []).length,
      artists: (raw.followedArtists || []).length,
      page: document.body.innerText,
    }
  })
  await shot('ui011-likes-after-reload')
  record(
    'UI-011',
    '真实点击 收藏/关注/喜欢 后刷新',
    collected && lib.liked >= 1 && lib.playlists >= 1 && lib.artists >= 1 && followState,
    `收藏点击=${collected};刷新后 library:喜欢 ${lib.liked} 首、收藏歌单 ${lib.playlists} 个、关注歌手 ${lib.artists} 位;关注态生效=${followState};行内喜欢按钮态="${likedViaRow}"`,
    ['ui011-likes-after-reload.png']
  )
}

fs.writeFileSync(
  path.resolve(OUT, '..', 'results-fixups2.json'),
  JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2)
)
console.log('FIXUPS2 DONE')
ws.close()
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {})
process.exit(0)
