// Sonic Intelligent Recommendation & Smart Search — Core Hybrid Recommendation Engine
// Implements:
//   - Target A: Station Popularity (24h / 7d / all / surging / new / genre / personalized)
//   - Target B: Search-Intent Driven Recommendations (queries + clicks + downstream plays)
//   - Target C: Playback Behavior Recommendations (for-you, recent, favorites, next/Auto-DJ, radio, dislike)
//   - Target D: Honest Metadata + Co-occurrence Content Similarity & MMR Diversity Reranking

import type { AppEnv } from '../../types';
import { searchNexus } from '../nexus-search';
import type {
  CanonicalTrack,
  ComputedPopularity,
  DiscoverOptions,
  ExplanationSignal,
  ForYouOptions,
  RecommendationExplanation,
  RecommendedTrack,
  RecommendStore,
  ScoreSourceKind,
  SimilarOptions,
  SonicBehaviorEventInput,
  StoredBehaviorEvent,
  TrendingOptions,
  UserIdentityContext,
  UserPreferenceProfile,
} from './types';
import {
  compactNormalize,
  extractQueryGenres,
  getRelatedArtists,
  resolveCanonicalArtist,
  toSimplifiedChinese,
} from './text-norm';
import {
  canonicalToRecommendedTrack,
  deterministicHash16,
  isPlayableTrack,
  toCanonicalTrack,
} from './track-canonical';
import { getRecommendStore } from './memory-store';
import { computeCatalogPopularity, exponentialTimeDecay } from './popularity';
import { ensureCatalogSeeded } from './seed-catalog';
import {
  fetchGorseNeighbors,
  fetchGorseRecommendations,
  fetchListenBrainzSimilarArtists,
  isGorseEnabled,
  syncFeedbackToGorse,
  syncTrackToGorse,
} from './external-adapters';

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

const NON_USER_SKIP_REASONS = new Set([
  'network_stall',
  'playback_error',
  'trial_end',
  'stream_unavailable',
  'buffer_timeout',
  'auto_switch_error',
]);

// ── 1. Event Credibility Weighting & Ingestion ──
export function computeEventCredibilityWeight(ev: SonicBehaviorEventInput): number {
  switch (ev.type) {
    case 'favorite':
      return 4.0;
    case 'unfavorite':
      return -1.5;
    case 'replay':
      return 3.5;
    case 'play_complete':
      return 2.5;
    case 'play_progress': {
      const ratio =
        ev.progressRatio ??
        (ev.playedSeconds && ev.durationSeconds && ev.durationSeconds > 0
          ? ev.playedSeconds / ev.durationSeconds
          : 0.5);
      if (ratio >= 0.75) return 1.8;
      if (ratio >= 0.45 || (ev.playedSeconds && ev.playedSeconds >= 60)) return 1.2;
      return 0.2;
    }
    case 'play_start':
      return 0.35;
    case 'search_click':
      return 1.1;
    case 'search':
      return 0.3;
    case 'skip': {
      if (ev.reason && NON_USER_SKIP_REASONS.has(ev.reason)) {
        return 0; // Never confuse network stall / playback error / trial end with user dislike!
      }
      const ratio =
        ev.progressRatio ??
        (ev.playedSeconds !== undefined && ev.durationSeconds && ev.durationSeconds > 0
          ? ev.playedSeconds / ev.durationSeconds
          : undefined);
      if ((ev.playedSeconds !== undefined && ev.playedSeconds >= 60) || (ratio !== undefined && ratio >= 0.5)) {
        return 0.25; // Listened to over half before pressing next -> mild positive, not negative
      }
      if ((ev.playedSeconds !== undefined && ev.playedSeconds < 25) || (ratio !== undefined && ratio < 0.2) || ev.playedSeconds === undefined) {
        return -0.8; // Early manual skip -> weak negative signal
      }
      return -0.25;
    }
    case 'dislike':
      return -5.0;
    case 'undislike':
      return 0.5;
    default:
      return 0;
  }
}

export async function ingestBehaviorEvents(
  inputs: SonicBehaviorEventInput[],
  identity: UserIdentityContext,
  env?: AppEnv,
): Promise<{
  accepted: number;
  deduplicated: number;
  ignoredByPrivacy: number;
  storageKind: string;
}> {
  const store = getRecommendStore(env);
  ensureCatalogSeeded(store);

  if (!identity.personalizationEnabled || !identity.subjectKey) {
    return {
      accepted: 0,
      deduplicated: 0,
      ignoredByPrivacy: inputs.length,
      storageKind: 'none',
    };
  }

  let accepted = 0;
  let deduplicated = 0;
  const now = Date.now();
  const recentEvents = store.getUserEvents(identity.subjectKey, 12, now - HOUR_MS);
  const recentPositiveTracks = recentEvents
    .filter((e) => e.canonicalTrackId && e.weight >= 1.0)
    .map((e) => e.canonicalTrackId!)
    .slice(0, 4);

  for (const rawEv of inputs.slice(0, 50)) {
    if (!rawEv || !rawEv.type) continue;
    const ts =
      typeof rawEv.timestamp === 'number' && Number.isFinite(rawEv.timestamp)
        ? Math.min(now + 60_000, Math.max(now - 90 * DAY_MS, rawEv.timestamp))
        : now;

    let canonicalTrack: CanonicalTrack | null = null;
    if (rawEv.track) {
      canonicalTrack = toCanonicalTrack(rawEv.track, { nowMs: ts });
      if (canonicalTrack) {
        store.upsertTrack(canonicalTrack);
      } else if (rawEv.track.canonicalTrackId || rawEv.track.id) {
        canonicalTrack = store.getTrack(String(rawEv.track.canonicalTrackId || rawEv.track.id));
      }
    }

    const weight = computeEventCredibilityWeight(rawEv);
    // Skip zero-weight non-events (such as network_stall skip) from polluting profile
    if (rawEv.type === 'skip' && weight === 0) {
      continue;
    }

    const cleanQuery = rawEv.query ? rawEv.query.trim().slice(0, 80) : undefined;
    if (cleanQuery && (rawEv.type === 'search' || rawEv.type === 'search_click')) {
      store.recordSearchQuery(compactNormalize(cleanQuery), cleanQuery, rawEv.type === 'search_click');
    }

    const fallbackIdSeed = `${identity.subjectKey}:${rawEv.type}:${canonicalTrack?.canonicalTrackId || cleanQuery || ''}:${Math.floor(ts / 2000)}`;
    const eventId =
      rawEv.eventId && /^[a-zA-Z0-9_.:-]{6,96}$/.test(rawEv.eventId)
        ? rawEv.eventId
        : `ev_${deterministicHash16(fallbackIdSeed)}`;

    const inferredQueryGenres = cleanQuery ? extractQueryGenres(cleanQuery).genres : [];
    const storedEv: StoredBehaviorEvent = {
      eventId,
      subjectKey: identity.subjectKey,
      type: rawEv.type,
      canonicalTrackId: canonicalTrack?.canonicalTrackId,
      artistKey: canonicalTrack?.canonicalArtist || undefined,
      genres: canonicalTrack?.genres?.length ? canonicalTrack.genres : inferredQueryGenres.length ? inferredQueryGenres : undefined,
      language: canonicalTrack?.language,
      query: cleanQuery,
      weight,
      progressRatio: rawEv.progressRatio,
      createdAt: ts,
    };

    const res = store.recordEvent(storedEv);
    if (res.deduplicated) {
      deduplicated += 1;
      continue;
    }
    if (res.inserted) {
      accepted += 1;

      // Update Item-to-Item session co-occurrence graph on real positive engagement
      if (canonicalTrack && weight >= 1.1) {
        const curId = canonicalTrack.canonicalTrackId;
        for (const prevId of recentPositiveTracks) {
          if (prevId !== curId) {
            store.incrementCooccurrence(prevId, curId, Math.min(2.5, weight * 0.5));
          }
        }
        if (!recentPositiveTracks.includes(curId)) {
          recentPositiveTracks.unshift(curId);
          if (recentPositiveTracks.length > 4) recentPositiveTracks.pop();
        }
      }

      // Optional non-blocking Stage 2 Gorse feedback sync
      if (canonicalTrack && isGorseEnabled(env)) {
        syncTrackToGorse(canonicalTrack, env).catch(() => {});
        syncFeedbackToGorse(identity.subjectKey, canonicalTrack.canonicalTrackId, rawEv.type, ts, env).catch(() => {});
      }
    }
  }

  return {
    accepted,
    deduplicated,
    ignoredByPrivacy: 0,
    storageKind: store.kind,
  };
}

