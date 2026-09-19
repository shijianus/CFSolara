import { buildAuthorizeUrl } from '../../_lib/auth';
import { handleOptions, jsonResponse } from '../../_lib/http';
import type { AppEnv } from '../../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();

  const url = new URL(request.url);
  const redirectMode = url.searchParams.get('mode') === 'json' ? 'json' : 'redirect';
  const state = url.searchParams.get('state') || 'solara_login';
  const authorizeUrl = buildAuthorizeUrl(env, url.origin, state);

  if (redirectMode === 'json') {
    return jsonResponse({ ok: true, authorizeUrl });
  }

  return Response.redirect(authorizeUrl, 302);
}
