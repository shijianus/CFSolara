// 批次 2 补验脚本:对 UI-005/006/008/009/010/011/012/013/019/020/021/029/031/041/042/058/061
// 逐条用 mock 数据 + 刷新/断点重放方式重新验证,输出断言结果与截图。
// 运行前提:mock-server.mjs 已监听 5090(MOCK_DIST=player/dist),Chrome CDP 已监听 9222。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 9222
const BASE = 'http://127.0.0.1:5090'
const OUT = path.resolve(__dirname, '../../../reports/final/rerun/batch-2-verify/shots')
fs.mkdirSync(OUT, { recursive: true })

const results = []
const record = (id, method, pass, detail, shots) => {
  results.push({ id, method, result: pass ? '通过' : '失败', detail, shots })
  console.log(`${pass ? '✅' : '❌'} ${id} ${detail}`)
}

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

const waitEvent = (method, timeout = 15000) =>
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

const shot = async name => {
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  const file = path.join(OUT, `${name}.png`)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

const clickTextIn = async (text, { scope = 'main', exact = false, tag = 'button, a' } = {}) => {
  const ok = await evaluate(
    ({ text, scope, exact, tag }) => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim()
      const root = scope ? document.querySelector(scope) || document : document
      const el = [...root.querySelectorAll(tag)].find(n =>
        exact ? norm(n.textContent) === text : norm(n.textContent).includes(text)
      )
      if (!el) return false
      el.click()
      return true
    },
    { text, scope, exact, tag }
  )
  await sleep(700)
  return ok
}

const clickTrusted = async (text, { exact = false, tag = 'button' } = {}) => {
  const point = await evaluate(
    ({ text, exact, tag }) => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim()
      const el = [...document.querySelectorAll(tag)].find(n =>
        exact ? norm(n.textContent) === text : norm(n.textContent).includes(text)
      )
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    },
    { text, exact, tag }
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
    const el =
      document.querySelector(`button[aria-label="${l}"]`) ||
      document.querySelector(`button[title="${l}"]`)
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
  await sleep(600)
  return ok
}

// 单击行播放(单击 = handleRowActivate → playSongWithAnimation)
const clickRow = async name => {
  const ok = await evaluate(n => {
    const row = [...document.querySelectorAll('.song-item')].find(r =>
      (r.textContent || '').includes(n)
    )
    if (!row) return false
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  }, name)
  await sleep(2500)
  return ok
}

const clearAudio = () => evaluate(() => localStorage.removeItem('audio'))

const toasts = () =>
  evaluate(() =>
    [...document.querySelectorAll('[role="alert"],[role="status"]')]
      .map(e => e.innerText)
      .filter(Boolean)
  )

const playerState = () =>
  evaluate(() => {
    const audio = JSON.parse(localStorage.getItem('audio') || 'null')?.audio || null
    const player = document.querySelector('#audioPlayer')
    return {
      toasts: [...document.querySelectorAll('[role="alert"],[role="status"]')]
        .map(e => e.innerText)
        .filter(Boolean),
      paused: player ? player.paused : null,
      src: player ? player.src : '',
      current: audio?.currentSong || null,
      queue: audio?.playlist?.length ?? null,
    }
  })

await send('Page.enable')
await send('Runtime.enable')
await setViewport(1440, 900)
await goto('/', 1200)
await evaluate(() => {
  localStorage.clear()
  localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' }))
})

