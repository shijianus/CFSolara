// Sonic Gateway — Secret loading & validation
// There are deliberately no default secrets. A missing or short secret must
// fail closed on every signing and verification path.

import type { AppEnv } from './types';

export const MIN_SECRET_LENGTH = 32;

export function isValidSecret(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= MIN_SECRET_LENGTH;
}

export function readSecret(value: unknown): string | null {
  if (!isValidSecret(value)) return null;
  return value.trim();
}

export interface SigningSecrets {
  current: string | null;
  previous: string | null;
}

export function getSigningSecrets(env: AppEnv | undefined): SigningSecrets {
  const e = (env || {}) as AppEnv;
  return {
    current: readSecret(e.SONIC_SECRET || e.SOLARA_SECRET),
    previous: readSecret(e.SONIC_SECRET_PREV),
  };
}

export function hasSigningSecret(env: AppEnv | undefined): boolean {
  return getSigningSecrets(env).current !== null;
}

export function logSecretConfigError(context: string, env: AppEnv | undefined): void {
  const e = (env || {}) as AppEnv;
  const configured = Boolean(e.SONIC_SECRET || e.SOLARA_SECRET);
  const reason = configured ? `must be at least ${MIN_SECRET_LENGTH} characters` : 'is not configured';
  // Never log the value itself.
  console.error(`[Sonic Security] ${context}: signing secret ${reason}`);
}