// ── 2. User Preference Profile Construction (Short-Term + Long-Term + Search + Negative Feedback) ──
export function buildUserPreferenceProfile(
  identity: UserIdentityContext,
  store: RecommendStore,
  nowMs = Date.now(),
): UserPreferenceProfile {
  const profile: UserPreferenceProfile = {
    subjectKey: identity.subjectKey || 'public',
    totalEvents: 0,
    hasPlayHistory: false,
    hasSearchHistory: false,
    longTermArtists: {},
    shortTermArtists: {},
    genreAffinities: {},
    languageAffinities: {},
    recentTrackIds: [],
    likedTrackIds: new Set<string>(),
    blockedTrackIds: new Set<string>(),
    penalizedArtists: {},
    recentQueries: [],
    updatedAt: nowMs,
  };

  if (!identity.personalizationEnabled) {
    return profile;
  }

  // Fold server-persisted events in chronological order (oldest -> newest) so favorite/unfavorite & dislike/undislike state transitions accurately
  const eventsDesc = identity.subjectKey
    ? store.getUserEvents(identity.subjectKey, 350, nowMs - 90 * DAY_MS)
    : [];
  const eventsAsc = [...eventsDesc].reverse();
  profile.totalEvents = eventsAsc.length;

  // Track which searched queries/tracks were subsequently played/liked (amplifying confirmed search intent)
  const confirmedTrackIds = new Set<string>();
  for (const ev of eventsAsc) {
    if (
      ev.canonicalTrackId &&
      (ev.type === 'play_complete' || ev.type === 'replay' || ev.type === 'favorite' || (ev.type === 'play_progress' && (ev.progressRatio ?? 0.5) >= 0.45))
    ) {
      confirmedTrackIds.add(ev.canonicalTrackId);
      profile.hasPlayHistory = true;
    }
  }

  for (const ev of eventsAsc) {
    const ageMs = Math.max(0, nowMs - ev.createdAt);
    const shortDecay = exponentialTimeDecay(ageMs, 24 * HOUR_MS);
    const longDecay = exponentialTimeDecay(ageMs, 21 * DAY_MS);

    if (ev.type === 'favorite' && ev.canonicalTrackId) {
      profile.likedTrackIds.add(ev.canonicalTrackId);
      profile.blockedTrackIds.delete(ev.canonicalTrackId);
    } else if (ev.type === 'unfavorite' && ev.canonicalTrackId) {
      profile.likedTrackIds.delete(ev.canonicalTrackId);
    } else if (ev.type === 'dislike' && ev.canonicalTrackId) {
      profile.blockedTrackIds.add(ev.canonicalTrackId);
      profile.likedTrackIds.delete(ev.canonicalTrackId);
      if (ev.artistKey) {
        profile.penalizedArtists[ev.artistKey] = (profile.penalizedArtists[ev.artistKey] || 0) + 1.8 * longDecay;
      }
    } else if (ev.type === 'undislike' && ev.canonicalTrackId) {
      profile.blockedTrackIds.delete(ev.canonicalTrackId);
    }

    if (ev.type === 'search' || ev.type === 'search_click') {
      profile.hasSearchHistory = true;
      if (ev.query && !profile.recentQueries.includes(ev.query)) {
        profile.recentQueries.unshift(ev.query);
        if (profile.recentQueries.length > 15) profile.recentQueries.pop();
      }
    }

    // Weight adjustment: unconfirmed raw `search` stays modest (0.3), while `search_click` confirmed by actual playback gets 1.8x boost!
    let effectiveWeight = ev.weight;
    if (ev.type === 'search_click' && ev.canonicalTrackId && confirmedTrackIds.has(ev.canonicalTrackId)) {
      effectiveWeight *= 1.8;
    }

    let artist = ev.artistKey ? resolveCanonicalArtist(ev.artistKey) : '';
    if (!artist && ev.query && ev.type === 'search') {
      // Check if user searched for a known artist (e.g. "周杰伦", "Jay Chou", "林俊杰")
      const resolvedFromQuery = resolveCanonicalArtist(ev.query);
      if (compactNormalize(resolvedFromQuery) !== compactNormalize(ev.query) || store.searchLocalTracks(ev.query, 1)[0]?.canonicalArtist === resolvedFromQuery) {
        artist = resolvedFromQuery;
      }
    }

    if (artist) {
      if (effectiveWeight > 0) {
        profile.longTermArtists[artist] = (profile.longTermArtists[artist] || 0) + effectiveWeight * longDecay;
        profile.shortTermArtists[artist] = (profile.shortTermArtists[artist] || 0) + effectiveWeight * shortDecay;
      } else if (effectiveWeight < 0) {
        profile.penalizedArtists[artist] = (profile.penalizedArtists[artist] || 0) + Math.abs(effectiveWeight) * 0.45 * shortDecay;
      }
    }

    if (Array.isArray(ev.genres)) {
      for (const g of ev.genres) {
        if (!g) continue;
        profile.genreAffinities[g] = (profile.genreAffinities[g] || 0) + effectiveWeight * 0.7 * longDecay;
      }
    }

    if (ev.language && ev.language !== 'unknown') {
      profile.languageAffinities[ev.language] =
        (profile.languageAffinities[ev.language] || 0) + effectiveWeight * 0.5 * longDecay;
    }

    if (ev.canonicalTrackId && effectiveWeight > 0.3 && ev.type !== 'search') {
      const idx = profile.recentTrackIds.indexOf(ev.canonicalTrackId);
      if (idx !== -1) profile.recentTrackIds.splice(idx, 1);
      profile.recentTrackIds.unshift(ev.canonicalTrackId);
      if (profile.recentTrackIds.length > 40) profile.recentTrackIds.pop();
    }
  }

  // Merge opted-in client hints (useful on cold Edge isolates or pre-existing local Pinia library)
  const hints = identity.clientHints;
  if (hints) {
    for (const rawId of hints.dislikedTrackIds || []) {
      const mapped = store.getTrack(rawId)?.canonicalTrackId || rawId;
      profile.blockedTrackIds.add(mapped);
    }
    for (const rawId of hints.likedTrackIds || []) {
      const t = store.getTrack(rawId);
      const tid = t?.canonicalTrackId || rawId;
      if (!profile.blockedTrackIds.has(tid)) {
        profile.likedTrackIds.add(tid);
        profile.hasPlayHistory = true;
      }
      if (t) {
        profile.longTermArtists[t.canonicalArtist] = (profile.longTermArtists[t.canonicalArtist] || 0) + 2.2;
        for (const g of t.genres) {
          profile.genreAffinities[g] = (profile.genreAffinities[g] || 0) + 1.2;
        }
      }
    }
    for (const rawAr of hints.likedArtists || []) {
      const ar = resolveCanonicalArtist(rawAr);
      profile.longTermArtists[ar] = (profile.longTermArtists[ar] || 0) + 2.5;
      profile.hasPlayHistory = true;
    }
    for (const rawAr of hints.recentArtists || []) {
      const ar = resolveCanonicalArtist(rawAr);
      profile.shortTermArtists[ar] = (profile.shortTermArtists[ar] || 0) + 1.4;
      profile.hasPlayHistory = true;
    }
    for (const rawAr of hints.dislikedArtists || []) {
      const ar = resolveCanonicalArtist(rawAr);
      profile.penalizedArtists[ar] = (profile.penalizedArtists[ar] || 0) + 2.5;
    }
    for (const q of hints.recentQueries || []) {
      profile.hasSearchHistory = true;
      if (!profile.recentQueries.includes(q)) profile.recentQueries.push(q);
      const { genres } = extractQueryGenres(q);
      for (const g of genres) {
        profile.genreAffinities[g] = (profile.genreAffinities[g] || 0) + 0.9;
      }
    }
  }

  return profile;
}

