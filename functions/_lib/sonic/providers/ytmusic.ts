// Sonic Provider — YouTube Music
// Optional adapter: returns 501 / disabled when no credentials

import type { AppEnv } from '../../types';
import type { SonicQueryParams } from '../types';
import type { SonicProviderAdapter, ProviderLyricResult } from './adapter';
import { getSonicConfig } from '../config';

export const ytmusicProvider: SonicProviderAdapter = {
  name: 'ytmusic',
  isEnabled(env?: AppEnv): boolean {
    const config = getSonicConfig(env);
    const hasKey = Boolean((env as any)?.SONIC_YOUTUBE_API_KEY || (env as any)?.YOUTUBE_API_KEY);
    return config.enableYtmusic && hasKey;
  },

  async getLyrics(params: SonicQueryParams, options?: { env?: AppEnv; signal?: AbortSignal }): Promise<ProviderLyricResult | null> {
    if (!this.isEnabled(options?.env)) {
      return null;
    }
    // Reserved for configured YouTube Data API / innertube provider
    return null;
  },
};
