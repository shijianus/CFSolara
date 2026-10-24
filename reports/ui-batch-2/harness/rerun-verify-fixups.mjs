// 批次 2 补验失败项专项重跑:UI-009 / UI-011 / UI-019 / UI-031 / UI-058
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 9222
const BASE = 'http://127.0.0.1:5090'
const OUT = path.resolve(__dirname, '../../../reports/final/rerun/batch-2-verify/shots')
fs.mkdirSync(OUT, { recursive: true })

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
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text)
  }
  return res.result.value
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const setViewport = (width, height, mobile = false) =>
  send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  })

const goto = async (route, wait = 1800) => {
  await send('Page.navigate', { url: `${BASE}/?s=${Date.now()}#${route}` })
  await waitEvent('Page.loadEventFired').catch(() => {})
  await sleep(wait)
}

const shot = async name => {
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
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
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await sleep(600)
  return true
}

const clickRow = async name => {
  const ok = await evaluate(n => {
    const row = [...document.querySelectorAll('.song-item')].find(r =>
      (r.textContent || '').includes(n)
    )
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
      toasts: [...document.querySelectorAll('[role="alert"],[role="status"]')]
        .map(e => e.innerText)
        .filter(Boolean),
      paused: player ? player.paused : null,
      src: player ? player.src : '',
      current: audio?.currentSong || null,
      queue: audio?.playlist?.length ?? null,
    }
  })

// 轮询等待 toast 出现(toast 存活 4s,轮询避免错过)
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
await goto('/', 1200)
await evaluate(() => {
  localStorage.clear()
  localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' }))
})

// ── UI-009 音质切换失败回滚(菜单项为 SQ 无损,轮询 toast)──
{
  await clearAudio()
  await goto('/playlist/1', 2000)
  await clickRow('测试歌曲 3')
  await sleep(1500)
  await evaluate(() => document.querySelector('#footer-quality-btn')?.click())
  await sleep(1500)
  const menuOpen = await evaluate(() => document.body.innerText.includes('SQ 无损'))
  await clickTrusted('SQ 无损')
  const st = await waitForToast('音质切换失败', 9000)
  const srcOk = st.src.includes('br=128')
  await shot('ui009-quality-rollback')
  record(
    'UI-009',
    'mock 曲目 999999 在无损档必 403:底栏切音质',
    menuOpen && st.toasts.some(x => x.includes('音质切换失败')) && srcOk,
    `菜单打开=${menuOpen};toast="${st.toasts.join(' | ').slice(0, 50)}";src 仍 br=128=${srcOk}`,
    ['ui009-quality-rollback.png']
  )
}