// ── 3. Content + Co-occurrence Similarity (Honest Metadata + Session Graph) ──
export function computeTrackSimilarity(
  seed: CanonicalTrack,
  candidate: CanonicalTrack,
  cooccurrenceWeight = 0,
): {
  score: number;
  basis: 'metadata-and-cooccurrence' | 'metadata-only';
  signals: ExplanationSignal[];
} {
  if (seed.canonicalTrackId === candidate.canonicalTrackId) {
    return { score: 1, basis: 'metadata-only', signals: [] };
  }

  let metaScore = 0;
  const signals: ExplanationSignal[] = [];

  const sameArtist = compactNormalize(seed.canonicalArtist) === compactNormalize(candidate.canonicalArtist);
  const relatedArtists = getRelatedArtists(seed.canonicalArtist).map(compactNormalize);
  const isRelatedArtist = !sameArtist && relatedArtists.includes(compactNormalize(candidate.canonicalArtist));

  if (sameArtist) {
    metaScore += 0.42;
    signals.push({
      type: 'content_artist',
      label: `同歌手 · ${candidate.canonicalArtist}`,
      weight: 0.42,
    });
  } else if (isRelatedArtist) {
    metaScore += 0.28;
    signals.push({
      type: 'content_artist',
      label: `相似歌手 · ${candidate.canonicalArtist}`,
      weight: 0.28,
    });
  }

  // Genre Jaccard similarity
  if (seed.genres.length > 0 && candidate.genres.length > 0) {
    const shared = candidate.genres.filter((g) => seed.genres.includes(g));
    if (shared.length > 0) {
      const union = new Set([...seed.genres, ...candidate.genres]).size;
      const jaccard = shared.length / Math.max(1, union);
      const gScore = 0.28 * jaccard;
      metaScore += gScore;
      signals.push({
        type: 'content_genre',
        label: `风格契合 · ${shared.slice(0, 2).join(' / ')}`,
        weight: Math.round(gScore * 100) / 100,
      });
    }
  }

  // Language consistency
  if (seed.language !== 'unknown' && seed.language === candidate.language) {
    metaScore += 0.14;
    signals.push({
      type: 'content_language',
      label: `同语种曲风`,
      weight: 0.14,
    });
  }

  // Same album or close duration pacing
  if (seed.cleanAlbum && candidate.cleanAlbum && seed.cleanAlbum === candidate.cleanAlbum) {
    metaScore += 0.08;
  } else if (seed.duration > 0 && candidate.duration > 0 && Math.abs(seed.duration - candidate.duration) <= 40) {
    metaScore += 0.05;
  }

  // Prefer studio version when seed is studio
  if (seed.edition === 'studio' && candidate.edition !== 'studio') {
    metaScore *= 0.72;
  } else if (seed.edition === candidate.edition) {
    metaScore += 0.04;
  }

  // Item-to-Item co-occurrence boost
  let coocScore = 0;
  if (cooccurrenceWeight > 0) {
    coocScore = Math.min(0.32, (Math.log(1 + cooccurrenceWeight) / Math.log(1 + 12)) * 0.32);
    signals.push({
      type: 'cooccurrence',
      label: '听过这首歌的用户也常听',
      weight: Math.round(coocScore * 100) / 100,
    });
  }

  const finalSim = Math.max(0, Math.min(1, metaScore + coocScore));
  return {
    score: finalSim,
    basis: coocScore > 0 ? 'metadata-and-cooccurrence' : 'metadata-only',
    signals,
  };
}

// ── 4. MMR Diversity Reranking, Artist/Album Caps & Exploration ──
function trackRedundancy(a: CanonicalTrack, b: CanonicalTrack): number {
  if (a.cleanTitle === b.cleanTitle && compactNormalize(a.canonicalArtist) === compactNormalize(b.canonicalArtist)) {
    return 1.0;
  }
  let sim = 0;
  if (compactNormalize(a.canonicalArtist) === compactNormalize(b.canonicalArtist)) sim += 0.65;
  if (a.cleanAlbum && b.cleanAlbum && a.cleanAlbum === b.cleanAlbum) sim += 0.25;
  if (a.genres.length > 0 && b.genres.length > 0) {
    const shared = a.genres.filter((g) => b.genres.includes(g)).length;
    if (shared > 0) sim += 0.15 * (shared / Math.max(a.genres.length, b.genres.length));
  }
  return Math.min(1, sim);
}

interface ScoredCandidate {
  track: CanonicalTrack;
  score: number;
  scoreSource: ScoreSourceKind;
  explanation: RecommendationExplanation;
  popularity?: ComputedPopularity;
}

