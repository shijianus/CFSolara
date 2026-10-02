// Sonic Lyrics Gateway — Providers (Backward Compatibility Wrapper)
// Delegates to unified ./sonic library

import type { SonicQueryParams } from './sonic/types';
import type { AppEnv } from './types';
import { resolveNexusLyrics } from './sonic/nexus-lyrics';

export * from './sonic/providers';
export * from './sonic/nexus-lyrics';
export * from './sonic/nexus-search';

/**
 * Backward compatibility wrapper for resolveSonicLyrics
 */
export async function resolveSonicLyrics(params: SonicQueryParams, env?: AppEnv) {
  const result = await resolveNexusLyrics(params, env);
  return {
    data: result.data,
    matchLevel: result.matchLevel,
    matchScore: result.matchScore,
    provider: result.provider as any,
    qualityScore: result.qualityScore,
  };
}
