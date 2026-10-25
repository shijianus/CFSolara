// Sonic Intelligent Recommendation & Smart Search — Optional Stage 2/3 External Service Adapters
// Supports Gorse (Apache-2.0), Meilisearch (MIT), and ListenBrainz Public API.
// All adapters are OFF by default (`SONIC_GORSE_URL`, `SONIC_MEILISEARCH_URL`, `SONIC_ENABLE_LISTENBRAINZ=0`)
// and gracefully fall back to the built-in SQLite + FTS5 + Hybrid Engine on timeout or error.

import type { AppEnv } from '../../types';
import { isEnvEnabled } from '../config';
import type { CanonicalTrack, SonicEventType } from './types';

function cleanBaseUrl(raw?: string): string {
  const s = (raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

// ── 1. Optional Gorse Adapter (Collaborative Filtering & Item-to-Item Neighbors) ──
export function isGorseEnabled(env?: AppEnv): boolean {
  return Boolean(cleanBaseUrl(env?.SONIC_GORSE_URL));
}

function mapEventToGorseFeedback(type: SonicEventType): string | null {
  switch (type) {
    case 'favorite':
      return 'star';
    case 'replay':
    case 'play_complete':
      return 'read';
    case 'play_progress':
    case 'search_click':
      return 'click';
    default:
      return null;
  }
}

export async function syncTrackToGorse(track: CanonicalTrack, env?: AppEnv): Promise<boolean> {
  const baseUrl = cleanBaseUrl(env?.SONIC_GORSE_URL);
  if (!baseUrl) return false;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env?.SONIC_GORSE_API_KEY) headers['X-API-Key'] = String(env.SONIC_GORSE_API_KEY);

  try {
    const resp = await fetch(`${baseUrl}/api/item`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ItemId: track.canonicalTrackId,
        IsHidden: track.streamType === 'unavailable',
        Categories: [track.language, track.edition, ...track.genres.slice(0, 3)].filter(Boolean),
        Timestamp: new Date(track.updatedAt).toISOString(),
        Labels: [track.canonicalArtist, ...track.genres, ...track.tags].filter(Boolean),
        Comment: `${track.title} - ${track.primaryArtist}`,
      }),
      signal: AbortSignal.timeout(1500),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function syncFeedbackToGorse(
  subjectKey: string,
  canonicalTrackId: string,
  eventType: SonicEventType,
  timestampMs: number,
  env?: AppEnv,
): Promise<boolean> {
  const baseUrl = cleanBaseUrl(env?.SONIC_GORSE_URL);
  if (!baseUrl || !subjectKey || !canonicalTrackId) return false;
  const feedbackType = mapEventToGorseFeedback(eventType);
  if (!feedbackType) return false;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env?.SONIC_GORSE_API_KEY) headers['X-API-Key'] = String(env.SONIC_GORSE_API_KEY);

  try {
    const resp = await fetch(`${baseUrl}/api/feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify([
        {
          FeedbackType: feedbackType,
          UserId: subjectKey,
          ItemId: canonicalTrackId,
          Timestamp: new Date(timestampMs).toISOString(),
        },
      ]),
      signal: AbortSignal.timeout(1500),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function fetchGorseRecommendations(
  subjectKey: string,
  count = 20,
  env?: AppEnv,
): Promise<string[]> {
  const baseUrl = cleanBaseUrl(env?.SONIC_GORSE_URL);
  if (!baseUrl || !subjectKey) return [];
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (env?.SONIC_GORSE_API_KEY) headers['X-API-Key'] = String(env.SONIC_GORSE_API_KEY);

  try {
    const resp = await fetch(
      `${baseUrl}/api/recommend/${encodeURIComponent(subjectKey)}?n=${Math.min(50, Math.max(1, count))}`,
      { headers, signal: AbortSignal.timeout(1200) },
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    if (Array.isArray(data)) {
      return data
        .map((item: any) => (typeof item === 'string' ? item : item?.Id || ''))
        .filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

export async function fetchGorseNeighbors(
  canonicalTrackId: string,
  count = 15,
  env?: AppEnv,
): Promise<Array<{ id: string; score: number }>> {
  const baseUrl = cleanBaseUrl(env?.SONIC_GORSE_URL);
  if (!baseUrl || !canonicalTrackId) return [];
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (env?.SONIC_GORSE_API_KEY) headers['X-API-Key'] = String(env.SONIC_GORSE_API_KEY);

  try {
    const resp = await fetch(
      `${baseUrl}/api/item/${encodeURIComponent(canonicalTrackId)}/neighbors?n=${Math.min(40, Math.max(1, count))}`,
      { headers, signal: AbortSignal.timeout(1200) },
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    if (Array.isArray(data)) {
      return data
        .map((x: any) => ({ id: String(x?.Id || ''), score: Number(x?.Score || 0.5) }))
        .filter((x) => x.id);
    }
    return [];
  } catch {
    return [];
  }
}

// ── 2. Optional Meilisearch Adapter (Stage 3 External CJK + Typo Search) ──
export function isMeilisearchEnabled(env?: AppEnv): boolean {
  return Boolean(cleanBaseUrl(env?.SONIC_MEILISEARCH_URL));
}

export async function indexTracksInMeilisearch(tracks: CanonicalTrack[], env?: AppEnv): Promise<boolean> {
  const baseUrl = cleanBaseUrl(env?.SONIC_MEILISEARCH_URL);
  if (!baseUrl || tracks.length === 0) return false;
  const indexName = (env?.SONIC_MEILISEARCH_INDEX || 'sonic_tracks').trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env?.SONIC_MEILISEARCH_KEY) {
    headers.Authorization = `Bearer ${String(env.SONIC_MEILISEARCH_KEY).trim()}`;
  }

  try {
    const docs = tracks.map((t) => ({
      id: t.canonicalTrackId,
      title: t.title,
      simpTitle: t.simpTitle,
      cleanTitle: t.cleanTitle,
      pinyinFull: t.pinyinFull,
      pinyinInitials: t.pinyinInitials,
      artist: t.primaryArtist,
      canonicalArtist: t.canonicalArtist,
      album: t.album,
      genres: t.genres,
      language: t.language,
      edition: t.edition,
      externalPopularity: t.externalPopularity,
    }));
    const resp = await fetch(`${baseUrl}/indexes/${encodeURIComponent(indexName)}/documents`, {
      method: 'POST',
      headers,
      body: JSON.stringify(docs),
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function searchMeilisearchIds(query: string, limit = 25, env?: AppEnv): Promise<string[]> {
  const baseUrl = cleanBaseUrl(env?.SONIC_MEILISEARCH_URL);
  if (!baseUrl || !query) return [];
  const indexName = (env?.SONIC_MEILISEARCH_INDEX || 'sonic_tracks').trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env?.SONIC_MEILISEARCH_KEY) {
    headers.Authorization = `Bearer ${String(env.SONIC_MEILISEARCH_KEY).trim()}`;
  }

  try {
    const resp = await fetch(`${baseUrl}/indexes/${encodeURIComponent(indexName)}/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ q: query, limit }),
      signal: AbortSignal.timeout(1200),
    });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    if (Array.isArray(data?.hits)) {
      return data.hits.map((h: any) => String(h?.id || '')).filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

// ── 3. Optional ListenBrainz Adapter (Strict <= 1 req/s rate guard + 6h cache) ──
const lbArtistCache = new Map<string, { artists: string[]; expiresAt: number }>();
let lastLbCallAt = 0;

export async function fetchListenBrainzSimilarArtists(artistName: string, env?: AppEnv): Promise<string[]> {
  if (!isEnvEnabled(env?.SONIC_ENABLE_LISTENBRAINZ, false) || !artistName) return [];
  const key = artistName.trim().toLowerCase();
  const now = Date.now();
  const cached = lbArtistCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.artists;
  }

  // Enforce strict >= 1100ms spacing between requests (MusicBrainz / ListenBrainz policy)
  if (now - lastLbCallAt < 1100) {
    return cached?.artists || [];
  }
  lastLbCallAt = now;

  try {
    const mbResp = await fetch(
      `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json&limit=1`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CFSolara-SonicEngine/2.3 (https://github.com/shijianus/CFSolara)',
        },
        signal: AbortSignal.timeout(2000),
      },
    );
    if (!mbResp.ok) return [];
    const mbData: any = await mbResp.json();
    const mbid = mbData?.artists?.[0]?.id;
    if (!mbid) return [];

    const simResp = await fetch(
      `https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=${encodeURIComponent(mbid)}&algorithm=session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CFSolara-SonicEngine/2.3 (https://github.com/shijianus/CFSolara)',
        },
        signal: AbortSignal.timeout(2500),
      },
    );
    if (!simResp.ok) return [];
    const simData: any = await simResp.json();
    const list: string[] = Array.isArray(simData)
      ? simData
          .slice(0, 8)
          .map((item: any) => String(item?.name || '').trim())
          .filter(Boolean)
      : [];

    if (lbArtistCache.size > 500) {
      const oldest = lbArtistCache.keys().next().value;
      if (oldest) lbArtistCache.delete(oldest);
    }
    lbArtistCache.set(key, { artists: list, expiresAt: now + 6 * 3600 * 1000 });
    return list;
  } catch {
    return [];
  }
}