function diversifyAndSelectTracks(
  candidates: ScoredCandidate[],
  count: number,
  options?: {
    diversity?: number; // [0, 1] -> MMR penalty weight (1 - lambda)
    temperature?: number; // [0, 1.5]
    maxPerArtist?: number;
    maxPerAlbum?: number;
  },
): RecommendedTrack[] {
  const diversity = Math.max(0, Math.min(0.75, options?.diversity ?? 0.28));
  const lambda = 1 - diversity;
  const temperature = Math.max(0, Math.min(1.5, options?.temperature ?? 0.25));
  const maxPerArtist = options?.maxPerArtist ?? Math.max(2, Math.ceil(count * 0.2));
  const maxPerAlbum = options?.maxPerAlbum ?? 2;

  // Deduplicate same `(cleanTitle, canonicalArtist)` keeping highest score (e.g. studio over cover/live)
  const uniquePool: ScoredCandidate[] = [];
  const seenBaseSong = new Set<string>();
  const sortedInitial = [...candidates].sort((a, b) => b.score - a.score);

  for (const item of sortedInitial) {
    if (!isPlayableTrack(item.track)) continue;
    const songKey = `${item.track.cleanTitle}:::${compactNormalize(item.track.canonicalArtist)}`;
    if (seenBaseSong.has(songKey)) continue;
    seenBaseSong.add(songKey);

    // Controlled exploration jitter proportional to temperature (only among positive candidates)
    let adjustedScore = item.score;
    if (temperature > 0.2) {
      // Deterministic-friendly slight stochastic exploration for discovery
      const jitter = (Math.random() - 0.5) * 0.14 * temperature;
      adjustedScore = Math.max(0.01, item.score + jitter);
    }
    uniquePool.push({ ...item, score: adjustedScore });
  }

  const selected: ScoredCandidate[] = [];
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();
  const remaining = [...uniquePool];

  while (selected.length < count && remaining.length > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const arKey = compactNormalize(cand.track.canonicalArtist);
      const alKey = cand.track.cleanAlbum ? `${arKey}:::${cand.track.cleanAlbum}` : '';

      if ((artistCounts.get(arKey) || 0) >= maxPerArtist) continue;
      if (alKey && (albumCounts.get(alKey) || 0) >= maxPerAlbum) continue;

      let maxSim = 0;
      for (const prev of selected) {
        const r = trackRedundancy(cand.track, prev.track);
        if (r > maxSim) maxSim = r;
      }

      const mmrScore = selected.length === 0 ? cand.score : lambda * cand.score - (1 - lambda) * maxSim * 0.55;
      if (mmrScore > bestMmr) {
        bestMmr = mmrScore;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      // Relax artist/album cap if pool is small so requested count is still met
      const fallback = remaining.shift();
      if (fallback) selected.push(fallback);
      break;
    }

    const [chosen] = remaining.splice(bestIdx, 1);
    selected.push(chosen);
    const arKey = compactNormalize(chosen.track.canonicalArtist);
    artistCounts.set(arKey, (artistCounts.get(arKey) || 0) + 1);
    if (chosen.track.cleanAlbum) {
      const alKey = `${arKey}:::${chosen.track.cleanAlbum}`;
      albumCounts.set(alKey, (albumCounts.get(alKey) || 0) + 1);
    }
  }

  return selected.map((c) =>
    canonicalToRecommendedTrack(c.track, c.score, c.scoreSource, c.explanation, c.popularity),
  );
}

// ── 5. Bounded Live Upstream Catalog Enrichment ──
async function enrichStoreWithLiveQuery(
  query: string,
  store: RecommendStore,
  env?: AppEnv,
  explicitGenres?: string[],
): Promise<void> {
  if (!query || isEnvOfflineForRecommend(env)) return;
  try {
    const res = await searchNexus(
      query,
      { page: 1, count: 12, signal: AbortSignal.timeout(2200) },
      env,
    );
    const canonicals: CanonicalTrack[] = [];
    res.data.tracks.forEach((t, idx) => {
      const ct = toCanonicalTrack(t, { rank: idx, explicitGenres });
      if (ct) canonicals.push(ct);
    });
    if (canonicals.length > 0) {
      store.upsertTracks(canonicals);
    }
  } catch {
    // Fail open silently — local catalog continues serving
  }
}

function isEnvOfflineForRecommend(env?: AppEnv): boolean {
  return String(env?.SONIC_RECOMMEND_OFFLINE || '') === '1';
}

