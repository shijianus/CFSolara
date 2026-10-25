import {
  base64UrlEncode,
  buildAuthorizeUrl,
  getEpomailConfig,
} from '../../_lib/auth';
import { errorResponse, handleOptions, jsonResponse } from '../../_lib/http';
import type { AppEnv } from '../../_lib/types';

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
  const redirectMode = url.searchParams.get('mode') === 'json' ? 'json' : 'redirect';

  // Validate redirect URI origin against config or allowed origins whitelist
  const config = getEpomailConfig(env, url.origin);
  if (!config.redirectUri) {
    return errorResponse(
      '未配置合法重定向地址 (EPOMAIL_REDIRECT_URI 缺失且请求来源不在 SONIC_ALLOWED_ORIGINS 白名单)',
      400,
    );
  }

  // 1. Generate >= 128-bit cryptographically secure random state (256-bit)
  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  const state = base64UrlEncode(stateBytes);

  // 2. PKCE: generate 256-bit random code_verifier and S256 code_challenge
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = base64UrlEncode(verifierBytes);
  const challengeHash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = base64UrlEncode(new Uint8Array(challengeHash));

  let authorizeUrl: string;
  try {
    authorizeUrl = buildAuthorizeUrl(env, url.origin, state, codeChallenge);
  } catch (err: any) {
    return errorResponse(err?.message || '构建授权跳转链接失败', 500);
  }

  const headers = new Headers();
  headers.append(
    'Set-Cookie',
    `sonic_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=600`,
  );
  headers.append(
    'Set-Cookie',
    `sonic_oauth_verifier=${codeVerifier}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=600`,
  );

  if (redirectMode === 'json') {
    return jsonResponse({ ok: true, authorizeUrl }, { headers });
  }

  headers.set('Location', authorizeUrl);
  return new Response(null, {
    status: 302,
    headers,
  });
}
