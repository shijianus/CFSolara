// 线上验证(sonic.epocanvas.tech):axe 扫描 + 四视口 DOM 巡检 + 隐私模式(存储禁用)加载
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 9222
const BASE = 'https://sonic.epocanvas.tech'
const OUT = path.resolve(__dirname, '../../../reports/final/online-verify/shots')
fs.mkdirSync(OUT, { recursive: true })
const AXE_SRC = fs.readFileSync(path.resolve(__dirname, '../../../reports/final/online-verify/axe.min.js'), 'utf8')

const results = { axe: [], dom: [], privacy: null }
const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
let nid = 1; const pend = new Map(); const waits = new Map()
const consoleErrors = []
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data)
  if (m.id) { const w = pend.get(m.id); if (!w) return; pend.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result) }
  else if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 200))
  } else { const l = waits.get(m.method); l?.length && l.shift()(m.params) }
})
const send = (m, p = {}) => new Promise((res, rej) => { const id = nid++; pend.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
const waitEvent = (m, t = 30000) => new Promise((res, rej) => { const l = waits.get(m) || []; l.push(res); waits.set(m, l); setTimeout(() => rej(new Error('timeout ' + m)), t) })
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
const goto = async (route, wait = 3500) => {
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

await send('Page.enable')
await send('Runtime.enable')

const VIEWPORTS = [
  { w: 1440, h: 900, label: '1440x900', mobile: false },
  { w: 820, h: 700, label: '820x700', mobile: false },
  { w: 844, h: 390, label: '844x390', mobile: false },
  { w: 390, h: 844, label: '390x844', mobile: true },
]
const ROUTES = ['/', '/playlist/1', '/search?q=test', '/artists', '/settings']

// ── 1. 四视口 DOM 巡检 ──
for (const v of VIEWPORTS) {
  await setViewport(v.w, v.h, v.mobile)
  for (const route of ROUTES) {
    consoleErrors.length = 0
    await goto(route, 3200)
    const dom = await evaluate(() => ({
      appLen: document.querySelector('#app')?.innerHTML.length || 0,
      bodyLen: document.body.innerText.length,
      hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      songItems: document.querySelectorAll('button.group, .song-item').length,
      hasFatalText: /应用程序加载失败|页面出错了|Cannot read|undefined is not/i.test(document.body.innerText),
    }))
    await shot(`dom-${v.label}-${route.replace(/[/?=]/g, '_') || 'home'}`)
    results.dom.push({
      viewport: v.label,
      route,
      rendered: dom.appLen > 1000 && dom.bodyLen > 10 && !dom.hasFatalText,
      hOverflow: dom.hOverflow,
      interactiveRows: dom.songItems,
      consoleErrors: consoleErrors.filter(e => !e.includes('Failed to load resource')).slice(0, 3),
    })
    console.log(`DOM ${v.label} ${route}: rendered=${dom.appLen > 1000 && dom.bodyLen > 10} overflow=${dom.hOverflow} rows=${dom.songItems} errs=${consoleErrors.length}`)
  }
}

// ── 2. axe 扫描(关键视口 × 关键路由)──
await setViewport(1440, 900, false)
for (const route of ['/', '/playlist/1', '/settings']) {
  await goto(route, 3500)
  await evaluate(src => {
    const s = document.createElement('script')
    s.textContent = src
    document.head.appendChild(s)
  }, AXE_SRC)
  const axe = await evaluate(async () => {
    const r = await window.axe.run(document, {
      resultTypes: ['violations'],
    })
    return {
      violations: r.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        sample: v.nodes[0]?.target?.join(' ')?.slice(0, 120) || '',
      })),
    }
  })
  const serious = axe.violations.filter(v => v.impact === 'serious').length
  const critical = axe.violations.filter(v => v.impact === 'critical').length
  results.axe.push({ route, serious, critical, violations: axe.violations })
  console.log(`AXE ${route}: serious=${serious} critical=${critical} total=${axe.violations.length}`)
}

// ── 3. 隐私模式(localStorage/sessionStorage 抛 SecurityError)加载首页 ──
{
  await setViewport(390, 844, true)
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      Object.defineProperty(window, 'localStorage', {
        get() { throw new DOMException('Access is denied for this document.', 'SecurityError') },
        configurable: false,
      })
      Object.defineProperty(window, 'sessionStorage', {
        get() { throw new DOMException('Access is denied for this document.', 'SecurityError') },
        configurable: false,
      })
    `,
  })
  consoleErrors.length = 0
  await goto('/', 4200)
  const privacy = await evaluate(() => ({
    appLen: document.querySelector('#app')?.innerHTML.length || 0,
    bodyText: document.body.innerText.slice(0, 120),
    hasFatalText: /应用程序加载失败|白屏|Cannot read|is not defined|is not a function/i.test(document.body.innerText),
    songRows: document.querySelectorAll('button.group, .song-item').length,
    canInteract: Boolean(document.querySelector('button')),
  }))
  await shot('privacy-mode-home-390')
  results.privacy = { ...privacy, consoleErrors: consoleErrors.slice(0, 5) }
  // 清除注入,避免影响后续
  await send('Page.removeScriptToEvaluateOnNewDocument').catch(() => {})
  console.log(`PRIVACY: appLen=${privacy.appLen} rows=${privacy.songRows} fatal=${privacy.hasFatalText}`)
}

fs.writeFileSync(
  path.resolve(OUT, '..', 'online-results.json'),
  JSON.stringify({ timestamp: new Date().toISOString(), ...results }, null, 2)
)
const axeOk = results.axe.every(a => a.serious === 0 && a.critical === 0)
const domOk = results.dom.every(d => d.rendered)
const privacyOk = results.privacy && results.privacy.appLen > 1000 && !results.privacy.hasFatalText
console.log(`\nSUMMARY: axe serious/critical 全 0 = ${axeOk};四视口全部渲染 = ${domOk};隐私模式不白屏 = ${privacyOk}`)
console.log('ONLINE VERIFY DONE')
ws.close()
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {})
process.exit(0)
