// Sonic Gateway — Commercial Upstream Aggregation & Desensitization
// Bridges standard music platform requests (home, playlists, MVs, charts, artists) to high-availability upstreams,
// with complete desensitization, privacy anonymization, and Edge CDN caching.

import { jsonResponse } from '../http';
import { SONIC_UA } from './config';

const UPSTREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://music.163.com',
  'Accept': '*/*',
  'X-Real-IP': '116.25.146.177',
  'Cookie': 'os=pc; appver=2.9.7;',
};

// Popular curated artists with high-res avatars
// Popular curated artists with high-res avatars
const TOP_ARTISTS_CATALOG = [
  { id: 6452, name: '周杰伦', picUrl: 'https://p2.music.126.net/NWv6PtSBkyWZzqbJVzBr7g==/109951169164936450.jpg', musicSize: 420, albumSize: 38 },
  { id: 3684, name: '林俊杰', picUrl: 'https://p2.music.126.net/78q0jUUJ0h08GxAs2G-tCA==/109951168529051968.jpg', musicSize: 390, albumSize: 35 },
  { id: 2116, name: '陈奕迅', picUrl: 'https://p2.music.126.net/5KJI2mq0G0OQHQaAfAJfwg==/109951173289563385.jpg', musicSize: 380, albumSize: 42 },
  { id: 5781, name: '薛之谦', picUrl: 'https://p2.music.126.net/Z2x6knGRr7eRrZeOlgCngA==/109951172414270313.jpg', musicSize: 210, albumSize: 18 },
  { id: 7763, name: 'G.E.M.邓紫棋', picUrl: 'https://y.gtimg.cn/music/photo_new/T001R300x300M000001fNHEf1SFEFN.jpg', musicSize: 260, albumSize: 24 },
  { id: 4292, name: '李荣浩', picUrl: 'https://p2.music.126.net/FlL7wkN6VBoGTj3Df7s2_w==/109951170316908673.jpg', musicSize: 180, albumSize: 15 },
  { id: 5771, name: '许嵩', picUrl: 'https://p2.music.126.net/FLHG9Ou-sIq9F6dPe7SuNw==/109951169440811453.jpg', musicSize: 195, albumSize: 16 },
  { id: 29051613, name: '郑润泽', picUrl: 'https://p2.music.126.net/BtXjoRNLCZjoSV-3Ag3M0Q==/109951164458656122.jpg', musicSize: 130, albumSize: 10 },
  { id: 5538, name: '汪苏泷', picUrl: 'https://p2.music.126.net/YrjCHWk_OQhjlc5ycLpY3A==/109951172494696852.jpg', musicSize: 250, albumSize: 20 },
  { id: 2738, name: '方大同', picUrl: 'https://p2.music.126.net/EO_mrK1Hft9DpC5fr9ROIw==/109951169897875877.jpg', musicSize: 180, albumSize: 15 },
  { id: 5196, name: '陶喆', picUrl: 'https://p2.music.126.net/7FWLQ9Vm_po0VS7ptLTFiQ==/109951170606711717.jpg', musicSize: 190, albumSize: 16 },
  { id: 6731, name: '赵雷', picUrl: 'https://p2.music.126.net/j6KWzSdlRKzZUwJnQx3vBA==/3300733912483912.jpg', musicSize: 120, albumSize: 8 },
  { id: 6472, name: '张杰', picUrl: 'https://p2.music.126.net/PxsdyHtM0yMi1cIIDk_MFw==/109951169294511651.jpg', musicSize: 280, albumSize: 25 },
  { id: 1143033, name: '队长', picUrl: 'https://p2.music.126.net/bFUIuxjaooW5dH98_NaAoA==/109951170827419881.jpg', musicSize: 110, albumSize: 9 },
  { id: 31376161, name: '颜人中', picUrl: 'https://p2.music.126.net/M9GvSuKJQyfPKprZaLKt7A==/109951165122696427.jpg', musicSize: 100, albumSize: 8 },
  { id: 9621, name: '王菲', picUrl: 'https://p1.music.126.net/5XK6juNImi6Au60YCCcCtA==/109951170501527382.jpg', musicSize: 310, albumSize: 32 },
];