// ── 6. Endpoint Core 1: Personalized / Context Recommendations (`for-you`, `recent`, `favorites`, `next`, `radio`) ──
export async function getRecommendationsForYou(
  identity: UserIdentityContext,
  options: ForYouOptions = {},
  env?: AppEnv,
): Promise<{
  mode: string;
  personalized: boolean;
  privacyMode: string;
  storageKind: string;
  tracks: RecommendedTrack[];
  profileSummary: {
    hasHistory: boolean;
    topArtists: string[];
    topGenres: string[];
  };
}> {
  const store = getRecommendStore(env);
  ensureCatalogSeeded(store);

  const mode = options.mode || 'for-you';
  const count = Math.min(50, Math.max(1, options.count || 18));
  const nowMs = Date.now();
  const profile = buildUserPreferenceProfile(identity, store, nowMs);
  const hasUserSignals = profile.hasPlayHistory || profile.hasSearchHistory || profile.likedTrackIds.size > 0;

  // Resolve optional seed track (for `next` / `radio` modes)
  let seedTrack: CanonicalTrack | null = null;
  if (options.seedTrackId) {
    seedTrack = store.getTrack(options.seedTrackId);
  }
  if (!seedTrack && options.seedTitle) {
    seedTrack = toCanonicalTrack({
      id: options.seedTrackId || '',
      title: options.seedTitle,
      artist: options.seedArtist || '',
    });
    if (seedTrack) store.upsertTrack(seedTrack);
  }

  // Top user artists & genres
  const combinedArtists = new Map<string, number>();
  for (const [ar, w] of Object.entries(profile.longTermArtists)) {
    combinedArtists.set(ar, (combinedArtists.get(ar) || 0) + w * 0.65);
  }
  for (const [ar, w] of Object.entries(profile.shortTermArtists)) {
    combinedArtists.set(ar, (combinedArtists.get(ar) || 0) + w * 0.85);
  }
  const topArtists = Array.from(combinedArtists.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ar]) => ar);

  const topGenres = Object.entries(profile.genreAffinities)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([g]) => g);

  // Opportunistic catalog enrichment if user's top artist or seed artist has sparse local songs
  const probeArtist = seedTrack?.canonicalArtist || topArtists[0];
  if (probeArtist && store.searchLocalTracks(probeArtist, 5).length < 3) {
    await enrichStoreWithLiveQuery(probeArtist, store, env);
  }

  // Optional Stage 2 Gorse collaborative recommendations
  const gorseBoostSet = new Set<string>();
  if (identity.subjectKey && isGorseEnabled(env)) {
    const gorseIds = await fetchGorseRecommendations(identity.subjectKey, count * 2, env);
    gorseIds.forEach((id) => gorseBoostSet.add(id));
  }

  const allTracks = store.listTracks(1200);
  const recentEvents = store.getAllRecentEvents(nowMs - 30 * DAY_MS, 8000);
  const popMap = computeCatalogPopularity(allTracks, recentEvents, { window: '7d', nowMs });

  // Reference anchor tracks based on mode
  const anchorTracks: CanonicalTrack[] = [];
  if (seedTrack) {
    anchorTracks.push(seedTrack);
  } else if (mode === 'favorites' && profile.likedTrackIds.size > 0) {
    for (const id of Array.from(profile.likedTrackIds).slice(0, 6)) {
      const t = store.getTrack(id);
      if (t) anchorTracks.push(t);
    }
  } else if (profile.recentTrackIds.length > 0) {
    for (const id of profile.recentTrackIds.slice(0, 5)) {
      const t = store.getTrack(id);
      if (t) anchorTracks.push(t);
    }
  }

  // Co-occurrence map from anchors
  const coocScores = new Map<string, number>();
  for (const anchor of anchorTracks) {
    for (const edge of store.getCooccurringTracks(anchor.canonicalTrackId, 20)) {
      coocScores.set(edge.canonicalTrackId, (coocScores.get(edge.canonicalTrackId) || 0) + edge.weight);
    }
  }

  const excludeSet = new Set<string>(options.excludeIds || []);
  if (seedTrack) excludeSet.add(seedTrack.canonicalTrackId);
  // Avoid immediately repeating the exact last 3 played songs in `for-you`/`next`/`radio`
  for (const recentId of profile.recentTrackIds.slice(0, mode === 'next' ? 5 : 2)) {
    excludeSet.add(recentId);
  }

  const maxArtistAffinity = Math.max(1, ...Array.from(combinedArtists.values()));
  const maxGenreAffinity = Math.max(1, ...Object.values(profile.genreAffinities));
  const relatedToTopArtists = new Set<string>();
  for (const ar of topArtists.slice(0, 3)) {
    getRelatedArtists(ar).forEach((rel) => relatedToTopArtists.add(compactNormalize(rel)));
  }

  const candidates: ScoredCandidate[] = [];

  for (const track of allTracks) {
    if (!isPlayableTrack(track)) continue;
    if (profile.blockedTrackIds.has(track.canonicalTrackId)) continue;
    if (excludeSet.has(track.canonicalTrackId) || excludeSet.has(track.providerTrackId)) continue;
    // Deprioritize non-studio editions unless user explicitly listens to instrumental/live
    if (track.edition === 'demo' || track.edition === 'cover') continue;

    const pop = popMap.get(track.canonicalTrackId);
    const signals: ExplanationSignal[] = [];

    // Component 1: Content & Co-occurrence similarity to anchors
    let contentScore = 0;
    if (anchorTracks.length > 0) {
      let bestAnchorSim = 0;
      let bestSignals: ExplanationSignal[] = [];
      for (const anchor of anchorTracks) {
        const sim = computeTrackSimilarity(anchor, track, coocScores.get(track.canonicalTrackId) || 0);
        if (sim.score > bestAnchorSim) {
          bestAnchorSim = sim.score;
          bestSignals = sim.signals;
        }
      }
      contentScore = bestAnchorSim;
      signals.push(...bestSignals);
    }

    // Component 2: User Behavior & Search Intent Affinity
    let behaviorScore = 0;
    if (hasUserSignals) {
      const arAffinity = (combinedArtists.get(track.canonicalArtist) || 0) / maxArtistAffinity;
      if (arAffinity > 0.1) {
        behaviorScore += 0.52 * Math.min(1, arAffinity);
        signals.push({
          type: 'behavior_artist',
          label: `常听 ${track.canonicalArtist}`,
          weight: Math.round(0.52 * Math.min(1, arAffinity) * 100) / 100,
        });
      } else if (relatedToTopArtists.has(compactNormalize(track.canonicalArtist))) {
        behaviorScore += 0.34;
        signals.push({
          type: 'behavior_artist',
          label: `与你偏爱的 ${topArtists[0]} 曲风相近`,
          weight: 0.34,
        });
      }

      let gMatch = 0;
      let matchedGenreName = '';
      for (const g of track.genres) {
        const gw = (profile.genreAffinities[g] || 0) / maxGenreAffinity;
        if (gw > gMatch) {
          gMatch = gw;
          matchedGenreName = g;
        }
      }
      if (gMatch > 0.1) {
        behaviorScore += 0.28 * Math.min(1, gMatch);
        signals.push({
          type: 'search_intent',
          label: `符合你偏好的 ${matchedGenreName.toUpperCase()} 风格`,
          weight: Math.round(0.28 * Math.min(1, gMatch) * 100) / 100,
        });
      }

      if (profile.likedTrackIds.has(track.canonicalTrackId) && mode !== 'favorites') {
        // Already in favorites: gentle familiarity bonus without flooding entire list
        behaviorScore += 0.12;
      }

      if (gorseBoostSet.has(track.canonicalTrackId)) {
        behaviorScore += 0.25;
        signals.push({
          type: 'collaborative_gorse',
          label: '协同过滤兴趣匹配',
          weight: 0.25,
        });
      }

      // Apply explicit artist penalty (from dislikes or repeated early skips)
      const penalty = profile.penalizedArtists[track.canonicalArtist] || 0;
      if (penalty > 0) {
        behaviorScore -= Math.min(0.65, penalty * 0.22);
      }
      behaviorScore = Math.max(-0.4, Math.min(1, behaviorScore));
    }

    // Component 3: Station Popularity + Confidence-Blended External Reference
    const internalPop = pop?.internalScore || 0;
    const conf = pop?.confidence || 0;
    const extPop = pop?.externalChartScore ?? track.externalPopularity / 100;
    const blendedPopularity = conf * internalPop + (1 - conf * 0.75) * extPop * 0.75;
    if (internalPop >= 0.25 && (pop?.uniqueListeners || 0) >= 2) {
      signals.push({
        type: 'station_popularity',
        label: `站内近期热播 (${pop!.uniqueListeners} 位听众)`,
        weight: Math.round(internalPop * 100) / 100,
      });
    } else if (extPop >= 0.85 && signals.length === 0) {
      signals.push({
        type: 'external_chart',
        label: '经典高口碑热曲',
        weight: Math.round(extPop * 100) / 100,
      });
    }

    // Component 4: Freshness / Novelty (favor unplayed discoveries)
    const alreadyPlayed = profile.recentTrackIds.includes(track.canonicalTrackId);
    const freshnessScore = alreadyPlayed ? 0.25 : 0.85;

    // Component 5: Context fit (full stream > trial, studio > remix)
    const contextScore =
      (track.streamType === 'trial' ? 0.45 : 1.0) * (track.edition === 'studio' ? 1.0 : 0.78);

    // Dynamic Weight Reallocation (never penalize missing signals!)
    let wContent = 0.30;
    let wBehavior = 0.35;
    let wPop = 0.15;
    let wFresh = 0.10;
    let wContext = 0.10;

    if (mode === 'radio' || mode === 'next') {
      wContent = anchorTracks.length > 0 ? 0.48 : 0.15;
      wBehavior = hasUserSignals ? 0.27 : 0;
      wPop = 0.10;
      wFresh = 0.08;
      wContext = 0.07;
    } else if (!hasUserSignals && anchorTracks.length === 0) {
      // Cold-start user: 0 behavior, 0 anchor -> reallocate to popularity, freshness & context quality
      wContent = 0;
      wBehavior = 0;
      wPop = 0.62;
      wFresh = 0.20;
      wContext = 0.18;
    } else if (anchorTracks.length === 0 && hasUserSignals) {
      // Search-only user (Target B): has search/artist/genre preferences, no anchor track yet
      wContent = 0;
      wBehavior = 0.58;
      wPop = 0.20;
      wFresh = 0.12;
      wContext = 0.10;
    } else if (anchorTracks.length > 0 && !hasUserSignals) {
      wBehavior = 0;
      wContent = 0.60;
      wPop = 0.20;
      wFresh = 0.10;
      wContext = 0.10;
    }

    const wSum = wContent + wBehavior + wPop + wFresh + wContext || 1;
    const finalScore =
      (wContent * contentScore +
        wBehavior * behaviorScore +
        wPop * blendedPopularity +
        wFresh * freshnessScore +
        wContext * contextScore) /
      wSum;

    // Apply artist penalty directly to finalScore even if behavior weight is small
    const arPenalty = profile.penalizedArtists[track.canonicalArtist] || 0;
    const penalizedFinal = arPenalty > 0 ? finalScore * (1 / (1 + 0.45 * arPenalty)) : finalScore;

    signals.sort((a, b) => b.weight - a.weight);
    const topSignal = signals[0];
    const scoreSource: ScoreSourceKind = hasUserSignals
      ? anchorTracks.length > 0
        ? 'hybrid-personalized'
        : 'personalized-interest'
      : seedTrack
        ? 'content-similarity'
        : (pop?.primarySource === 'cfsolara-internal' ? 'cfsolara-internal' : 'cold-start-curated');

    const primaryReason = topSignal
      ? topSignal.label
      : scoreSource === 'cold-start-curated'
        ? '新用户精选多元探索推荐'
        : '全站高口碑热门佳作';

    candidates.push({
      track,
      score: penalizedFinal,
      scoreSource,
      popularity: pop,
      explanation: {
        primaryReason,
        reasonCode: topSignal?.type || 'cold_start_curated',
        scoreSource,
        similarityBasis: coocScores.has(track.canonicalTrackId) ? 'metadata-and-cooccurrence' : 'metadata-only',
        signals: signals.slice(0, 3),
        scoreBreakdown: {
          content: Math.round(contentScore * 1000) / 1000,
          behavior: Math.round(behaviorScore * 1000) / 1000,
          popularity: Math.round(blendedPopularity * 1000) / 1000,
          freshness: Math.round(freshnessScore * 1000) / 1000,
          context: Math.round(contextScore * 1000) / 1000,
          finalScore: Math.round(penalizedFinal * 1000) / 1000,
        },
      },
    });
  }

  const diversified = diversifyAndSelectTracks(candidates, count, {
    diversity: options.diversity ?? (hasUserSignals ? 0.28 : 0.42),
    temperature: options.temperature ?? 0.25,
    maxPerArtist: hasUserSignals ? 3 : 2,
    maxPerAlbum: 2,
  });

  return {
    mode,
    personalized: identity.personalizationEnabled && hasUserSignals,
    privacyMode: identity.mode,
    storageKind: store.kind,
    tracks: diversified,
    profileSummary: {
      hasHistory: hasUserSignals,
      topArtists,
      topGenres,
    },
  };
}

