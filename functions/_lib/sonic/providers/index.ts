// Sonic Providers — Registry & Exporter

export * from './adapter';
export * from './amll';
export * from './lrclib';
export * from './netease';
export * from './qq';
export * from './kugou';
export * from './gdstudio';
export * from './apple';
export * from './ytmusic';

import { amllProvider } from './amll';
import { lrclibProvider } from './lrclib';
import { neteaseProvider } from './netease';
import { qqProvider } from './qq';
import { kugouProvider } from './kugou';
import { gdstudioProvider } from './gdstudio';
import { appleProvider } from './apple';
import { ytmusicProvider } from './ytmusic';
import type { SonicProviderAdapter } from './adapter';
import type { AppEnv } from '../../types';

export const kuwoProvider: SonicProviderAdapter = {
  name: 'kuwo',
  isEnabled(env?: AppEnv): boolean {
    return true;
  },
  async getLyrics(params, options) {
    return gdstudioProvider.getLyrics!({ ...params, platform: 'kuwo' }, options);
  },
  async search(query, options) {
    return gdstudioProvider.search!(query, { ...options, platform: 'kuwo' });
  },
};

export const jooxProvider: SonicProviderAdapter = {
  name: 'joox',
  isEnabled(env?: AppEnv): boolean {
    return true;
  },
  async getLyrics(params, options) {
    return gdstudioProvider.getLyrics!({ ...params, platform: 'joox' }, options);
  },
  async search(query, options) {
    return gdstudioProvider.search!(query, { ...options, platform: 'joox' });
  },
};

export const SONIC_PROVIDERS: Record<string, SonicProviderAdapter> = {
  amll: amllProvider,
  lrclib: lrclibProvider,
  netease: neteaseProvider,
  qq: qqProvider,
  kugou: kugouProvider,
  gdstudio: gdstudioProvider,
  kuwo: kuwoProvider,
  joox: jooxProvider,
  apple: appleProvider,
  ytmusic: ytmusicProvider,
};

export function getProvider(name: string): SonicProviderAdapter | undefined {
  const key = name.toLowerCase().trim();
  if (key === 'ncm') return SONIC_PROVIDERS.netease;
  if (key === 'tencent') return SONIC_PROVIDERS.qq;
  return SONIC_PROVIDERS[key];
}

