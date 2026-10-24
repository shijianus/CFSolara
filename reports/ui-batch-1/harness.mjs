import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const DIST = path.join(ROOT, 'player', 'dist')
const SHOTS = path.join(HERE, 'screenshots')
const COVER = path.join(HERE, 'cover-bright.png')
const BASE = 'http://127.0.0.1:4174'
const CDP_PORT = 9339
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fs.mkdirSync(SHOTS, { recursive: true })

const playlists = [
  { id: 501, name: '清晨通勤 · 轻电子精选集', picUrl: '/cover-bright.png', playCount: 1280000, trackCount: 24 },
  { id: 502, name: '深夜写作电台：雨声与钢琴', picUrl: '/cover-bright.png', playCount: 860000, trackCount: 18 },
  { id: 503, name: '华语流行新声采样', picUrl: '/cover-bright.png', playCount: 450000, trackCount: 30 },
]
const songs = [
  { id: 186016, name: '晴天', artist: '周杰伦', album: '叶惠美', albumId: 18821, cover: '/cover-bright.png', duration: 269000 },
  { id: 186017, name: '夜曲', artist: '周杰伦', album: '十一月的萧邦', albumId: 18822, cover: '/cover-bright.png', duration: 240000 },
  { id: 186018, name: '蓝色多瑙河', artist: 'Johann Strauss II', album: 'Classics', albumId: 18823, cover: '/cover-bright.png', duration: 300000 },
]
const hotSearches = [
  ['晴天', 38620000, 1], ['夜曲', 29800000, 5], ['稻香', 25100000, 0], ['七里香', 20700000, 1],
  ['告白气球', 17200000, 5], ['青花瓷', 15100000, 0], ['一路向北', 12800000, 1], ['反方向的钟', 10400000, 0],
  ['最长的电影', 9800000, 5], ['搁浅', 8700000, 0], ['花海', 7900000, 1], ['珊瑚海', 7100000, 0],
  ['退后', 6600000, 5], ['蒲公英的约定', 5900000, 0], ['半岛铁盒', 5200000, 1], ['爷爷泡的茶', 4600000, 0],
]
const lyrics = [
  '[00:00.00]故事的小黄花 从出生那年就飘着',
  '[00:12.00]童年的荡秋千 随记忆一直晃到现在',
  '[00:24.00]Re So So Si Do Si La',
  '[00:31.00]So La Si Si Si Si La Si La So',
  '[00:38.00]吹着前奏望着天空',
  '[00:45.00]我想起花瓣试着掉落',
  '[00:52.00]为你翘课的那一天',
  '[00:59.00]花落的那一天 教室的那一间',
  '[01:06.00]我怎么看不见',
  '[01:13.00]消失的下雨天 我好想再淋一遍',
  '[01:20.00]没想到失去的勇气我还留着',
  '[01:27.00]好想再问一遍 你会等待还是离开',
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
    '.json': 'application/json', '.woff2': 'font/woff2',
  }
  res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', BASE)
  const p = decodeURIComponent(url.pathname)
  if (p === '/cover-bright.png') return serveFile(res, COVER)
  if (p.startsWith('/api/')) {
    if (p === '/api/banner') return json(res, { code: 200, banners: [] })
    if (p === '/api/personalized') return json(res, { code: 200, result: playlists })
    if (p === '/api/personalized/newsong') {
      return json(res, {
        code: 200,
        result: songs.map(s => ({
          id: s.id,
          name: s.name,
          song: {
            id: s.id,
            name: s.name,
            artists: [{ id: 6452, name: s.artist }],
            album: { id: s.albumId, name: s.album, picUrl: s.cover },
            duration: s.duration,
          },
        })),
      })
    }
    if (p === '/api/personalized/mv') {
      return json(res, {
        code: 200,
        result: songs.slice(0, 3).map((s, i) => ({
          id: 1000 + i, name: `${s.name} 官方 MV`, cover: s.cover,
          artistName: s.artist, playCount: 500000, duration: 240000,
        })),
      })
    }
    if (p === '/api/top/artists') {
      return json(res, {
        code: 200,
        artists: songs.map((s, i) => ({
          id: 6452 + i, name: s.artist, picUrl: s.cover, albumSize: 12, musicSize: 88,
        })),
      })
    }
    if (p === '/api/search/hot/detail') {
      return json(res, {
        code: 200,
        data: hotSearches.map(([searchWord, score, iconType]) => ({ searchWord, score, iconType })),
      })
    }
    if (p === '/api/search/default') {
      return json(res, { code: 200, data: { showKeyword: '晴天', realkeyword: '晴天' } })
    }
    if (p === '/api/sonic/lyrics/nexus') {
      return json(res, { brand: 'Sonic', data: { plainLyrics: lyrics } })
    }
    if (p === '/api/music/lyric' || p === '/api/lyric') {
      return json(res, { lrc: { lyric: lyrics }, tlyric: { lyric: '' } })
    }
    if (p === '/api/comment/music') return json(res, { code: 200, total: 0, comments: [] })
    if (p === '/api/login/status') return json(res, { code: 200, data: { code: 200, profile: null } })
    if (p === '/api/song/url/v1' || p === '/api/song/url') {
      return json(res, { code: 200, data: [{ url: '', code: 200 }] })
    }
    if (p === '/api/music/cover') return serveFile(res, COVER)
    return json(res, { code: 200, data: {}, result: [], banners: [], artists: [] })
  }
  const candidate = path.join(DIST, p.replace(/^\/+/, ''))
  if (candidate.startsWith(DIST) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return serveFile(res, candidate)
  }
  return serveFile(res, path.join(DIST, 'index.html'))
})

