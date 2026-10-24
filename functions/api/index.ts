import { handleOptions, jsonResponse } from '../_lib/http';
import { API_DESCRIPTION, API_NAME, BRANDING, BRAND_COPYRIGHT } from '../_lib/brand';
import type { AppEnv } from '../_lib/types';

export async function onRequest({ request }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();

  const url = new URL(request.url);
  const base = url.origin;

  return jsonResponse({
    name: API_NAME,
    version: '2.1.0',
    copyright: BRAND_COPYRIGHT,
    description: API_DESCRIPTION,
    branding: BRANDING,
    auth: {
      provider: 'Epomail OAuth 2.0',
      loginUrl: `${base}/api/auth/login`,
      callbackUrl: `${base}/api/auth/callback`,
      userUrl: `${base}/api/auth/user`,
      keyManagementUrl: `${base}/api/auth/key`,
      header: 'X-Sonic-Key: <your_key> or Authorization: Bearer <your_key> (亦兼容 X-CFSolara-Key)',
    },
    endpoints: [
      { path: '/api/music/search', method: 'GET', desc: '搜索歌曲 (params: q, source, count, page)' },
      { path: '/api/music/stream', method: 'GET', desc: '获取/代理音频流 (params: id, source, quality)' },
      { path: '/api/music/lyric', method: 'GET', desc: '获取歌词与逐行时间戳 (params: id, source)' },
      { path: '/api/music/cover', method: 'GET', desc: '多渠道封面与歌手图解析/代理网关 (params: id, source, artist, url)' },
      { path: '/api/music/random', method: 'GET', desc: '随机曲目推荐 (params: count, genre)' },
      { path: '/api/music/palette', method: 'GET', desc: '封面取色与沉浸式背景渐变计算' },
      { path: '/proxy', method: 'GET', desc: '经典兼容代理接口 (Backward compatible)' },
      { path: '/palette', method: 'GET', desc: '经典封面配色接口 (Backward compatible)' },
    ],
  });
}
