/**
 * Trial-stream end-of-playback guard.
 *
 * Audit fix #3 (player side): the `trial` marker can be wrong in two directions.
 * 1. Probe never returned a stream-type header → the song must NOT be treated
 *    as a trial end (unknown ≠ trial).
 * 2. A complete stream misjudged as `trial` keeps serving audio beyond any
 *    trial clip length → cancel the trial state and resume normal playback
 *    flow instead of stopping with a misleading "trial ended" toast.
 */

/** Default upper bound for an official trial clip when metadata is missing (seconds). */
export const TRIAL_DURATION_FALLBACK_SEC = 45

/** Grace window beyond the declared trial length before we treat the stream as misjudged. */
export const TRIAL_MISJUDGE_GRACE_SEC = 10

export interface TrialEndDecision {
  /** Actual playback exceeded any trial length → cancel the trial state. */
  cancelTrial: boolean
  /** Genuinely a trial clip that played to its end → stop with the trial toast. */
  treatAsTrialEnd: boolean
}

export function resolveTrialEnd(
  streamType: 'full' | 'trial' | 'unavailable' | undefined | null,
  playedSeconds: number,
  trialDurationSec?: number,
): TrialEndDecision {
  // Unknown stream type is NOT a trial end: never stop playback on a guess.
  if (streamType !== 'trial') {
    return { cancelTrial: false, treatAsTrialEnd: false }
  }
  const cap = Math.max(1, Math.round(trialDurationSec || TRIAL_DURATION_FALLBACK_SEC)) + TRIAL_MISJUDGE_GRACE_SEC
  if (Number.isFinite(playedSeconds) && playedSeconds > cap) {
    return { cancelTrial: true, treatAsTrialEnd: false }
  }
  return { cancelTrial: false, treatAsTrialEnd: true }
}
