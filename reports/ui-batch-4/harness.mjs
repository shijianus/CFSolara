import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const PLAYER = path.join(ROOT, 'player')
const DIST = path.join(PLAYER, 'dist')
const SHOTS = path.join(HERE, 'screenshots')
const COVER = path.join(ROOT, 'reports', 'ui-batch-1', 'cover-bright.png')
const BASE = 'http://127.0.0.1:4175'
const CDP_PORT = 9340
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fs.mkdirSync(SHOTS, { recursive: true })

const SILENT_AUDIO = (() => {
  const sampleRate = 8000
  const samples = Math.floor(sampleRate * 0.2)
  const buf = Buffer.alloc(44 + samples)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate, 28)
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36)
  buf.writeUInt32LE(samples, 40); buf.fill(128, 44)
  return 'data:audio/wav;base64,' + buf.toString('base64')
})()
const songs = [
  { id: 186016, name: 'Morning Light', artist: 'Aria North', album: 'First Light', albumId: 18821, cover: '/cover-bright.png', duration: 269000 },
  { id: 186017, name: 'Neon River', artist: 'Nova Fields', album: 'Night Drive', albumId: 18822, cover: '/cover-bright.png', duration: 240000 },
  { id: 186018, name: 'Blue Danube', artist: 'Johann Strauss II', album: 'Classics', albumId: 18823, cover: '/cover-bright.png', duration: 300000 },
  { id: 186019, name: 'Paper Planes', artist: 'Aria North', album: 'First Light', albumId: 18821, cover: '/cover-bright.png', duration: 214000 },
  { id: 186020, name: 'Glass Garden', artist: 'Nova Fields', album: 'Night Drive', albumId: 18822, cover: '/cover-bright.png', duration: 251000 },
  { id: 186021, name: 'Silver Hour', artist: 'The Coast', album: 'Tides', albumId: 18824, cover: '/cover-bright.png', duration: 233000 },
]
const playlists = [
  { id: 501, name: 'Morning Commute', picUrl: '/cover-bright.png', playCount: 1280000, trackCount: 24 },
  { id: 502, name: 'Late Night Writing', picUrl: '/cover-bright.png', playCount: 860000, trackCount: 18 },
  { id: 503, name: 'Fresh Pop Picks', picUrl: '/cover-bright.png', playCount: 450000, trackCount: 30 },
  { id: 504, name: 'Piano & Rain', picUrl: '/cover-bright.png', playCount: 320000, trackCount: 21 },
  { id: 505, name: 'Electronic Focus', picUrl: '/cover-bright.png', playCount: 280000, trackCount: 26 },
  { id: 506, name: 'Sunday Acoustic', picUrl: '/cover-bright.png', playCount: 210000, trackCount: 19 },
]
const mvs = [
  { id: 1000, name: 'Morning Light (Official Video)', cover: '/cover-bright.png', artistName: 'Aria North', playCount: 500000, duration: 240000 },
  { id: 1001, name: 'Neon River (Live)', cover: '/cover-bright.png', artistName: 'Nova Fields', playCount: 430000, duration: 231000 },
  { id: 1002, name: 'Blue Danube Session', cover: '/cover-bright.png', artistName: 'Johann Strauss II', playCount: 310000, duration: 300000 },
]
const lyrics = [
  '[00:00.00]Morning light across the room',
  '[00:12.00]Every little thing comes into view',
  '[00:24.00]Hold the moment, let it stay',
  '[00:36.00]We can find another way',
  '[00:48.00]Neon river running through the night',
  '[01:00.00]Chasing colors in the city light',
].join('\n')

function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function serveFile(res, file) {
  const ext = path.extname(file)
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.ttf': 'font/ttf', '.map': 'application/json',
  }
  res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}

