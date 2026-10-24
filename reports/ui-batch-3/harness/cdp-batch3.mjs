import fs from 'node:fs'
import path from 'node:path'

const PORT = 9222
const BASE = 'http://127.0.0.1:5090'
const ROOT = path.resolve('reports/ui-batch-3')
const OUT = path.join(ROOT, 'shots')
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
  { width: 820, height: 700, mobile: true, label: '820x700' },
  { width: 844, height: 390, mobile: true, label: '844x390' },
  { width: 390, height: 844, mobile: true, label: '390x844' },
]
const themes = ['dark', 'light']
const pages = [
  { name: 'home', route: '/', wait: 1800 },
  { name: 'search-discovery', route: '/search', wait: 1200 },
  { name: 'search-results', route: '/search?q=测试搜索', wait: 1800 },
  { name: 'playlist', route: '/playlist/1', wait: 1800 },
  { name: 'song-detail', route: '/song/1001', wait: 1200 },
  { name: 'settings', route: '/settings', wait: 1000 },
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
  await send('Emulation.setTouchEmulationEnabled', {
    enabled: v.mobile,
    maxTouchPoints: v.mobile ? 5 : 1,
  })
}

const seedStorage = (theme, withAudio) =>
  evaluate(
    ({ theme, withAudio }) => {
      const song = {
        id: 1001,
        name: '测试歌曲 1',
        artist: '测试歌手 2',
        album: '测试专辑 2',
        cover: '/media/cover.svg',
        duration: 151,
      }
      localStorage.setItem(
        'global',
        JSON.stringify({
          theme,
          lang: 'zh',
          searchHistory: ['测试搜索', '晴天'],
        })
      )
      if (withAudio) {
        localStorage.setItem(
          'audio',
          JSON.stringify({
            count: 0,
            audio: {
              currentSong: { ...song, url: '/api/music/stream?id=1001' },
              currentIndex: 0,
              playlist: [{ ...song, url: '/api/music/stream?id=1001' }],
              originalPlaylist: [{ ...song, url: '/api/music/stream?id=1001' }],
              playMode: 'list',
              volume: 1,
              isMuted: false,
              playHistory: [],
            },
          })
        )
      } else {
        localStorage.removeItem('audio')
      }
    },
    { theme, withAudio }
  )

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

const axeSource = fs.readFileSync(path.resolve('reports/ui-batch-3/harness/axe.min.js'), 'utf8')
await send('Page.addScriptToEvaluateOnNewDocument', { source: axeSource })

const scanAxe = async label => {
  const violations = await evaluate(async () => {
    if (typeof axe === 'undefined') return [{ id: 'axe-missing', impact: 'critical', nodes: 0 }]
    const result = await axe.run(document, { resultTypes: ['violations'] })
    return result.violations
      .filter(v => v.impact === 'serious' || v.impact === 'critical')
      .map(v => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
        targets: v.nodes.slice(0, 4).map(n => n.target.join(' ')),
      }))
  })
  console.log('axe', label, JSON.stringify(violations))
  return { label, violations }
}

const auditLayout = () =>
  evaluate(() => {
    const vw = window.innerWidth
    const doc = document.documentElement
    const rootFont = getComputedStyle(doc).fontSize
    const bodyFont = getComputedStyle(document.body).fontSize
    const tinyText = getComputedStyle(document.createElement('div'))
    const probe = document.createElement('div')
    probe.className = 'text-xs'
    probe.style.position = 'absolute'
    probe.style.visibility = 'hidden'
    document.body.appendChild(probe)
    const textXs = getComputedStyle(probe).fontSize
    probe.remove()
    const smallTargets = []
    const seen = new Set()
    const nodes = document.querySelectorAll(
      'a[href], button, [role="button"], [role="slider"], [role="combobox"], [tabindex="0"]'
    )
    for (const el of nodes) {
      if (!(el instanceof HTMLElement)) continue
      if (el.closest('[inert]')) continue
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none')
        continue
      if (rect.width < 44 || rect.height < 44) {
        const name =
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48) ||
          el.tagName
        if (seen.has(name + rect.width + rect.height)) continue
        seen.add(name + rect.width + rect.height)
        smallTargets.push({
          name,
          tag: el.tagName,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })
      }
    }
    const overflow = []
    for (const el of document.querySelectorAll('body *')) {
      if (!(el instanceof HTMLElement)) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.right > vw + 1 || rect.left < -1) {
        const style = getComputedStyle(el)
        if (style.position === 'fixed' && style.visibility === 'hidden') continue
        overflow.push({
          tag: el.tagName,
          cls: String(el.className || '').slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        })
      }
    }
    return {
      innerWidth: vw,
      scrollWidth: doc.scrollWidth,
      horizontalOverflow: doc.scrollWidth > vw + 1,
      rootFont,
      bodyFont,
      textXs,
      smallTargets: smallTargets.slice(0, 60),
      smallTargetCount: smallTargets.length,
      overflow: overflow.slice(0, 30),
    }
  })

