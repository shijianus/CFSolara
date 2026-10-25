import { AuthConfigError, buildAuthorizeUrl } from '../../_lib/auth';
import { handleOptions, jsonResponse } from '../../_lib/http';
import type { AppEnv } from '../../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();

  const url = new URL(request.url);
  const redirectMode = url.searchParams.get('mode') === 'json' ? 'json' : 'redirect';

  try {
    const state = url.searchParams.get('state') || 'sonic_login';
    const authorizeUrl = buildAuthorizeUrl(env, url.origin, state);

    if (redirectMode === 'json') {
      return jsonResponse({ ok: true, authorizeUrl });
    }

    return Response.redirect(authorizeUrl, 302);
  } catch (error) {
    if (error instanceof AuthConfigError) {
      console.error(`[Sonic Auth] login unavailable (${error.code})`);
      return jsonResponse(
        { brand: 'Sonic', error: { code: 'AUTH_UNAVAILABLE', message: 'Authentication service is not configured' } },
        { status: 503 },
      );
    }
    console.error('[Sonic Auth] login failed');
    return jsonResponse(
      { brand: 'Sonic', error: { code: 'AUTH_UNAVAILABLE', message: 'Authentication service is unavailable' } },
      { status: 503 },
    );
  }
}
