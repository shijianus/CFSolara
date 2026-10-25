// Sonic Gateway — Pages -> Linux Local Engine Client & 3-State Circuit Breaker
// State Machine:
//   CLOSED (Healthy) ──[>= threshold errors or Argo 530/52x]──> OPEN (Fast-Fail 0ms)
//   OPEN             ──[after cooldownMs]─────────────────────> HALF_OPEN (Single Probe)
//   HALF_OPEN        ──[2xx OK]──> CLOSED | ──[fail/5xx]──> OPEN

import type { AppEnv } from '../types';
import { getSonicConfig } from './config';
import { extractClientIp } from './security';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface EndpointCircuit {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number;
  lastError: string;
  lastErrorAt: number;
  lastSuccessAt: number;
  probeInFlight: boolean;
}

const circuits = new Map<string, EndpointCircuit>();

function getOrCreateCircuit(engineBaseUrl: string): EndpointCircuit {
  const key = engineBaseUrl.toLowerCase();
  let c = circuits.get(key);
  if (!c) {
    c = {
      state: 'CLOSED',
      consecutiveFailures: 0,
      openedAt: 0,
      lastError: '',
      lastErrorAt: 0,
      lastSuccessAt: 0,
      probeInFlight: false,
    };
    circuits.set(key, c);
  }
  return c;
}

export interface CircuitSnapshot {
  enabled: boolean;
  engineUrl?: string;
  state: CircuitState;
  consecutiveFailures: number;
  lastError?: string;
  cooldownRemainingMs: number;
}

export function getLocalEngineCircuitSnapshot(env?: AppEnv): CircuitSnapshot {
  const cfg = getSonicConfig(env);
  if (!cfg.enableLocalEngine || !cfg.localEngineUrl) {
    return {
      enabled: false,
      state: 'CLOSED',
      consecutiveFailures: 0,
      cooldownRemainingMs: 0,
    };
  }
  const c = getOrCreateCircuit(cfg.localEngineUrl);
  const cooldownMs = Math.max(100, parseInt(String(env?.SONIC_CB_COOLDOWN_MS || '30000'), 10) || 30_000);
  const now = Date.now();
  let effectiveState = c.state;
  let cooldownRemainingMs = 0;

  if (c.state === 'OPEN') {
    const elapsed = now - c.openedAt;
    if (elapsed >= cooldownMs) {
      effectiveState = 'HALF_OPEN';
    } else {
      cooldownRemainingMs = cooldownMs - elapsed;
    }
  }

  return {
    enabled: true,
    engineUrl: cfg.localEngineUrl,
    state: effectiveState,
    consecutiveFailures: c.consecutiveFailures,
    lastError: c.lastError || undefined,
    cooldownRemainingMs,
  };
}

export function resetLocalEngineCircuitForTest(): void {
  circuits.clear();
}

export interface LocalEngineCallResult<T> {
  ok: boolean;
  data?: T;
  status?: number;
  latencyMs: number;
  skippedByCircuit: boolean;
  circuitState: CircuitState;
  error?: string;
}

const INSTANT_TRIP_HTTP_STATUSES = new Set([521, 522, 523, 524, 530]);

