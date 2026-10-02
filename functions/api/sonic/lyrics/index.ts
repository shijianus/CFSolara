// Sonic Gateway — Backward Compatibility Handler
// GET /api/sonic/lyrics
// Internal forward to /api/sonic/lyrics/nexus

import type { AppEnv } from '../../../_lib/types';
import { handleNexusLyricsRequest } from './nexus';

export async function onRequest({
  request,
  env,
  waitUntil,
}: {
  request: Request;
  env: AppEnv;
  waitUntil?: (promise: Promise<any>) => void;
}): Promise<Response> {
  return handleNexusLyricsRequest(request, env, waitUntil);
}
