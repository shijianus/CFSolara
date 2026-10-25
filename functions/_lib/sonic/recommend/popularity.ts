// Sonic Intelligent Recommendation & Smart Search — Station Popularity, Time Decay, Bayesian Smoothing & Anti-Gaming
// Strictly separates:
//   (1) CFSolara internal real listening popularity (`internalScore`, `cfsolara-internal`)
//   (2) Third-party / upstream chart reference (`externalChartScore`, `external-chart`)
//   (3) Personalized predicted interest (computed separately in `engine.ts`)

import type {
  CanonicalTrack,
  ComputedPopularity,
  StoredBehaviorEvent,
  TrendingWindow,
} from './types';

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface PopularityComputeOptions {
  window?: TrendingWindow;
  nowMs?: number;
  confidencePriorK?: number; // Default k = 5 unique listeners
}

// Wilson score lower bound for binomial proportion (prevents 1/1 = 100% small-sample inflation)
export function wilsonLowerBound(positive: number, total: number, z = 1.645): number {
  if (total <= 0 || positive <= 0) return 0;
  const p = Math.min(1, positive / total);
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return Math.max(0, Math.min(1, (center - margin) / denom));
}

export function exponentialTimeDecay(ageMs: number, halfLifeMs: number): number {
  if (ageMs <= 0) return 1;
  if (halfLifeMs <= 0) return 0;
  return Math.pow(2, -ageMs / halfLifeMs);
}

// Per-(user, track) logarithmic cap: 1 play -> 1.0, 10 plays -> 2.15, 100 plays -> 3.30
export function compressUserRepeatPlays(rawWeightedPlays: number): number {
  if (rawWeightedPlays <= 0) return 0;
  if (rawWeightedPlays <= 1) return rawWeightedPlays;
  return 1 + 0.5 * Math.log(rawWeightedPlays);
}

interface RawTrackAccumulator {
  userDecayedPlaysWindow: Map<string, number>;
  userPlays24h: Map<string, number>;
  userPlays7d: Map<string, number>;
  uniqueUsersWindow: Set<string>;
  uniqueUsers24h: Set<string>;
  uniqueUsers7d: Set<string>;
  playStarts: number;
  playCompletes: number;
  favoritesUsers: Set<string>;
  unfavoritesUsers: Set<string>;
  dislikeUsers: Set<string>;
  undislikeUsers: Set<string>;
  lastPlayedAt: number;
}

function getOrCreateAcc(map: Map<string, RawTrackAccumulator>, trackId: string): RawTrackAccumulator {
  let acc = map.get(trackId);
  if (!acc) {
    acc = {
      userDecayedPlaysWindow: new Map(),
      userPlays24h: new Map(),
      userPlays7d: new Map(),
      uniqueUsersWindow: new Set(),
      uniqueUsers24h: new Set(),
      uniqueUsers7d: new Set(),
      playStarts: 0,
      playCompletes: 0,
      favoritesUsers: new Set(),
      unfavoritesUsers: new Set(),
      dislikeUsers: new Set(),
      undislikeUsers: new Set(),
      lastPlayedAt: 0,
    };
    map.set(trackId, acc);
  }
  return acc;
}

