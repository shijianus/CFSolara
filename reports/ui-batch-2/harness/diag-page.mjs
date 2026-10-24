import fs from 'node:fs'
const PORT = 9222
const BASE = 'http://127.0.0.1:5090'
const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
let nid = 1; const pend = new Map(); const waits = new Map()
const consoleLogs = []
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data)
  if (m.id) { const w = pend.get(m.id); if (!w) return; pend.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result) }
  else if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args || []).map(a => a.value || a.description || '').join(' ')
    consoleLogs.push(`[${m.params.type}] ${text.slice(0, 200)}`)
  } else if (m.method === 'Runtime.exceptionThrown') {
    consoleLogs.push(`[EXC] ${(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 300)}`)
  } else { const l = waits.get(m.method); l?.length && l.shift()(m.params) }
})
const send = (m, p = {}) => new Promise((res, rej) => { const id = nid++; pend.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
const waitEvent = (m, t = 15000) => new Promise((res, rej) => { const l = waits.get(m) || []; l.push(res); waits.set(m, l); setTimeout(() => rej(new Error('timeout ' + m)), t) })
const ev = async (fn, arg) => { const r = await send('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value }
const sleep = ms => new Promise(r => setTimeout(r, ms))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 })
await send('Page.navigate', { url: `${BASE}/?s=${Date.now()}#/` })
await waitEvent('Page.loadEventFired').catch(() => {}); await sleep(2000)
await ev(() => { localStorage.clear(); localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' })) })
await send('Page.navigate', { url: `${BASE}/?s=${Date.now()}#/playlist/1` })
await waitEvent('Page.loadEventFired').catch(() => {}); await sleep(3000)
const state = await ev(() => ({
  url: location.hash,
  bodyText: document.body.innerText.slice(0, 300),
  songItems: document.querySelectorAll('.song-item').length,
  hasApp: Boolean(document.querySelector('#app')),
  appHtmlLen: document.querySelector('#app')?.innerHTML.length || 0,
}))
console.log('STATE:', JSON.stringify(state, null, 1))
console.log('CONSOLE (last 20):')
for (const l of consoleLogs.slice(-20)) console.log(' ', l)
ws.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {})
process.exit(0)