// Trending hot searches
const HOT_SEARCH_LIST = [
  { searchWord: '周杰伦', score: 988000, iconType: 1, content: '华语流行天王精选作品' },
  { searchWord: '晴天', score: 865000, iconType: 1, content: '故事的小黄花，从出生那年就飘着' },
  { searchWord: '起风了', score: 792000, iconType: 1, content: '我曾难自拔于世界之大' },
  { searchWord: '七里香', score: 721000, iconType: 1, content: '雨下整夜，我的爱溢出就像雨水' },
  { searchWord: '乌梅子酱', score: 654000, iconType: 0, content: '你浅浅的微笑就像乌梅子酱' },
  { searchWord: '孤勇者', score: 593000, iconType: 0, content: '爱你孤身走暗巷' },
  { searchWord: '青花瓷', score: 531000, iconType: 0, content: '天青色等烟雨，而我在等你' },
  { searchWord: '稻香', score: 489000, iconType: 0, content: '回家吧，回到最初的美好' },
  { searchWord: '如愿', score: 452000, iconType: 0, content: '山河无恙，烟火寻常' },
  { searchWord: '突然好想你', score: 418000, iconType: 0, content: '你会在哪里，过得快乐或委屈' },
];

/**
 * Deep desensitize text & objects by replacing third-party provider brands with Sonic
 */
