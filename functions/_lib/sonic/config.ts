// Sonic Gateway — Configuration & Environment Parser
// Prefix: SONIC_

import type { AppEnv } from '../types';

export const SONIC_UA = 'Sonic/2.0 (Sonic-Gateway; CF Pages Functions)';

export interface SonicConfig {
  upstreamGdstudio: string;
  upstreamAmll: string;
  upstreamLrclib: string;
  upstreamMeting?: string;
  enableNetease: boolean;
  enableQq: boolean;
  enableKugou: boolean;
  enableAmll: boolean;
  enableLrclib: boolean;
  enableGdstudio: boolean;
  enableApple: boolean;
  enableYtmusic: boolean;
  timeoutMs: number;
}

export function isEnvEnabled(val: unknown, defaultValue = true): boolean {
  if (val === undefined || val === null || val === '') return defaultValue;
  const str = String(val).trim().toLowerCase();
  return str === '1' || str === 'true' || str === 'yes' || str === 'on';
}

export function getSonicConfig(env?: AppEnv): SonicConfig {
  const e = (env || {}) as Record<string, any>;

  return {
    upstreamGdstudio: e.SONIC_UPSTREAM_GDSTUDIO || e.MUSIC_API_BASE || 'https://music-api.gdstudio.xyz/api.php',
    upstreamAmll: e.SONIC_UPSTREAM_AMLL || 'https://api.amll.dev',
    upstreamLrclib: e.SONIC_UPSTREAM_LRCLIB || 'https://lrclib.net',
    upstreamMeting: e.SONIC_UPSTREAM_METING || undefined,
    enableNetease: isEnvEnabled(e.SONIC_ENABLE_NETEASE, true),
    enableQq: isEnvEnabled(e.SONIC_ENABLE_QQ, true),
    enableKugou: isEnvEnabled(e.SONIC_ENABLE_KUGOU, true),
    enableAmll: isEnvEnabled(e.SONIC_ENABLE_AMLL, true),
    enableLrclib: isEnvEnabled(e.SONIC_ENABLE_LRCLIB, true),
    enableGdstudio: isEnvEnabled(e.SONIC_ENABLE_GDSTUDIO, true),
    enableApple: isEnvEnabled(e.SONIC_ENABLE_APPLE, false),
    enableYtmusic: isEnvEnabled(e.SONIC_ENABLE_YTMUSIC, false),
    timeoutMs: Math.max(1000, parseInt(String(e.SONIC_TIMEOUT_MS || '3500'), 10) || 3500),
  };
}
