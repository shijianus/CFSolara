import fs from 'node:fs'
import path from 'node:path'
const PORT = 9222
const BASE = 'http://127.0.0.1:5090'
const OUT = path.resolve('reports/final/online-verify')
const AXE_SRC = fs.readFileSync(path.resolve(OUT, 'axe.min.js'), 'utf8')
const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
let nid = 1; const pend = new Map(); const waits = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { const w = pend.get(m.id); if (!w) return; pend.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result) } else { const l = waits.get(m.method); l?.length && l.shift()(m.params) } })
const send = (m, p = {}) => new Promise((res, rej) => { const id = nid++; pend.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
const waitEvent = (m, t = 30000) => new Promise((res, rej) => { const l = waits.get(m) || []; l.push(res); waits.set(m, l); setTimeout(() => rej(new Error('timeout ' + m)), t) })
const evaluate = async (fn, arg) => { const r = await send('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value }
const sleep = ms => new Promise(r => setTimeout(r, ms))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
for (const route of ['/', '/playlist/1', '/settings']) {
  await send('Page.navigate', { url: `${BASE}/?s=${Date.now()}#${route}` })
  await waitEvent('Page.loadEventFired').catch(() => {}); await sleep(2800)
  await evaluate(src => { const s = document.createElement('script'); s.textContent = src; document.head.appendChild(s) }, AXE_SRC)
  const axe = await evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] })
    return r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: (v.nodes[0]?.target || []).join(' ').slice(0, 120) }))
  })
  const serious = axe.filter(v => v.impact === 'serious').length
  const critical = axe.filter(v => v.impact === 'critical').length
  console.log(`LOCAL AXE ${route}: serious=${serious} critical=${critical}`)
  for (const v of axe) console.log('  ', v.impact, v.id, 'x' + v.nodes, v.sample)
}
ws.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {})
process.exit(0)