function wait(ms) { return new Promise(r => setTimeout(r, ms)) }

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

async function main() {
  await new Promise(resolve => server.listen(4174, '127.0.0.1', resolve))
  const profile = path.join(HERE, '.chrome-profile')
  fs.rmSync(profile, { recursive: true, force: true })
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--lang=zh-CN',
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
  const shot = async name => {
    const r = await cdp.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    })
    const file = path.join(SHOTS, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
    return file
  }
  const nav = async (hash, nonce) => {
    await cdp.send('Page.navigate', { url: `${BASE}/?run=${nonce}#${hash}` })
    await waitFor(`document.readyState === 'complete' && !!document.querySelector('#app')`, 15000)
  }
  const setStorage = async theme => {
    const song = songs[0]
    await evaluate(`(() => {
      const song = ${JSON.stringify(song)};
      localStorage.clear();
      localStorage.setItem('global', JSON.stringify({ count: 0, theme: ${JSON.stringify(theme)}, searchHistory: ['晴天', '夜曲', '蓝色多瑙河'], lang: 'zh' }));
      localStorage.setItem('audio', JSON.stringify({ count: 0, audio: { currentSong: song, currentIndex: 0, playlist: [song], originalPlaylist: [song], playMode: 'list', volume: 1, isMuted: false, playHistory: [] } }));
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
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('downloaded_music', 'readwrite');
        const store = tx.objectStore('downloaded_music');
        const blob = new Blob([new Uint8Array([0, 1, 2, 3, 4])], { type: 'audio/mpeg' });
        [
          { id: 9001, name: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269, cover: '/cover-bright.png', qualityLevel: 'lossless', qualityBadge: 'SQ', bitrate: 'FLAC 24-bit', format: 'flac', fileSize: 38200000, file: blob, downloadTime: Date.now(), streamUrl: '' },
          { id: 9002, name: '夜曲', artist: '周杰伦', album: '十一月的萧邦', duration: 240, cover: '/cover-bright.png', qualityLevel: 'exhigh', qualityBadge: 'HQ', bitrate: '320kbps', format: 'mp3', fileSize: 9400000, file: blob, downloadTime: Date.now() - 1000, streamUrl: '' },
          { id: 9003, name: '蓝色多瑙河', artist: 'Johann Strauss II', album: 'Classics', duration: 300, cover: '/cover-bright.png', qualityLevel: 'standard', qualityBadge: '标准', bitrate: '128kbps', format: 'mp3', fileSize: 4200000, file: blob, downloadTime: Date.now() - 2000, streamUrl: '' }
        ].forEach(row => store.put(row));
        tx.oncomplete = () => { db.close(); resolve(true) };
        tx.onerror = () => reject(tx.error);
      };
    })`, true)
  }

  await setViewport({ width: 1440, height: 900 })
  await nav('/', 'seed')
  await waitFor(`!!document.querySelector('#app')`)
  await seedDownloads()

  const results = []
  const scenarios = []
  const viewports = [
    { name: '1440x900', width: 1440, height: 900 },
    { name: '820x700', width: 820, height: 700 },
    { name: '844x390', width: 844, height: 390 },
    { name: '390x844', width: 390, height: 844 },
  ]

  for (const vp of viewports) {
    for (const theme of ['light', 'dark']) {
      scenarios.push({ page: 'settings', route: '/settings', vp, theme })
      scenarios.push({ page: 'downloads', route: '/downloads', vp, theme })
    }
  }
  for (const vp of viewports.slice(0, 3)) {
    for (const theme of ['light', 'dark']) scenarios.push({ page: 'search', route: '/search', vp, theme })
  }
  for (const theme of ['light', 'dark']) {
    scenarios.push({ page: 'home-mobile', route: '/', vp: viewports[3], theme })
  }
  for (const vp of [viewports[0], viewports[1], viewports[3]]) {
    for (const theme of ['light', 'dark']) scenarios.push({ page: 'lyrics', route: '/', vp, theme })
  }

  let nonce = 0
  for (const sc of scenarios) {
    const { page, route, vp, theme } = sc
    nonce++
    process.stdout.write(`capture ${page} ${vp.name} ${theme} ... `)
    await setViewport(vp)
    await setStorage(theme)
    await nav(route, `${page}-${vp.name}-${theme}-${nonce}`)
    await waitFor(`!!document.querySelector('#app')`)
    await evaluate(`document.documentElement.classList.add('perf-mode')`)

    if (page === 'settings') {
      await waitFor(`document.querySelector('h1') && [...document.querySelectorAll('button')].some(b => b.classList.contains('glass-button'))`, 12000)
      await wait(300)
    } else if (page === 'downloads') {
      await waitFor(`!!document.querySelector('#downloads-title-heading') || !!document.querySelector('h1')`, 12000)
      await waitFor(`document.body.innerText.includes('晴天')`, 12000)
      await wait(300)
    } else if (page === 'search') {
      await waitFor(`document.querySelectorAll('.hot-item').length > 0`, 12000)
      await wait(300)
    } else if (page === 'home-mobile') {
      await waitFor(`document.querySelectorAll('.playlist-name').length > 0`, 12000)
      await wait(300)
    } else if (page === 'lyrics') {
      if (vp.width >= 768) {
        await waitFor(`!!document.querySelector('#footer-cover')`, 12000)
        await evaluate(`document.querySelector('#footer-cover').click()`)
      } else {
        await waitFor(`!!document.querySelector('.mask-glass .glass-card img')`, 12000)
        await evaluate(`document.querySelector('.mask-glass .glass-card img').click()`)
      }
      await waitFor(`document.querySelectorAll('.lyric-line').length > 1`, 15000)
      await wait(600)
      if (vp.width >= 768 && vp.width < 1024) {
        await evaluate(`(() => {
          const btn = [...document.querySelectorAll('button')].find(b => b.innerHTML.includes('mdi--text-box-outline'));
          if (btn) btn.click();
        })()`)
        await waitFor(`getComputedStyle(document.querySelector('.lyrics-container')).display !== 'none'`, 12000)
      } else if (vp.width < 768) {
        await evaluate(`document.querySelector('.album-area')?.click()`)
        await waitFor(`getComputedStyle(document.querySelector('.lyrics-container')).display !== 'none'`, 12000)
      }
      await evaluate(`document.querySelector('.lyric-line[data-index="2"]')?.click()`)
      await waitFor(`(() => {
        const line = document.querySelector('.lyric-line.current');
        if (!line) return false;
        const rect = line.getBoundingClientRect();
        const style = getComputedStyle(line);
        return rect.top > 0 && rect.bottom < innerHeight && Number(style.opacity) > 0.9;
      })()`, 12000)
    }

    // Let route enter/leave transitions and cover-color fades settle before capture.
    await wait(1500)
    const name = `${page}-${vp.name}-${theme}`
    const file = await shot(name)

    let metrics = {}
    if (page === 'settings') {
      metrics = await evaluate(`(() => {
        const parse = value => { const m = value.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r:p[0], g:p[1], b:p[2], a:p[3] ?? 1 } };
        const bg = el => { let cur = el; while (cur) { const c = parse(getComputedStyle(cur).backgroundColor); if (c && c.a > .85) return c; cur = cur.parentElement } return { r:255,g:255,b:255,a:1 } };
        const lum = c => { const f = v => { v/=255; return v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4 }; return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b) };
        const ratio = (a,b) => { const l1=lum(a), l2=lum(b); return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05) };
        const title = document.querySelector('h1');
        const card = document.querySelector('.glass-card');
        const buttons = [...document.querySelectorAll('button.glass-button')].map(b => ({
          text: b.innerText.trim(), color: getComputedStyle(b).color,
          arrowColor: b.querySelector('span:last-child') ? getComputedStyle(b.querySelector('span:last-child')).color : null,
        }));
        const tcol = parse(getComputedStyle(title).color), tbg = bg(title);
        return {
          themeClass: document.documentElement.className,
          title: title?.innerText, titleColor: getComputedStyle(title).color,
          titleContrast: ratio(tcol, tbg).toFixed(2),
          cardBackground: getComputedStyle(card).backgroundColor,
          cardBackgroundImage: getComputedStyle(card).backgroundImage,
          cardShadow: getComputedStyle(card).boxShadow,
          buttons,
          perfSwitch: document.querySelector('[role=switch]')?.getAttribute('aria-checked'),
        }
      })()`)
    } else if (page === 'downloads') {
      metrics = await evaluate(`(() => {
        const title = document.querySelector('#downloads-title-heading') || [...document.querySelectorAll('h1')].find(h => h.innerText.includes('下载列表'));
        const firstName = document.querySelector('.download-song-item h3') || document.querySelector('h4');
        const row = document.querySelector('.download-song-item');
        const firstArtist = row ? row.querySelector('p') : document.querySelector('h4 + p');
        const sortLabel = [...document.querySelectorAll('button.glass-button')].map(b => ({
          text: b.innerText.trim(), color: getComputedStyle(b).color,
        })).find(x => /最新下载|歌曲名称|文件大小/.test(x.text));
        return {
          title: title?.innerText, titleColor: title ? getComputedStyle(title).color : null,
          firstName: firstName?.innerText, firstNameColor: firstName ? getComputedStyle(firstName).color : null,
          firstArtist: firstArtist?.innerText, firstArtistColor: firstArtist ? getComputedStyle(firstArtist).color : null,
          sortLabel,
        }
      })()`)
    } else if (page === 'search') {
      metrics = await evaluate(`(() => [...document.querySelectorAll('.hot-item')].slice(3, 7).map(item => {
        const spans = [...item.querySelectorAll(':scope > span')];
        const heat = spans[spans.length - 1];
        const cs = getComputedStyle(heat);
        return { word: item.innerText.split('\\n')[0], heat: heat.innerText, fontSize: cs.fontSize, color: cs.color };
      }))()`)
    } else if (page === 'home-mobile') {
      metrics = await evaluate(`(() => {
        const el = document.querySelector('.playlist-name');
        const cs = getComputedStyle(el);
        const sec = document.querySelector('.section-title');
        return {
          playlistName: el?.innerText, fontSize: cs.fontSize, color: cs.color, opacity: cs.opacity,
          sectionTitle: sec?.innerText, sectionTitleColor: sec ? getComputedStyle(sec).color : null,
        }
      })()`)
    } else if (page === 'lyrics') {
      metrics = await evaluate(`(() => {
        const c = document.querySelector('.lyrics-container');
        const lines = [...document.querySelectorAll('.lyric-line')];
        const current = document.querySelector('.lyric-line.current');
        const other = lines.find(l => !l.classList.contains('current'));
        const cs = c ? getComputedStyle(c) : null;
        return {
          lineCount: lines.length,
          currentText: current?.innerText,
          currentColor: current ? getComputedStyle(current).color : null,
          otherColor: other ? getComputedStyle(other).color : null,
          containerBackground: cs?.backgroundColor,
          activeToken: cs?.getPropertyValue('--lyric-word-active').trim(),
          inactiveToken: cs?.getPropertyValue('--lyric-word-inactive').trim(),
          rect: c ? {
            x: Math.round(c.getBoundingClientRect().x), y: Math.round(c.getBoundingClientRect().y),
            w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height),
          } : null,
        }
      })()`)
    }

    results.push({ page, viewport: vp.name, theme, file: path.relative(HERE, file), metrics })
    console.log('ok')
  }

  fs.writeFileSync(path.join(HERE, 'measurements.json'), JSON.stringify(results, null, 2))
  console.log(`Saved ${results.length} screenshots to ${SHOTS}`)
  cdp.close()
  chrome.kill()
  server.close()
}

main().catch(err => {
  console.error(err)
  try { server.close() } catch {}
  process.exitCode = 1
})
