import { handleOptions, jsonResponse } from '../_lib/http';
import { API_DESCRIPTION, API_NAME, BRANDING, BRAND_COPYRIGHT } from '../_lib/brand';
import { getSonicConfig } from '../_lib/sonic/config';
import { getLocalEngineCircuitSnapshot } from '../_lib/sonic/local-engine';
import { checkEngineAccess } from '../_lib/sonic/security';
import type { AppEnv } from '../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();
  const engineDenied = checkEngineAccess(request, env);
  if (engineDenied) return engineDenied;

  const url = new URL(request.url);
  const base = url.origin;
  const cfg = getSonicConfig(env);
  const circuit = getLocalEngineCircuitSnapshot(env);

  return jsonResponse({
    brand: 'Sonic',
    name: API_NAME,
    version: '2.2.0',
    copyright: BRAND_COPYRIGHT,
    description: API_DESCRIPTION,
    branding: BRANDING,
    architecture: {
      runtime: cfg.runtime,
      localEngineConfigured: cfg.enableLocalEngine,
      circuitState: circuit.state,
      degraded: cfg.enableLocalEngine && circuit.state !== 'CLOSED',
      thirdPartyFallbacks: {
        gdstudioEnabled: cfg.enableGdstudio,
        lyrivaEnabled: cfg.enableLyriva,
        vipUnblockEnabled: cfg.enableUnblock,
      },
    },
    auth: {
      provider: 'Epomail OAuth 2.0',
      loginUrl: `${base}/api/auth/login`,
      callbackUrl: `${base}/api/auth/callback`,
      userUrl: `${base}/api/auth/user`,
      keyManagementUrl: `${base}/api/auth/key`,
      header: 'X-Sonic-Key: <your_key> or X-CFSolara-Key: <your_key> or Authorization: Bearer <your_key>',
    },
    endpoints: [
      { path: '/api/sonic/search/smart', method: 'GET', desc: '智能混合搜索引擎：繁简/拼音/别名/纠错/个性化重排与建议 (params: q, mode, count, page)' },
      { path: '/api/sonic/search/nexus', method: 'GET', desc: '多源本地协议聚合搜索 (params: q, count, page)' },
      { path: '/api/sonic/recommend/for-you', method: 'GET', desc: '个性化与上下文推荐：猜你喜欢/最近/收藏/下一首/电台 (params: mode, count, seedTrackId)' },
      { path: '/api/sonic/recommend/trending', method: 'GET', desc: '站内真实热度与趋势榜：24h/7d/飙升/新歌/流派 (params: window, genre, count)' },
      { path: '/api/sonic/recommend/similar', method: 'GET', desc: '基于元数据与会话共现的相似歌曲与相似歌手 (params: trackId, title, artist)' },
      { path: '/api/sonic/recommend/discover', method: 'GET', desc: '基于流派/语种与温度控制的探索推荐 (params: genre, language, temperature)' },
      { path: '/api/sonic/events', method: 'POST/DELETE/GET', desc: '隐私友好的播放与搜索行为反馈及一键清除接口' },
      { path: '/api/sonic/lyrics/nexus', method: 'GET', desc: '多源逐字歌词聚合引擎 (params: title, artist, platform, platformId)' },
      { path: '/api/music/search', method: 'GET', desc: '搜索歌曲 (params: q, source, count, page)' },
      { path: '/api/music/stream', method: 'GET', desc: '获取/代理音频流，支持 HTTP Range 206 (params: id, source, quality)' },
      { path: '/api/music/lyric', method: 'GET', desc: '获取歌词与逐行/逐字时间戳 (params: id, source)' },
      { path: '/api/music/cover', method: 'GET', desc: '多渠道封面与歌手图解析/代理网关 (params: id, source, artist, url)' },
      { path: '/api/music/random', method: 'GET', desc: '随机曲目推荐 (params: count, genre)' },
      { path: '/api/music/palette', method: 'GET', desc: '封面取色与沉浸式背景渐变计算' },
      { path: '/proxy', method: 'GET', desc: '经典兼容代理接口 (Backward compatible)' },
      { path: '/palette', method: 'GET', desc: '经典封面配色接口 (Backward compatible)' },
    ],
  });
}
