import {
  AuthConfigError,
  AuthError,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  appendSetCookies,
  buildClearedOAuthCookie,
  createSession,
  exchangeCode,
  fetchUserInfo,
  parseCookieHeader,
} from '../../_lib/auth';
import { errorResponse, handleOptions, jsonResponse } from '../../_lib/http';
import { constantTimeEqualStrings } from '../../_lib/sonic/hash';
import type { AppEnv } from '../../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();

  const url = new URL(request.url);
  const cookies = parseCookieHeader(request.headers.get('cookie'));
  const clearCookies = [
    buildClearedOAuthCookie(OAUTH_STATE_COOKIE),
    buildClearedOAuthCookie(OAUTH_VERIFIER_COOKIE),
  ];
  const fail = (message: string, status: number): Response =>
    appendSetCookies(errorResponse(message, status), clearCookies);

  const state = url.searchParams.get('state') || '';
  const cookieState = cookies[OAUTH_STATE_COOKIE] || '';
  if (!state || !cookieState || !constantTimeEqualStrings(state, cookieState)) {
    console.error('[Sonic Auth] callback rejected: OAuth state missing or mismatched');
    return fail('OAuth state validation failed', 400);
  }

  if (url.searchParams.get('error')) {
    return fail('OAuth authorization was denied', 400);
  }

  const code = url.searchParams.get('code');
  if (!code) {
    return fail('Missing authorization code', 400);
  }

  try {
    const codeVerifier = cookies[OAUTH_VERIFIER_COOKIE] || undefined;
    const { accessToken } = await exchangeCode(env, url.origin, code, codeVerifier);
    const userInfo = await fetchUserInfo(env, accessToken);
    const session = await createSession(env, userInfo);

    const acceptsJson =
      request.headers.get('Accept')?.includes('application/json') || url.searchParams.get('format') === 'json';

    if (acceptsJson) {
      const response = jsonResponse(
        {
          ok: true,
          session,
          message: 'Epomail OAuth 登录成功',
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
      return appendSetCookies(response, clearCookies);
    }

    // The session is carried in the URL fragment: unlike a query string it is
    // not sent to the server, Referer, or access logs.
    const targetUrl = new URL('/', url.origin);
    targetUrl.searchParams.set('auth', 'success');
    targetUrl.hash = `session=${encodeURIComponent(JSON.stringify({
      email: session.email,
      name: session.name,
      avatar: session.avatar,
      apiKey: session.apiKey,
      expiresAt: session.expiresAt,
    }))}`;

    const response = new Response(null, {
      status: 302,
      headers: {
        Location: targetUrl.toString(),
        'Cache-Control': 'no-store',
      },
    });
    return appendSetCookies(response, clearCookies);
  } catch (err: any) {
    if (err instanceof AuthConfigError) {
      console.error(`[Sonic Auth] callback unavailable (${err.code})`);
      return fail('Authentication service is not configured', 503);
    }
    if (err instanceof AuthError) {
      return fail('OAuth login failed', err.status);
    }
    console.error('[Sonic Auth Callback Error]', err?.name || 'unknown error');
    return fail('OAuth login failed', 502);
  }
}
