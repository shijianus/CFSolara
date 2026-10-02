// Sonic Provider — Apple Music
// Optional adapter: returns 501 / disabled when no credentials

import type { AppEnv } from '../../types';
import type { SonicQueryParams } from '../types';
import type { SonicProviderAdapter, ProviderLyricResult } from './adapter';
import { getSonicConfig } from '../config';

export const appleProvider: SonicProviderAdapter = {
  name: 'apple',
  isEnabled(env?: AppEnv): boolean {
    const config = getSonicConfig(env);
    const hasToken = Boolean((env as any)?.SONIC_APPLE_MUSIC_TOKEN || (env as any)?.APPLE_MUSIC_TOKEN);
    return config.enableApple && hasToken;
  },

  async getLyrics(params: SonicQueryParams, options?: { env?: AppEnv; signal?: AbortSignal }): Promise<ProviderLyricResult | null> {
    // If not enabled or no keys, return null so nexus gracefully falls back
    if (!this.isEnabled(options?.env)) {
      return null;
    }
    // Reserved for configured Apple Music MusicKit developer token
    return null;
  },
};
