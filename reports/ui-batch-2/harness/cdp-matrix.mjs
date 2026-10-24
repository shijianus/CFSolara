import fs from 'node:fs'
import path from 'node:path'

const PORT = 9222
const BASE = 'http://127.0.0.1:5090'
const OUT = path.resolve('images/batch2')
fs.mkdirSync(OUT, { recursive: true })

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

const waitEvent = (method, timeout = 10000) =>
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
const viewports = [
  { width: 1440, height: 900, mobile: false, label: '1440x900' },
  { width: 820, height: 700, mobile: false, label: '820x700' },
  { width: 844, height: 390, mobile: false, label: '844x390' },
  { width: 390, height: 844, mobile: true, label: '390x844' },
]
const themes = ['dark', 'light']
const pages = [
  { name: 'playlist', route: '/playlist/1', wait: 2200 },
  { name: 'artist', route: '/artist/1', wait: 2600 },
  { name: 'likes', route: '/likes', wait: 1800 },
  { name: 'mv', route: '/mv-player/1', wait: 1800 },
  { name: 'song', route: '/song/1001', wait: 1800 },
]

const setViewport = async v => {
  await send('Emulation.setDeviceMetricsOverride', {
    width: v.width,
    height: v.height,
    deviceScaleFactor: 1,
    mobile: v.mobile,
    screenWidth: v.width,
    screenHeight: v.height,
  })
}

const setTheme = theme =>
  evaluate(t => localStorage.setItem('global', JSON.stringify({ theme: t, lang: 'zh' })), theme)

const goto = async (route, wait) => {
  await send('Page.navigate', { url: `${BASE}/?m=${Date.now()}#${route}` })
  await waitEvent('Page.loadEventFired').catch(() => {})
  await sleep(wait)
}

const screenshot = async name => {
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log('saved', name)
}

const clickText = async (text, exact = false) => {
  const ok = await evaluate(
    ({ text, exact }) => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim()
      const el = [...document.querySelectorAll('button, a')].find(n =>
        exact ? norm(n.textContent) === text : norm(n.textContent).includes(text)
      )
      if (!el) return false
      el.click()
      return true
    },
    { text, exact }
  )
  await sleep(800)
  return ok
}

await send('Page.enable')
await send('Runtime.enable')

// 保证喜欢页有真实数据（沿用本会话已写入的 library，缺失时补种子）
await setViewport(viewports[0])
await goto('/', 800)
await setTheme('dark')
await evaluate(() => {
  const lib = JSON.parse(localStorage.getItem('library') || 'null')
  if (!lib || !lib.likedSongs?.length) {
    localStorage.setItem(
      'library',
      JSON.stringify({
        likedSongs: [
          {
            id: 1001,
            name: '测试歌曲 1',
            artist: '测试歌手 2',
            album: '测试专辑 2',
            cover: '/media/cover.svg',
            duration: 151000,
            likedAt: Date.now(),
          },
        ],
        collectedPlaylists: [
          {
            id: 1,
            name: '分页测试歌单（130 首）',
            coverImgUrl: '/media/cover.svg',
            trackCount: 130,
            creator: 'Sonic 测试',
            playCount: 123456,
            collectedAt: Date.now(),
          },
        ],
        followedArtists: [
          { id: 1, name: '分页测试歌手', picUrl: '/media/cover.svg', followedAt: Date.now() },
        ],
        likedMvs: [
          {
            id: 1,
            name: 'MV 无源测试',
            artist: '测试歌手',
            cover: '/media/cover.svg',
            likedAt: Date.now(),
          },
        ],
        collectedAlbums: [],
      })
    )
  }
  localStorage.removeItem('audio')
})

for (const v of viewports) {
  await setViewport(v)
  for (const theme of themes) {
    await setTheme(theme)
    for (const page of pages) {
      await goto(page.route, page.wait)
      await screenshot(`${v.label}-${theme}-${page.name}`)
      if (page.name === 'playlist' && !v.mobile) {
        await clickText('评论')
        await screenshot(`${v.label}-${theme}-playlist-comments`)
      }
      if (page.name === 'artist') {
        await clickText('专辑', true)
        await screenshot(`${v.label}-${theme}-artist-albums`)
      }
    }
  }
}

console.log('MATRIX DONE')
ws.close()
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {})
