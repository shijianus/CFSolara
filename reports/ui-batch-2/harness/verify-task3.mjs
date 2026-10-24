// 任务3补做项验证:UI-028(抽屉喜欢/下载/加入歌单)、UI-033(移动歌单卡起播)、UI-065(200% 缩放不截断)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 9222
const BASE = 'http://127.0.0.1:5090'
const OUT = path.resolve(__dirname, '../../../reports/final/rerun/task3-verify/shots')
fs.mkdirSync(OUT, { recursive: true })

const results = []
const record = (id, pass, detail, shots) => {
  results.push({ id, result: pass ? '通过' : '失败', detail, shots })
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
const setViewport = (width, height, mobile = false, dsf = 1) =>
  send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile, screenWidth: width, screenHeight: height })
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
  // 优先在打开的 dialog(抽屉/弹窗)内查找:抽屉打开后 main 处于 inert,外部按钮点击无效。
  // 直接用 el.click()(抽屉本身非 inert,JS click 可触发 Vue 处理器,不受遮挡影响)
  const ok = await evaluate(l => {
    const scope = document.querySelector('[role="dialog"][aria-modal="true"]') || document
    const el =
      scope.querySelector(`button[title="${l}"]`) ||
      scope.querySelector(`button[aria-label="${l}"]`)
    if (!el) return false
    el.click()
    return true
  }, label)
  await sleep(800)
  return ok
}
const clickTitleGlobal = async label => {
  const point = await evaluate(l => {
    const el =
      document.querySelector(`button[title="${l}"]`) ||
      document.querySelector(`button[aria-label="${l}"]`)
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, label)
  if (!point) return false
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(700)
  return true
}
const clickRow = async name => {
  const ok = await evaluate(n => {
    const row = [...document.querySelectorAll('.song-item')].find(r => (r.textContent || '').includes(n))
    if (!row) return false
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  }, name)
  await sleep(2200)
  return ok
}

await send('Page.enable')
await send('Runtime.enable')
await setViewport(1440, 900)
await goto('/', 1000)
await evaluate(() => {
  localStorage.clear()
  localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' }))
})

// ── UI-028:桌面抽屉 喜欢/下载/加入歌单 ──
{
  await goto('/playlist/1', 2000)
  await clickRow('测试歌曲 1')
  // 打开抽屉:点击底栏封面/展开按钮
  await evaluate(() => {
    const cover = document.querySelector('.cover-inner')
    cover?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(1800)
  const drawerOpen = await evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')))
  const likeBtn = await clickTitle('喜欢')
  await sleep(600)
  const liked = await evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('library') || '{}')
    return (raw.likedSongs || []).some(s => String(s.id) === '1001')
  })
  await shot('ui028-drawer-like')
  // 加入歌单:打开弹窗 → 新建歌单 → 断言写入
  await clickTitle('加入歌单')
  await sleep(900)
  await shot('ui028-add-to-playlist-dialog')
  await evaluate(() => {
    const input = document.querySelector('input[aria-label="新建歌单名称"]')
    if (input) {
      input.value = '补验歌单'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await sleep(300)
  await clickTrusted('新建', { exact: true })
  await sleep(900)
  const lib = await evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('library') || '{}')
    const pl = (raw.userPlaylists || []).find(p => p.name === '补验歌单')
    return { created: Boolean(pl), hasSong: Boolean(pl?.songs.some(s => String(s.id) === '1001')) }
  })
  await shot('ui028-added-to-playlist')
  // 下载入口:抽屉下载按钮打开下载弹窗
  await clickTitle('下载')
  await sleep(900)
  const dlDialog = await evaluate(() => document.body.innerText.includes('选择下载音质'))
  await shot('ui028-drawer-download-dialog')
  await clickTitle('关闭弹窗')
  await sleep(500)
  record(
    'UI-028',
    likeBtn && drawerOpen && liked && lib.created && lib.hasSong && dlDialog,
    `抽屉打开=${drawerOpen};喜欢写入=${liked};加入歌单(新建+写入)=${lib.created}/${lib.hasSong};下载弹窗打开=${dlDialog}`,
    ['ui028-drawer-like.png', 'ui028-add-to-playlist-dialog.png', 'ui028-added-to-playlist.png', 'ui028-drawer-download-dialog.png']
  )
}

