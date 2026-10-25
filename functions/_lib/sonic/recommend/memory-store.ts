// Sonic Intelligent Recommendation & Smart Search — Pure-TS Bounded In-Memory Store
// Used on Cloudflare Edge Isolates, read-only environments, and unit tests.
// On Linux VPS, `server/recommend-sqlite.ts` injects `SqliteRecommendStore` via `env.RECOMMEND_STORE`.

import type { AppEnv } from '../../types';
import type {
  CanonicalTrack,
  RecommendStore,
  StoredBehaviorEvent,
  TrackEdition,
} from './types';
import {
  compactNormalize,
  computeFuzzySimilarity,
  expandQueryAliases,
  toPinyinInfo,
  toSimplifiedChinese,
} from './text-norm';
import { canMergeCanonicalTracks, mergeCanonicalTracks } from './track-canonical';

const MAX_TRACKS = 6000;
const MAX_EVENTS = 25000;
const MAX_COOCCURRENCE_ANCHORS = 3000;
const MAX_QUERIES = 2000;

export class MemoryRecommendStore implements RecommendStore {
  public readonly kind = 'memory' as const;

  private tracks = new Map<string, CanonicalTrack>();
  private platformIndex = new Map<string, string>(); // "netease:186016" or "186016" -> canonicalTrackId
  private titleArtistIndex = new Map<string, string>(); // "cleantitle:::artist:::edition" -> canonicalTrackId
  private eventIds = new Set<string>();
  private events: StoredBehaviorEvent[] = [];
  private userEventsIndex = new Map<string, StoredBehaviorEvent[]>();
  private cooccurrence = new Map<string, Map<string, number>>();
  private searchQueries = new Map<string, { display: string; count: number; updatedAt: number }>();

  upsertTrack(incoming: CanonicalTrack): void {
    if (!incoming?.canonicalTrackId) return;

    const existing = this.tracks.get(incoming.canonicalTrackId);
    let finalTrack = incoming;
    if (existing && canMergeCanonicalTracks(existing, incoming)) {
      finalTrack = mergeCanonicalTracks(existing, incoming);
    } else if (existing && !canMergeCanonicalTracks(existing, incoming)) {
      // Duration anomaly (e.g. 30s ringtone): disambiguate ID so studio original is untouched
      finalTrack = {
        ...incoming,
        canonicalTrackId: `${incoming.canonicalTrackId}_${incoming.duration || 'alt'}`,
      };
    }

    if (!this.tracks.has(finalTrack.canonicalTrackId) && this.tracks.size >= MAX_TRACKS) {
      const oldestKey = this.tracks.keys().next().value;
      if (oldestKey) this.tracks.delete(oldestKey);
    }

    this.tracks.set(finalTrack.canonicalTrackId, finalTrack);
    const taKey = `${finalTrack.cleanTitle}:::${compactNormalize(finalTrack.canonicalArtist)}:::${finalTrack.edition}`;
    this.titleArtistIndex.set(taKey, finalTrack.canonicalTrackId);

    if (finalTrack.provider && finalTrack.providerTrackId) {
      this.platformIndex.set(`${finalTrack.provider}:${finalTrack.providerTrackId}`, finalTrack.canonicalTrackId);
      if (!this.platformIndex.has(finalTrack.providerTrackId)) {
        this.platformIndex.set(finalTrack.providerTrackId, finalTrack.canonicalTrackId);
      }
    }
    for (const [plat, pid] of Object.entries(finalTrack.sourceIds || {})) {
      if (plat && pid) {
        this.platformIndex.set(`${plat}:${pid}`, finalTrack.canonicalTrackId);
        if (!this.platformIndex.has(pid)) {
          this.platformIndex.set(pid, finalTrack.canonicalTrackId);
        }
      }
    }
  }

  upsertTracks(tracks: CanonicalTrack[]): void {
    for (const t of tracks) this.upsertTrack(t);
  }

  getTrack(idOrPlatformId: string): CanonicalTrack | null {
    if (!idOrPlatformId) return null;
    const direct = this.tracks.get(idOrPlatformId);
    if (direct) return direct;
    const mapped = this.platformIndex.get(idOrPlatformId);
    if (mapped) return this.tracks.get(mapped) || null;
    return null;
  }

  findTrackByTitleArtist(cleanTitle: string, canonicalArtist: string, edition: TrackEdition = 'studio'): CanonicalTrack | null {
    const key = `${cleanTitle}:::${compactNormalize(canonicalArtist)}:::${edition}`;
    const id = this.titleArtistIndex.get(key);
    return id ? this.tracks.get(id) || null : null;
  }

  listTracks(limit = 500): CanonicalTrack[] {
    const all = Array.from(this.tracks.values());
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    return all.slice(0, limit);
  }

