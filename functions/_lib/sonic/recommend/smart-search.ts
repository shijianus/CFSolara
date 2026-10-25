// Sonic Intelligent Recommendation & Smart Search — Hybrid Multi-Field Search, Suggestions & Bounded Reranking
// Strictly enforces:
//   Relevance > Playability & Studio Authenticity > Consensus & Popularity > Bounded Personalization

import type { AppEnv } from '../../types';
import type { SonicAttempt } from '../types';
import type { CircuitState } from '../local-engine';
import { searchNexus } from '../nexus-search';
import type {
  CanonicalTrack,
  SmartSearchResultData,
  SmartSearchSuggestion,
  TrackEdition,
  UserIdentityContext,
} from './types';
import {
  classifyTrackEdition,
  compactNormalize,
  computeFuzzySimilarity,
  expandQueryAliases,
  toPinyinInfo,
  toSimplifiedChinese,
} from './text-norm';
import {
  canMergeCanonicalTracks,
  canonicalToSonicTrack,
  isPlayableTrack,
  mergeCanonicalTracks,
  toCanonicalTrack,
} from './track-canonical';
import { getRecommendStore } from './memory-store';
import { computeCatalogPopularity } from './popularity';
import { ensureCatalogSeeded } from './seed-catalog';
import { buildUserPreferenceProfile, getRecommendationsForYou } from './engine';
import { indexTracksInMeilisearch, isMeilisearchEnabled, searchMeilisearchIds } from './external-adapters';

export interface SmartSearchExecutionResult {
  data: SmartSearchResultData;
  attempts: SonicAttempt[];
  degraded?: boolean;
  degradedReason?: string;
  circuitState?: CircuitState;
}

export function executeSmartSuggest(
  rawQuery: string,
  limit = 8,
  identity?: UserIdentityContext,
  env?: AppEnv,
): SmartSearchSuggestion[] {
  const store = getRecommendStore(env);
  ensureCatalogSeeded(store);

  const trimmed = (rawQuery || '').trim();
  const maxItems = Math.min(15, Math.max(1, limit));

  if (!trimmed) {
    // Empty input -> suggest user's recent queries (if opted in) + top searches + hot tracks
    const out: SmartSearchSuggestion[] = [];
    const seen = new Set<string>();
    const add = (item: SmartSearchSuggestion) => {
      const k = compactNormalize(item.text);
      if (!k || seen.has(k) || out.length >= maxItems) return;
      seen.add(k);
      out.push(item);
    };

    if (identity?.personalizationEnabled) {
      const prof = buildUserPreferenceProfile(identity, store);
      for (const q of prof.recentQueries.slice(0, 3)) {
        add({ text: q, type: 'query', subLabel: '最近搜索', score: 95 });
      }
    }
    for (const topQ of store.getTopSearchQueries('', 4)) {
      add({ text: topQ.query, type: 'query', subLabel: '热门搜索', score: 85 });
    }
    for (const preset of ['周杰伦', '华语 R&B', '陈奕迅', '粤语金曲', 'Taylor Swift']) {
      add({ text: preset, type: 'query', subLabel: '精选热搜', score: 75 });
    }
    return out;
  }

  const exp = expandQueryAliases(trimmed);
  const suggestions: SmartSearchSuggestion[] = [];
  const seenText = new Set<string>();
  const pushUnique = (item: SmartSearchSuggestion) => {
    const key = `${item.type}:${compactNormalize(item.text)}`;
    if (seenText.has(key)) return;
    seenText.add(key);
    suggestions.push(item);
  };

  if (exp.matchedArtist) {
    pushUnique({
      text: exp.matchedArtist,
      type: 'artist',
      subLabel: compactNormalize(exp.matchedArtist) !== exp.compact ? `歌手 · 别名匹配 (${trimmed})` : '歌手',
      score: 120,
    });
  }

  const localHits = store.searchLocalTracks(trimmed, 12);
  for (const t of localHits) {
    if (compactNormalize(t.canonicalArtist).startsWith(exp.compact)) {
      pushUnique({
        text: t.canonicalArtist,
        type: 'artist',
        subLabel: '歌手',
        score: 110,
      });
    }
    pushUnique({
      text: `${t.title} - ${t.primaryArtist}`,
      type: 'song',
      subLabel: t.album || t.genres[0]?.toUpperCase() || '单曲',
      score: 100 + t.externalPopularity * 0.1,
    });
  }

  for (const qItem of store.getTopSearchQueries(trimmed, 5)) {
    pushUnique({
      text: qItem.query,
      type: 'query',
      subLabel: '历史热搜',
      score: 80 + Math.min(15, qItem.count),
    });
  }

  for (const g of exp.inferredGenres) {
    pushUnique({
      text: `${g.toUpperCase()} 精选`,
      type: 'genre',
      subLabel: '曲风探索',
      score: 78,
    });
  }

  suggestions.sort((a, b) => b.score - a.score);
  return suggestions.slice(0, maxItems);
}