const activeInfo = () =>
  evaluate(() => {
    const el = document.activeElement
    if (!(el instanceof HTMLElement)) return null
    const rect = el.getBoundingClientRect()
    return {
      tag: el.tagName,
      id: el.id,
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      placeholder: el.getAttribute('placeholder'),
      inDialog: !!el.closest('[role="dialog"]'),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  })

const pressKey = async (key, code, vk) => {
  const extra =
    key === 'Enter'
      ? { text: '\r', unmodifiedText: '\r' }
      : key === ' '
        ? { text: ' ', unmodifiedText: ' ' }
        : {}
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    ...extra,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
}

const tab = async () => {
  await pressKey('Tab', 'Tab', 9)
  await sleep(90)
}

const tabTo = async (predicate, max = 180) => {
  const log = []
  for (let i = 0; i < max; i++) {
    await tab()
    const info = await activeInfo()
    if (info) log.push(info)
    if (info && predicate(info)) return { found: true, info, steps: i + 1, log }
  }
  return { found: false, info: await activeInfo(), steps: max, log }
}

const axeResults = []
const layoutResults = []
const matrix = []

await send('Page.enable')
await send('Runtime.enable')

// Initial origin visit so localStorage is available.
await setViewport(viewports[0])
await goto('/', 800)

for (const v of viewports) {
  await setViewport(v)
  for (const theme of themes) {
    await seedStorage(theme, true)
    for (const page of pages) {
      await goto(page.route, page.wait)
      await screenshot(`${v.label}-${theme}-${page.name}`)
      matrix.push({ viewport: v.label, theme, page: page.name })
    }
    for (const page of pages.filter(p =>
      ['home', 'search-results', 'playlist', 'settings'].includes(p.name)
    )) {
      await goto(page.route, page.wait)
      axeResults.push(await scanAxe(`${v.label}-${theme}-${page.name}`))
    }
    if (v.label !== '1440x900') {
      for (const page of pages.filter(p => ['home', 'search-discovery', 'search-results', 'playlist', 'settings'].includes(p.name))) {
        await goto(page.route, page.wait)
        const audit = await auditLayout()
        layoutResults.push({ viewport: v.label, theme, page: page.name, ...audit })
        console.log('layout', v.label, theme, page.name, JSON.stringify({
          horizontalOverflow: audit.horizontalOverflow,
          scrollWidth: audit.scrollWidth,
          smallTargetCount: audit.smallTargetCount,
          rootFont: audit.rootFont,
          textXs: audit.textXs,
        }))
      }
    }
  }
}

// Player / drawer / quality states (dark desktop)
await setViewport(viewports[0])
await seedStorage('dark', true)
await goto('/search?q=测试搜索', 1800)
await evaluate(() => document.querySelector('#footer-cover')?.click())
await sleep(1200)
await screenshot('1440x900-dark-player-open')
await scanAxe('1440x900-dark-player-open').then(r => axeResults.push(r))
await pressKey('Escape', 'Escape', 27)
await sleep(900)
await evaluate(() => document.querySelector('#footer-quality-btn')?.click())
await sleep(700)
await screenshot('1440x900-dark-quality-menu')
await pressKey('Escape', 'Escape', 27)
await sleep(400)
await evaluate(() => {
  const local = JSON.parse(localStorage.getItem('global') || '{}')
  local.searchHistory = []
  localStorage.setItem('global', JSON.stringify(local))
})
await goto('/search', 1200)
await screenshot('1440x900-dark-search-history-empty')
// Mobile drawer open states
await setViewport(viewports[3])
await seedStorage('dark', true)
await goto('/search?q=测试搜索', 1600)
await screenshot('390x844-dark-search-results-seeded')
await evaluate(() => {
  const el = document.querySelector('button[aria-label="测试歌曲 1 - 测试歌手 2"]')
  el?.click()
})
await sleep(1200)
await screenshot('390x844-dark-miniplayer')
await evaluate(() => document.querySelector('button[aria-label="正在播放"]')?.click())
await sleep(1200)
await screenshot('390x844-dark-player-open')
await scanAxe('390x844-dark-player-open').then(r => axeResults.push(r))
await pressKey('Escape', 'Escape', 27)
await sleep(900)

// Keyboard-only flow: home -> search -> play -> open player -> close -> quality -> close
const flow = []
await setViewport(viewports[0])
await seedStorage('dark', false)
await goto('/', 1400)
flow.push({ step: 'start', active: await activeInfo() })

let r = await tabTo(
  i => i.tag === 'INPUT' && (i.placeholder || '').includes('搜索'),
  120
)
flow.push({ step: 'tab-to-search', found: r.found, steps: r.steps, active: r.info })
if (r.found) {
  await send('Input.insertText', { text: '测试搜索' })
  await pressKey('Enter', 'Enter', 13)
  await sleep(1600)
  flow.push({ step: 'submit-search', hash: await evaluate(() => location.hash) })

  r = await tabTo(
    i => i.ariaLabel === '播放' || i.title === '播放',
    160
  )
  flow.push({ step: 'tab-to-play', found: r.found, steps: r.steps, active: r.info })
  if (r.found) {
    await pressKey('Enter', 'Enter', 13)
    await sleep(1600)
    flow.push({
      step: 'play',
      current: await evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('audio') || 'null')
        return raw?.audio?.currentSong?.name || null
      }),
    })
  }

  r = await tabTo(i => i.id === 'footer-cover', 160)
  flow.push({ step: 'tab-to-player-entry', found: r.found, steps: r.steps, active: r.info })
  if (r.found) {
    await pressKey('Enter', 'Enter', 13)
    await sleep(1200)
    flow.push({
      step: 'open-player',
      dialog: await evaluate(() => !!document.querySelector('[role="dialog"]')),
      active: await activeInfo(),
    })

    r = await tabTo(i => i.inDialog && i.ariaLabel === '关闭', 120)
    flow.push({ step: 'tab-to-close', found: r.found, steps: r.steps, active: r.info })
    if (r.found) {
      await pressKey(' ', 'Space', 32)
      await sleep(1400)
      await screenshot('1440x900-dark-after-close-tabflow')
      flow.push({
        step: 'close-player',
        dialogs: await evaluate(() =>
          [...document.querySelectorAll('[role="dialog"]')].map(el => {
            const rect = el.getBoundingClientRect()
            return {
              label: el.getAttribute('aria-label'),
              cls: String(el.className || '').slice(0, 80),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              display: getComputedStyle(el).display,
              visibility: getComputedStyle(el).visibility,
            }
          })
        ),
        active: await activeInfo(),
      })
    }
  }

  r = await tabTo(i => i.id === 'footer-quality-btn', 80)
  flow.push({ step: 'tab-to-quality', found: r.found, steps: r.steps, active: r.info })
  if (r.found) {
    await pressKey('Enter', 'Enter', 13)
    await sleep(900)
    await pressKey('ArrowDown', 'ArrowDown', 40)
    await pressKey('ArrowDown', 'ArrowDown', 40)
    await pressKey('Enter', 'Enter', 13)
    await sleep(1800)
    flow.push({
      step: 'switch-quality',
      toast: await evaluate(() => {
        const el = document.querySelector('[role="status"][aria-live="polite"]')
        return { text: el?.textContent?.replace(/\s+/g, ' ').trim() || null, present: !!el }
      }),
      menuOpen: await evaluate(() => !!document.querySelector('#quality-menu-panel')),
    })
    await screenshot('1440x900-dark-quality-toast-tabflow')
    await pressKey('Escape', 'Escape', 27)
    await sleep(500)
    flow.push({ step: 'close', menuOpen: await evaluate(() => !!document.querySelector('#quality-menu-panel')) })
  }
}

fs.writeFileSync(path.join(ROOT, 'axe.json'), JSON.stringify(axeResults, null, 2))
fs.writeFileSync(path.join(ROOT, 'layout-audit.json'), JSON.stringify(layoutResults, null, 2))
fs.writeFileSync(path.join(ROOT, 'tab-flow.json'), JSON.stringify(flow, null, 2))
fs.writeFileSync(path.join(ROOT, 'matrix.json'), JSON.stringify(matrix, null, 2))
console.log('FLOW', JSON.stringify(flow, null, 2))
console.log('BATCH3 DONE')

ws.close()
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {})