const track = (s, i = 0) => ({
  id: s.id,
  name: s.name,
  ar: [{ id: 6452 + i, name: s.artist }],
  al: { id: s.albumId, name: s.album, picUrl: s.cover },
  dt: s.duration,
  duration: s.duration,
  url: SILENT_AUDIO,
  mvId: 1000 + i,
  qualityBadge: 'SQ',
  qualities: [{ level: 'lossless', label: 'SQ', bitrate: 'FLAC', format: 'flac' }],
})

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', BASE)
  const p = decodeURIComponent(url.pathname)
  if (p === '/cover-bright.png') return serveFile(res, COVER)
  if (p.startsWith('/api/')) {
    if (p === '/api/banner') {
      return json(res, {
        code: 200,
        banners: [{
          imageUrl: '/cover-bright.png', typeTitle: 'New Release', title: 'Morning Light',
          targetType: 1, targetId: 186016,
        }],
      })
    }
    if (p === '/api/top/playlist' || p === '/api/personalized') {
      return json(res, { code: 200, result: playlists })
    }
    if (p === '/api/top/song') {
      return json(res, { code: 200, data: { data: songs.map(track) } })
    }
    if (p === '/api/top/artists') {
      return json(res, {
        code: 200,
        artists: songs.map((s, i) => ({
          id: 6452 + i, name: s.artist, picUrl: s.cover, albumSize: 12, musicSize: 88, mvSize: 4,
        })),
      })
    }
    if (p === '/api/personalized/newsong') {
      return json(res, {
        code: 200,
        result: songs.map(s => ({
          id: s.id,
          name: s.name,
          song: { id: s.id, name: s.name, artists: [{ id: 6452, name: s.artist }], album: { id: s.albumId, name: s.album, picUrl: s.cover }, duration: s.duration },
        })),
      })
    }
    if (p === '/api/personalized/mv') {
      return json(res, { code: 200, result: mvs })
    }
    if (p === '/api/mv/all') {
      return json(res, { code: 200, data: mvs.map(mv => ({ ...mv, duration: mv.duration, cover: mv.cover })) })
    }
    if (p === '/api/mv/detail') {
      return json(res, {
        code: 200,
        data: {
          id: 1000, name: mvs[0].name, artistName: mvs[0].artistName, cover: mvs[0].cover,
          playCount: mvs[0].playCount, subCount: 1200, publishTime: '2025-05-01', desc: 'A warm opening track.',
        },
      })
    }
    if (p === '/api/mv/url') return json(res, { code: 200, data: { url: '' } })
    if (p === '/api/simi/mv') return json(res, { code: 200, mvs: mvs.slice(1) })
    if (p === '/api/song/detail') {
      return json(res, { code: 200, songs: [track(songs[0])] })
    }
    if (p === '/api/lyric' || p === '/api/music/lyric') {
      return json(res, { lrc: { lyric: lyrics }, tlyric: { lyric: '' }, romalrc: { lyric: '' } })
    }
    if (p === '/api/sonic/lyrics/nexus') {
      return json(res, { brand: 'Sonic', data: { plainLyrics: lyrics } })
    }
    if (p === '/api/search') {
      const type = Number(url.searchParams.get('type') || 1)
      if (type === 1000) {
        return json(res, { code: 200, result: { playlists, playlistCount: playlists.length } })
      }
      return json(res, { code: 200, result: { songs: songs.map(track), songCount: songs.length } })
    }
    if (p === '/api/playlist/detail') {
      return json(res, {
        code: 200,
        playlist: {
          name: playlists[0].name,
          description: 'A bright start to the day.',
          creator: { nickname: 'Sonic Editorial', avatarUrl: '' },
          createTime: 1700000000000,
          trackCount: songs.length,
          playCount: 1280000,
          subscribedCount: 3200,
          tags: ['Pop'],
          coverImgUrl: '/cover-bright.png',
        },
      })
    }
    if (p === '/api/playlist/track/all') {
      return json(res, { code: 200, songs: songs.map(track) })
    }
    if (p === '/api/comment/music' || p === '/api/comment/playlist' || p === '/api/comment/new') {
      return json(res, {
        code: 200,
        total: 2,
        more: false,
        comments: [
          { user: { nickname: 'Listener One', avatarUrl: '' }, content: 'Beautiful track.', time: Date.now() - 3600_000, likedCount: 12 },
          { user: null, content: 'Works offline too.', time: Date.now() - 7200_000, likedCount: 4 },
        ],
      })
    }
    if (p === '/api/search/hot/detail') {
      return json(res, { code: 200, data: [{ searchWord: 'Morning Light', score: 1000 }, { searchWord: 'Neon River', score: 900 }] })
    }
    if (p === '/api/search/default') return json(res, { code: 200, data: { showKeyword: 'Morning Light', realkeyword: 'Morning Light' } })
    if (p === '/api/login/status') return json(res, { code: 200, data: { code: 200, profile: null } })
    if (p === '/api/song/url/v1' || p === '/api/song/url') return json(res, { code: 200, data: [{ url: '', code: 200 }] })
    if (p === '/api/music/cover') return serveFile(res, COVER)
    return json(res, { code: 200, data: {}, result: [], banners: [], artists: [] })
  }
  const candidate = path.join(DIST, p.replace(/^\/+/, ''))
  if (candidate.startsWith(DIST) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return serveFile(res, candidate)
  }
  return serveFile(res, path.join(DIST, 'index.html'))
})

