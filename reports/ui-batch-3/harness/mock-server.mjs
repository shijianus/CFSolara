import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = process.env.MOCK_DIST || path.join(__dirname, 'dist')
const PORT = Number(process.env.MOCK_PORT || 5090)
const TOTAL_WAV_BYTES = 5_292_044

const ok = (res, data, status = 200) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(data))
}

const songs = (count, offset = 0) =>
  Array.from({ length: count }, (_, i) => {
    const n = offset + i + 1
    const id = n === 3 ? 999999 : n === 4 ? 999998 : 1000 + n
    return {
      id,
      name: `测试歌曲 ${n}`,
      ar: [{ id: 100 + (n % 5), name: `测试歌手 ${(n % 5) + 1}` }],
      al: { id: 200 + (n % 7), name: `测试专辑 ${(n % 7) + 1}`, picUrl: '/media/cover.svg' },
      dt: 150000 + (n % 60) * 1000,
      mv: n % 9 === 0 ? 5000 + n : 0,
    }
  })

const albums = (offset = 0) =>
  Array.from({ length: 15 }, (_, i) => {
    const n = offset + i + 1
    return {
      id: 3000 + n,
      name: `测试专辑 ${n}`,
      picUrl: '/media/cover.svg',
      artist: { id: 1, name: '测试歌手' },
      publishTime: 1700000000000 + n * 86400000,
      size: 10 + (n % 5),
    }
  })

const artists = () =>
  Array.from({ length: 30 }, (_, i) => ({
    id: 100 + i,
    name: `测试歌手 ${i + 1}`,
    picUrl: '/media/cover.svg',
    alias: [],
    albumSize: 12,
    musicSize: 80,
    mvSize: 20,
  }))

const searchTracks = () => [
  {
    id: 7001,
    title: '无音质字段的搜索歌曲',
    artist: '测试歌手',
    album: '测试专辑',
    cover: '/media/cover.svg',
    duration: 185,
    streamUrl: '/api/music/stream?id=7001',
    sha: 'sha-7001',
  },
  {
    id: 7002,
    title: '带真实音质的搜索歌曲',
    artist: '测试歌手',
    album: '测试专辑',
    cover: '/media/cover.svg',
    duration: 221,
    qualityBadge: 'HQ',
    qualities: [{ level: 'exhigh', label: 'HQ 极高', bitrate: '320kbps' }],
    streamUrl: '/api/music/stream?id=7002',
    sha: 'sha-7002',
  },
]

const wavBuffer = Buffer.alloc(TOTAL_WAV_BYTES)
wavBuffer.write('RIFF', 0)
wavBuffer.writeUInt32LE(TOTAL_WAV_BYTES - 8, 4)
wavBuffer.write('WAVEfmt ', 8)
wavBuffer.writeUInt32LE(16, 16)
wavBuffer.writeUInt16LE(1, 20)
wavBuffer.writeUInt16LE(2, 22)
wavBuffer.writeUInt32LE(44100, 24)
wavBuffer.writeUInt32LE(44100 * 4, 28)
wavBuffer.writeUInt16LE(4, 32)
wavBuffer.writeUInt16LE(16, 34)
wavBuffer.write('data', 36)
wavBuffer.writeUInt32LE(TOTAL_WAV_BYTES - 44, 40)

const COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2563eb"/><stop offset="1" stop-color="#38bdf8"/></linearGradient></defs><rect width="300" height="300" rx="28" fill="url(#g)"/><circle cx="150" cy="150" r="54" fill="rgba(255,255,255,.18)"/></svg>`