function computeLexicalRelevance(
  track: CanonicalTrack,
  exp: ReturnType<typeof expandQueryAliases>,
  rawQuery: string,
): { relevance: number; reasons: string[] } {
  const qComp = exp.compact;
  if (!qComp) return { relevance: 0, reasons: [] };

  const reasons: string[] = [];
  let rel = 0;

  const tClean = track.cleanTitle;
  const tSimp = compactNormalize(track.simpTitle);
  const arCanon = compactNormalize(track.canonicalArtist);
  const arPrim = compactNormalize(track.primaryArtist);
  const alClean = track.cleanAlbum;
  const matchedArtistComp = exp.matchedArtist ? compactNormalize(exp.matchedArtist) : '';

  // 1. Multi-term query (e.g. "周杰伦 晴天", "jay chou 晴天", "陈奕迅 富士山下")
  const tokens = toSimplifiedChinese(rawQuery)
    .toLowerCase()
    .split(/[\s\-—/]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (tokens.length >= 2) {
    let titleMatched = false;
    let artistMatched = false;
    for (const tok of tokens) {
      const tokExp = expandQueryAliases(tok);
      const tc = tokExp.compact;
      if (!tc) continue;
      if (tClean === tc || tSimp.includes(tc) || track.pinyinFull === tc) {
        titleMatched = true;
      }
      if (
        arCanon === tc ||
        arPrim.includes(tc) ||
        (tokExp.matchedArtist && compactNormalize(tokExp.matchedArtist) === arCanon)
      ) {
        artistMatched = true;
      }
    }
    if (titleMatched && artistMatched) {
      rel = Math.max(rel, 1950);
      reasons.push('歌名+歌手精准匹配');
    }
  }

  // 2. Single/Full field exact & prefix matches
  if (tClean === qComp || tSimp === qComp) {
    rel = Math.max(rel, 1600);
    reasons.push(rawQuery !== exp.simplified ? '繁简归一精准匹配' : '歌名精准匹配');
  } else if (exp.expandedQueries.some((eq) => compactNormalize(eq) === tClean)) {
    rel = Math.max(rel, 1550);
    reasons.push('拼音/别名精准匹配');
  } else if (tClean.startsWith(qComp) || tSimp.startsWith(qComp)) {
    rel = Math.max(rel, 1050);
    reasons.push('歌名前缀匹配');
  } else if (qComp.length >= 2 && (tClean.includes(qComp) || tSimp.includes(qComp))) {
    rel = Math.max(rel, 740);
    reasons.push('歌名包含关键词');
  }

  // 3. Artist & Alias matching
  if (arCanon === qComp || arPrim === qComp || (matchedArtistComp && arCanon === matchedArtistComp)) {
    const artistScore = matchedArtistComp && arCanon !== qComp ? 1220 : 1250;
    if (rel >= 700) {
      rel += 320;
    } else {
      rel = Math.max(rel, artistScore);
    }
    reasons.push(matchedArtistComp && arCanon !== qComp ? `歌手别名匹配 (${track.canonicalArtist})` : '歌手精准匹配');
  } else if (qComp.length >= 2 && (arCanon.includes(qComp) || arPrim.includes(qComp))) {
    rel = Math.max(rel, 680);
    reasons.push('歌手匹配');
  }

  // 4. Pinyin full & initials matching
  if (/^[a-z0-9]+$/i.test(qComp) && qComp.length >= 2) {
    const artistPy = toPinyinInfo(track.canonicalArtist);
    if (track.pinyinFull === qComp) {
      rel = Math.max(rel, 1380);
      reasons.push('全拼精准匹配');
    } else if (artistPy.full === qComp) {
      rel = Math.max(rel, 1180);
      reasons.push('歌手全拼匹配');
    } else if (track.pinyinInitials === qComp && qComp.length >= 2) {
      rel = Math.max(rel, 980);
      reasons.push('拼音首字母匹配');
    } else if (artistPy.initials === qComp && qComp.length >= 3) {
      rel = Math.max(rel, 920);
      reasons.push('歌手首字母匹配');
    } else if (qComp.length >= 4 && track.pinyinFull.startsWith(qComp)) {
      rel = Math.max(rel, 780);
      reasons.push('拼音前缀匹配');
    }
  }

  // 5. Album & Genre matching
  if (qComp.length >= 2 && alClean && (alClean === qComp || alClean.includes(qComp))) {
    rel = Math.max(rel, alClean === qComp ? 820 : 480);
    reasons.push('专辑匹配');
  }
  if (exp.inferredGenres.length > 0) {
    const sharedG = exp.inferredGenres.filter((g) => track.genres.includes(g));
    if (sharedG.length > 0) {
      rel = Math.max(rel, 660 + sharedG.length * 80);
      reasons.push(`流派匹配 (${sharedG[0].toUpperCase()})`);
    }
  }

  // 6. Typo-tolerant fuzzy matching (e.g. "tayler swift", "shape of yu", "qingtain")
  if (rel === 0 && qComp.length >= 3) {
    const simTitle = computeFuzzySimilarity(qComp, tClean);
    const simArtist = computeFuzzySimilarity(qComp, arCanon);
    const simPinyin = /^[a-z]+$/.test(qComp) ? computeFuzzySimilarity(qComp, track.pinyinFull) : 0;
    const bestSim = Math.max(simTitle, simArtist, simPinyin);
    if (bestSim >= 0.7) {
      rel = Math.round(bestSim * 780);
      reasons.push('纠错模糊匹配');
    }
  }

  return { relevance: rel, reasons };
}

export async function executeSmartSearch(
  rawQuery: string,
  options: {
    page?: number;
    count?: number;
    personalize?: boolean;
    skipLiveUpstream?: boolean;
    request?: Request;
    signal?: AbortSignal;
  } = {},
  identity: UserIdentityContext,
  env?: AppEnv,
): Promise<SmartSearchExecutionResult> {
  const store = getRecommendStore(env);
  ensureCatalogSeeded(store);

  const page = Math.max(1, options.page || 1);
  const count = Math.min(50, Math.max(1, options.count || 20));
  const query = (rawQuery || '').trim();
  const exp = expandQueryAliases(query);
  const attempts: SonicAttempt[] = [];
  let degraded = false;
  let degradedReason: string | undefined;
  let circuitState: CircuitState | undefined;

  // Record anonymized aggregate search query popularity
  if (exp.compact) {
    store.recordSearchQuery(exp.compact, query, false);
  }

  // 1. Local Canonical Store & FTS5 Recall (across raw query + alias/typo/pinyin expanded queries)
  const localStart = Date.now();
  const localCandidateMap = new Map<string, CanonicalTrack>();
  for (const qVariant of [query, ...exp.expandedQueries]) {
    if (!qVariant) continue;
    for (const hit of store.searchLocalTracks(qVariant, count * 2)) {
      localCandidateMap.set(hit.canonicalTrackId, hit);
    }
  }
  const localCandidates = Array.from(localCandidateMap.values());
  attempts.push({
    provider: `catalog-${store.kind}`,
    via: 'local-index',
    source: store.kind,
    ok: localCandidates.length > 0,
    ms: Date.now() - localStart,
  });

  // 2. Optional Stage 3 Meilisearch Recall
  const meiliCandidates: CanonicalTrack[] = [];
  if (isMeilisearchEnabled(env)) {
    const mStart = Date.now();
    const ids = await searchMeilisearchIds(exp.simplified || query, count, env);
    for (const id of ids) {
      const t = store.getTrack(id);
      if (t) meiliCandidates.push(t);
    }
    attempts.push({
      provider: 'meilisearch',
      via: 'external-search',
      ok: meiliCandidates.length > 0,
      ms: Date.now() - mStart,
    });
  }

  // 3. Live Multi-Platform Nexus Search (unless offline/test-disabled)
  const liveCanonicals: CanonicalTrack[] = [];
  const offlineMode = options.skipLiveUpstream || String(env?.SONIC_RECOMMEND_OFFLINE || '') === '1';
  if (!offlineMode) {
    // Pick best upstream query: if user typed pure pinyin/alias/traditional, also search the normalized form!
    const primaryUpstreamQuery =
      exp.matchedArtist && exp.compact === compactNormalize(query) && !/[\u4e00-\u9fff]/.test(query)
        ? exp.matchedArtist
        : exp.expandedQueries[exp.expandedQueries.length - 1] || exp.simplified || query;

    try {
      const nexusRes = await searchNexus(
        primaryUpstreamQuery,
        { page, count, signal: options.signal, request: options.request },
        env,
      );
      attempts.push(...nexusRes.attempts);
      degraded = Boolean(nexusRes.degraded);
      degradedReason = nexusRes.degradedReason;
      circuitState = nexusRes.circuitState;

      nexusRes.data.tracks.forEach((rawTrack, idx) => {
        const ct = toCanonicalTrack(rawTrack, { rank: idx });
        if (ct) liveCanonicals.push(ct);
      });

      // Automatically index newly discovered tracks into local store (& optional Meilisearch)
      if (liveCanonicals.length > 0) {
        store.upsertTracks(liveCanonicals);
        if (isMeilisearchEnabled(env)) {
          indexTracksInMeilisearch(liveCanonicals, env).catch(() => {});
        }
      }
    } catch (err: any) {
      degraded = true;
      degradedReason = err?.message || 'live_search_failed';
      attempts.push({
        provider: 'nexus',
        ok: false,
        ms: 0,
        error: degradedReason,
      });
    }
  }

  // 4. Canonical Song Clustering & Edition-Safe Merging
  const clusterMap = new Map<string, CanonicalTrack>();
  const addCandidateToClusters = (cand: CanonicalTrack) => {
    const existing = clusterMap.get(cand.canonicalTrackId);
    if (existing && canMergeCanonicalTracks(existing, cand)) {
      clusterMap.set(cand.canonicalTrackId, mergeCanonicalTracks(existing, cand));
      return;
    }
    // Also check if another cluster has identical `(cleanTitle, canonicalArtist, edition)`
    for (const [k, v] of clusterMap.entries()) {
      if (canMergeCanonicalTracks(v, cand)) {
        clusterMap.set(k, mergeCanonicalTracks(v, cand));
        return;
      }
    }
    clusterMap.set(cand.canonicalTrackId, cand);
  };

  for (const c of liveCanonicals) addCandidateToClusters(c);
  for (const c of localCandidates) addCandidateToClusters(c);
  for (const c of meiliCandidates) addCandidateToClusters(c);

  const mergedPool = Array.from(clusterMap.values());

  // 5. Relevance-First Scoring + Gated Bounded Personalization
  const requestedEdition: TrackEdition = classifyTrackEdition(query, '');
  const userAskedSpecificEdition = requestedEdition !== 'studio';

  const allowPersonalize = options.personalize !== false && identity.personalizationEnabled;
  const profile = allowPersonalize ? buildUserPreferenceProfile(identity, store) : null;
  const hasProfileHistory = Boolean(profile && (profile.hasPlayHistory || profile.hasSearchHistory || profile.likedTrackIds.size > 0));
  const popMap = computeCatalogPopularity(
    mergedPool,
    store.getAllRecentEvents(Date.now() - 30 * 24 * 3600 * 1000, 5000),
  );

  let personalizedApplied = false;
  const ranked: Array<{
    canonical: CanonicalTrack;
    totalScore: number;
    relevance: number;
    reasons: string[];
  }> = [];

  for (const track of mergedPool) {
    let { relevance, reasons } = computeLexicalRelevance(track, exp, query);

    // Upstream returned this track specifically for `primaryUpstreamQuery` (e.g. lyrics/alias match on NetEase/QQ)
    if (relevance === 0 && liveCanonicals.some((lc) => lc.canonicalTrackId === track.canonicalTrackId)) {
      relevance = 420;
      reasons.push('多源检索召回');
    }

    // HARD RELEVANCE GATE: Never surface completely irrelevant songs in search results!
    if (relevance <= 0) continue;

    let score = relevance;

    // Edition priority: studio original beats cover/live/instrumental UNLESS user explicitly asked for it!
    if (userAskedSpecificEdition) {
      if (track.edition === requestedEdition) {
        score += 320;
        reasons.push(`${requestedEdition.toUpperCase()} 版本匹配`);
      }
    } else {
      if (track.edition === 'studio') {
        score += 140;
      } else if (track.edition === 'live' || track.edition === 'acoustic') {
        score -= 80;
      } else if (track.edition === 'cover' || track.edition === 'remix') {
        score -= 180;
      } else if (track.edition === 'instrumental' || track.edition === 'demo') {
        score -= 260;
      }
    }

    // Playability & Cross-Platform Consensus Priority
    if (!isPlayableTrack(track)) {
      score -= 600;
    } else {
      score += track.streamType === 'trial' ? 20 : 120;
      const sourceCount = Math.min(4, Math.max(1, track.availableSources.length));
      score += sourceCount * 65;
      if (sourceCount >= 2) reasons.push(`${sourceCount} 平台音源聚合`);
      if (track.qualityBadge === 'SQ') score += 45;
    }

    // Moderate Station & External Popularity Bonus (capped at <= 140 so relevance still dominates)
    const pop = popMap.get(track.canonicalTrackId);
    const popSignal = (pop?.internalScore || 0) * 80 + (track.externalPopularity / 100) * 60;
    score += popSignal;

    // BOUNDED GATED PERSONALIZATION:
    //   Only applies when `relevance >= 600` (genuine query match) AND capped strictly at `<= +85`!
    //   Guarantees e.g. searching《晴天》will NEVER rank an unrelated favorite artist above《晴天》!
    if (profile && hasProfileHistory && relevance >= 600) {
      let pBoost = 0;
      if (profile.blockedTrackIds.has(track.canonicalTrackId)) {
        pBoost -= 220; // Demote explicitly disliked edition/version if alternatives exist
      } else {
        if (profile.likedTrackIds.has(track.canonicalTrackId)) {
          pBoost += 45;
          reasons.push('已收藏');
        }
        if (profile.longTermArtists[track.canonicalArtist] || profile.shortTermArtists[track.canonicalArtist]) {
          pBoost += 35;
          reasons.push('偏爱歌手优先');
        }
        if (track.genres.some((g) => (profile.genreAffinities[g] || 0) > 0.6)) {
          pBoost += 15;
        }
        pBoost = Math.min(85, pBoost);
      }
      if (pBoost !== 0) {
        score += pBoost;
        personalizedApplied = true;
      }
    }

    ranked.push({
      canonical: track,
      totalScore: Math.round(score * 10) / 10,
      relevance,
      reasons,
    });
  }

  ranked.sort((a, b) => b.totalScore - a.totalScore || b.relevance - a.relevance);
  const sliced = ranked.slice(0, count);

  const outputTracks = sliced.map(({ canonical, totalScore, reasons }) => ({
    ...canonicalToSonicTrack(canonical),
    canonicalTrackId: canonical.canonicalTrackId,
    edition: canonical.edition,
    language: canonical.language,
    genres: canonical.genres,
    matchScore: totalScore,
    matchReasons: Array.from(new Set(reasons)).slice(0, 4),
  }));

  const suggestions = executeSmartSuggest(query, 6, identity, env);

  // 6. Zero-Result Smart Fallback (never leave user on a dead blank page)
  if (outputTracks.length === 0) {
    const fallbackRec = await getRecommendationsForYou(
      identity,
      { mode: 'for-you', count: 8 },
      { ...(env || {}), SONIC_RECOMMEND_OFFLINE: '1' },
    );
    return {
      data: {
        query,
        normalizedQuery: exp.simplified,
        expandedTerms: exp.expandedQueries,
        page,
        count: 0,
        total: 0,
        personalizedApplied: false,
        tracks: [],
        suggestions,
        fallbackUsed: true,
        fallbackQuery: exp.matchedArtist || suggestions[0]?.text || '热门精选',
        fallbackTracks: fallbackRec.tracks,
      },
      attempts,
      degraded,
      degradedReason,
      circuitState,
    };
  }

  return {
    data: {
      query,
      normalizedQuery: exp.simplified,
      expandedTerms: exp.expandedQueries,
      page,
      count: outputTracks.length,
      total: ranked.length,
      personalizedApplied,
      tracks: outputTracks,
      suggestions,
      fallbackUsed: false,
    },
    attempts,
    degraded,
    degradedReason,
    circuitState,
  };
}
