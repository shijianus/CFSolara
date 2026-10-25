import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.CDP_PORT || 9334)
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8791'
const OUT = process.argv[2] || 'pre'
const OUT_DIR = path.resolve('reports/brand-keyname/evidence/browser', OUT)
const PROFILE = path.resolve(`temp_brand_baseline/cdp-journey-${OUT}`)
fs.rmSync(OUT_DIR, { recursive: true, force: true })
fs.mkdirSync(OUT_DIR, { recursive: true })
fs.rmSync(PROFILE, { recursive: true, force: true })
fs.mkdirSync(PROFILE, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage',
  '--ignore-certificate-errors',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1440,900',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const observations = { startedAt: new Date().toISOString(), base: BASE, out: OUT, steps: [] }

let ws
let seq = 0
const pending = new Map()

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'evaluate failed')
  return res.result.value
}

async function waitFor(expression, timeoutMs = 15000, label = expression) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { if (await evaluate(expression)) return true } catch {}
    await sleep(250)
  }
  throw new Error(`timeout: ${label}`)
}

async function nav(url) {
  await send('Page.navigate', { url })
  await waitFor('document.readyState === "complete"', 15000, `load ${url}`)
  await sleep(1200)
}

async function setViewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile,
    screenWidth: width, screenHeight: height,
  })
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile })
}

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(data, 'base64'))
  return `${name}.png`
}

async function focusAndType(selector, text) {
  const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); return document.activeElement === el; })()`)
  if (!ok) throw new Error(`input not found: ${selector}`)
  await send('Input.insertText', { text })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
}

const readCommon = `(() => {
  const text = (el) => (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200);
  return {
    title: document.title,
    url: location.href,
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 3000),
    brandText: Array.from(document.querySelectorAll('aside, header, [aria-label="epocanvas sonic"]')).map(text).join(' | ').slice(0, 800),
    songItems: Array.from(document.querySelectorAll('.song-item')).slice(0, 8).map(el => text(el)),
    audio: Array.from(document.querySelectorAll('audio')).map(el => ({ src: el.currentSrc || el.src, paused: el.paused, currentTime: el.currentTime, duration: el.duration, readyState: el.readyState })),
    localStorageKeys: Object.keys(localStorage).sort(),
    sessionStorageKeys: Object.keys(sessionStorage).sort(),
    dbNames: null,
  };
})()`

async function step(name, fn) {
  const started = Date.now()
  try {
    const data = await fn()
    observations.steps.push({ name, ok: true, ms: Date.now() - started, ...data })
    console.log(`PASS ${name} (${Date.now() - started}ms)`)
  } catch (err) {
    observations.steps.push({ name, ok: false, ms: Date.now() - started, error: String(err?.message || err) })
    console.log(`FAIL ${name}: ${err?.message || err}`)
  }
}

async function connect() {
  let list
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      list = await r.json()
      if (list.some(t => t.type === 'page' && t.webSocketDebuggerUrl)) break
    } catch {}
    await sleep(250)
  }
  const page = list?.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('CDP page target not found')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`))
      else resolve(msg.result)
    }
  }
  await send('Page.enable')
  await send('Runtime.enable')
}

try {
  await connect()
  await setViewport(1440, 900, false)

  await step('desktop-home-clean', async () => {
    await nav(`${BASE}/`)
    await evaluate('localStorage.clear(); sessionStorage.clear();')
    await send('Page.reload')
    await waitFor('document.readyState === "complete"', 15000, 'reload home')
    await sleep(2000)
    const common = await evaluate(readCommon)
    const shot = await screenshot('desktop-home')
    return { ...common, screenshot: shot }
  })

  await step('desktop-search-by-typing', async () => {
    const inputSelector = 'input[placeholder="搜索音乐、歌手、专辑..."]'
    await focusAndType(inputSelector, '周杰伦')
    const routed = await waitFor('location.hash.includes("/search")', 10000, 'search route')
    if (!routed) throw new Error('search route not reached')
    await waitFor('document.querySelectorAll(".song-item").length > 0', 40000, 'search results')
    const common = await evaluate(readCommon)
    const shot = await screenshot('desktop-search-results')
    return { ...common, screenshot: shot }
  })

  await step('desktop-play-first-result', async () => {
    const clicked = await evaluate(`(() => { const row = document.querySelector('.song-item'); if (!row) return false; row.click(); return true; })()`)
    if (!clicked) throw new Error('no song row to click')
    await waitFor(`(() => { const a = document.querySelector('audio'); return a && a.currentTime > 0.3; })()`, 30000, 'audio progress > 0.3s')
    const common = await evaluate(readCommon)
    const shot = await screenshot('desktop-playing')
    return { ...common, screenshot: shot }
  })

  await step('desktop-settings', async () => {
    await nav(`${BASE}/#/settings`)
    await waitFor('location.hash.includes("/settings")', 10000, 'settings route')
    await sleep(1000)
    const common = await evaluate(readCommon)
    const shot = await screenshot('desktop-settings')
    return { ...common, screenshot: shot }
  })

  await step('desktop-404', async () => {
    await nav(`${BASE}/#/definitely-not-a-route`)
    await waitFor(`document.title.includes('页面不存在') || document.body.innerText.includes('页面走丢了')`, 10000, '404 text')
    const common = await evaluate(readCommon)
    const shot = await screenshot('desktop-404')
    return { ...common, screenshot: shot }
  })

  await setViewport(390, 844, true)
  await step('mobile-home', async () => {
    await nav(`${BASE}/#/`)
    await waitFor('document.readyState === "complete"', 15000, 'mobile home load')
    await sleep(1800)
    const common = await evaluate(readCommon)
    const shot = await screenshot('mobile-home')
    return { ...common, screenshot: shot }
  })

  await step('mobile-search-and-play', async () => {
    await nav(`${BASE}/#/search?q=${encodeURIComponent('周杰伦')}`)
    await waitFor('document.querySelectorAll(".song-item, .song-item-compact").length > 0', 40000, 'mobile search results')
    const before = await evaluate(readCommon)
    const clicked = await evaluate(`(() => { const row = document.querySelector('.song-item, .song-item-compact'); if (!row) return false; row.click(); return true; })()`)
    if (!clicked) throw new Error('no mobile song row')
    let after = null
    try {
      await waitFor(`(() => { const a = document.querySelector('audio'); return a && a.currentTime > 0.3; })()`, 30000, 'mobile audio progress > 0.3s')
    } catch (err) {
      after = await evaluate(readCommon)
      throw new Error(`${err.message}; audio=${JSON.stringify(after.audio)}; body=${after.bodyText.slice(0,300)}`)
    }
    after = await evaluate(readCommon)
    const shot = await screenshot('mobile-playing')
    return { before, after, screenshot: shot }
  })
} catch (err) {
  observations.fatal = String(err?.stack || err)
  console.error(err)
  process.exitCode = 1
} finally {
  observations.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(OUT_DIR, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`, 'utf8')
  try { ws?.close() } catch {}
  try { chrome.kill() } catch {}
  await sleep(500)
}