  searchLocalTracks(query: string, limit = 30): CanonicalTrack[] {
    const trimmed = (query || '').trim();
    if (!trimmed) return [];
    const exp = expandQueryAliases(trimmed);
    const qCompact = exp.compact;
    const qPyFull = exp.pinyinFull;
    const qPyInit = exp.pinyinInitials;
    const qArtist = exp.matchedArtist ? compactNormalize(exp.matchedArtist) : '';

    const scored: Array<{ track: CanonicalTrack; score: number }> = [];
    for (const track of this.tracks.values()) {
      let s = 0;
      const tComp = track.cleanTitle;
      const tSimpComp = compactNormalize(track.simpTitle);
      const arComp = compactNormalize(track.canonicalArtist);
      const rawArComp = compactNormalize(track.primaryArtist);
      const alComp = track.cleanAlbum;

      if (tComp === qCompact || tSimpComp === qCompact) s += 100;
      else if (tComp.startsWith(qCompact) || tSimpComp.startsWith(qCompact)) s += 78;
      else if (qCompact.length >= 2 && (tComp.includes(qCompact) || tSimpComp.includes(qCompact))) s += 58;

      if (arComp === qCompact || rawArComp === qCompact || (qArtist && arComp === qArtist)) s += 85;
      else if (qCompact.length >= 2 && (arComp.includes(qCompact) || rawArComp.includes(qCompact))) s += 55;

      if (qCompact.length >= 2 && alComp && alComp.includes(qCompact)) s += 35;

      // Pinyin full & initials matching (e.g. "qingtian" or "qt" or "zjl")
      if (/^[a-z0-9]+$/i.test(qCompact) && qCompact.length >= 2) {
        const artistPy = toPinyinInfo(track.canonicalArtist);
        if (track.pinyinFull === qCompact || artistPy.full === qCompact) s += 82;
        else if (track.pinyinFull.startsWith(qCompact) || artistPy.full.startsWith(qCompact)) s += 62;
        else if (track.pinyinInitials === qCompact || artistPy.initials === qCompact) s += 74;
        else if (qCompact.length >= 3 && (track.pinyinInitials.startsWith(qCompact) || artistPy.initials.startsWith(qCompact))) {
          s += 50;
        } else if (qPyFull && track.pinyinFull === qPyFull && s === 0) {
          s += 55;
        }
      }

      // Genre / style match
      if (exp.inferredGenres.length > 0) {
        const gHits = exp.inferredGenres.filter((g) => track.genres.includes(g)).length;
        if (gHits > 0) s += gHits * 35;
      }

      // Combined query like "周杰伦 晴天" or "jay chou qingtian"
      if (s === 0 && trimmed.includes(' ')) {
        const parts = toSimplifiedChinese(trimmed).toLowerCase().split(/\s+/).filter(Boolean);
        let partMatches = 0;
        for (const p of parts) {
          const pComp = compactNormalize(p);
          if (!pComp) continue;
          if (
            tSimpComp.includes(pComp) ||
            arComp.includes(pComp) ||
            track.pinyinFull.includes(pComp) ||
            (qArtist && arComp === qArtist)
          ) {
            partMatches++;
          }
        }
        if (partMatches >= Math.min(2, parts.length)) {
          s += 72;
        }
      }

      // Fuzzy typo tolerance fallback
      if (s === 0 && qCompact.length >= 3) {
        const simTitle = computeFuzzySimilarity(qCompact, tComp);
        const simArtist = computeFuzzySimilarity(qCompact, arComp);
        const simPy = /^[a-z]+$/.test(qCompact) ? computeFuzzySimilarity(qCompact, track.pinyinFull) : 0;
        const bestSim = Math.max(simTitle, simArtist, simPy);
        if (bestSim >= 0.68) {
          s += bestSim * 52;
        }
      }

      if (s > 0) {
        scored.push({ track, score: s });
      }
    }

    scored.sort((a, b) => b.score - a.score || b.track.externalPopularity - a.track.externalPopularity);
    return scored.slice(0, limit).map((x) => x.track);
  }

  recordEvent(event: StoredBehaviorEvent): { inserted: boolean; deduplicated: boolean } {
    if (!event?.eventId || !event?.subjectKey) {
      return { inserted: false, deduplicated: false };
    }
    if (this.eventIds.has(event.eventId)) {
      return { inserted: false, deduplicated: true };
    }

    if (this.events.length >= MAX_EVENTS) {
      const evicted = this.events.shift();
      if (evicted) {
        this.eventIds.delete(evicted.eventId);
        const uList = this.userEventsIndex.get(evicted.subjectKey);
        if (uList && uList[0]?.eventId === evicted.eventId) {
          uList.shift();
        }
      }
    }

    this.eventIds.add(event.eventId);
    this.events.push(event);
    let userList = this.userEventsIndex.get(event.subjectKey);
    if (!userList) {
      userList = [];
      this.userEventsIndex.set(event.subjectKey, userList);
    }
    userList.push(event);
    if (userList.length > 600) {
      userList.shift();
    }
    return { inserted: true, deduplicated: false };
  }