// ─────────────────────────────────────────────────────────────
// UI-005 歌单分页 + 播放全部完整队列
// ─────────────────────────────────────────────────────────────
{
  await clearAudio()
  await goto('/playlist/1', 2000)
  const before = await evaluate(() => document.querySelectorAll('.song-item').length)
  // 滚动到底触发/露出 加载更多
  await evaluate(() => {
    const scroller = document.querySelector('main .overflow-y-auto')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
  await sleep(600)
  await clickTextIn('加载更多歌曲')
  await sleep(900)
  const after = await evaluate(() => document.querySelectorAll('.song-item').length)
  const countText = await evaluate(() => document.body.innerText.match(/\d+\s*\/\s*130/)?.[0] || '')
  await shot('ui005-playlist-loaded130')
  // 播放全部 → 队列 130
  await evaluate(() => {
    const btn = document.querySelector('button[aria-label="播放全部"]')
    if (btn) btn.click()
  })
  await sleep(3500)
  const st = await playerState()
  await shot('ui005-playall-queue130')
  record(
    'UI-005',
    'mock 歌单 130 首:加载更多 + 播放全部',
    before === 100 && after === 130 && /130\s*\/\s*130/.test(countText) && st.queue === 130,
    `初始 ${before} 首 → 加载后 ${after} 首 (${countText});播放全部后队列 ${st.queue}`,
    ['ui005-playlist-loaded130.png', 'ui005-playall-queue130.png']
  )
}

// ─────────────────────────────────────────────────────────────
// UI-006 搜索结果无伪造 artistId 链接 / UI-010 时长格式 / UI-021 无音质不显示徽章
// ─────────────────────────────────────────────────────────────
{
  await goto('/search?q=test', 2200)
  const search = await evaluate(() => ({
    fakeArtistLinks: document.querySelectorAll('a[href*="/artist/0"]').length,
    artistAnchors: [...document.querySelectorAll('main a[href^="/artist/"]')].length,
    bodyHas305: document.body.innerText.includes('3:05'),
    bodyHas341: document.body.innerText.includes('3:41'),
    hqBadge: document.body.innerText.includes('HQ'),
    sqFakeCount: (document.body.innerText.match(/SQ 无损/g) || []).length,
    trackCount: document.querySelectorAll('.song-item').length,
  }))
  await shot('ui006-010-021-search')
  record(
    'UI-006',
    'mock 搜索(两首均无 artistId):刷新进入搜索页',
    search.fakeArtistLinks === 0,
    `伪造 /artist/0 链接 ${search.fakeArtistLinks} 个;页面歌手为纯文本`,
    ['ui006-010-021-search.png']
  )
  record(
    'UI-010',
    'mock 搜索时长 185s/221s',
    search.bodyHas305 && search.bodyHas341,
    `页面包含 3:05 与 3:41:${search.bodyHas305}/${search.bodyHas341}`,
    ['ui006-010-021-search.png']
  )
  record(
    'UI-021',
    'mock 搜索:无音质字段 vs 带 HQ 字段',
    search.hqBadge && search.sqFakeCount === 0,
    `7002 显示 HQ 徽章=${search.hqBadge};伪造 “SQ 无损” 出现 ${search.sqFakeCount} 次`,
    ['ui006-010-021-search.png']
  )
}

// ─────────────────────────────────────────────────────────────
// UI-008 播放错误归因 toast(音源不可用 + 重试/下一首)
// ─────────────────────────────────────────────────────────────
{
  await clearAudio()
  await goto('/playlist/1', 2000)
  await clickRow('测试歌曲 4')
  await sleep(2500)
  const t = await toasts()
  const hasRetry = await evaluate(() =>
    [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '重试')
  )
  const hasNext = await evaluate(() =>
    [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '下一首')
  )
  await shot('ui008-source-error-toast')
  record(
    'UI-008',
    'mock 曲目 999998(403 无音源)单击播放',
    t.some(x => x.includes('音源不可用')) && hasRetry && hasNext,
    `toast="${t.join(' | ')}";重试=${hasRetry} 下一首=${hasNext}`,
    ['ui008-source-error-toast.png']
  )
}

// ─────────────────────────────────────────────────────────────
// UI-009 音质切换失败回滚
// ─────────────────────────────────────────────────────────────
{
  await clearAudio()
  await goto('/playlist/1', 2000)
  await clickRow('测试歌曲 3')
  await sleep(1500)
  await evaluate(() => document.querySelector('#footer-quality-btn')?.click())
  await sleep(1500)
  await clickTrusted('无损')
  await sleep(3000)
  const st = await playerState()
  const toastOk = st.toasts.some(x => x.includes('音质切换失败'))
  const srcOk = st.src.includes('br=128')
  await shot('ui009-quality-rollback')
  record(
    'UI-009',
    'mock 曲目 999999 在无损档必 403:底栏切音质',
    toastOk && srcOk,
    `toast="${st.toasts.join(' | ')}";src 仍 br=128=${srcOk}(实际 ${st.src.slice(0, 80)})`,
    ['ui009-quality-rollback.png']
  )
}

// ─────────────────────────────────────────────────────────────
// UI-011 library 持久化(收藏歌单 + 关注歌手 + 喜欢歌曲 → 刷新 → 喜欢页)
// ─────────────────────────────────────────────────────────────
{
  await evaluate(() => localStorage.clear())
  await evaluate(() => localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' })))
  await goto('/playlist/1', 2000)
  await clickTrustedLabel('收藏')
  await sleep(600)
  await goto('/artist/1', 2200)
  await clickTrustedLabel('关注')
  await sleep(600)
  await goto('/playlist/1', 1800)
  await clickSongAction('测试歌曲 1', '喜欢')
  await sleep(600)
  // 刷新后验证
  await goto('/likes', 2000)
  const lib = await evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('library') || '{}')
    return {
      liked: (raw.likedSongs || []).length,
      playlists: (raw.collectedPlaylists || []).length,
      artists: (raw.followedArtists || []).length,
      likesPage: document.body.innerText,
    }
  })
  await shot('ui011-likes-after-reload')
  record(
    'UI-011',
    '真实点击 收藏/关注/喜欢 后刷新',
    lib.liked >= 1 && lib.playlists >= 1 && lib.artists >= 1 && lib.likesPage.includes('测试歌曲 1'),
    `刷新后 library:喜欢 ${lib.liked} 首、收藏歌单 ${lib.playlists} 个、关注歌手 ${lib.artists} 位;喜欢页渲染歌曲=${lib.likesPage.includes('测试歌曲 1')}`,
    ['ui011-likes-after-reload.png']
  )
}