// ── UI-033:移动端歌单卡片播放图标真正起播 ──
{
  await setViewport(390, 844, true)
  await evaluate(() => {
    localStorage.removeItem('audio')
    localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' }))
  })
  // mock 搜索不含歌单结果 → 为该场景注入临时歌单结果:改用歌单页?
  // mock /api/cloudsearch type=1000 返回空歌单。这里直接验证机制:
  // 给 search 页注入 mock 歌单数据不可行,改在页面上下文拦截 fetch 响应。
  await goto('/search?q=test', 2000)
  // 通过 CDP Fetch mock 不便;检查 playlist tab 是否有卡片;若无则用 DOM 注入一个卡片验证点击逻辑?
  // 更直接:验证页面中播放按钮绑定了 click 事件且调用后发起 playlistTrackAll 请求。
  const hasCard = await evaluate(() => Boolean(document.querySelector('.playlist-play-btn')))
  if (hasCard) {
    await evaluate(() => {
      // 记录点击前的资源条目基线,axios 走 XHR,用 PerformanceResourceTiming 检测
      window.__plBase = performance.getEntriesByType('resource').length
    })
    await evaluate(() => {
      document.querySelector('.playlist-play-btn').click()
    })
    await sleep(2800)
    const st = await evaluate(() => {
      const entries = performance.getEntriesByType('resource').slice(window.__plBase)
      const trackReq = entries.some(e => e.name.includes('/api/playlist/track/all'))
      const audio = JSON.parse(localStorage.getItem('audio') || 'null')?.audio || null
      return {
        trackReq,
        src: document.querySelector('#audioPlayer')?.src || '',
        queue: audio?.playlist?.length ?? 0,
      }
    })
    await shot('ui033-playlist-card-playing')
    record('UI-033', st.trackReq && st.queue >= 100 && Boolean(st.src), `点击播放图标发起歌单曲目请求=${st.trackReq};队列 ${st.queue} 首(mock limit=100);audio.src 已设置=${Boolean(st.src)}`, ['ui033-playlist-card-playing.png'])
  } else {
    record('UI-033', false, 'mock 搜索无歌单结果,无法触发(需检查 mock)', [])
  }
}

// ── UI-065:200% 缩放(1920 屏 → 960x540 CSS 视口,桌面布局)GlassSelect/下载选项/页脚不截断 ──
{
  await setViewport(960, 540)
  await evaluate(() => {
    localStorage.removeItem('audio')
    localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' }))
  })
  await goto('/settings', 2200)
  // GlassSelect:打开任意下拉,检查触发按钮与选项无纵向裁切
  const sel = await evaluate(() => {
    const trigger = document.querySelector('button[role="combobox"]')
    if (!trigger) return { found: false }
    const clipped = trigger.scrollHeight > trigger.clientHeight + 1
    return { found: true, clipped, h: trigger.clientHeight, sh: trigger.scrollHeight }
  })
  await shot('ui065-glassselect-200')
  // 页脚:歌名两行内完整显示,无固定高度裁切
  const footer = await evaluate(() => {
    const title = document.querySelector('#footer-song-info p')
    if (!title) return { found: false }
    const clipped = title.scrollHeight > title.clientHeight + 2
    return { found: true, clipped, h: title.clientHeight, sh: title.scrollHeight, text: title.textContent.trim().slice(0, 20) }
  })
  await shot('ui065-footer-200')
  // 下载选项:打开下载弹窗,等探测完成后检查行高自适应
  await goto('/playlist/1', 1800)
  await clickRow('测试歌曲 1')
  await evaluate(() => {
    const row = [...document.querySelectorAll('.song-item')].find(r => (r.textContent || '').includes('测试歌曲 1'))
    const btn = row && [...row.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').includes('下载'))
    btn?.click()
  })
  await sleep(3500)
  const dl = await evaluate(() => {
    const rows = [...document.querySelectorAll('.option-row')]
    return {
      count: rows.length,
      clipped: rows.filter(r => r.scrollHeight > r.clientHeight + 1).length,
    }
  })
  await shot('ui065-download-options-200')
  record(
    'UI-065',
    sel.found && !sel.clipped && footer.found && !footer.clipped && dl.count > 0 && dl.clipped === 0,
    `GlassSelect 裁切=${sel.clipped};页脚歌名裁切=${footer.clipped};下载选项行 ${dl.count} 个、裁切 ${dl.clipped} 个`,
    ['ui065-glassselect-200.png', 'ui065-footer-200.png', 'ui065-download-options-200.png']
  )
}

fs.writeFileSync(
  path.resolve(OUT, '..', 'results-task3.json'),
  JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2)
)
console.log('TASK3 VERIFY DONE')
ws.close()
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {})
process.exit(0)
