import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.CDP_PORT || 9335)
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8792'
const OUT = process.argv[2] || 'pre'
const OUT_DIR = path.resolve('reports/brand-keyname/evidence/browser/legacy', OUT)
const PROFILE = path.resolve(`temp_brand_baseline/cdp-legacy-${OUT}`)
fs.rmSync(OUT_DIR, { recursive: true, force: true })
fs.mkdirSync(OUT_DIR, { recursive: true })
fs.rmSync(PROFILE, { recursive: true, force: true })
fs.mkdirSync(PROFILE, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--no-default-browser-check', '--disable-dev-shm-usage', '--ignore-certificate-errors',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
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

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(data, 'base64'))
  return `${name}.png`
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

const read = `(() => {
  const body = document.body.innerText || '';
  const html = document.documentElement.innerHTML || '';
  return {
    title: document.title,
    url: location.href,
    bodyText: body.replace(/\\s+/g, ' ').slice(0, 3000),
    epoMailCount: (body.match(/EpoMail/g) || []).length,
    epomailCount: (body.match(/Epomail/g) || []).length,
    legacyBrandCount: (body.match(/Solara|CFSolara|Shijianus|Glass Music Player/gi) || []).length,
    modalText: (document.getElementById('apiKeyModal')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 1500),
    modalDisplay: document.getElementById('apiKeyModal')?.style.display || '',
    localStorageKeys: Object.keys(localStorage).sort(),
  };
})()`

try {
  await connect()
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${BASE}/` })
  await waitFor('document.readyState === "complete"', 15000, 'legacy static load')
  await sleep(1500)
  const home = await evaluate(read)
  home.screenshot = await screenshot('legacy-home')

  await evaluate(`localStorage.setItem('sonic_epomail_session', JSON.stringify({ email: 'brand-check@epocanvas.com', name: 'Brand Check', apiKey: 'sonic_live_brand_check', avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=epomail' }));`)
  await send('Page.reload')
  await waitFor('document.readyState === "complete"', 15000, 'legacy reload')
  await sleep(1200)
  await evaluate(`document.getElementById('epomailLoginBtn')?.click()`)
  await waitFor(`document.getElementById('apiKeyModal')?.style.display === 'flex'`, 5000, 'legacy modal')
  const modal = await evaluate(read)
  modal.screenshot = await screenshot('legacy-modal')

  const observations = { startedAt: new Date().toISOString(), base: BASE, out: OUT, home, modal, finishedAt: new Date().toISOString() }
  fs.writeFileSync(path.join(OUT_DIR, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ home: { title: home.title, epoMailCount: home.epoMailCount, epomailCount: home.epomailCount }, modal: { epoMailCount: modal.epoMailCount, epomailCount: modal.epomailCount, modalText: modal.modalText.slice(0, 200) } }, null, 2))
} catch (err) {
  console.error(err)
  process.exitCode = 1
} finally {
  try { ws?.close() } catch {}
  try { chrome.kill() } catch {}
  await sleep(500)
}