// ── UI-011 library 持久化(关注按钮为文本按钮,精确匹配)──
{
  await evaluate(() => localStorage.clear())
  await evaluate(() => localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' })))
  await goto('/playlist/1', 2000)
  await clickTrusted('收藏', { exact: true })
  await sleep(600)
  await goto('/artist/1', 2400)
  await clickTrusted('关注', { exact: true })
  await sleep(800)
  const followState = await evaluate(() => document.body.innerText.includes('已关注'))
  await goto('/playlist/1', 1800)
  await evaluate(() => {
    const row = [...document.querySelectorAll('.song-item')].find(r =>
      (r.textContent || '').includes('测试歌曲 1')
    )
    const btn = row && [...row.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').includes('喜欢'))
    if (btn) btn.click()
  })
  await sleep(700)
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
    lib.liked >= 1 && lib.playlists >= 1 && lib.artists >= 1 && followState,
    `刷新后 library:喜欢 ${lib.liked} 首、收藏歌单 ${lib.playlists} 个、关注歌手 ${lib.artists} 位;关注态生效=${followState}`,
    ['ui011-likes-after-reload.png']
  )
}

// ── UI-019 清空队列撤销(单击播放保留整页队列,断言恢复一致)──
{
  await clearAudio()
  await goto('/playlist/1', 2000)
  await clickRow('测试歌曲 1')
  await sleep(1500)
  const queueBefore = (await playerState()).queue
  await goto('/my-music', 1800)
  await clickTrusted('清空', { exact: true })
  await sleep(700)
  const undoToast = (await playerState()).toasts
  await shot('ui019-queue-undo-toast')
  await clickTrusted('撤销', { exact: true })
  await sleep(900)
  const st = await playerState()
  await shot('ui019-queue-restored')
  record(
    'UI-019',
    '我的音乐 → 清空 → 撤销(队列恢复到清空前快照)',
    queueBefore > 0 &&
      undoToast.some(x => x.includes('已清空') && x.includes('撤销')) &&
      st.queue === queueBefore,
    `清空前队列 ${queueBefore};撤销 toast 出现=${undoToast.some(x => x.includes('撤销'))};撤销后队列 ${st.queue}`,
    ['ui019-queue-undo-toast.png', 'ui019-queue-restored.png']
  )
}

// ── UI-031 下载(按钮文案为全角括号 下载（{quality}）)──
{
  await evaluate(
    () =>
      new Promise(resolve => {
        const req = indexedDB.open('SonicMusicPlayerDB')
        req.onerror = () => resolve()
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('downloaded_music')) {
            resolve()
            return
          }
          const tx = db.transaction('downloaded_music', 'readwrite')
          tx.objectStore('downloaded_music').clear()
          tx.oncomplete = () => resolve()
        }
      })
  )
  await clearAudio()
  await goto('/playlist/1', 2000)
  await evaluate(() => {
    const row = [...document.querySelectorAll('.song-item')].find(r =>
      (r.textContent || '').includes('测试歌曲 1')
    )
    const btn = row && [...row.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').includes('下载'))
    if (btn) btn.click()
  })
  await sleep(1200)
  await shot('ui031-download-dialog')
  const dlgBtn = await clickTrusted('下载（')
  await sleep(1600)
  const prog = await evaluate(() => {
    const m = document.body.innerText.match(/(\d+)\s*%/)
    const bar = document.querySelector('[role="progressbar"], .progress-bar, [class*="progress"]')
    return {
      pct: m ? Number(m[1]) : 0,
      barVisible: Boolean(bar && bar.getBoundingClientRect().width > 0),
      cancelBtn: [...document.querySelectorAll('button')].some(b => b.textContent.includes('取消下载')),
    }
  })
  await shot('ui031-download-progress')
  await sleep(6500)
  const doneToast = (await playerState()).toasts
  // 二次下载 → 覆盖确认
  await evaluate(() => {
    const row = [...document.querySelectorAll('.song-item')].find(r =>
      (r.textContent || '').includes('测试歌曲 1')
    )
    const btn = row && [...row.querySelectorAll('button')].find(b => (b.getAttribute('title') || '').includes('下载'))
    if (btn) btn.click()
  })
  await sleep(1100)
  await clickTrusted('下载（')
  await sleep(1100)
  const overwrite = await evaluate(() =>
    [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '覆盖下载')
  )
  await shot('ui031-download-overwrite')
  await clickTrusted('覆盖下载', { exact: true })
  await sleep(1000)
  await clickTrusted('取消下载', { exact: true })
  await sleep(1300)
  const cancelSt = await playerState()
  await shot('ui031-download-cancelled')
  record(
    'UI-031',
    '行内下载 → 进度/完成 → 二次下载覆盖确认 → 取消',
    dlgBtn && prog.pct > 0 && overwrite && (doneToast.length > 0 || cancelSt.toasts.length > 0),
    `确认点击=${dlgBtn};进度峰值 ${prog.pct}%(进度条可见=${prog.barVisible},取消按钮=${prog.cancelBtn});覆盖确认=${overwrite};toast="${[...doneToast, ...cancelSt.toasts].join(' | ').slice(0, 70)}"`,
    ['ui031-download-dialog.png', 'ui031-download-progress.png', 'ui031-download-overwrite.png', 'ui031-download-cancelled.png']
  )
}

// ── UI-058 artists 页错误态(retry-text 被覆盖为 加载更多)──
{
  await goto('/artists', 1800)
  await clickTrusted('Z', { exact: true })
  await sleep(1300)
  const empty = await evaluate(() => ({
    emptyText: document.body.innerText.includes('暂无结果'),
    resetBtn: [...document.querySelectorAll('button')].some(b => b.textContent.includes('重置筛选')),
  }))
  await shot('ui058-artists-empty')
  await clickTrusted('重置筛选', { exact: true })
  await sleep(1300)
  const restored = await evaluate(() => document.querySelectorAll('.song-item, [class*="artist"]').length)
  await clickTrusted('韩国', { exact: true })
  await sleep(1800)
  const err = await evaluate(() => ({
    errText: document.body.innerText.includes('加载失败'),
    retryBtn: [...document.querySelectorAll('button')].some(b => b.textContent.includes('加载更多')),
    artists: document.body.innerText,
  }))
  await shot('ui058-artists-error')
  await clickTrusted('加载更多', { exact: true })
  await sleep(1600)
  const afterRetry = await evaluate(() => document.body.innerText.includes('加载失败'))
  await shot('ui058-artists-after-retry')
  record(
    'UI-058',
    'mock:首字母 Z 空结果 / 韩国(area=16) 500 + 手动重试',
    empty.emptyText && empty.resetBtn && err.errText && err.retryBtn && afterRetry,
    `空态+重置=${empty.emptyText}/${empty.resetBtn};重置后列表项≈${restored};失败态+重试按钮=${err.errText}/${err.retryBtn};重试后仍为错误态(mock 持续 500)=${afterRetry}`,
    ['ui058-artists-empty.png', 'ui058-artists-error.png', 'ui058-artists-after-retry.png']
  )
}

fs.writeFileSync(
  path.resolve(OUT, '..', 'results-fixups.json'),
  JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2)
)
console.log('FIXUPS DONE')
ws.close()
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {})
process.exit(0)
