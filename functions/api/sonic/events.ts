// POST / DELETE / GET /api/sonic/events
// Privacy-First User Behavior Feedback & Preference Management Endpoint
// - POST: Ingest batch or single behavior event (`play_start`, `play_progress`, `play_complete`, `skip`, `replay`, `favorite`, `dislike`, `search`, `search_click`)
// - DELETE: One-click deletion of all server-side events/preferences for the current user or anonymous ID
// - GET: Inspect current privacy mode and high-level preference profile summary (no raw PII)

import type { AppEnv } from '../../_lib/types';
import { jsonResponse, handleOptions } from '../../_lib/http';
import { getSonicConfig } from '../../_lib/sonic/config';
import { callLocalEngineJson } from '../../_lib/sonic/local-engine';
import { buildGatewayHeaders, guardGatewayRequest, sonicError } from '../../_lib/sonic/route-helpers';
import {
  buildUserPreferenceProfile,
  clearUserRecommendationData,
  getRecommendStore,
  ingestBehaviorEvents,
  resolveUserIdentity,
  type SonicBehaviorEventInput,
} from '../../_lib/sonic/recommend';

const MAX_BODY_BYTES = 64 * 1024;
const VALID_EVENT_TYPES = new Set([
  'search',
  'search_click',
  'play_start',
  'play_progress',
  'play_complete',
  'skip',
  'replay',
  'favorite',
  'unfavorite',
  'dislike',
  'undislike',
]);

export async function onRequest({
  request,
  env,
}: {
  request: Request;
  env: AppEnv;
  waitUntil?: (promise: Promise<any>) => void;
}): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();

  const method = request.method.toUpperCase();
  if (method !== 'POST' && method !== 'DELETE' && method !== 'GET') {
    return sonicError('METHOD_NOT_ALLOWED', 'Only GET, POST, and DELETE allowed', 405);
  }

  const guardResp = await guardGatewayRequest(request, env, 'sonic-events');
  if (guardResp) return guardResp;

  const start = Date.now();
  const config = getSonicConfig(env);
  const privateHeaders = {
    'Cache-Control': 'private, no-store',
    Vary: 'Authorization, X-Sonic-Key, X-CFSolara-Key, X-Sonic-Anon-Id, X-Sonic-Personalization',
  };

  if (method === 'GET') {
    if (config.enableLocalEngine) {
      const engineRes = await callLocalEngineJson<any>('/api/sonic/events', env, {
        request,
        method: 'GET',
        timeoutMs: config.engineTimeoutMs,
      });
      if (engineRes.ok && engineRes.data?.brand === 'Sonic') {
        return jsonResponse(engineRes.data, {
          status: 200,
          headers: buildGatewayHeaders(privateHeaders, false, 'CLOSED'),
        });
      }
    }

    const identity = await resolveUserIdentity(request, env);
    const store = getRecommendStore(env);
    const profile = buildUserPreferenceProfile(identity, store);
    return jsonResponse(
      {
        brand: 'Sonic',
        data: {
          privacyMode: identity.mode,
          personalizationEnabled: identity.personalizationEnabled,
          totalEvents: profile.totalEvents,
          likedCount: profile.likedTrackIds.size,
          dislikedCount: profile.blockedTrackIds.size,
          topArtists: Object.entries(profile.longTermArtists)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([name]) => name),
          topGenres: Object.entries(profile.genreAffinities)
            .filter(([, w]) => w > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([genre]) => genre),
          recentQueries: profile.recentQueries.slice(0, 6),
          storageKind: store.kind,
        },
        meta: {
          cached: false,
          cacheLevel: 'none',
          latencyMs: Date.now() - start,
          provider: 'sonic-events',
        },
      },
      { status: 200, headers: buildGatewayHeaders(privateHeaders) },
    );
  }

  if (method === 'DELETE') {
    let engineCleared = false;
    if (config.enableLocalEngine) {
      const engineRes = await callLocalEngineJson<any>('/api/sonic/events', env, {
        request,
        method: 'DELETE',
        timeoutMs: config.engineTimeoutMs,
      });
      if (engineRes.ok && engineRes.data?.brand === 'Sonic') {
        engineCleared = true;
      }
    }

    const identity = await resolveUserIdentity(request, env);
    const localClear = clearUserRecommendationData(identity, env);
    return jsonResponse(
      {
        brand: 'Sonic',
        data: {
          cleared: engineCleared || localClear.cleared,
          removedEvents: localClear.removedEvents,
          privacyMode: identity.mode,
        },
        meta: {
          cached: false,
          cacheLevel: 'none',
          latencyMs: Date.now() - start,
          provider: 'sonic-events',
        },
      },
      { status: 200, headers: buildGatewayHeaders(privateHeaders) },
    );
  }

  // POST: Parse & validate JSON payload
  let rawText = '';
  try {
    rawText = await request.text();
  } catch {
    return sonicError('INVALID_BODY', 'Failed to read request body', 400);
  }
  if (rawText.length > MAX_BODY_BYTES) {
    return sonicError('PAYLOAD_TOO_LARGE', 'Event payload exceeds 64KB limit', 413);
  }

  let parsed: any;
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    return sonicError('INVALID_JSON', 'Request body must be valid JSON', 400);
  }

  const rawEvents: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.events)
      ? parsed.events
      : parsed?.type
        ? [parsed]
        : [];

  if (rawEvents.length === 0) {
    return sonicError('EMPTY_EVENTS', 'Provide `events` array or single event object with valid `type`', 400);
  }

  const validEvents: SonicBehaviorEventInput[] = [];
  for (const ev of rawEvents.slice(0, 50)) {
    if (ev && typeof ev === 'object' && VALID_EVENT_TYPES.has(String(ev.type))) {
      validEvents.push(ev as SonicBehaviorEventInput);
    }
  }

  if (validEvents.length === 0) {
    return sonicError('INVALID_EVENT_TYPE', 'No valid event types found in payload', 400);
  }

  // Primary Hop: forward to Linux VPS Sonic Engine when configured
  let degraded = false;
  let circuitState: string | undefined;
  if (config.enableLocalEngine) {
    const engineRes = await callLocalEngineJson<any>('/api/sonic/events', env, {
      request,
      method: 'POST',
      body: JSON.stringify({ events: validEvents }),
      timeoutMs: config.engineTimeoutMs,
    });
    circuitState = engineRes.circuitState;
    if (engineRes.ok && engineRes.data?.brand === 'Sonic') {
      return jsonResponse(
        {
          ...engineRes.data,
          meta: {
            ...engineRes.data.meta,
            latencyMs: Date.now() - start,
            via: 'local-engine',
            circuitState: 'CLOSED',
          },
        },
        {
          status: 200,
          headers: buildGatewayHeaders(privateHeaders, false, 'CLOSED'),
        },
      );
    }
    degraded = true;
  }

  const identity = await resolveUserIdentity(request, env);
  const result = await ingestBehaviorEvents(validEvents, identity, env);

  return jsonResponse(
    {
      brand: 'Sonic',
      data: {
        ok: true,
        privacyMode: identity.mode,
        ...result,
      },
      meta: {
        cached: false,
        cacheLevel: 'none',
        latencyMs: Date.now() - start,
        provider: 'sonic-events',
        degraded,
        ...(degraded ? { circuitState } : {}),
      },
    },
    {
      status: 200,
      headers: buildGatewayHeaders(privateHeaders, degraded, circuitState),
    },
  );
}