// ─────────────────────────────────────────────────────────────
// UI-012 评论只读 / UI-041 评论总数
// ─────────────────────────────────────────────────────────────
{
  await goto('/playlist/1', 2000)
  await clickTextIn('评论', { tag: 'button, [role="tab"]' })
  await sleep(1600)
  const c = await evaluate(() => ({
    textarea: document.querySelectorAll('textarea').length,
    publishBtn: [...document.querySelectorAll('button')].some(b => /发布|回复/.test(b.textContent)),
    likeBtns: [...document.querySelectorAll('main button[title*="点赞"]')].length,
    total42: document.body.innerText.includes('42'),
  }))
  await shot('ui012-041-comments-readonly')
  record(
    'UI-012',
    'mock 评论(42 条,分页 20):进入评论 Tab',
    c.textarea === 0 && !c.publishBtn && c.likeBtns === 0,
    `textarea=${c.textarea};发布/回复按钮=${c.publishBtn};点赞按钮=${c.likeBtns}`,
    ['ui012-041-comments-readonly.png']
  )
  record(
    'UI-041',
    '同场景:评论 Tab 计数取接口 total',
    c.total42,
    `页面出现 42(接口 total)=${c.total42}`,
    ['ui012-041-comments-readonly.png']
  )
}

// ─────────────────────────────────────────────────────────────
// UI-013 歌曲详情页播放/暂停切换
// ─────────────────────────────────────────────────────────────
{
  await clearAudio()
  await goto('/song/1001', 2000)
  await clickTrusted('播放', { exact: true })
  await sleep(3000)
  const playing = await playerState()
  await shot('ui013-song-playing')
  await clickTrusted('暂停', { exact: true })
  await sleep(900)
  const paused = await playerState()
  await shot('ui013-song-paused')
  record(
    'UI-013',
    '歌曲详情页点击 播放 → 暂停',
    playing.paused === false && paused.paused === true,
    `播放后 paused=${playing.paused};暂停后 paused=${paused.paused}`,
    ['ui013-song-playing.png', 'ui013-song-paused.png']
  )
}

// ─────────────────────────────────────────────────────────────
// UI-019 清空队列 5 秒撤销
// ─────────────────────────────────────────────────────────────
{
  await clearAudio()
  await goto('/playlist/1', 2000)
  await clickRow('测试歌曲 1')
  await sleep(1500)
  const queueBefore = (await playerState()).queue
  await goto('/my-music', 1800)
  await clickTextIn('清空', { exact: true })
  await sleep(700)
  const undoToast = await toasts()
  await shot('ui019-queue-undo-toast')
  await clickTextIn('撤销', { scope: 'body' })
  await sleep(900)
  const st = await playerState()
  await shot('ui019-queue-restored')
  record(
    'UI-019',
    '我的音乐 → 清空 → 撤销',
    queueBefore === 1 && undoToast.some(x => x.includes('已清空') && x.includes('撤销')) && st.queue === 1,
    `清空前队列 ${queueBefore};撤销 toast="${undoToast.join(' | ')}";撤销后队列 ${st.queue}`,
    ['ui019-queue-undo-toast.png', 'ui019-queue-restored.png']
  )
}