export function computeCatalogPopularity(
  tracks: CanonicalTrack[],
  events: StoredBehaviorEvent[],
  options?: PopularityComputeOptions,
): Map<string, ComputedPopularity> {
  const window: TrendingWindow = options?.window || '7d';
  const nowMs = options?.nowMs ?? Date.now();
  const kPrior = options?.confidencePriorK ?? 5;

  const halfLifeMs =
    window === '24h' || window === 'surging'
      ? 12 * HOUR_MS
      : window === '7d' || window === 'new'
        ? 72 * HOUR_MS
        : 30 * DAY_MS;

  const windowCutoffMs =
    window === '24h'
      ? nowMs - DAY_MS
      : window === '7d' || window === 'surging'
        ? nowMs - 7 * DAY_MS
        : window === 'new'
          ? nowMs - 14 * DAY_MS
          : 0;

  const cutoff24h = nowMs - DAY_MS;
  const cutoff7d = nowMs - 7 * DAY_MS;

  const accMap = new Map<string, RawTrackAccumulator>();

  // Process chronological / reverse-chronological events
  for (const ev of events) {
    const tid = ev.canonicalTrackId;
    if (!tid || !ev.subjectKey) continue;
    const acc = getOrCreateAcc(accMap, tid);
    const ageMs = Math.max(0, nowMs - ev.createdAt);
    const inWindow = ev.createdAt >= windowCutoffMs;
    const in24h = ev.createdAt >= cutoff24h;
    const in7d = ev.createdAt >= cutoff7d;

    if (ev.type === 'play_start') {
      if (inWindow) acc.playStarts += 1;
      // A start by itself is small (0.25) until progress/complete arrives, preventing instant-skip spam
      const decay = exponentialTimeDecay(ageMs, halfLifeMs);
      if (inWindow) {
        acc.userDecayedPlaysWindow.set(
          ev.subjectKey,
          (acc.userDecayedPlaysWindow.get(ev.subjectKey) || 0) + 0.25 * decay,
        );
      }
      if (ev.createdAt > acc.lastPlayedAt) acc.lastPlayedAt = ev.createdAt;
    } else if (ev.type === 'play_progress') {
      const ratio = ev.progressRatio ?? 0.5;
      if (ratio >= 0.45) {
        const decay = exponentialTimeDecay(ageMs, halfLifeMs);
        if (inWindow) {
          acc.uniqueUsersWindow.add(ev.subjectKey);
          acc.userDecayedPlaysWindow.set(
            ev.subjectKey,
            (acc.userDecayedPlaysWindow.get(ev.subjectKey) || 0) + 0.55 * decay,
          );
        }
        if (in24h) {
          acc.uniqueUsers24h.add(ev.subjectKey);
          acc.userPlays24h.set(ev.subjectKey, (acc.userPlays24h.get(ev.subjectKey) || 0) + 0.55);
        }
        if (in7d) {
          acc.uniqueUsers7d.add(ev.subjectKey);
          acc.userPlays7d.set(ev.subjectKey, (acc.userPlays7d.get(ev.subjectKey) || 0) + 0.55);
        }
        if (ev.createdAt > acc.lastPlayedAt) acc.lastPlayedAt = ev.createdAt;
      }
    } else if (ev.type === 'play_complete' || ev.type === 'replay') {
      const mult = ev.type === 'replay' ? 1.25 : 1.0;
      const decay = exponentialTimeDecay(ageMs, halfLifeMs);
      if (inWindow) {
        acc.playCompletes += 1;
        if (acc.playStarts < acc.playCompletes) acc.playStarts = acc.playCompletes;
        acc.uniqueUsersWindow.add(ev.subjectKey);
        acc.userDecayedPlaysWindow.set(
          ev.subjectKey,
          (acc.userDecayedPlaysWindow.get(ev.subjectKey) || 0) + mult * decay,
        );
      }
      if (in24h) {
        acc.uniqueUsers24h.add(ev.subjectKey);
        acc.userPlays24h.set(ev.subjectKey, (acc.userPlays24h.get(ev.subjectKey) || 0) + mult);
      }
      if (in7d) {
        acc.uniqueUsers7d.add(ev.subjectKey);
        acc.userPlays7d.set(ev.subjectKey, (acc.userPlays7d.get(ev.subjectKey) || 0) + mult);
      }
      if (ev.createdAt > acc.lastPlayedAt) acc.lastPlayedAt = ev.createdAt;
    } else if (ev.type === 'favorite') {
      acc.favoritesUsers.add(ev.subjectKey);
      acc.unfavoritesUsers.delete(ev.subjectKey);
      if (inWindow) acc.uniqueUsersWindow.add(ev.subjectKey);
    } else if (ev.type === 'unfavorite') {
      acc.unfavoritesUsers.add(ev.subjectKey);
    } else if (ev.type === 'dislike') {
      acc.dislikeUsers.add(ev.subjectKey);
      acc.undislikeUsers.delete(ev.subjectKey);
    } else if (ev.type === 'undislike') {
      acc.undislikeUsers.add(ev.subjectKey);
    }
  }

  // First pass: compute capped effective plays & maxima for log normalization
  interface IntermediateStats {
    effectivePlays: number;
    effective24h: number;
    effective7d: number;
    uniqueListeners: number;
    completionRateSmoothed: number;
    favoriteRateSmoothed: number;
    velocityScore: number;
    netDislikes: number;
  }

  const intermediate = new Map<string, IntermediateStats>();
  let maxEffectivePlays = 1;
  let maxUniqueListeners = 1;

  for (const [tid, acc] of accMap.entries()) {
    let effectivePlays = 0;
    for (const rawVal of acc.userDecayedPlaysWindow.values()) {
      effectivePlays += compressUserRepeatPlays(rawVal);
    }

    let effective24h = 0;
    for (const rawVal of acc.userPlays24h.values()) {
      effective24h += compressUserRepeatPlays(rawVal);
    }

    let effective7d = 0;
    for (const rawVal of acc.userPlays7d.values()) {
      effective7d += compressUserRepeatPlays(rawVal);
    }

    const netFavs = Math.max(0, acc.favoritesUsers.size - acc.unfavoritesUsers.size);
    const netDislikes = Math.max(0, acc.dislikeUsers.size - acc.undislikeUsers.size);
    const uniqueListeners = acc.uniqueUsersWindow.size;

    // Bayesian-smoothed completion rate (prior mean = 0.62, strength = 4)
    const starts = Math.max(acc.playStarts, acc.playCompletes);
    const completionRateSmoothed =
      starts > 0 ? (acc.playCompletes + 4 * 0.62) / (starts + 4) : 0.62;

    // Favorite score combining Wilson lower bound and Bayesian smoothing
    const listenerDenom = Math.max(uniqueListeners, netFavs, 1);
    const wilsonFav = wilsonLowerBound(netFavs, listenerDenom);
    const bayesFav = (netFavs + 5 * 0.12) / (listenerDenom + 5);
    const favoriteRateSmoothed = uniqueListeners > 0 || netFavs > 0 ? 0.6 * wilsonFav + 0.4 * bayesFav : 0;

    // 24h vs previous 6-day daily average velocity (Laplace-smoothed beta = 1.2)
    const prev6dDailyAvg = Math.max(0, effective7d - effective24h) / 6;
    const rawVelocityRatio = (effective24h + 1.2) / (prev6dDailyAvg + 1.2);
    const velocityScore =
      effective24h > 0
        ? Math.max(0, Math.min(1, 1 - Math.exp(-0.55 * Math.max(0, rawVelocityRatio - 0.85))))
        : 0;

    if (effectivePlays > maxEffectivePlays) maxEffectivePlays = effectivePlays;
    if (uniqueListeners > maxUniqueListeners) maxUniqueListeners = uniqueListeners;

    intermediate.set(tid, {
      effectivePlays,
      effective24h,
      effective7d,
      uniqueListeners,
      completionRateSmoothed,
      favoriteRateSmoothed,
      velocityScore,
      netDislikes,
    });
  }

  // Second pass: assemble final ComputedPopularity for all requested tracks
  const out = new Map<string, ComputedPopularity>();
  const logMaxPlays = Math.log(1 + Math.max(2, maxEffectivePlays));
  const logMaxListeners = Math.log(1 + Math.max(2, maxUniqueListeners));

  for (const track of tracks) {
    const tid = track.canonicalTrackId;
    const st = intermediate.get(tid);
    const externalChartScore = Math.max(0, Math.min(1, (track.externalPopularity || 0) / 100));

    if (!st || (st.effectivePlays <= 0 && st.uniqueListeners === 0)) {
      out.set(tid, {
        canonicalTrackId: tid,
        internalScore: 0,
        externalChartScore,
        velocityScore: 0,
        completionRateSmoothed: 0,
        favoriteRateSmoothed: 0,
        confidence: 0,
        uniqueListeners: 0,
        effectivePlays: 0,
        primarySource: 'external-chart',
      });
      continue;
    }

    const playNorm = Math.min(1, Math.log(1 + st.effectivePlays) / logMaxPlays);
    const listenerNorm = Math.min(1, Math.log(1 + st.uniqueListeners) / logMaxListeners);
    // Favorite rate scaled to [0, 1] where >= 0.45 smoothed rate reaches ~1.0
    const favNorm = Math.min(1, st.favoriteRateSmoothed / 0.45);

    // Candidate weighted combination:
    //   35% recent effective plays + 25% unique listeners + 20% completion + 15% favorites + 5% velocity
    //   (For `surging` window, boost velocity weight to 40% to surface genuinely rising tracks)
    const rawWeighted =
      window === 'surging'
        ? 0.25 * playNorm +
          0.2 * listenerNorm +
          0.1 * st.completionRateSmoothed +
          0.05 * favNorm +
          0.4 * st.velocityScore
        : 0.35 * playNorm +
          0.25 * listenerNorm +
          0.2 * st.completionRateSmoothed +
          0.15 * favNorm +
          0.05 * st.velocityScore;

    // Low-sample Bayesian confidence shrinkage: U / (U + k)
    const confidence = st.uniqueListeners / (st.uniqueListeners + kPrior);

    // Anti-dislike dampening & anti-monopoly freshness modulation
    const dislikePenalty = 1 / (1 + 0.35 * st.netDislikes);
    const catalogAgeDays = Math.max(0, (nowMs - (track.firstSeenAt || nowMs)) / DAY_MS);
    const antiMonopolyFactor = window === 'new'
      ? Math.pow(2, -catalogAgeDays / 14)
      : 0.88 + 0.12 * Math.pow(2, -catalogAgeDays / 45);

    const internalScore = Math.max(
      0,
      Math.min(1, rawWeighted * (0.25 + 0.75 * confidence) * dislikePenalty * antiMonopolyFactor),
    );

    out.set(tid, {
      canonicalTrackId: tid,
      internalScore,
      externalChartScore,
      velocityScore: st.velocityScore,
      completionRateSmoothed: st.completionRateSmoothed,
      favoriteRateSmoothed: st.favoriteRateSmoothed,
      confidence,
      uniqueListeners: st.uniqueListeners,
      effectivePlays: st.effectivePlays,
      primarySource: st.uniqueListeners >= 1 && internalScore > 0.05 ? 'cfsolara-internal' : 'external-chart',
    });
  }

  return out;
}