// ── 7. Endpoint Core 2: Station Trending & Popularity (`24h`, `7d`, `all`, `surging`, `new`, `genre`, `personalized`) ──
export async function getTrendingRecommendations(
  identity: UserIdentityContext,
  options: TrendingOptions = {},
  env?: AppEnv,
): Promise<{
  window: string;
  genre: string | null;
  personalized: boolean;
  metricsSeparationNote: string;
  stationStats: {
    activeTracksWithPlays: number;
    totalCatalogTracks: number;
    storageKind: string;
  };
  tracks: RecommendedTrack[];
}> {
  const store = getRecommendStore(env);
  ensureCatalogSeeded(store);

  const window = options.window || '7d';
  const count = Math.min(50, Math.max(1, options.count || 20));
  const genreFilter = options.genre ? options.genre.trim().toLowerCase() : '';
  const wantPersonalized = Boolean(options.personalized && identity.personalizationEnabled);
  const nowMs = Date.now();

  if (genreFilter && store.listTracks(600).filter((t) => t.genres.includes(genreFilter)).length < 4) {
    await enrichStoreWithLiveQuery(genreFilter, store, env, [genreFilter]);
  }

  const allTracks = store.listTracks(1500);
  const events = store.getAllRecentEvents(
    window === 'all' ? nowMs - 180 * DAY_MS : nowMs - 14 * DAY_MS,
    15000,
  );
  const popMap = computeCatalogPopularity(allTracks, events, { window, nowMs });
  const profile = wantPersonalized ? buildUserPreferenceProfile(identity, store, nowMs) : null;

  let activeTracksWithPlays = 0;
  for (const p of popMap.values()) {
    if (p.effectivePlays > 0 && p.uniqueListeners > 0) activeTracksWithPlays++;
  }

  const candidates: ScoredCandidate[] = [];
  for (const track of allTracks) {
    if (!isPlayableTrack(track)) continue;
    if (profile?.blockedTrackIds.has(track.canonicalTrackId)) continue;
    if (genreFilter) {
      const matchGenre =
        track.genres.some((g) => g.includes(genreFilter) || genreFilter.includes(g)) ||
        extractQueryGenres(genreFilter).genres.some((g) => track.genres.includes(g));
      if (!matchGenre) continue;
    }

    const pop = popMap.get(track.canonicalTrackId)!;
    const hasInternal = pop.internalScore > 0 && pop.uniqueListeners > 0;

    // Strict provenance:
    //   When station has real listening data, internal score leads (weighted by confidence U/(U+k)),
    //   while externalChartScore only acts as a cold-start tie-breaker and is explicitly labeled!
    let rankScore: number;
    let scoreSource: ScoreSourceKind;
    let primaryReason: string;
    const signals: ExplanationSignal[] = [];

    if (window === 'surging') {
      rankScore = hasInternal
        ? 0.65 * pop.velocityScore + 0.35 * pop.internalScore
        : 0.28 * pop.externalChartScore;
      scoreSource = hasInternal ? 'cfsolara-internal' : 'external-chart';
      primaryReason = hasInternal
        ? `站内热度飙升 · 24h 活跃 (${pop.uniqueListeners} 人在听)`
        : '外部热榜参考曲目（站内暂无飙升样本）';
      if (hasInternal) {
        signals.push({ type: 'station_popularity', label: primaryReason, weight: rankScore });
      } else {
        signals.push({ type: 'external_chart', label: primaryReason, weight: rankScore });
      }
    } else if (window === 'new') {
      const ageDays = Math.max(0, (nowMs - track.firstSeenAt) / DAY_MS);
      const recencyFactor = Math.pow(2, -ageDays / 10);
      rankScore = (hasInternal ? 0.6 * pop.internalScore + 0.4 * recencyFactor : 0.45 * recencyFactor + 0.35 * pop.externalChartScore);
      scoreSource = hasInternal ? 'cfsolara-internal' : 'external-chart';
      primaryReason = hasInternal ? '站内新入库热播单曲' : '近期入库新歌精选';
      signals.push({ type: 'fresh_discovery', label: primaryReason, weight: rankScore });
    } else {
      if (hasInternal) {
        // Real station data exists: confidence-smoothed internal score dominates
        rankScore = 0.82 * pop.internalScore + 0.18 * pop.externalChartScore * (1 - pop.confidence);
        scoreSource = 'cfsolara-internal';
        primaryReason = `CFSolara 站内真实热播 · ${pop.uniqueListeners} 位听众`;
        signals.push({ type: 'station_popularity', label: primaryReason, weight: pop.internalScore });
      } else {
        // Cold-start fallback: capped below genuine multi-listener internal hits, clearly labeled `external-chart`
        rankScore = 0.38 * pop.externalChartScore;
        scoreSource = 'external-chart';
        primaryReason = '第三方平台热榜参考（站内冷启动兜底）';
        signals.push({ type: 'external_chart', label: primaryReason, weight: pop.externalChartScore });
      }
    }

    // Optional personalized hot re-weighting (Target A: "用户个人偏好的热门歌曲")
    let behaviorBoost = 0;
    if (profile && (profile.hasPlayHistory || profile.hasSearchHistory)) {
      if (profile.longTermArtists[track.canonicalArtist] || profile.shortTermArtists[track.canonicalArtist]) {
        behaviorBoost += 0.18;
      }
      if (track.genres.some((g) => (profile.genreAffinities[g] || 0) > 0.5)) {
        behaviorBoost += 0.12;
      }
      if (behaviorBoost > 0) {
        rankScore += behaviorBoost;
        scoreSource = 'hybrid-personalized';
        signals.unshift({
          type: 'behavior_artist',
          label: '结合你的口味偏好的热门曲目',
          weight: behaviorBoost,
        });
        primaryReason = '符合你口味偏好的热门歌曲';
      }
    }

    candidates.push({
      track,
      score: rankScore,
      scoreSource,
      popularity: pop,
      explanation: {
        primaryReason,
        reasonCode: scoreSource,
        scoreSource,
        signals,
        scoreBreakdown: {
          content: 0,
          behavior: Math.round(behaviorBoost * 1000) / 1000,
          popularity: Math.round((hasInternal ? pop.internalScore : pop.externalChartScore) * 1000) / 1000,
          freshness: window === 'new' ? 0.8 : 0.5,
          context: 1,
          finalScore: Math.round(rankScore * 1000) / 1000,
        },
      },
    });
  }

  const tracks = diversifyAndSelectTracks(candidates, count, {
    diversity: 0.22,
    temperature: 0,
    maxPerArtist: 2,
    maxPerAlbum: 2,
  });

  return {
    window,
    genre: genreFilter || null,
    personalized: Boolean(profile && (profile.hasPlayHistory || profile.hasSearchHistory)),
    metricsSeparationNote:
      'strictly_separated: popularity.internalScore measures verified CFSolara listening events only; popularity.externalChartScore reflects upstream chart reference; scoreSource explicitly tags each item.',
    stationStats: {
      activeTracksWithPlays,
      totalCatalogTracks: allTracks.length,
      storageKind: store.kind,
    },
    tracks,
  };
}

