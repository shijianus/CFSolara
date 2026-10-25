import {
  AuthConfigError,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  appendSetCookies,
  buildAuthorizeUrl,
  buildOAuthCookie,
  generateOAuthState,
  generatePkcePair,
} from '../../_lib/auth';
import { handleOptions, jsonResponse } from '../../_lib/http';
import { isEnvEnabled } from '../../_lib/sonic/config';
import type { AppEnv } from '../../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();

  const url = new URL(request.url);
  const redirectMode = url.searchParams.get('mode') === 'json' ? 'json' : 'redirect';

  try {
    // The state is always generated server-side; a client-supplied ?state= is ignored.
    const state = generateOAuthState();
    const cookies = [buildOAuthCookie(OAUTH_STATE_COOKIE, state)];

    let codeChallenge: string | undefined;
    if (isEnvEnabled(env.EPOMAIL_PKCE, true)) {
      const pkce = await generatePkcePair();
      codeChallenge = pkce.challenge;
      cookies.push(buildOAuthCookie(OAUTH_VERIFIER_COOKIE, pkce.verifier));
    }

    const authorizeUrl = buildAuthorizeUrl(env, url.origin, state, { codeChallenge });

    if (redirectMode === 'json') {
      const response = jsonResponse({ ok: true, authorizeUrl }, { headers: { 'Cache-Control': 'no-store' } });
      return appendSetCookies(response, cookies);
    }

    const headers = new Headers({
      Location: authorizeUrl,
      'Cache-Control': 'no-store',
    });
    for (const cookie of cookies) headers.append('Set-Cookie', cookie);
    return new Response(null, { status: 302, headers });
  } catch (error) {
    if (error instanceof AuthConfigError) {
      console.error(`[Sonic Auth] login unavailable (${error.code})`);
      return jsonResponse(
        { brand: 'Sonic', error: { code: 'AUTH_UNAVAILABLE', message: 'Authentication service is not configured' } },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    console.error('[Sonic Auth] login failed');
    return jsonResponse(
      { brand: 'Sonic', error: { code: 'AUTH_UNAVAILABLE', message: 'Authentication service is unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
