// 队列组合 UI 验证:单击行播放 → 队列抽屉内点击另一项(playByIndex)→ 队列保持不变
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 9222
const BASE = 'http://127.0.0.1:5090'
const OUT = path.resolve(__dirname, '../../../reports/final/rerun/queue-combo')
fs.mkdirSync(OUT, { recursive: true })

const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
let nid = 1; const pend = new Map(); const waits = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { const w = pend.get(m.id); if (!w) return; pend.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result) } else { const l = waits.get(m.method); l?.length && l.shift()(m.params) } })
const send = (m, p = {}) => new Promise((res, rej) => { const id = nid++; pend.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
const waitEvent = (m, t = 15000) => new Promise((res, rej) => { const l = waits.get(m) || []; l.push(res); waits.set(m, l); setTimeout(() => rej(new Error('timeout ' + m)), t) })
const ev = async (fn, arg) => { const r = await send('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value }
const sleep = ms => new Promise(r => setTimeout(r, ms))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 })
// 先进入首页完成初始化,再进目标路由
await send('Page.navigate', { url: `${BASE}/?s=${Date.now()}#/` })
await waitEvent('Page.loadEventFired').catch(() => {}); await sleep(1600)
await ev(() => { localStorage.clear(); localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' })) })
await send('Page.navigate', { url: `${BASE}/?s=${Date.now()}#/playlist/1` })
await waitEvent('Page.loadEventFired').catch(() => {}); await sleep(2800)

// 1. 单击第 2 行(index 1)播放(MobileSongList 行 = button.group,aria-label = "歌名 - 歌手")
const s1 = await ev(() => {
  const rows = [...document.querySelectorAll('button.group')].filter(b => /^测试歌曲 \d+ - /.test(b.getAttribute('aria-label') || ''))
  rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return rows.length
})
await sleep(2400)
const st1 = await ev(() => {
  const a = JSON.parse(localStorage.getItem('audio') || 'null')?.audio
  return { cur: a?.currentSong?.id, idx: a?.currentIndex, q: a?.playlist?.length }
})
// 2. 进入我的音乐(mobile/recent.vue,队列上下文 MobileSongList context="queue")
await send('Page.navigate', { url: `${BASE}/?s=${Date.now()}#/my-music` })
await waitEvent('Page.loadEventFired').catch(() => {}); await sleep(2200)
// 3. 队列上下文点击第 4 项(→ playByIndex(3),队列不变)
const click2 = await ev(() => {
  const rows = [...document.querySelectorAll('button.group')].filter(b => /^测试歌曲 \d+ - /.test(b.getAttribute('aria-label') || ''))
  if (rows.length < 4) return 0
  rows[3].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return rows.length
})
await sleep(2200)
const st2 = await ev(() => {
  const a = JSON.parse(localStorage.getItem('audio') || 'null')?.audio
  return { cur: a?.currentSong?.id, idx: a?.currentIndex, q: a?.playlist?.length }
})
const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
fs.writeFileSync(path.join(OUT, 'mobile-queue-click.png'), Buffer.from(data, 'base64'))
console.log(JSON.stringify({ rowsOnPage: s1, afterRowClick: st1, queueRows: click2, afterQueueClick: st2 }))
const pass = st1.q === 100 && st1.idx === 1 && click2 >= 4 && st2.q === 100 && st2.idx === 3
console.log(pass ? 'QUEUE-COMBO PASS' : 'QUEUE-COMBO FAIL')
ws.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {})
process.exit(0)
