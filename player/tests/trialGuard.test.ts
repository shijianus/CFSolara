// Unit tests for the trial-end guard (audit fix #3, player side).
import { describe, it, expect } from 'vitest'
import { resolveTrialEnd, TRIAL_DURATION_FALLBACK_SEC, TRIAL_MISJUDGE_GRACE_SEC } from '../src/utils/trialGuard'

describe('resolveTrialEnd', () => {
  it('unknown/undefined stream type is never a trial end (probe header missing)', () => {
    expect(resolveTrialEnd(undefined, 30, 30)).toEqual({ cancelTrial: false, treatAsTrialEnd: false })
    expect(resolveTrialEnd(null, 30, 30)).toEqual({ cancelTrial: false, treatAsTrialEnd: false })
    expect(resolveTrialEnd('full', 30, 30)).toEqual({ cancelTrial: false, treatAsTrialEnd: false })
    expect(resolveTrialEnd('unavailable', 30, 30)).toEqual({ cancelTrial: false, treatAsTrialEnd: false })
  })

  it('a genuine trial clip that reached its end stops with the trial toast', () => {
    expect(resolveTrialEnd('trial', 30, 30).treatAsTrialEnd).toBe(true)
    // exactly at the grace boundary still counts as a trial end
    expect(resolveTrialEnd('trial', 30 + TRIAL_MISJUDGE_GRACE_SEC, 30).treatAsTrialEnd).toBe(true)
  })

  it('missing trialDuration falls back to the default cap', () => {
    expect(resolveTrialEnd('trial', TRIAL_DURATION_FALLBACK_SEC + TRIAL_MISJUDGE_GRACE_SEC - 1, undefined).treatAsTrialEnd).toBe(true)
    expect(resolveTrialEnd('trial', TRIAL_DURATION_FALLBACK_SEC + TRIAL_MISJUDGE_GRACE_SEC + 1, undefined).cancelTrial).toBe(true)
  })

  it('complete stream misjudged as trial is cancelled once playback exceeds any trial cap', () => {
    // 240s of actual audio played while the marker said "trial" (declared 30s)
    expect(resolveTrialEnd('trial', 240, 30).cancelTrial).toBe(true)
    // 90s complete track misjudged as trial without metadata
    expect(resolveTrialEnd('trial', 90, undefined).cancelTrial).toBe(true)
    // cancelled decision must not simultaneously request a trial-end stop
    expect(resolveTrialEnd('trial', 240, 30).treatAsTrialEnd).toBe(false)
  })

  it('non-finite played seconds never cancels the trial state', () => {
    expect(resolveTrialEnd('trial', Number.NaN, 30).treatAsTrialEnd).toBe(true)
    expect(resolveTrialEnd('trial', Number.POSITIVE_INFINITY, 30).cancelTrial).toBe(false)
  })
})