const serveStream = (req, res, url) => {
  const id = url.searchParams.get('id')
  const br = url.searchParams.get('br') || ''
  const range = req.headers.range
  if (id === '999998') {
    res.writeHead(403, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
    res.end('copyright restricted')
    return
  }
  if (id === '999999') {
    if (range === 'bytes=0-0') {
      const totalByBr = { lossless: 40000000, '320': 15000000, '128': TOTAL_WAV_BYTES }
      const total = totalByBr[br] || TOTAL_WAV_BYTES
      res.writeHead(206, {
        'Content-Type': br === 'lossless' ? 'audio/flac' : 'audio/mpeg',
        'Content-Range': `bytes 0-0/${total}`,
        'Content-Length': '1',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(wavBuffer.subarray(0, 1))
      return
    }
    if (br === 'lossless' || br === '320') {
      res.writeHead(403, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
      res.end('copyright restricted')
      return
    }
  }
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    const start = match && match[1] ? Number(match[1]) : 0
    const requestedEnd = match && match[2] ? Number(match[2]) : wavBuffer.length - 1
    const end = Math.min(requestedEnd, wavBuffer.length - 1)
    res.writeHead(206, {
      'Content-Type': 'audio/wav',
      'Content-Range': `bytes ${start}-${end}/${wavBuffer.length}`,
      'Content-Length': String(Math.max(0, end - start + 1)),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(wavBuffer.subarray(start, end + 1))
    return
  }
  res.writeHead(200, {
    'Content-Type': 'audio/wav',
    'Content-Length': String(TOTAL_WAV_BYTES),
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  })
  const chunkSize = 64 * 1024
  let offset = 0
  let closed = false
  res.on('close', () => {
    closed = true
  })
  const pump = () => {
    if (closed) return
    if (offset >= wavBuffer.length) {
      res.end()
      return
    }
    res.write(wavBuffer.subarray(offset, offset + chunkSize))
    offset += chunkSize
    setTimeout(pump, 35)
  }
  pump()
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const p = url.pathname.replace(/\/+$/, '') || '/'

  if (p === '/media/cover.svg' || p === '/api/music/cover') {
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(COVER_SVG)
    return
  }
  if (p === '/api/music/stream') {
    serveStream(req, res, url)
    return
  }
  if (p === '/api/playlist/detail') {
    ok(res, {
      playlist: {
        id: 1,
        name: '分页测试歌单（130 首）',
        description: '用于验证分页加载、完整队列与评论总数。',
        creator: { nickname: 'Sonic 测试', avatarUrl: '/media/cover.svg' },
        createTime: 1700000000000,
        trackCount: 130,
        playCount: 123456,
        subscribedCount: 4321,
        tags: ['华语', '测试'],
        coverImgUrl: '/media/cover.svg',
      },
    })
    return
  }
  if (p === '/api/playlist/track/all') {
    const limit = Number(url.searchParams.get('limit') || 100)
    const offset = Number(url.searchParams.get('offset') || 0)
    ok(res, { songs: songs(Math.min(limit, 130 - offset), offset) })
    return
  }
  if (p === '/api/comment/new') {
    const pageNo = Number(url.searchParams.get('pageNo') || 1)
    const pageSize = 20
    const total = 42
    const start = (pageNo - 1) * pageSize
    const count = Math.max(0, Math.min(pageSize, total - start))
    ok(res, {
      data: {
        total,
        comments: Array.from({ length: count }, (_, i) => ({
          user: { nickname: `评论用户 ${start + i + 1}`, avatarUrl: '/media/cover.svg' },
          time: Date.now() - (start + i) * 60000,
          content: `这是第 ${start + i + 1} 条只读测试评论，用于验证评论总数与分页。`,
          likedCount: (start + i) % 17,
          beReplied: [],
        })),
      },
    })
    return
  }
  if (p === '/api/artist/detail') {
    ok(res, {
      data: {
        artist: {
          id: 1,
          name: '分页测试歌手',
          alias: ['Test Artist'],
          cover: '/media/cover.svg',
          briefDesc: '用于验证歌手歌曲与专辑分页加载，以及隐藏 MV 统计。',
          albumSize: 15,
          musicSize: 130,
          mvSize: 120,
          fansCnt: 98765,
          followed: false,
        },
      },
    })
    return
  }
  if (p === '/api/artist/top/song') {
    ok(res, { songs: songs(50) })
    return
  }
  if (p === '/api/artist/songs') {
    const limit = Number(url.searchParams.get('limit') || 50)
    const offset = Number(url.searchParams.get('offset') || 0)
    ok(res, {
      songs: songs(Math.min(limit, 130 - offset), offset),
      more: offset + limit < 130,
    })
    return
  }
  if (p === '/api/artist/album') {
    const limit = Number(url.searchParams.get('limit') || 12)
    const offset = Number(url.searchParams.get('offset') || 0)
    const all = albums()
    ok(res, { hotAlbums: all.slice(offset, offset + limit), more: offset + limit < all.length })
    return
  }
  if (p === '/api/artist/list') {
    const area = url.searchParams.get('area')
    if (area === '16') {
      ok(res, { code: 500, message: 'mock upstream error' }, 500)
      return
    }
    if (url.searchParams.get('initial') === 'Z') {
      ok(res, { artists: [] })
      return
    }
    ok(res, { artists: artists() })
    return
  }
  if (p === '/api/mv/detail') {
    ok(res, {
      data: {
        id: Number(url.searchParams.get('mvid') || 1),
        name: 'MV 无源测试',
        artistName: '测试歌手',
        artists: [{ id: 1, name: '测试歌手' }],
        duration: 180000,
        cover: '/media/cover.svg',
        playCount: 23456,
        likedCount: 12,
        desc: '该 MV 的接口不返回播放地址，用于验证错误态与重试入口。',
      },
    })
    return
  }
  if (p === '/api/mv/url') {
    ok(res, { data: { url: '' } })
    return
  }
  if (p === '/api/simi/mv') {
    ok(res, {
      mvs: Array.from({ length: 6 }, (_, i) => ({
        id: 800 + i,
        name: `相关 MV ${i + 1}`,
        artistName: '测试歌手',
        cover: '/media/cover.svg',
        duration: 120000,
        playCount: 1000 + i,
      })),
    })
    return
  }
  if (p === '/api/mv/all') {
    const limit = Number(url.searchParams.get('limit') || 24)
    const offset = Number(url.searchParams.get('offset') || 0)
    ok(res, {
      data: Array.from({ length: Math.min(limit, 30 - offset) }, (_, i) => ({
        id: 900 + offset + i,
        name: `MV 列表 ${offset + i + 1}`,
        artistName: '测试歌手',
        cover: '/media/cover.svg',
        duration: 150000,
        playCount: 2000 + i,
      })),
    })
    return
  }
  if (p === '/api/song/detail') {
    ok(res, {
      songs: [
        {
          id: Number((url.searchParams.get('ids') || '[1001]').replace(/[^\d]/g, '')) || 1001,
          name: '歌曲详情测试',
          ar: [{ id: 1, name: '测试歌手' }],
          al: { id: 1, name: '测试专辑', picUrl: '/media/cover.svg' },
          dt: 185000,
        },
      ],
    })
    return
  }
  if (p === '/api/lyric') {
    ok(res, { lrc: { lyric: '[00:00.00]测试歌词\n[00:05.00]第二行歌词' } })
    return
  }
  if (p === '/api/song/url/v1' || p === '/api/song/url') {
    const id = url.searchParams.get('id') || '1001'
    ok(res, {
      data: [
        {
          id,
          url:
            id === '999998'
              ? '/media/missing.mp3'
              : id === '999999'
                ? '/api/music/stream?id=999999&br=128'
                : `/api/music/stream?id=${id}`,
        },
      ],
    })
    return
  }
  if (p === '/api/sonic/search/nexus') {
    const q = url.searchParams.get('q') || ''
    ok(res, {
      data: {
        tracks: q ? searchTracks() : [],
        total: q ? 2 : 0,
      },
    })
    return
  }
  if (p === '/api/cloudsearch' || p === '/api/search') {
    const type = Number(url.searchParams.get('type') || 1)
    if (type === 1000) {
      ok(res, {
        result: {
          playlists: [],
          playlistCount: 0,
        },
      })
      return
    }
    ok(res, { result: { songs: [], songCount: 0 } })
    return
  }
  if (p === '/api/search/hot/detail') {
    ok(res, { data: [{ searchWord: '测试搜索', score: 1000 }] })
    return
  }
  if (p === '/api/search/hot') {
    ok(res, { result: { hots: [{ first: '测试搜索' }] } })
    return
  }
  if (p === '/api/search/default') {
    ok(res, { data: { realkeyword: '测试搜索', showKeyword: '测试搜索' } })
    return
  }
  if (p === '/api/search/suggest') {
    ok(res, { result: { allMatch: [{ keyword: '测试搜索' }] } })
    return
  }
  if (p === '/api/album/new') {
    ok(res, { albums: albums() })
    return
  }
  if (p === '/api/album') {
    ok(res, {
      album: {
        id: 1,
        name: '测试专辑',
        picUrl: '/media/cover.svg',
        artist: { id: 1, name: '测试歌手' },
        publishTime: 1700000000000,
        description: '专辑简介',
        size: songs(12).length,
      },
      songs: songs(12),
    })
    return
  }
  if (p === '/api/banner') {
    ok(res, { banners: [] })
    return
  }
  if (p === '/api/personalized' || p === '/api/top/playlist' || p === '/api/personalized/newsong') {
    ok(res, { result: [], data: [] })
    return
  }
  if (p === '/api/top/song') {
    ok(res, { data: songs(20) })
    return
  }
  if (p === '/api/toplist/detail' || p === '/api/toplist') {
    ok(res, { list: [] })
    return
  }
  if (p === '/api/top/artists') {
    ok(res, { artists: artists() })
    return
  }
  if (p.startsWith('/api/')) {
    ok(res, { code: 404, message: `Mock endpoint not implemented: ${p}` }, 404)
    return
  }

  let filePath = path.join(DIST, decodeURIComponent(p))
  if (p === '/') filePath = path.join(DIST, 'index.html')
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html')
  }
  const ext = path.extname(filePath)
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.gz': 'application/gzip',
  }
  res.writeHead(200, {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  fs.createReadStream(filePath).pipe(res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock server listening on http://127.0.0.1:${PORT}`)
})
