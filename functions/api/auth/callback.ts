import {
  createSession,
  exchangeCode,
  fetchUserInfo,
  getEpomailConfig,
} from '../../_lib/auth';
import { errorResponse, handleOptions, jsonResponse } from '../../_lib/http';
import { timingSafeEqualStr } from '../../_lib/sonic/security';
import type { AppEnv } from '../../_lib/types';

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('cookie') || '';
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();

  // Fail closed if OAuth credentials are not configured
  if (!env.EPOMAIL_CLIENT_ID || !env.EPOMAIL_CLIENT_SECRET) {
    return errorResponse(
      'OAuth 服务未正确配置 (EPOMAIL_CLIENT_ID 或 EPOMAIL_CLIENT_SECRET 缺失)',
      503,
    );
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  // Headers to clear state & verifier cookies
  const clearCookieHeaders = new Headers();
  clearCookieHeaders.append(
    'Set-Cookie',
    'sonic_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  );
  clearCookieHeaders.append(
    'Set-Cookie',
    'sonic_oauth_verifier=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  );

  if (error) {
    return errorResponse(`Epomail 授权失败: ${error}`, 400, undefined);
  }

  // 1. Verify OAuth State (CSRF Protection)
  const cookies = parseCookies(request);
  const cookieState = cookies['sonic_oauth_state'];

  if (!state || !cookieState || !timingSafeEqualStr(state, cookieState)) {
    return jsonResponse(
      { ok: false, error: '无效或已过期的登录 state 标识 (OAuth CSRF 校验失败)' },
      { status: 400, headers: clearCookieHeaders },
    );
  }

  if (!code) {
    return jsonResponse(
      { ok: false, error: '缺少授权码 (Missing authorization code)' },
      { status: 400, headers: clearCookieHeaders },
    );
  }

  // 2. Validate redirect URI
  const config = getEpomailConfig(env, url.origin);
  if (!config.redirectUri) {
    return jsonResponse(
      { ok: false, error: '未配置合法重定向地址或请求来源未授权' },
      { status: 400, headers: clearCookieHeaders },
    );
  }

  const codeVerifier = cookies['sonic_oauth_verifier'];

  try {
    const { accessToken } = await exchangeCode(env, url.origin, code, codeVerifier);
    const userInfo = await fetchUserInfo(env, accessToken);
    const session = await createSession(env, userInfo);

    // If request asks for json or has accept json
    const acceptsJson =
      request.headers.get('Accept')?.includes('application/json') ||
      url.searchParams.get('format') === 'json';

    if (acceptsJson) {
      return jsonResponse(
        {
          ok: true,
          session,
          message: 'Epomail OAuth 登录成功',
        },
        { headers: clearCookieHeaders },
      );
    }

    // Redirect to frontend with session hash
    const targetUrl = new URL('/', url.origin);
    targetUrl.searchParams.set('auth', 'success');
    targetUrl.hash = `session=${encodeURIComponent(
      JSON.stringify({
        email: session.email,
        name: session.name,
        avatar: session.avatar,
        apiKey: session.apiKey,
        expiresAt: session.expiresAt,
      }),
    )}`;

    clearCookieHeaders.set('Location', targetUrl.toString());
    return new Response(null, {
      status: 302,
      headers: clearCookieHeaders,
    });
  } catch (err: any) {
    console.error('[Sonic Auth Callback Error]', err);
    const isMisconfig = String(err?.message || '').includes('SONIC_SECRET');
    return jsonResponse(
      {
        brand: 'Sonic',
        error: {
          code: isMisconfig ? 'AUTH_SECRET_MISCONFIGURED' : 'OAUTH_EXCHANGE_FAILED',
          message: isMisconfig
            ? 'API Key signing secret is not configured or shorter than 32 characters'
            : 'OAuth 登录授权处理失败',
        },
      },
      {
        status: isMisconfig ? 503 : 500,
        headers: clearCookieHeaders,
      },
    );
  }
}