  getUserEvents(subjectKey: string, limit = 200, sinceMs = 0): StoredBehaviorEvent[] {
    if (!subjectKey) return [];
    const list = this.userEventsIndex.get(subjectKey) || [];
    const out: StoredBehaviorEvent[] = [];
    for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
      if (list[i].createdAt >= sinceMs) {
        out.push(list[i]);
      }
    }
    return out;
  }

  clearUserEvents(subjectKey: string): number {
    if (!subjectKey) return 0;
    const list = this.userEventsIndex.get(subjectKey) || [];
    const removed = list.length;
    for (const ev of list) {
      this.eventIds.delete(ev.eventId);
    }
    this.userEventsIndex.delete(subjectKey);
    if (removed > 0) {
      this.events = this.events.filter((e) => e.subjectKey !== subjectKey);
    }
    return removed;
  }

  getAllRecentEvents(sinceMs: number, limit = 10000): StoredBehaviorEvent[] {
    const out: StoredBehaviorEvent[] = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < limit; i--) {
      const ev = this.events[i];
      if (ev.createdAt >= sinceMs) {
        out.push(ev);
      }
    }
    return out;
  }

  incrementCooccurrence(trackA: string, trackB: string, delta: number): void {
    if (!trackA || !trackB || trackA === trackB || delta <= 0) return;
    const addEdge = (from: string, to: string) => {
      let neighbors = this.cooccurrence.get(from);
      if (!neighbors) {
        if (this.cooccurrence.size >= MAX_COOCCURRENCE_ANCHORS) {
          const oldest = this.cooccurrence.keys().next().value;
          if (oldest) this.cooccurrence.delete(oldest);
        }
        neighbors = new Map<string, number>();
        this.cooccurrence.set(from, neighbors);
      }
      neighbors.set(to, Math.min(200, (neighbors.get(to) || 0) + delta));
    };
    addEdge(trackA, trackB);
    addEdge(trackB, trackA);
  }

  getCooccurringTracks(trackId: string, limit = 20): Array<{ canonicalTrackId: string; weight: number }> {
    const neighbors = this.cooccurrence.get(trackId);
    if (!neighbors) return [];
    return Array.from(neighbors.entries())
      .map(([canonicalTrackId, weight]) => ({ canonicalTrackId, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit);
  }

  recordSearchQuery(normQuery: string, displayQuery: string, clicked = false): void {
    const key = normQuery.trim();
    if (!key || key.length < 1 || key.length > 64) return;
    const existing = this.searchQueries.get(key);
    const inc = clicked ? 3 : 1;
    if (existing) {
      existing.count += inc;
      existing.updatedAt = Date.now();
    } else {
      if (this.searchQueries.size >= MAX_QUERIES) {
        const firstKey = this.searchQueries.keys().next().value;
        if (firstKey) this.searchQueries.delete(firstKey);
      }
      this.searchQueries.set(key, {
        display: displayQuery.trim(),
        count: inc,
        updatedAt: Date.now(),
      });
    }
  }

  getTopSearchQueries(prefix: string, limit = 8): Array<{ query: string; count: number }> {
    const pNorm = compactNormalize(prefix);
    const matches: Array<{ query: string; count: number; updatedAt: number }> = [];
    for (const [k, v] of this.searchQueries.entries()) {
      if (!pNorm || k.startsWith(pNorm) || toSimplifiedChinese(v.display).toLowerCase().includes(pNorm)) {
        matches.push({ query: v.display, count: v.count, updatedAt: v.updatedAt });
      }
    }
    matches.sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt);
    return matches.slice(0, limit).map(({ query, count }) => ({ query, count }));
  }

  getStats(): { trackCount: number; eventCount: number; cooccurrencePairs: number; storageKind: string } {
    let pairs = 0;
    for (const m of this.cooccurrence.values()) pairs += m.size;
    return {
      trackCount: this.tracks.size,
      eventCount: this.events.length,
      cooccurrencePairs: Math.floor(pairs / 2),
      storageKind: this.kind,
    };
  }

  clearAll(): void {
    this.tracks.clear();
    this.platformIndex.clear();
    this.titleArtistIndex.clear();
    this.eventIds.clear();
    this.events = [];
    this.userEventsIndex.clear();
    this.cooccurrence.clear();
    this.searchQueries.clear();
  }
}

let singletonMemoryStore: MemoryRecommendStore | null = null;

export function getMemoryRecommendStore(): MemoryRecommendStore {
  if (!singletonMemoryStore) {
    singletonMemoryStore = new MemoryRecommendStore();
  }
  return singletonMemoryStore;
}

export function getRecommendStore(env?: AppEnv): RecommendStore {
  if (env?.RECOMMEND_STORE && typeof env.RECOMMEND_STORE.upsertTrack === 'function') {
    return env.RECOMMEND_STORE as RecommendStore;
  }
  return getMemoryRecommendStore();
}

export function resetMemoryRecommendStoreForTest(): void {
  if (singletonMemoryStore) {
    singletonMemoryStore.clearAll();
  }
}