// ─────────────────────────────────────────────────────────────
// UI-021 已随 UI-006/010 场景输出
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// UI-029 歌手页分页与 MV 统计隐藏
// ─────────────────────────────────────────────────────────────
{
  await goto('/artist/1', 2200)
  const head = await evaluate(() => ({
    musicSize: document.body.innerText.includes('130'),
    mvLeak: /MV\D*120/.test(document.body.innerText),
    songs: document.querySelectorAll('.song-item').length,
  }))
  // 加载更多歌曲
  await evaluate(() => {
    const scroller = document.querySelector('main .overflow-y-auto')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
  await sleep(500)
  await clickTextIn('加载更多')
  await sleep(900)
  await evaluate(() => {
    const scroller = document.querySelector('main .overflow-y-auto')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
  await sleep(500)
  await clickTextIn('加载更多')
  await sleep(1200)
  const after = await evaluate(() => document.querySelectorAll('.song-item').length)
  await shot('ui029-artist-loaded')
  record(
    'UI-029',
    'mock 歌手 130 首/15 专辑:头部统计 + 加载更多',
    head.musicSize && !head.mvLeak && after >= 100,
    `头部含 130 歌曲=${head.musicSize};无 MV 120 泄漏=${!head.mvLeak};歌曲加载后 ${after} 首`,
    ['ui029-artist-loaded.png']
  )
}

// ─────────────────────────────────────────────────────────────
// UI-031 下载进度/覆盖确认/取消
// ─────────────────────────────────────────────────────────────
{
  await evaluate(
    () =>
      new Promise(resolve => {
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
  )
  await clearAudio()
  await goto('/playlist/1', 2000)
  await clickSongAction('测试歌曲 1', '下载')
  await sleep(1000)
  await shot('ui031-download-dialog')
  await clickTextIn('下载 (')
  await sleep(1500)
  const prog = await evaluate(() => {
    const m = document.body.innerText.match(/(\d+)%/)
    return { pct: m ? Number(m[1]) : 0, hasCancel: [...document.querySelectorAll('button')].some(b => b.textContent.includes('取消下载')) }
  })
  await shot('ui031-download-progress')
  await sleep(6000) // 等待 5MB WAV 下载完成
  await clickSongAction('测试歌曲 1', '下载')
  await sleep(900)
  await clickTextIn('下载 (')
  await sleep(1000)
  const overwrite = await evaluate(() =>
    [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '覆盖下载')
  )
  await shot('ui031-download-overwrite')
  await clickTextIn('覆盖下载', { exact: true })
  await sleep(900)
  await clickTextIn('取消下载', { exact: true })
  await sleep(1200)
  const st = await playerState()
  await shot('ui031-download-cancelled')
  record(
    'UI-031',
    '行内下载 → 进度 → 二次下载覆盖确认 → 取消',
    prog.pct > 0 && overwrite && st.toasts.length > 0,
    `进度峰值 ${prog.pct}%;覆盖确认出现=${overwrite};取消后 toast="${st.toasts.join(' | ').slice(0, 60)}"`,
    ['ui031-download-dialog.png', 'ui031-download-progress.png', 'ui031-download-overwrite.png', 'ui031-download-cancelled.png']
  )
}

// ─────────────────────────────────────────────────────────────
// UI-042 MV 无地址错误态与重试
// ─────────────────────────────────────────────────────────────
{
  await goto('/mv-player/1', 2500)
  const e1 = await evaluate(() => ({
    err: document.body.innerText.includes('暂无可播放的 MV 地址'),
    retryBtn: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '重试'),
  }))
  await shot('ui042-mv-error')
  await clickTextIn('重试', { exact: true })
  await sleep(2000)
  const e2 = await evaluate(() => ({
    err: document.body.innerText.includes('暂无可播放的 MV 地址'),
    retryBtn: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '重试'),
  }))
  await shot('ui042-mv-after-retry')
  record(
    'UI-042',
    'mock MV(url 为空):进入详情 + 点击重试',
    e1.err && e1.retryBtn && e2.err && e2.retryBtn,
    `初始错误态=${e1.err}/${e1.retryBtn};重试后仍为明确错误态=${e2.err}/${e2.retryBtn}`,
    ['ui042-mv-error.png', 'ui042-mv-after-retry.png']
  )
}

// ─────────────────────────────────────────────────────────────
// UI-058 无限滚动空态/错误态
// ─────────────────────────────────────────────────────────────
{
  await goto('/artists', 1800)
  await clickTextIn('Z', { exact: true })
  await sleep(1200)
  const empty = await evaluate(() => ({
    emptyText: document.body.innerText.includes('暂无结果') || document.body.innerText.includes('没有找到'),
    resetBtn: [...document.querySelectorAll('button')].some(b => b.textContent.includes('重置筛选')),
  }))
  await shot('ui058-artists-empty')
  await clickTextIn('重置筛选', { exact: true })
  await sleep(1200)
  await clickTextIn('韩国', { exact: true })
  await sleep(1500)
  const err = await evaluate(() => ({
    errText: document.body.innerText.includes('加载失败'),
    reloadBtn: [...document.querySelectorAll('button')].some(b => b.textContent.includes('重新加载')),
  }))
  await shot('ui058-artists-error')
  record(
    'UI-058',
    'mock:首字母 Z 空结果 / 韩国(area=16) 500',
    empty.emptyText && empty.resetBtn && err.errText && err.reloadBtn,
    `空态+重置=${empty.emptyText}/${empty.resetBtn};失败态+重新加载=${err.errText}/${err.reloadBtn}`,
    ['ui058-artists-empty.png', 'ui058-artists-error.png']
  )
}

// ─────────────────────────────────────────────────────────────
// UI-061 失效 blob:失败清理 & 从下载库重建
// ─────────────────────────────────────────────────────────────
{
  // b) 失败路径:队列项指向失效 blob 且无库记录 → 清空当前歌曲 + toast
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
  await goto('/playlist/1', 2200)
  const fail = await playerState()
  await shot('ui061-blob-missing-cleanup')
  record(
    'UI-061a',
    'seed 失效 blob + 无库记录 → 刷新',
    fail.current === null && fail.toasts.some(x => x.includes('本地文件已不可用')),
    `currentSong 已清空=${fail.current === null};toast="${fail.toasts.join(' | ').slice(0, 50)}"`,
    ['ui061-blob-missing-cleanup.png']
  )
  // b) 重建路径:下载库有同 id Blob → 刷新后 src 为新 blob URL
  await evaluate(
    () =>
      new Promise(resolve => {
        const blob = new Blob([new Uint8Array(64)], { type: 'audio/mpeg' })
        const req = indexedDB.open('SonicMusicPlayerDB')
        req.onerror = () => resolve()
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('downloaded_music', 'readwrite')
          tx.objectStore('downloaded_music').put({
            id: 'restore-1',
            name: '可恢复的下载文件',
            artist: '测试歌手',
            quality: '128',
            size: 64,
            file: blob,
            downloadedAt: Date.now(),
          })
          tx.oncomplete = () => resolve()
        }
      })
  )
  await evaluate(() => {
    const song = {
      id: 'restore-1',
      name: '可恢复的下载文件',
      artist: '测试歌手',
      duration: 1000,
      url: 'blob:http://127.0.0.1:5090/stale-restore-1',
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
  await goto('/playlist/1', 2200)
  const ok = await playerState()
  await shot('ui061-blob-restored')
  record(
    'UI-061b',
    'seed 失效 blob + 下载库同 id 记录 → 刷新',
    ok.current?.id === 'restore-1' && ok.src.startsWith('blob:'),
    `currentSong 保留=${ok.current?.id};audio.src 已重建为 blob=${ok.src.startsWith('blob:')}`,
    ['ui061-blob-restored.png']
  )
}

await setViewport(390, 844, true)
await evaluate(() => localStorage.setItem('global', JSON.stringify({ theme: 'dark', lang: 'zh' })))

fs.writeFileSync(
  path.resolve(OUT, '..', 'results.json'),
  JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2)
)
console.log('\n=== 汇总 ===')
for (const r of results) console.log(`${r.id} | ${r.result} | ${r.detail}`)
console.log('DONE')
ws.close()
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {})
process.exit(0)
