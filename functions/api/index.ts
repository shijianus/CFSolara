import { handleOptions, jsonResponse } from '../_lib/http';
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
    name: 'Sonic Music Cloud Platform & Aggregation Gateway',
    version: '2.2.0',
    copyright: '© EpoCanvas',
    description: 'Linux 本地解析引擎为主 + Cloudflare 边缘缓存与优雅降级为辅的音乐网关',
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
      { path: '/api/sonic/search/nexus', method: 'GET', desc: '多源本地协议聚合搜索 (params: q, count, page)' },
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
