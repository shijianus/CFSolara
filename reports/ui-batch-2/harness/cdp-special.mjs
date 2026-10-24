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
  await sleep(700)
  return ok
}
const clickTrusted = async (text, exact = false) => {
  const point = await evaluate(
    ({ text, exact }) => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim()
      const el = [...document.querySelectorAll('button')].find(n =>
        exact ? norm(n.textContent) === text : norm(n.textContent).includes(text)
      )
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    },
    { text, exact }
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
const clickTrustedLabel = async label => {
  const point = await evaluate(l => {
    const el = document.querySelector(`button[aria-label="${l}"]`)
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, label)
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

const clickSongAction = async (name, action) => {
  const ok = await evaluate(
    ({ name, action }) => {
      const row = [...document.querySelectorAll('.song-item')].find(r =>
        (r.textContent || '').includes(name)
      )
      if (!row) return false
      const btn = [...row.querySelectorAll('button')].find(b =>
        (b.getAttribute('title') || '').includes(action)
      )
      if (!btn) return false
      btn.click()
      return true
    },
    { name, action }
  )
  await sleep(500)
  return ok
}
const playRow = async name => {
  const ok = await evaluate(n => {
    const row = [...document.querySelectorAll('.song-item')].find(r =>
      (r.textContent || '').includes(n)
    )
    if (!row) return false
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return true
  }, name)
  await sleep(2500)
  return ok
}
const state = () =>
  evaluate(() => {
    const audio = JSON.parse(localStorage.getItem('audio') || 'null')?.audio || null
    const player = document.querySelector('#audioPlayer')
    return {
      toast: [...document.querySelectorAll('[role="alert"],[role="status"]')]
        .map(e => e.innerText)
        .filter(Boolean),
      paused: player?.paused,
      current: audio?.currentSong || null,
      queue: audio?.playlist?.length ?? null,
      text: document.body.innerText.slice(0, 200),
    }
  })
const seedLibrary = () =>
  evaluate(() => {
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

await send('Page.enable')
await send('Runtime.enable')
await setViewport(1440, 900)
await goto('/', 800)
await evaluate(() => localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' })))
await seedLibrary()

// 1. playback error toast
await goto('/playlist/1', 1800)
await playRow('测试歌曲 4')
console.log('playback error', await state())
await screenshot('1440x900-dark-playback-error')

// 2. quality failure toast
await evaluate(() => localStorage.removeItem('audio'))
await goto('/playlist/1', 1800)
await playRow('测试歌曲 3')
await sleep(1200)
await evaluate(() => document.querySelector('#footer-quality-btn')?.click())
await sleep(1800)
await clickTrusted('HQ 极高')
await sleep(2500)
console.log('quality failure', await state())
await screenshot('1440x900-dark-quality-failure')

// 3. song detail play/pause
await evaluate(() => localStorage.removeItem('audio'))
await goto('/song/1001', 1800)
await clickTrusted('播放', true)
await sleep(3000)
console.log('song playing', await state())
await screenshot('1440x900-dark-song-playing')
await clickTrusted('暂停', true)
await sleep(600)
console.log('song paused', await state())
await screenshot('1440x900-dark-song-paused')

// 4. queue clear undo
await goto('/my-music', 1500)
await clickText('清空', true)
await sleep(400)
await screenshot('1440x900-dark-queue-undo')
await clickText('撤销', true)
await sleep(800)

// 5. download dialog / progress / duplicate / cancel
await evaluate(async () => {
  await new Promise(resolve => {
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
})
await goto('/playlist/1', 1800)
await clickSongAction('测试歌曲 1', '下载')
await sleep(1000)
await screenshot('1440x900-dark-download-dialog')
await clickText('下载 (')
await sleep(900)
await screenshot('1440x900-dark-download-progress')
await sleep(5000)
await clickSongAction('测试歌曲 1', '下载')
await sleep(800)
await clickText('下载 (')
await sleep(900)
await screenshot('1440x900-dark-download-overwrite')
await clickText('覆盖下载', true)
await sleep(900)
await clickText('取消下载', true)
await sleep(1000)
console.log('download cancel', await state())
await screenshot('1440x900-dark-download-cancelled')

// 6. missing local file toast
await evaluate(() => {
  const song = {
    id: 'missing-1',
    name: '丢失的本地文件',
    artist: '测试歌手',
    duration: 1000,
    url: 'blob:http://127.0.0.1:5090/stale-missing-1',
    isLocal: true,
  }
  localStorage.setItem(
    'audio',
    JSON.stringify({
      count: 0,
      audio: {
        currentSong: song,
        currentIndex: 0,
        playlist: [song],
        originalPlaylist: [song],
        playMode: 'list',
        volume: 1,
        isMuted: false,
        playHistory: [],
      },
    })
  )
})
await goto('/playlist/1', 1800)
await screenshot('1440x900-dark-local-missing')

// 7. artists empty and error
await goto('/artists', 1500)
await clickText('Z', true)
await screenshot('1440x900-dark-artists-empty')
await clickText('重置筛选', true)
await sleep(800)
await clickText('韩国', true)
await sleep(1200)
await screenshot('1440x900-dark-artists-error')

// 8. playlist load more 100 -> 130
await evaluate(() => localStorage.removeItem('audio'))
await goto('/playlist/1', 1800)
await evaluate(() => {
  const scroller = document.querySelector('main .overflow-y-auto')
  if (scroller) scroller.scrollTop = scroller.scrollHeight
})
await sleep(500)
await screenshot('1440x900-dark-playlist-loaded100')
await clickText('加载更多歌曲')
await evaluate(() => {
  const scroller = document.querySelector('main .overflow-y-auto')
  if (scroller) scroller.scrollTop = scroller.scrollHeight
})
await sleep(600)
await screenshot('1440x900-dark-playlist-loaded130')

// 9. 820 / 844 likes after responsive fix
for (const v of [
  { width: 820, height: 700, label: '820x700' },
  { width: 844, height: 390, label: '844x390' },
]) {
  await setViewport(v.width, v.height)
  for (const theme of ['dark', 'light']) {
    await evaluate(t => localStorage.setItem('global', JSON.stringify({ theme: t, lang: 'zh' })), theme)
    await goto('/likes', 1700)
    await screenshot(`${v.label}-${theme}-likes`)
  }
}

// 10. mobile song pause + my music entry
await setViewport(390, 844, true)
await evaluate(() => localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' })))
await goto('/recent', 1500)
await screenshot('390x844-dark-my-music-entry')
await evaluate(() => localStorage.removeItem('audio'))
await goto('/song/1001', 1800)
await clickTrustedLabel('播放')
await sleep(3000)
await screenshot('390x844-dark-song-playing')
await clickTrustedLabel('暂停')
await sleep(600)
await screenshot('390x844-dark-song-paused')
console.log('mobile song', await state())

console.log('SPECIAL DONE')
ws.close()
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {})