// ── 8. Endpoint Core 3: Content & Co-occurrence Similar Songs & Artists (`/api/sonic/recommend/similar`) ──
export async function getSimilarRecommendations(
  identity: UserIdentityContext,
  options: SimilarOptions = {},
  env?: AppEnv,
): Promise<{
  seed: {
    canonicalTrackId: string;
    title: string;
    artist: string;
    genres: string[];
    language: string;
  } | null;
  similarArtists: string[];
  audioFeaturesUsed: false;
  similarityMethod: string;
  tracks: RecommendedTrack[];
}> {
  const store = getRecommendStore(env);
  ensureCatalogSeeded(store);

  const count = Math.min(40, Math.max(1, options.count || 12));
  const includeSameArtist = options.includeSameArtist !== false;

  let seed: CanonicalTrack | null = null;
  if (options.trackId) {
    seed = store.getTrack(options.trackId);
  }
  if (!seed && (options.title || options.artist)) {
    const constructed = toCanonicalTrack({
      id: options.trackId || '',
      title: options.title || options.artist || '',
      artist: options.artist || '',
      album: options.album || '',
      genres: options.genre ? [options.genre] : undefined,
    });
    if (constructed) {
      const existing = store.findTrackByTitleArtist(constructed.cleanTitle, constructed.canonicalArtist, constructed.edition);
      seed = existing || constructed;
      store.upsertTrack(seed);
    }
  }

  if (!seed) {
    return {
      seed: null,
      similarArtists: [],
      audioFeaturesUsed: false,
      similarityMethod: 'metadata-cosine-and-session-cooccurrence',
      tracks: [],
    };
  }

  // Gather related artists (built-in graph + optional ListenBrainz when enabled)
  const relatedSet = new Set<string>(getRelatedArtists(seed.canonicalArtist));
  const lbSimilar = await fetchListenBrainzSimilarArtists(seed.canonicalArtist, env);
  lbSimilar.forEach((a) => relatedSet.add(a));
  const similarArtists = Array.from(relatedSet).slice(0, 8);

  // If local catalog has very few tracks for seed artist or related artists, enrich opportunistically
  if (store.searchLocalTracks(seed.canonicalArtist, 4).length < 2) {
    await enrichStoreWithLiveQuery(seed.canonicalArtist, store, env, seed.genres);
  }
  if (similarArtists[0] && store.searchLocalTracks(similarArtists[0], 3).length < 1) {
    await enrichStoreWithLiveQuery(similarArtists[0], store, env, seed.genres);
  }

  const profile = buildUserPreferenceProfile(identity, store);
  const coocEdges = store.getCooccurringTracks(seed.canonicalTrackId, 30);
  const coocMap = new Map<string, number>(coocEdges.map((e) => [e.canonicalTrackId, e.weight]));

  // Optional Gorse item neighbors
  if (isGorseEnabled(env)) {
    const gorseNeighbors = await fetchGorseNeighbors(seed.canonicalTrackId, 20, env);
    for (const n of gorseNeighbors) {
      coocMap.set(n.id, (coocMap.get(n.id) || 0) + n.score * 6);
    }
  }

  const allTracks = store.listTracks(1200);
  const popMap = computeCatalogPopularity(allTracks, store.getAllRecentEvents(Date.now() - 30 * DAY_MS, 5000));

  const candidates: ScoredCandidate[] = [];
  for (const track of allTracks) {
    if (!isPlayableTrack(track)) continue;
    if (track.canonicalTrackId === seed.canonicalTrackId) continue;
    if (track.cleanTitle === seed.cleanTitle && compactNormalize(track.canonicalArtist) === compactNormalize(seed.canonicalArtist)) {
      continue;
    }
    if (profile.blockedTrackIds.has(track.canonicalTrackId)) continue;
    if (!includeSameArtist && compactNormalize(track.canonicalArtist) === compactNormalize(seed.canonicalArtist)) {
      continue;
    }

    const sim = computeTrackSimilarity(seed, track, coocMap.get(track.canonicalTrackId) || 0);
    if (sim.score <= 0.08) continue;

    const pop = popMap.get(track.canonicalTrackId);
    const qualityTieBreaker = 0.12 * ((pop?.internalScore || 0) * 0.6 + (track.externalPopularity / 100) * 0.4);
    const totalScore = 0.88 * sim.score + qualityTieBreaker;
    const topSignal = sim.signals[0];

    candidates.push({
      track,
      score: totalScore,
      scoreSource: 'content-similarity',
      popularity: pop,
      explanation: {
        primaryReason: topSignal?.label || `与《${seed.title}》风格相近`,
        reasonCode: topSignal?.type || 'content_similarity',
        scoreSource: 'content-similarity',
        similarityBasis: sim.basis,
        signals: sim.signals.slice(0, 3),
        scoreBreakdown: {
          content: Math.round(sim.score * 1000) / 1000,
          behavior: 0,
          popularity: Math.round(qualityTieBreaker * 1000) / 1000,
          freshness: 0.5,
          context: 1,
          finalScore: Math.round(totalScore * 1000) / 1000,
        },
      },
    });
  }

  const tracks = diversifyAndSelectTracks(candidates, count, {
    diversity: 0.3,
    temperature: 0.15,
    maxPerArtist: includeSameArtist ? 3 : 1,
    maxPerAlbum: 2,
  });

  return {
    seed: {
      canonicalTrackId: seed.canonicalTrackId,
      title: seed.title,
      artist: seed.canonicalArtist,
      genres: seed.genres,
      language: seed.language,
    },
    similarArtists,
    audioFeaturesUsed: false, // Honest declaration: metadata + session co-occurrence, zero fabricated acoustic features
    similarityMethod: 'metadata-cosine-and-session-cooccurrence',
    tracks,
  };
}

