// Sonic Local Engine — Native SQLite (WAL + FTS5) Persistent Recommendation & Search Store
// Runs on Linux VPS Node.js 22 (`node:sqlite` built-in, zero native C++ npm dependencies).
// Automatically falls back to `MemoryRecommendStore` if filesystem is read-only.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  CanonicalTrack,
  RecommendStore,
  StoredBehaviorEvent,
  TrackEdition,
} from '../functions/_lib/sonic/recommend/types';
import {
  buildFtsTokens,
  compactNormalize,
  computeFuzzySimilarity,
  expandQueryAliases,
  toPinyinInfo,
} from '../functions/_lib/sonic/recommend/text-norm';
import { canMergeCanonicalTracks, mergeCanonicalTracks } from '../functions/_lib/sonic/recommend/track-canonical';
import { MemoryRecommendStore } from '../functions/_lib/sonic/recommend/memory-store';

export class SqliteRecommendStore implements RecommendStore {
  public readonly kind = 'sqlite' as const;
  private db: DatabaseSync;
  private writeCounter = 0;

  constructor(public readonly dbPath: string = ':memory:') {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(path.resolve(dbPath));
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 3000;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -16000;

      CREATE TABLE IF NOT EXISTS canonical_tracks (
        canonical_track_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_track_id TEXT NOT NULL,
        clean_title TEXT NOT NULL,
        canonical_artist_norm TEXT NOT NULL,
        edition TEXT NOT NULL,
        pinyin_full TEXT NOT NULL,
        pinyin_initials TEXT NOT NULL,
        external_popularity REAL NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tracks_title_artist
        ON canonical_tracks(clean_title, canonical_artist_norm, edition);
      CREATE INDEX IF NOT EXISTS idx_tracks_updated
        ON canonical_tracks(updated_at DESC);

      CREATE TABLE IF NOT EXISTS platform_track_links (
        link_key TEXT PRIMARY KEY,
        canonical_track_id TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
        canonical_track_id UNINDEXED,
        title_tokens,
        artist_tokens,
        album_tokens,
        pinyin_tokens,
        genre_tokens,
        tokenize = 'unicode61'
      );

      CREATE TABLE IF NOT EXISTS behavior_events (
        event_id TEXT PRIMARY KEY,
        subject_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        canonical_track_id TEXT,
        artist_key TEXT,
        genres_json TEXT,
        language TEXT,
        query TEXT,
        weight REAL NOT NULL,
        progress_ratio REAL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_subject_time
        ON behavior_events(subject_key, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_time
        ON behavior_events(created_at DESC);

      CREATE TABLE IF NOT EXISTS track_cooccurrence (
        track_a TEXT NOT NULL,
        track_b TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (track_a, track_b)
      );

      CREATE INDEX IF NOT EXISTS idx_cooc_a_weight
        ON track_cooccurrence(track_a, weight DESC);

      CREATE TABLE IF NOT EXISTS search_queries (
        norm_query TEXT PRIMARY KEY,
        display_query TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  upsertTrack(incoming: CanonicalTrack): void {
    if (!incoming?.canonicalTrackId) return;

    const existing = this.getTrack(incoming.canonicalTrackId);
    let finalTrack = incoming;
    if (existing && canMergeCanonicalTracks(existing, incoming)) {
      finalTrack = mergeCanonicalTracks(existing, incoming);
    } else if (existing && !canMergeCanonicalTracks(existing, incoming)) {
      finalTrack = {
        ...incoming,
        canonicalTrackId: `${incoming.canonicalTrackId}_${incoming.duration || 'alt'}`,
      };
    }

    const artistNorm = compactNormalize(finalTrack.canonicalArtist);
    const payloadJson = JSON.stringify(finalTrack);

    const upsertStmt = this.db.prepare(`
      INSERT INTO canonical_tracks (
        canonical_track_id, provider, provider_track_id, clean_title, canonical_artist_norm,
        edition, pinyin_full, pinyin_initials, external_popularity, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canonical_track_id) DO UPDATE SET
        provider = excluded.provider,
        provider_track_id = excluded.provider_track_id,
        external_popularity = excluded.external_popularity,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `);

    upsertStmt.run(
      finalTrack.canonicalTrackId,
      finalTrack.provider,
      finalTrack.providerTrackId,
      finalTrack.cleanTitle,
      artistNorm,
      finalTrack.edition,
      finalTrack.pinyinFull,
      finalTrack.pinyinInitials,
      finalTrack.externalPopularity,
      finalTrack.updatedAt,
      payloadJson,
    );

    // Update platform links
    const linkStmt = this.db.prepare(`
      INSERT OR REPLACE INTO platform_track_links (link_key, canonical_track_id)
      VALUES (?, ?)
    `);
    if (finalTrack.provider && finalTrack.providerTrackId) {
      linkStmt.run(`${finalTrack.provider}:${finalTrack.providerTrackId}`, finalTrack.canonicalTrackId);
      linkStmt.run(`raw:${finalTrack.providerTrackId}`, finalTrack.canonicalTrackId);
    }
    for (const [plat, pid] of Object.entries(finalTrack.sourceIds || {})) {
      if (plat && pid) {
        linkStmt.run(`${plat}:${pid}`, finalTrack.canonicalTrackId);
        linkStmt.run(`raw:${pid}`, finalTrack.canonicalTrackId);
      }
    }

    // Refresh FTS5 document
    this.db.prepare(`DELETE FROM tracks_fts WHERE canonical_track_id = ?`).run(finalTrack.canonicalTrackId);
    const artistPy = toPinyinInfo(finalTrack.canonicalArtist);
    const titleTokens = buildFtsTokens(`${finalTrack.title} ${finalTrack.simpTitle} ${finalTrack.cleanTitle}`);
    const artistTokens = buildFtsTokens(`${finalTrack.canonicalArtist} ${finalTrack.artists.join(' ')}`);
    const albumTokens = buildFtsTokens(finalTrack.album);
    const pinyinTokens = `${finalTrack.pinyinFull} ${finalTrack.pinyinInitials} ${artistPy.full} ${artistPy.initials}`.trim();
    const genreTokens = [...finalTrack.genres, ...finalTrack.tags, finalTrack.language].join(' ');

    this.db
      .prepare(
        `INSERT INTO tracks_fts (canonical_track_id, title_tokens, artist_tokens, album_tokens, pinyin_tokens, genre_tokens)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(finalTrack.canonicalTrackId, titleTokens, artistTokens, albumTokens, pinyinTokens, genreTokens);
  }

  upsertTracks(tracks: CanonicalTrack[]): void {
    if (tracks.length === 0) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const t of tracks) {
        this.upsertTrack(t);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      throw err;
    }
  }

  getTrack(idOrPlatformId: string): CanonicalTrack | null {
    if (!idOrPlatformId) return null;
    const directRow = this.db
      .prepare(`SELECT payload_json FROM canonical_tracks WHERE canonical_track_id = ?`)
      .get(idOrPlatformId) as { payload_json?: string } | undefined;
    if (directRow?.payload_json) {
      return this.safeParseTrack(directRow.payload_json);
    }

    const linkKey = idOrPlatformId.includes(':') ? idOrPlatformId : `raw:${idOrPlatformId}`;
    const linkRow = this.db
      .prepare(`SELECT canonical_track_id FROM platform_track_links WHERE link_key = ?`)
      .get(linkKey) as { canonical_track_id?: string } | undefined;
    if (linkRow?.canonical_track_id) {
      const row2 = this.db
        .prepare(`SELECT payload_json FROM canonical_tracks WHERE canonical_track_id = ?`)
        .get(linkRow.canonical_track_id) as { payload_json?: string } | undefined;
      if (row2?.payload_json) return this.safeParseTrack(row2.payload_json);
    }
    return null;
  }

  findTrackByTitleArtist(cleanTitle: string, canonicalArtist: string, edition: TrackEdition = 'studio'): CanonicalTrack | null {
    const row = this.db
      .prepare(
        `SELECT payload_json FROM canonical_tracks
         WHERE clean_title = ? AND canonical_artist_norm = ? AND edition = ?
         LIMIT 1`,
      )
      .get(cleanTitle, compactNormalize(canonicalArtist), edition) as { payload_json?: string } | undefined;
    return row?.payload_json ? this.safeParseTrack(row.payload_json) : null;
  }

  listTracks(limit = 500): CanonicalTrack[] {
    const rows = this.db
      .prepare(`SELECT payload_json FROM canonical_tracks ORDER BY updated_at DESC LIMIT ?`)
      .all(Math.max(1, Math.min(3000, limit))) as Array<{ payload_json: string }>;
    const out: CanonicalTrack[] = [];
    for (const r of rows) {
      const parsed = this.safeParseTrack(r.payload_json);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  searchLocalTracks(query: string, limit = 30): CanonicalTrack[] {
    const trimmed = (query || '').trim();
    if (!trimmed) return [];
    const exp = expandQueryAliases(trimmed);
    const foundMap = new Map<string, CanonicalTrack>();

    // 1. SQLite FTS5 BM25 lexical + CJK bigram + Pinyin prefix search
    const rawFtsTerms = buildFtsTokens(
      [exp.simplified, exp.matchedArtist || '', ...exp.expandedQueries, ...exp.inferredGenres].join(' '),
    )
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9\u4e00-\u9fff]/gi, ''))
      .filter((t) => t.length >= 1)
      .slice(0, 10);

    if (rawFtsTerms.length > 0) {
      const ftsExpr = rawFtsTerms.map((t) => `"${t}"*`).join(' OR ');
      try {
        const ftsRows = this.db
          .prepare(
            `SELECT c.payload_json
             FROM tracks_fts f
             JOIN canonical_tracks c ON c.canonical_track_id = f.canonical_track_id
             WHERE tracks_fts MATCH ?
             ORDER BY bm25(tracks_fts, 0.0, 5.0, 3.5, 1.5, 2.5, 1.5)
             LIMIT ?`,
          )
          .all(ftsExpr, limit * 2) as Array<{ payload_json: string }>;
        for (const r of ftsRows) {
          const ct = this.safeParseTrack(r.payload_json);
          if (ct) foundMap.set(ct.canonicalTrackId, ct);
        }
      } catch {
        // Fallback smoothly if special syntax rejected by FTS5
      }
    }

    // 2. Direct Pinyin / Initials SQL index lookup (handles short initials like "qt", "zjl")
    if (/^[a-z0-9]+$/i.test(exp.compact) && exp.compact.length >= 2) {
      const pyRows = this.db
        .prepare(
          `SELECT payload_json FROM canonical_tracks
           WHERE pinyin_full LIKE ? OR pinyin_initials LIKE ?
           ORDER BY external_popularity DESC
           LIMIT ?`,
        )
        .all(`${exp.compact}%`, `${exp.compact}%`, limit) as Array<{ payload_json: string }>;
      for (const r of pyRows) {
        const ct = this.safeParseTrack(r.payload_json);
        if (ct) foundMap.set(ct.canonicalTrackId, ct);
      }
    }

    // 3. Typo-tolerant Damerau-Levenshtein scan when FTS5 + prefix yielded < 3 hits
    if (foundMap.size < 3 && exp.compact.length >= 3) {
      const recentPool = this.listTracks(400);
      for (const t of recentPool) {
        const sim = Math.max(
          computeFuzzySimilarity(exp.compact, t.cleanTitle),
          computeFuzzySimilarity(exp.compact, compactNormalize(t.canonicalArtist)),
          /^[a-z]+$/.test(exp.compact) ? computeFuzzySimilarity(exp.compact, t.pinyinFull) : 0,
        );
        if (sim >= 0.68) {
          foundMap.set(t.canonicalTrackId, t);
        }
      }
    }

    return Array.from(foundMap.values()).slice(0, limit);
  }

  recordEvent(event: StoredBehaviorEvent): { inserted: boolean; deduplicated: boolean } {
    if (!event?.eventId || !event?.subjectKey) {
      return { inserted: false, deduplicated: false };
    }
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO behavior_events (
        event_id, subject_key, event_type, canonical_track_id, artist_key,
        genres_json, language, query, weight, progress_ratio, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      event.eventId,
      event.subjectKey,
      event.type,
      event.canonicalTrackId ?? null,
      event.artistKey ?? null,
      event.genres ? JSON.stringify(event.genres) : null,
      event.language ?? null,
      event.query ?? null,
      event.weight,
      event.progressRatio ?? null,
      event.createdAt,
    );

    const inserted = Number(info.changes) > 0;
    if (inserted) {
      this.writeCounter += 1;
      if (this.writeCounter % 1500 === 0) {
        this.pruneRetention();
      }
    }
    return {
      inserted,
      deduplicated: !inserted,
    };
  }

  getUserEvents(subjectKey: string, limit = 200, sinceMs = 0): StoredBehaviorEvent[] {
    if (!subjectKey) return [];
    const rows = this.db
      .prepare(
        `SELECT event_id, subject_key, event_type, canonical_track_id, artist_key,
                genres_json, language, query, weight, progress_ratio, created_at
         FROM behavior_events
         WHERE subject_key = ? AND created_at >= ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(subjectKey, sinceMs, Math.min(1000, Math.max(1, limit))) as Array<Record<string, any>>;

    return rows.map((r) => this.rowToEvent(r));
  }

  clearUserEvents(subjectKey: string): number {
    if (!subjectKey) return 0;
    const info = this.db.prepare(`DELETE FROM behavior_events WHERE subject_key = ?`).run(subjectKey);
    return Number(info.changes) || 0;
  }

  getAllRecentEvents(sinceMs: number, limit = 10000): StoredBehaviorEvent[] {
    const rows = this.db
      .prepare(
        `SELECT event_id, subject_key, event_type, canonical_track_id, artist_key,
                genres_json, language, query, weight, progress_ratio, created_at
         FROM behavior_events
         WHERE created_at >= ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(sinceMs, Math.min(25000, Math.max(1, limit))) as Array<Record<string, any>>;

    return rows.map((r) => this.rowToEvent(r));
  }

  incrementCooccurrence(trackA: string, trackB: string, delta: number): void {
    if (!trackA || !trackB || trackA === trackB || delta <= 0) return;
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO track_cooccurrence (track_a, track_b, weight, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(track_a, track_b) DO UPDATE SET
        weight = MIN(200.0, track_cooccurrence.weight + excluded.weight),
        updated_at = excluded.updated_at
    `);
    stmt.run(trackA, trackB, delta, now);
    stmt.run(trackB, trackA, delta, now);
  }

  getCooccurringTracks(trackId: string, limit = 20): Array<{ canonicalTrackId: string; weight: number }> {
    const rows = this.db
      .prepare(
        `SELECT track_b AS canonicalTrackId, weight
         FROM track_cooccurrence
         WHERE track_a = ?
         ORDER BY weight DESC
         LIMIT ?`,
      )
      .all(trackId, limit) as Array<{ canonicalTrackId: string; weight: number }>;
    return rows;
  }

  recordSearchQuery(normQuery: string, displayQuery: string, clicked = false): void {
    const key = normQuery.trim();
    if (!key || key.length > 64) return;
    const inc = clicked ? 3 : 1;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO search_queries (norm_query, display_query, hit_count, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(norm_query) DO UPDATE SET
           hit_count = search_queries.hit_count + excluded.hit_count,
           updated_at = excluded.updated_at`,
      )
      .run(key, displayQuery.trim(), inc, now);
  }

  getTopSearchQueries(prefix: string, limit = 8): Array<{ query: string; count: number }> {
    const pNorm = compactNormalize(prefix);
    const rows = pNorm
      ? (this.db
          .prepare(
            `SELECT display_query AS query, hit_count AS count
             FROM search_queries
             WHERE norm_query LIKE ? OR display_query LIKE ?
             ORDER BY hit_count DESC, updated_at DESC
             LIMIT ?`,
          )
          .all(`${pNorm}%`, `%${prefix.trim()}%`, limit) as Array<{ query: string; count: number }>)
      : (this.db
          .prepare(
            `SELECT display_query AS query, hit_count AS count
             FROM search_queries
             ORDER BY hit_count DESC, updated_at DESC
             LIMIT ?`,
          )
          .all(limit) as Array<{ query: string; count: number }>);
    return rows;
  }

  getStats(): { trackCount: number; eventCount: number; cooccurrencePairs: number; storageKind: string } {
    const tRow = this.db.prepare(`SELECT COUNT(*) AS cnt FROM canonical_tracks`).get() as { cnt: number };
    const eRow = this.db.prepare(`SELECT COUNT(*) AS cnt FROM behavior_events`).get() as { cnt: number };
    const cRow = this.db.prepare(`SELECT COUNT(*) AS cnt FROM track_cooccurrence`).get() as { cnt: number };
    return {
      trackCount: Number(tRow?.cnt || 0),
      eventCount: Number(eRow?.cnt || 0),
      cooccurrencePairs: Math.floor(Number(cRow?.cnt || 0) / 2),
      storageKind: this.kind,
    };
  }

  pruneRetention(retentionDays = 90): void {
    const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000;
    try {
      this.db.prepare(`DELETE FROM behavior_events WHERE created_at < ?`).run(cutoff);
    } catch {}
  }

  close(): void {
    try {
      this.db.close();
    } catch {}
  }

  private safeParseTrack(jsonStr: string): CanonicalTrack | null {
    try {
      return JSON.parse(jsonStr) as CanonicalTrack;
    } catch {
      return null;
    }
  }

  private rowToEvent(r: Record<string, any>): StoredBehaviorEvent {
    let genres: string[] | undefined;
    if (typeof r.genres_json === 'string' && r.genres_json) {
      try {
        genres = JSON.parse(r.genres_json);
      } catch {}
    }
    return {
      eventId: String(r.event_id),
      subjectKey: String(r.subject_key),
      type: r.event_type,
      canonicalTrackId: r.canonical_track_id ? String(r.canonical_track_id) : undefined,
      artistKey: r.artist_key ? String(r.artist_key) : undefined,
      genres,
      language: r.language ? (String(r.language) as any) : undefined,
      query: r.query ? String(r.query) : undefined,
      weight: Number(r.weight || 0),
      progressRatio: r.progress_ratio !== null && r.progress_ratio !== undefined ? Number(r.progress_ratio) : undefined,
      createdAt: Number(r.created_at || 0),
    };
  }
}

export function createServerRecommendStore(dbPath?: string): RecommendStore {
  const effectivePath =
    (dbPath ?? process.env.SONIC_RECOMMEND_DB_PATH ?? '').trim() ||
    path.resolve(process.cwd(), 'data', 'sonic-recommend.sqlite');

  if (effectivePath === 'memory' || effectivePath === 'off') {
    return new MemoryRecommendStore();
  }

  try {
    const store = new SqliteRecommendStore(effectivePath);
    store.pruneRetention(
      Math.max(7, parseInt(String(process.env.SONIC_RECOMMEND_RETENTION_DAYS || '90'), 10) || 90),
    );
    return store;
  } catch (err: any) {
    console.warn(
      `[Sonic Recommend] Failed to open SQLite store at ${effectivePath} (${err?.message || 'error'}); falling back to MemoryRecommendStore`,
    );
    return new MemoryRecommendStore();
  }
}
