import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.CDP_PORT || 9333)
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8791'
const PROFILE = path.resolve('temp_brand_baseline/cdp-probe-profile')
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
  '--window-size=1440,900',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  'about:blank',
], { stdio: 'ignore' })

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
async function json(url) { const r = await fetch(url); return r.json() }

let ws
let seq = 0
const pending = new Map()
async function connect() {
  let list
  for (let i = 0; i < 80; i++) {
    try {
      list = await json(`http://127.0.0.1:${PORT}/json/list`)
      if (list.some(t => t.type === 'page' && t.webSocketDebuggerUrl)) break
    } catch {}
    await sleep(250)
  }
  const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
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

async function waitFor(expression, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { if (await evaluate(expression)) return true } catch {}
    await sleep(250)
  }
  return false
}

async function nav(url) {
  await send('Page.navigate', { url })
  await waitFor('document.readyState === "complete"', 15000)
  await sleep(1500)
}

async function setViewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile,
    screenWidth: width, screenHeight: height,
  })
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile })
}

const common = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const text = (el) => (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160);
  return {
    title: document.title,
    url: location.href,
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 2500),
    inputs: Array.from(document.querySelectorAll('input, textarea')).filter(visible).map(el => ({
      tag: el.tagName, type: el.type, placeholder: el.placeholder, value: el.value, aria: el.getAttribute('aria-label'), name: el.name, cls: el.className,
    })).slice(0, 30),
    buttons: Array.from(document.querySelectorAll('button, [role=button]')).filter(visible).map(el => ({
      tag: el.tagName, text: text(el), aria: el.getAttribute('aria-label'), title: el.title, cls: el.className, testid: el.getAttribute('data-testid'),
    })).slice(0, 60),
    links: Array.from(document.querySelectorAll('a')).filter(visible).map(el => ({ text: text(el), href: el.getAttribute('href') })).slice(0, 40),
    asides: Array.from(document.querySelectorAll('aside')).filter(visible).map(text),
    headings: Array.from(document.querySelectorAll('h1,h2,h3')).filter(visible).map(el => text(el)).slice(0, 30),
    testIds: Array.from(document.querySelectorAll('[data-testid]')).map(el => el.getAttribute('data-testid')).slice(0, 40),
    audio: Array.from(document.querySelectorAll('audio')).map(el => ({ src: el.currentSrc || el.src, paused: el.paused, currentTime: el.currentTime, duration: el.duration })),
  };
})()`

try {
  await connect()
  await setViewport(1440, 900, false)
  await nav(`${BASE}/`)
  const home = await evaluate(common)
  console.log('=== HOME ===')
  console.log(JSON.stringify(home, null, 2))
  await nav(`${BASE}/search`)
  const search = await evaluate(common)
  console.log('=== SEARCH ===')
  console.log(JSON.stringify(search, null, 2))
  await nav(`${BASE}/settings`)
  const settings = await evaluate(common)
  console.log('=== SETTINGS ===')
  console.log(JSON.stringify(settings, null, 2))
} catch (err) {
  console.error(err)
  process.exitCode = 1
} finally {
  try { ws?.close() } catch {}
  try { chrome.kill() } catch {}
  await sleep(500)
}