// ── 9. Endpoint Core 4: Style / Language / Temperature Exploration (`/api/sonic/recommend/discover`) ──
export async function getDiscoverRecommendations(
  identity: UserIdentityContext,
  options: DiscoverOptions = {},
  env?: AppEnv,
): Promise<{
  genre: string | null;
  language: string | null;
  temperature: number;
  availableGenres: Array<{ id: string; label: string }>;
  tracks: RecommendedTrack[];
}> {
  const store = getRecommendStore(env);
  ensureCatalogSeeded(store);

  const count = Math.min(40, Math.max(1, options.count || 16));
  const temperature = Math.max(0.1, Math.min(1.5, options.temperature ?? 0.55));
  const rawGenre = (options.genre || '').trim().toLowerCase();
  const rawLang = (options.language || '').trim().toLowerCase();
  const profile = buildUserPreferenceProfile(identity, store);

  const parsedGenres = rawGenre ? extractQueryGenres(rawGenre).genres : [];
  const targetGenre = parsedGenres[0] || rawGenre;

  if (targetGenre && store.listTracks(600).filter((t) => t.genres.includes(targetGenre)).length < 4) {
    await enrichStoreWithLiveQuery(targetGenre, store, env, [targetGenre]);
  }

  const allTracks = store.listTracks(1200);
  const popMap = computeCatalogPopularity(allTracks, store.getAllRecentEvents(Date.now() - 30 * DAY_MS, 5000));

  const candidates: ScoredCandidate[] = [];
  for (const track of allTracks) {
    if (!isPlayableTrack(track)) continue;
    if (profile.blockedTrackIds.has(track.canonicalTrackId)) continue;

    if (targetGenre) {
      const hit = track.genres.some((g) => g === targetGenre || g.includes(targetGenre) || targetGenre.includes(g));
      if (!hit) continue;
    }
    if (rawLang && track.language !== rawLang) {
      continue;
    }

    const isNovelArtist = !profile.longTermArtists[track.canonicalArtist] && !profile.shortTermArtists[track.canonicalArtist];
    const pop = popMap.get(track.canonicalTrackId);
    const baseQuality = (pop?.internalScore || 0) * 0.5 + (track.externalPopularity / 100) * 0.5;
    const noveltyBonus = isNovelArtist ? 0.28 * Math.min(1.2, temperature) : 0.05;
    const score = 0.65 * baseQuality + noveltyBonus;

    const reasonLabel = targetGenre
      ? `${targetGenre.toUpperCase()} 风格探索推荐`
      : isNovelArtist
        ? `探索新风格 · ${track.genres[0]?.toUpperCase() || '精选'} 佳作`
        : '高口碑曲风精选';

    candidates.push({
      track,
      score,
      scoreSource: targetGenre ? 'content-similarity' : 'cold-start-curated',
      popularity: pop,
      explanation: {
        primaryReason: reasonLabel,
        reasonCode: 'fresh_discovery',
        scoreSource: targetGenre ? 'content-similarity' : 'cold-start-curated',
        signals: [{ type: 'fresh_discovery', label: reasonLabel, weight: Math.round(score * 100) / 100 }],
        scoreBreakdown: {
          content: targetGenre ? 0.85 : 0.4,
          behavior: 0,
          popularity: Math.round(baseQuality * 1000) / 1000,
          freshness: Math.round(noveltyBonus * 1000) / 1000,
          context: 1,
          finalScore: Math.round(score * 1000) / 1000,
        },
      },
    });
  }

  const tracks = diversifyAndSelectTracks(candidates, count, {
    diversity: Math.min(0.65, 0.3 + temperature * 0.2),
    temperature,
    maxPerArtist: 2,
    maxPerAlbum: 1,
  });

  return {
    genre: targetGenre || null,
    language: rawLang || null,
    temperature,
    availableGenres: [
      { id: 'mandopop', label: '华语流行' },
      { id: 'r&b', label: 'R&B 节奏布鲁斯' },
      { id: 'cantopop', label: '粤语金曲' },
      { id: 'rock', label: '摇滚乐队' },
      { id: 'folk', label: '独立民谣' },
      { id: 'pop', label: '欧美流行' },
      { id: 'electronic', label: '电子合成器' },
      { id: 'j-pop', label: '日音 / 动漫' },
      { id: 'k-pop', label: '韩流 K-Pop' },
      { id: 'instrumental', label: '纯音乐 / 原声' },
    ],
    tracks,
  };
}

export function clearUserRecommendationData(identity: UserIdentityContext, env?: AppEnv): {
  cleared: boolean;
  removedEvents: number;
  storageKind: string;
} {
  const store = getRecommendStore(env);
  if (!identity.subjectKey) {
    return { cleared: false, removedEvents: 0, storageKind: store.kind };
  }
  const removedEvents = store.clearUserEvents(identity.subjectKey);
  return { cleared: true, removedEvents, storageKind: store.kind };
}
