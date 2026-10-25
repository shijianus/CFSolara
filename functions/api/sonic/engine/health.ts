// Sonic Local Engine — Authenticated Health & Diagnostics Endpoint
// GET /api/sonic/engine/health
// Protected by mandatory `X-Sonic-Engine-Key` (rejects anonymous requests with 401; never exposes secrets/cookies)

import { handleOptions, jsonResponse } from '../../../_lib/http';
import { checkEngineAccess } from '../../../_lib/sonic/security';
import { getSonicConfig } from '../../../_lib/sonic/config';
import { getLocalEngineCircuitSnapshot } from '../../../_lib/sonic/local-engine';
import { sanitizeErrorForClient } from '../../../_lib/sonic/net-guard';
import type { AppEnv } from '../../../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();

  const denied = checkEngineAccess(request, env);
  if (denied) return denied;

  const cfg = getSonicConfig(env);
  let ncmSidecarHealthy: boolean | null = null;
  let ncmSidecarLatencyMs: number | null = null;

  if (cfg.ncmApiUrl) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${cfg.ncmApiUrl}/inner/version`, { signal: AbortSignal.timeout(2000) });
      ncmSidecarHealthy = r.ok;
      ncmSidecarLatencyMs = Date.now() - t0;
    } catch {
      ncmSidecarHealthy = false;
      ncmSidecarLatencyMs = Date.now() - t0;
    }
  }

  return jsonResponse(
    {
      brand: 'Sonic',
      ok: true,
      runtime: cfg.runtime,
      timestamp: new Date().toISOString(),
      ncmSidecar: {
        configured: Boolean(cfg.ncmApiUrl),
        healthy: ncmSidecarHealthy,
        latencyMs: ncmSidecarLatencyMs,
      },
      cookiesConfigured: {
        netease: Boolean(env?.NETEASE_COOKIE),
        qq: Boolean(env?.QQ_COOKIE),
        kugou: Boolean(env?.KUGOU_COOKIE),
      },
      flags: {
        enableGdstudio: cfg.enableGdstudio,
        enableLyriva: cfg.enableLyriva,
        enableUnblock: cfg.enableUnblock,
        enableFreeCrossMatch: cfg.enableFreeCrossMatch,
      },
      circuit: (() => {
        const snapshot = getLocalEngineCircuitSnapshot(env);
        return {
          ...snapshot,
          lastError: snapshot.lastError ? sanitizeErrorForClient(snapshot.lastError, 'engine unavailable') : undefined,
        };
      })(),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