export function desensitizeData<T>(obj: T): T {
  if (!obj) return obj;
  if (typeof obj === 'string') {
    return (obj as string)
      .replace(/网易云音乐/g, 'Sonic')
      .replace(/网易出品/g, 'Sonic 甄选')
      .replace(/网易/g, 'Sonic')
      .replace(/NetEase/gi, 'Sonic') as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => desensitizeData(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const copy: any = {};
    for (const [k, v] of Object.entries(obj)) {
      copy[k] = desensitizeData(v);
    }
    return copy;
  }
  return obj;
}

/**
 * Fetch and dispatch upstream endpoints
 */
export async function handleUpstreamEndpoint(
  endpoint: string,
  url: URL,
  request: Request,
): Promise<Response> {
  const normEndpoint = endpoint.replace(/^\/+|\/+$/g, '').toLowerCase();

  // 1. Banner
  if (normEndpoint === 'banner') {
    try {
      const resp = await fetch('https://music.163.com/api/v2/banner/get?clientType=pc', {
        headers: UPSTREAM_HEADERS,
      });
      const data: any = await resp.json();
      if (data && data.banners) {
        const banners = data.banners.map((b: any) => ({
          ...b,
          typeTitle: b.typeTitle ? `Sonic ${b.typeTitle.replace('首发', '独家').replace('网易', '')}` : 'Sonic 精选',
        }));
        return jsonResponse(
          { code: 200, brand: 'Sonic', banners: desensitizeData(banners) },
          { headers: { 'Cache-Control': 'public, max-age=1800' } },
        );
      }
    } catch {}
    return jsonResponse({ code: 200, brand: 'Sonic', banners: [] });
  }

  // 2. Playlists (Top / Highquality / Personalized)
  if (normEndpoint === 'top/playlist' || normEndpoint === 'playlist/highquality/list' || normEndpoint === 'personalized') {
    const limit = url.searchParams.get('limit') || '20';
    const cat = url.searchParams.get('cat') || '全部';
    try {
      const resp = await fetch(`https://music.163.com/api/playlist/highquality/list?limit=${limit}&cat=${encodeURIComponent(cat)}`, {
        headers: UPSTREAM_HEADERS,
      });
      const data: any = await resp.json();
      const playlists = (data.playlists || []).map((p: any) => ({
        ...p,
        copywriter: 'Sonic 甄选歌单',
      }));
      return jsonResponse(
        {
          code: 200,
          brand: 'Sonic',
          playlists: desensitizeData(playlists),
          total: data.total || playlists.length,
          more: data.more ?? false,
        },
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
      );
    } catch {}
    return jsonResponse({ code: 200, brand: 'Sonic', playlists: [], total: 0 });
  }

  // 3. Top Songs / New Songs
  if (normEndpoint === 'top/song' || normEndpoint === 'personalized/newsong') {
    try {
      const resp = await fetch('https://music.163.com/api/v1/discovery/new/songs', {
        headers: UPSTREAM_HEADERS,
      });
      const data: any = await resp.json();
      const songs = (data.data || []).map((s: any) => ({
        ...s,
        duration: s.duration || (s.dt ? Math.floor(s.dt / 1000) : 0),
        dt: s.dt || (s.duration ? s.duration * 1000 : 0),
      }));
      return jsonResponse(
        { code: 200, brand: 'Sonic', data: desensitizeData(songs) },
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
      );
    } catch {}
    return jsonResponse({ code: 200, brand: 'Sonic', data: [] });
  }

  // 4. Artists (Top / List)
  if (normEndpoint === 'top/artists' || normEndpoint === 'artist/list') {
    const limit = parseInt(url.searchParams.get('limit') || '16', 10);
    try {
      const resp = await fetch(`https://music.163.com/api/artist/list?categoryCode=1001&limit=${limit}`, {
        headers: UPSTREAM_HEADERS,
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data: any = await resp.json();
        if (Array.isArray(data?.artists) && data.artists.length > 0) {
          const artists = data.artists.map((a: any) => ({
            id: a.id,
            name: a.name,
            picUrl: (a.picUrl || a.img1v1Url || '').replace('http://', 'https://'),
            img1v1Url: (a.img1v1Url || a.picUrl || '').replace('http://', 'https://'),
            musicSize: a.musicSize || 0,
            albumSize: a.albumSize || 0,
          }));
          return jsonResponse(
            { code: 200, brand: 'Sonic', artists: desensitizeData(artists), more: data.hasMore ?? false },
            { headers: { 'Cache-Control': 'public, max-age=86400' } },
          );
        }
      }
    } catch {}

    const artists = TOP_ARTISTS_CATALOG.slice(0, limit);
    return jsonResponse(
      { code: 200, brand: 'Sonic', artists: desensitizeData(artists), more: false },
      { headers: { 'Cache-Control': 'public, max-age=86400' } },
    );
  }

  // 5. Personalized MV
  if (normEndpoint === 'personalized/mv' || normEndpoint === 'mv/first') {
    try {
      const resp = await fetch('https://music.163.com/api/personalized/mv', {
        headers: UPSTREAM_HEADERS,
      });
      const data: any = await resp.json();
      return jsonResponse(
        { code: 200, brand: 'Sonic', result: desensitizeData(data.result || []) },
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
      );
    } catch {}
    return jsonResponse({ code: 200, brand: 'Sonic', result: [] });
  }

  // 6. MV All
  if (normEndpoint === 'mv/all') {
    const limit = url.searchParams.get('limit') || '24';
    const offset = url.searchParams.get('offset') || '0';
    const order = url.searchParams.get('order') || '最新';
    let type = url.searchParams.get('type') || '';
    if (type === 'Sonic出品' || type === 'Sonic 甄选' || type === 'netease') type = '网易出品';

    try {
      const upstreamUrl = `https://music.163.com/api/mv/all?limit=${limit}&offset=${offset}&order=${encodeURIComponent(order)}${type ? `&type=${encodeURIComponent(type)}` : ''}`;
      const resp = await fetch(upstreamUrl, { headers: UPSTREAM_HEADERS });
      const data: any = await resp.json();
      return jsonResponse(
        {
          code: 200,
          brand: 'Sonic',
          data: desensitizeData(data.data || []),
          hasMore: data.hasMore ?? false,
          count: data.count || 0,
        },
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
      );
    } catch {}
    return jsonResponse({ code: 200, brand: 'Sonic', data: [], hasMore: false });
  }

  // 7. MV Detail
  if (normEndpoint === 'mv/detail') {
    const id = url.searchParams.get('mvid') || url.searchParams.get('id') || '';
    if (!id) return jsonResponse({ code: 400, message: 'Missing MV id' }, { status: 400 });

    try {
      const resp = await fetch(`https://music.163.com/api/mv/detail?id=${encodeURIComponent(id)}`, {
        headers: UPSTREAM_HEADERS,
      });
      const data: any = await resp.json();
      return jsonResponse(
        { code: 200, brand: 'Sonic', data: desensitizeData(data.data || {}) },
        { headers: { 'Cache-Control': 'public, max-age=7200' } },
      );
    } catch {}
    return jsonResponse({ code: 404, message: 'MV not found' }, { status: 404 });
  }

  // 8. MV Stream URL
  if (normEndpoint === 'mv/url') {
    const id = url.searchParams.get('id') || url.searchParams.get('mvid') || '';
    const r = url.searchParams.get('r') || '1080';
    if (!id) return jsonResponse({ code: 400, message: 'Missing MV id' }, { status: 400 });

    try {
      const resp = await fetch(`https://music.163.com/api/mv/detail?id=${encodeURIComponent(id)}`, {
        headers: UPSTREAM_HEADERS,
      });
      const data: any = await resp.json();
      const brs = data?.data?.brs || {};
      let streamUrl = brs[r] || brs['1080'] || brs['720'] || brs['480'] || brs['240'] || Object.values(brs)[0] || '';

      if (!streamUrl) {
        streamUrl = `https://vodkgeyttp8.vod.126.net/cloudmusic/MjQ3NDQ3MjUw/89a6a279dc2acfcd068b45ce72b1f560/533e4183a709699d566180ed0cd9abe9.mp4`;
      }

      return jsonResponse(
        {
          code: 200,
          brand: 'Sonic',
          data: { id: Number(id), url: streamUrl, r: parseInt(r, 10) || 1080 },
        },
        { headers: { 'Cache-Control': 'public, max-age=7200' } },
      );
    } catch {}
    return jsonResponse({
      code: 200,
      brand: 'Sonic',
      data: {
        id: Number(id),
        url: 'https://vodkgeyttp8.vod.126.net/cloudmusic/MjQ3NDQ3MjUw/89a6a279dc2acfcd068b45ce72b1f560/533e4183a709699d566180ed0cd9abe9.mp4',
        r: 1080,
      },
    });
  }

  // 9. Simi MV
  if (normEndpoint === 'simi/mv') {
    try {
      const resp = await fetch('https://music.163.com/api/mv/all?limit=10', { headers: UPSTREAM_HEADERS });
      const data: any = await resp.json();
      return jsonResponse(
        { code: 200, brand: 'Sonic', mvs: desensitizeData(data.data || []) },
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
      );
    } catch {}
    return jsonResponse({ code: 200, brand: 'Sonic', mvs: [] });
  }

  // 10. Comments (Music / MV)
  if (normEndpoint === 'comment/new' || normEndpoint === 'comment/music' || normEndpoint === 'comment') {
    const id = url.searchParams.get('id') || url.searchParams.get('mvid') || '33894312';
    const limit = url.searchParams.get('limit') || '20';
    const type = normEndpoint.includes('mv') || url.searchParams.has('mvid') ? '5' : '4';

    try {
      const resp = await fetch(`https://music.163.com/api/v1/resource/comments/R_${type === '5' ? 'MV' : 'SO'}_${type}_${encodeURIComponent(id)}?limit=${limit}`, {
        headers: UPSTREAM_HEADERS,
      });
      const data: any = await resp.json();
      return jsonResponse(
        {
          code: 200,
          brand: 'Sonic',
          comments: desensitizeData(data.comments || []),
          total: data.total || 0,
          more: data.more ?? false,
        },
        { headers: { 'Cache-Control': 'public, max-age=1800' } },
      );
    } catch {}
    return jsonResponse({ code: 200, brand: 'Sonic', comments: [], total: 0 });
  }

  // 11. Toplists / Charts
  if (normEndpoint === 'toplist/detail' || normEndpoint === 'toplist') {
    try {
      const resp = await fetch('https://music.163.com/api/toplist/detail', { headers: UPSTREAM_HEADERS });
      const data: any = await resp.json();
      return jsonResponse(
        {
          code: 200,
          brand: 'Sonic',
          list: desensitizeData(data.list || []),
          artistToplist: desensitizeData(data.artistToplist || {}),
        },
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
      );
    } catch {}
    return jsonResponse({ code: 200, brand: 'Sonic', list: [] });
  }

  // 12. Playlist Detail & Track All
  if (normEndpoint === 'playlist/detail' || normEndpoint === 'playlist/track/all') {
    const id = url.searchParams.get('id') || '3778678';
    try {
      const resp = await fetch(`https://music.163.com/api/playlist/detail?id=${encodeURIComponent(id)}`, {
        headers: UPSTREAM_HEADERS,
      });
      const data: any = await resp.json();
      const p = data.result || data.playlist || {};
      if (normEndpoint === 'playlist/track/all') {
        return jsonResponse(
          {
            code: 200,
            brand: 'Sonic',
            songs: desensitizeData(p.tracks || []),
            privileges: [],
          },
          { headers: { 'Cache-Control': 'public, max-age=3600' } },
        );
      }
      return jsonResponse(
        {
          code: 200,
          brand: 'Sonic',
          playlist: desensitizeData(p),
          result: desensitizeData(p),
        },
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
      );
    } catch {}
    return jsonResponse({ code: 404, message: 'Playlist not found' }, { status: 404 });
  }

  // 13. Artist Detail & Artist Top Song & Albums
  if (normEndpoint === 'artist/detail' || normEndpoint === 'artist/top/song' || normEndpoint === 'artist/album') {
    const id = url.searchParams.get('id') || '6452';
    if (normEndpoint === 'artist/album') {
      try {
        const resp = await fetch(`https://music.163.com/api/artist/albums/${encodeURIComponent(id)}?limit=20`, {
          headers: UPSTREAM_HEADERS,
        });
        const data: any = await resp.json();
        return jsonResponse(
          { code: 200, brand: 'Sonic', hotAlbums: desensitizeData(data.hotAlbums || []), more: data.more ?? false },
          { headers: { 'Cache-Control': 'public, max-age=3600' } },
        );
      } catch {}
      return jsonResponse({ code: 200, brand: 'Sonic', hotAlbums: [] });
    }

    try {
      const resp = await fetch(`https://music.163.com/api/artist/${encodeURIComponent(id)}`, {
        headers: UPSTREAM_HEADERS,
      });
      const data: any = await resp.json();
      if (normEndpoint === 'artist/top/song') {
        return jsonResponse(
          { code: 200, brand: 'Sonic', songs: desensitizeData(data.hotSongs || []) },
          { headers: { 'Cache-Control': 'public, max-age=3600' } },
        );
      }
      return jsonResponse(
        {
          code: 200,
          brand: 'Sonic',
          artist: desensitizeData(data.artist || {}),
          hotSongs: desensitizeData(data.hotSongs || []),
        },
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
      );
    } catch {}
    return jsonResponse({ code: 404, message: 'Artist not found' }, { status: 404 });
  }

  // 14. Search Hot / Default / Suggest
  if (normEndpoint === 'search/hot/detail' || normEndpoint === 'search/hot') {
    return jsonResponse(
      { code: 200, brand: 'Sonic', data: HOT_SEARCH_LIST },
      { headers: { 'Cache-Control': 'public, max-age=3600' } },
    );
  }

  if (normEndpoint === 'search/default') {
    return jsonResponse(
      { code: 200, brand: 'Sonic', data: { showKeyword: '周杰伦', realkeyword: '周杰伦' } },
      { headers: { 'Cache-Control': 'public, max-age=86400' } },
    );
  }

  if (normEndpoint === 'search/suggest') {
    const s = url.searchParams.get('keywords') || url.searchParams.get('s') || '';
    if (!s) return jsonResponse({ code: 200, result: {} });
    try {
      const resp = await fetch(`https://music.163.com/api/search/suggest/web?s=${encodeURIComponent(s)}`, {
        headers: UPSTREAM_HEADERS,
      });
      const data: any = await resp.json();
      return jsonResponse(
        { code: 200, brand: 'Sonic', result: desensitizeData(data.result || {}) },
        { headers: { 'Cache-Control': 'public, max-age=1800' } },
      );
    } catch {}
    return jsonResponse({ code: 200, brand: 'Sonic', result: {} });
  }

  // 15. Song Detail
  if (normEndpoint === 'song/detail') {
    const ids = url.searchParams.get('ids') || '[]';
    try {
      const resp = await fetch(`https://music.163.com/api/song/detail?ids=${encodeURIComponent(ids)}`, {
        headers: UPSTREAM_HEADERS,
      });
      const data: any = await resp.json();
      return jsonResponse(
        { code: 200, brand: 'Sonic', songs: desensitizeData(data.songs || []) },
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
      );
    } catch {}
    return jsonResponse({ code: 200, brand: 'Sonic', songs: [] });
  }

  // 16. Song URL
  if (normEndpoint === 'song/url/v1' || normEndpoint === 'song/url') {
    const id = url.searchParams.get('id') || '';
    return jsonResponse(
      {
        code: 200,
        brand: 'Sonic',
        data: [{ id: String(id), url: `/api/music/stream?id=${encodeURIComponent(String(id))}` }],
      },
      { headers: { 'Cache-Control': 'public, max-age=3600' } },
    );
  }

  // 17. Search / CloudSearch (for Playlists, MVs, etc.)
  if (normEndpoint === 'cloudsearch' || normEndpoint === 'search') {
    const keywords = url.searchParams.get('keywords') || url.searchParams.get('keyword') || url.searchParams.get('s') || '';
    const type = url.searchParams.get('type') || '1';
    const limit = url.searchParams.get('limit') || '30';
    const offset = url.searchParams.get('offset') || '0';

    if (type === '1000') {
      // Search playlists
      try {
        const resp = await fetch(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(keywords)}&type=1000&limit=${limit}&offset=${offset}`, {
          headers: UPSTREAM_HEADERS,
        });
        const data: any = await resp.json();
        return jsonResponse(
          {
            code: 200,
            brand: 'Sonic',
            result: desensitizeData(data.result || { playlists: [], playlistCount: 0 }),
          },
          { headers: { 'Cache-Control': 'public, max-age=1800' } },
        );
      } catch {}
      return jsonResponse({ code: 200, brand: 'Sonic', result: { playlists: [], playlistCount: 0 } });
    }

    if (type === '1004') {
      // Search MVs
      try {
        const resp = await fetch(`https://music.163.com/api/mv/all?limit=${limit}&offset=${offset}`, {
          headers: UPSTREAM_HEADERS,
        });
        const data: any = await resp.json();
        const mvs = (data.data || []).map((m: any) => ({
          ...m,
          name: m.name || m.title || '',
          artistName: m.artistName || m.artist || '',
        }));
        return jsonResponse(
          {
            code: 200,
            brand: 'Sonic',
            result: { mvs: desensitizeData(mvs), mvCount: mvs.length },
          },
          { headers: { 'Cache-Control': 'public, max-age=1800' } },
        );
      } catch {}
      return jsonResponse({ code: 200, brand: 'Sonic', result: { mvs: [], mvCount: 0 } });
    }

    // Default: Song search fallback via Nexus Search
    try {
      const { searchNexus } = await import('./nexus-search');
      const page = Math.floor(parseInt(offset, 10) / parseInt(limit, 10)) + 1;
      const res = await searchNexus(keywords, { page, count: parseInt(limit, 10) });
      const songs = (res.data?.tracks || []).map((t: any) => ({
        id: t.id,
        name: t.title || t.name,
        ar: [{ id: 0, name: t.artist }],
        al: { id: 0, name: t.album, picUrl: t.cover || t.coverUrl },
        dt: (t.duration || 200) * 1000,
        mv: 0,
        sha: t.sha,
        qualityBadge: t.qualityBadge,
      }));
      return jsonResponse(
        {
          code: 200,
          brand: 'Sonic',
          result: { songs, songCount: res.data?.total || songs.length },
        },
        { headers: { 'Cache-Control': 'public, max-age=1800' } },
      );
    } catch {}
    return jsonResponse({ code: 200, brand: 'Sonic', result: { songs: [], songCount: 0 } });
  }

  // Fallback 404 for unknown endpoint
  return jsonResponse(
    { brand: 'Sonic', error: { code: 'NOT_FOUND', message: `Endpoint /api/${endpoint} not found` } },
    { status: 404 },
  );
}
