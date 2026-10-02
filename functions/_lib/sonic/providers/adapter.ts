// Sonic Gateway — Provider Adapter Interface

import type { AppEnv } from '../../types';
import type {
  SonicQueryParams,
  SonicLyricsData,
  SonicSearchTrack,
  SonicSearchOptions,
  SonicMatchLevel,
  SonicProvider,
} from '../types';

export interface ProviderLyricResult {
  data: SonicLyricsData;
  matchLevel: SonicMatchLevel;
  matchScore: number;
  provider: SonicProvider | string;
  qualityScore: number;
}

export interface SonicProviderAdapter {
  name: SonicProvider | string;
  isEnabled(env?: AppEnv): boolean;
  getLyrics?(params: SonicQueryParams, options?: { env?: AppEnv; signal?: AbortSignal }): Promise<ProviderLyricResult | null>;
  search?(query: string, options?: SonicSearchOptions & { env?: AppEnv }): Promise<SonicSearchTrack[]>;
}