const wait = ms => new Promise(r => setTimeout(r, ms))

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let seq = 0
    const pending = new Map()
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(String(ev.data))
      if (!msg.id) return
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`))
      else p.resolve(msg.result)
    })
    ws.addEventListener('error', e => reject(new Error(`CDP socket error: ${e?.message || 'unknown'}`)))
    ws.addEventListener('open', () => {
      const send = (method, params = {}) => new Promise((res, rej) => {
        const id = ++seq
        pending.set(id, { resolve: res, reject: rej, method })
        ws.send(JSON.stringify({ id, method, params }))
      })
      resolve({ send, close: () => ws.close() })
    })
  })
}

const viewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '820x700', width: 820, height: 700 },
  { name: '844x390', width: 844, height: 390 },
  { name: '390x844', width: 390, height: 844 },
]

const only = process.env.ONLY ? process.env.ONLY.split(',').map(v => v.trim()).filter(Boolean) : null
const extraOnly = process.env.EXTRA_ONLY === '1'
const pages = [
  { name: 'home', route: '/' },
  { name: 'settings', route: '/settings' },
  { name: 'downloads', route: '/downloads' },
  { name: 'song', route: '/song/186016' },
  { name: 'not-found', route: '/missing-page' },
  { name: 'local-music', route: '/local-music' },
  { name: 'playlist', route: '/playlist/501' },
  { name: 'mv-list', route: '/mv-list' },
  { name: 'recent', route: '/recent' },
]

async function main() {
  await new Promise(resolve => server.listen(4175, '127.0.0.1', resolve))
  const profile = path.join(os.tmpdir(), `sonic-batch4-chrome-${Date.now()}`)
  fs.mkdirSync(profile, { recursive: true })
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--lang=en-US',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore' })

  let targets
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      targets = await r.json()
      if (targets.some(t => t.type === 'page')) break
    } catch {}
    await wait(200)
  }
  const pageTarget = targets?.find(t => t.type === 'page')
  if (!pageTarget) throw new Error('headless Chrome page target not available')

  const cdp = await connectCdp(pageTarget.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const evaluate = async (expression, awaitPromise = false) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true, userGesture: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result?.value
  }
  const waitFor = async (expr, timeout = 12000) => {
    const ok = await evaluate(
      `(async () => { const end = Date.now() + ${timeout}; while (Date.now() < end) { try { if (${expr}) return true } catch (e) {} await new Promise(r => setTimeout(r, 100)) } return false })()`,
      true,
    )
    if (!ok) throw new Error(`waitFor timeout: ${expr}`)
  }
  const setViewport = async ({ width, height }) => {
    const mobile = width < 768
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height,
    })
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 })
  }
  const setReducedMotion = async reduce => {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }],
    })
  }
  const shot = async name => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    const file = path.join(SHOTS, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
    return file
  }
  const nav = async (hash, nonce) => {
    await cdp.send('Page.navigate', { url: `${BASE}/?run=${nonce}#${hash}` })
    await waitFor(`document.readyState === 'complete' && !!document.querySelector('#app')`, 15000)
  }
  const setStorage = async ({ theme, lang }) => {
    await evaluate(`(() => {
      const song = ${JSON.stringify(songs[0])};
      localStorage.clear();
      localStorage.setItem('global', JSON.stringify({ count: 0, theme: ${JSON.stringify(theme)}, searchHistory: ['Morning Light', 'Neon River'], lang: ${JSON.stringify(lang)} }));
      localStorage.setItem('audio', JSON.stringify({ count: 0, audio: { currentSong: song, currentIndex: 0, playlist: ${JSON.stringify(songs.map(s => ({ id: s.id, name: s.name, artist: s.artist, album: s.album, duration: s.duration, cover: s.cover, url: SILENT_AUDIO })))}, originalPlaylist: [], playMode: 'list', volume: 1, isMuted: false, playHistory: ${JSON.stringify(songs.slice(0, 4).map(s => ({ id: s.id, name: s.name, artist: s.artist, album: s.album, duration: s.duration, cover: s.cover, url: SILENT_AUDIO })))}, error: null } }));
      localStorage.setItem('sonic-perf-mode', 'true');
    })()`)
  }
  const seedDownloads = async () => {
    await evaluate(`new Promise((resolve, reject) => {
      const req = indexedDB.open('SonicMusicPlayerDB', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('local_music')) db.createObjectStore('local_music', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('downloaded_music')) db.createObjectStore('downloaded_music', { keyPath: 'id' });
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB seed blocked'));
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('downloaded_music', 'readwrite');
        const store = tx.objectStore('downloaded_music');
        const blob = new Blob([new Uint8Array([0, 1, 2, 3, 4])], { type: 'audio/mpeg' });
        ${JSON.stringify(songs.slice(0, 3).map((s, i) => ({
          id: 9000 + i, name: s.name, artist: s.artist, album: s.album, duration: Math.round(s.duration / 1000), cover: s.cover,
          qualityLevel: ['lossless', 'exhigh', 'standard'][i], qualityBadge: ['SQ', 'HQ', '标准'][i],
          bitrate: ['FLAC 24-bit', '320kbps', '128kbps'][i], format: i === 0 ? 'flac' : 'mp3',
          fileSize: [38200000, 9400000, 4200000][i], downloadTime: Date.now() - i * 1000, streamUrl: '',
        })))}.forEach(row => { row.file = blob; store.put(row) });
        tx.oncomplete = () => { db.close(); resolve(true) };
        tx.onerror = () => reject(tx.error);
      };
    })`)
    await wait(1200)
  }

  console.log('boot: viewport')
  await setViewport(viewports[0])
  await setReducedMotion(false)
  console.log('boot: nav seed')
  await nav('/', 'seed')
  console.log('boot: storage seed')
  await setStorage({ theme: 'dark', lang: 'zh' })
  console.log('boot: downloads seed')
  await seedDownloads()
  console.log('boot: downloads seed done')

  // Visual matrix: 4 viewports × 2 themes, zh copy.
  let nonce = 0
  const activePages = only ? pages.filter(page => only.includes(page.name)) : pages
  if (!extraOnly) for (const vp of viewports) {
    for (const theme of ['light', 'dark']) {
      for (const page of activePages) {
        nonce++
        process.stdout.write(`shot ${page.name} ${vp.name} ${theme}\n`)
        await setViewport(vp)
        await setStorage({ theme, lang: 'zh' })
        await nav(page.route, `${page.name}-${vp.name}-${theme}-${nonce}`)
        await waitFor(`!!document.querySelector('#app')`)
        await wait(page.name === 'home' ? 2600 : page.name === 'downloads' ? 1600 : 1100)
        if (page.name === 'home') {
          await waitFor(`document.querySelectorAll('.hero-card').length > 0`, 8000).catch(() => {})
        }
        if (page.name === 'downloads') {
          await waitFor(`document.body.innerText.includes('Morning Light') || document.body.innerText.includes('Empty')`, 8000).catch(() => {})
        }
        await shot(`${page.name}-${vp.name}-${theme}`)
      }
    }
  }


  if (!only || only.includes('home')) {
    nonce++
    await setViewport(viewports[0])
    await setStorage({ theme: 'dark', lang: 'zh' })
    await nav('/', `queue-test-${nonce}`)
    await wait(2600)
    await evaluate(`(() => { const card = document.querySelectorAll('.song-card')[1]; if (card) card.scrollIntoView({ block: 'center' }); })()`)
    await wait(400)
    await shot('home-hot-songs-1440x900-dark')
    const queueBefore = await evaluate(`JSON.parse(localStorage.getItem('audio') || '{}').audio?.playlist?.length ?? -1`)
    await evaluate(`(() => { const cards = document.querySelectorAll('.song-card'); if (cards[1]) cards[1].click(); })()`)
    await wait(900)
    const queueAfter = await evaluate(`(() => { const audio = JSON.parse(localStorage.getItem('audio') || '{}').audio || {}; return { length: audio.playlist?.length ?? -1, currentIndex: audio.currentIndex, currentName: audio.currentSong?.name || '' }; })()`)
    await shot('home-now-playing-1440x900-dark')
    fs.writeFileSync(path.join(HERE, 'queue-test.json'), JSON.stringify({ queueBefore, queueAfter }, null, 2))
  }

  // Extra states: settings privacy block, download quality dialog, mobile delete dialog.
  if (!only) for (const theme of ['light', 'dark']) {
    nonce++
    await setViewport(viewports[0])
    await setStorage({ theme, lang: 'zh' })
    await nav('/settings', `privacy-${theme}-${nonce}`)
    await wait(600)
    await evaluate(`(() => { const h = [...document.querySelectorAll('h3')].find(el => el.textContent.includes('隐私与本地数据')); if (h) h.scrollIntoView({ block: 'center' }); })()`)
    await wait(300)
    await shot(`settings-privacy-1440x900-${theme}`)

    nonce++
    await nav('/downloads', `quality-dialog-${theme}-${nonce}`)
    await wait(900)
    await evaluate(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '下载'); if (btn) btn.click(); })()`)
    await wait(700)
    await shot(`download-dialog-1440x900-${theme}`)
  }

  if (!only) {
  nonce++
  await setViewport(viewports[3])
  await setStorage({ theme: 'dark', lang: 'zh' })
  await nav('/downloads', `mobile-delete-${nonce}`)
  await wait(900)
  await evaluate(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === '删除'); if (btn) btn.click(); })()`)
  await wait(500)
  await shot('download-delete-390x844-dark')

  nonce++
  await nav('/settings', `mobile-settings-bottom-${nonce}`)
  await wait(600)
  await evaluate(`(() => { const el = document.querySelector('.overflow-auto'); if (el) el.scrollTop = el.scrollHeight; })()`)
  await wait(300)
  await shot('settings-privacy-390x844-dark')
  }

  // i18n sweep in en/ja at desktop and mobile widths.
  const i18nResults = []
  if (!only && !extraOnly) for (const lang of ['en', 'ja']) {
    for (const vp of [viewports[0], viewports[3]]) {
      for (const page of pages) {
        nonce++
        await setViewport(vp)
        await setStorage({ theme: 'dark', lang })
        await nav(page.route, `lang-${lang}-${vp.name}-${page.name}-${nonce}`)
        await wait(page.name === 'home' ? 2600 : page.name === 'downloads' ? 1500 : 900)
        const text = await evaluate(`document.body.innerText`)
        const cjk = (text.match(/[\u4e00-\u9fa5]{4,}/g) || [])
        const shortCjk = (text.match(/[\u4e00-\u9fa5]{1,3}/g) || [])
        const rawKeys = (text.match(/\[missing:[^\]]+\]|(?:components|home|player|downloads|quality|common|layout|recent|search)\.[a-zA-Z0-9_.]+/g) || [])
        const zhHints = (text.match(/下载列表|暂无|播放全部|歌单|评论|未知歌手|取消|清空|正在播放|搜索|设置|本地音乐|分享|收藏|加载中|确认删除|音质/g) || [])
        i18nResults.push({ lang, viewport: vp.name, page: page.name, cjk, shortCjk, rawKeys, zhHints })
      }
    }
  }
  if (!only && !extraOnly) fs.writeFileSync(path.join(HERE, 'i18n-sweep.json'), JSON.stringify(i18nResults, null, 2))

  // reduced-motion: scroll-in fallback, no carousel autoplay, pause button present.
  if (!only && !extraOnly) {
  await setReducedMotion(true)
  await setViewport(viewports[0])
  await setStorage({ theme: 'dark', lang: 'zh' })
  await nav('/', 'reduced-home')
  await wait(2400)
  const reduced = await evaluate(`(() => {
    const swiper = document.querySelector('.home-swiper, .swiper')?.swiper || document.querySelector('.swiper')?.swiper;
    const items = [...document.querySelectorAll('.stagger-item')];
    const hidden = items.filter(el => Number(getComputedStyle(el).opacity) < 0.9).length;
    return {
      pauseButton: !!document.querySelector('button[aria-label*="轮播"]'),
      autoplayRunning: !!swiper?.autoplay?.running,
      hiddenStaggerItems: hidden,
      activeIndex: swiper?.activeIndex ?? null,
    };
  })()`)
  await wait(5200)
  const reducedAfter = await evaluate(`(() => {
    const swiper = document.querySelector('.swiper')?.swiper;
    return { autoplayRunning: !!swiper?.autoplay?.running, activeIndex: swiper?.activeIndex ?? null };
  })()`)
  fs.writeFileSync(path.join(HERE, 'reduced-motion.json'), JSON.stringify({ reduced, reducedAfter }, null, 2))

  // Hover/focus pause (no reduced motion): autoplay should stop while hovered.
  await setReducedMotion(false)
  await nav('/', 'hover-pause')
  await wait(500)
  const hoverPause = await evaluate(`(async () => {
    const section = document.querySelector('section');
    section?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    await new Promise(r => setTimeout(r, 200));
    const swiper = document.querySelector('.swiper')?.swiper;
    const paused = swiper ? !swiper.autoplay.running : null;
    section?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    await new Promise(r => setTimeout(r, 200));
    return { pausedOnHover: paused, runningAfterLeave: swiper ? swiper.autoplay.running : null };
  })()`, true)
  fs.writeFileSync(path.join(HERE, 'carousel-hover.json'), JSON.stringify(hoverPause, null, 2))
  }

  if (!extraOnly) console.log('i18n sweep issues:', i18nResults.filter(r => r.cjk.length || r.rawKeys.length).length)
  if (!only && !extraOnly) {
    console.log('reduced motion:', JSON.stringify(reduced), JSON.stringify(reducedAfter))
    console.log('hover pause:', JSON.stringify(hoverPause))
  }

  await cdp.send('Browser.close').catch(() => {})
  chrome.kill()
  server.close()
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
  server.close()
})