export async function callLocalEngineJson<T = any>(
  pathWithQuery: string,
  env?: AppEnv,
  options?: {
    request?: Request;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<LocalEngineCallResult<T>> {
  const cfg = getSonicConfig(env);
  if (!cfg.enableLocalEngine || !cfg.localEngineUrl) {
    return {
      ok: false,
      latencyMs: 0,
      skippedByCircuit: true,
      circuitState: 'CLOSED',
      error: 'Local engine not configured',
    };
  }

  // Loop guard: never let an already-forwarded request call the engine again
  if (options?.request?.headers.get('X-Sonic-Hop') === 'cf-pages') {
    return {
      ok: false,
      latencyMs: 0,
      skippedByCircuit: true,
      circuitState: 'CLOSED',
      error: 'Loop guard prevented recursive engine call',
    };
  }

  const c = getOrCreateCircuit(cfg.localEngineUrl);
  const threshold = Math.max(1, parseInt(String(env?.SONIC_CB_FAILURE_THRESHOLD || '3'), 10) || 3);
  const cooldownMs = Math.max(100, parseInt(String(env?.SONIC_CB_COOLDOWN_MS || '30000'), 10) || 30_000);
  const now = Date.now();

  if (c.state === 'OPEN') {
    if (now - c.openedAt < cooldownMs || c.probeInFlight) {
      return {
        ok: false,
        latencyMs: 0,
        skippedByCircuit: true,
        circuitState: 'OPEN',
        error: `Circuit OPEN (${c.lastError || 'engine unreachable'})`,
      };
    }
    c.state = 'HALF_OPEN';
    c.probeInFlight = true;
  } else if (c.state === 'HALF_OPEN' && c.probeInFlight) {
    return {
      ok: false,
      latencyMs: 0,
      skippedByCircuit: true,
      circuitState: 'HALF_OPEN',
      error: 'Circuit HALF_OPEN (probe already in flight)',
    };
  }

  const start = Date.now();
  const baseTimeout = options?.timeoutMs ?? cfg.engineTimeoutMs;
  const effectiveTimeout = c.state === 'HALF_OPEN' ? Math.min(baseTimeout, 2500) : baseTimeout;

  const targetUrl = `${cfg.localEngineUrl}${pathWithQuery.startsWith('/') ? '' : '/'}${pathWithQuery}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'Sonic-Edge-Gateway/2.2',
    'X-Sonic-Hop': 'cf-pages',
  };
  if (cfg.engineSecret) {
    headers['X-Sonic-Engine-Key'] = cfg.engineSecret;
  }
  if (options?.request) {
    headers['X-Sonic-Client-IP'] = extractClientIp(options.request, env);
  }

  const signals: AbortSignal[] = [AbortSignal.timeout(effectiveTimeout)];
  if (options?.signal) signals.push(options.signal);
  const combinedSignal =
    typeof (AbortSignal as any).any === 'function' ? (AbortSignal as any).any(signals) : signals[0];

  try {
    const resp = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: combinedSignal,
    });
    const latencyMs = Date.now() - start;

    if (resp.status >= 500 || INSTANT_TRIP_HTTP_STATUSES.has(resp.status)) {
      const errMsg = `Engine HTTP ${resp.status}`;
      c.consecutiveFailures += 1;
      c.lastError = errMsg;
      c.lastErrorAt = Date.now();
      c.probeInFlight = false;
      if (INSTANT_TRIP_HTTP_STATUSES.has(resp.status) || c.state === 'HALF_OPEN' || c.consecutiveFailures >= threshold) {
        c.state = 'OPEN';
        c.openedAt = Date.now();
      }
      return {
        ok: false,
        status: resp.status,
        latencyMs,
        skippedByCircuit: false,
        circuitState: c.state,
        error: errMsg,
      };
    }

    if (!resp.ok) {
      // 4xx (e.g. 401 misconfigured secret or 404 track not found)
      c.probeInFlight = false;
      if (resp.status === 401 || resp.status === 403) {
        c.lastError = `Engine auth rejected (${resp.status})`;
      } else if (c.state === 'HALF_OPEN') {
        c.state = 'CLOSED';
        c.consecutiveFailures = 0;
      }
      let errPayload: any = null;
      try {
        errPayload = await resp.json();
      } catch {}
      return {
        ok: false,
        status: resp.status,
        data: errPayload,
        latencyMs,
        skippedByCircuit: false,
        circuitState: c.state,
        error: errPayload?.error?.message || errPayload?.error || `Engine HTTP ${resp.status}`,
      };
    }

    const data = (await resp.json()) as T;
    c.state = 'CLOSED';
    c.consecutiveFailures = 0;
    c.probeInFlight = false;
    c.lastSuccessAt = Date.now();
    c.lastError = '';

    return {
      ok: true,
      data,
      status: resp.status,
      latencyMs,
      skippedByCircuit: false,
      circuitState: 'CLOSED',
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const errMsg = err?.name === 'TimeoutError' || err?.name === 'AbortError'
      ? `Engine timeout (${effectiveTimeout}ms)`
      : (err?.message || 'Engine network error');

    c.consecutiveFailures += 1;
    c.lastError = errMsg;
    c.lastErrorAt = Date.now();
    c.probeInFlight = false;
    if (c.state === 'HALF_OPEN' || c.consecutiveFailures >= threshold) {
      c.state = 'OPEN';
      c.openedAt = Date.now();
    }

    return {
      ok: false,
      latencyMs,
      skippedByCircuit: false,
      circuitState: c.state,
      error: errMsg,
    };
  }
}
