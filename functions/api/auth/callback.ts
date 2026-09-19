import { createSession, exchangeCode, fetchUserInfo } from '../../_lib/auth';
import { errorResponse, handleOptions, jsonResponse } from '../../_lib/http';
import type { AppEnv } from '../../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return errorResponse(`Epomail 授权失败: ${error}`, 400);
  }

  if (!code) {
    return errorResponse('缺少授权码 (Missing authorization code)', 400);
  }

  try {
    const { accessToken } = await exchangeCode(env, url.origin, code);
    const userInfo = await fetchUserInfo(env, accessToken);
    const session = await createSession(env, userInfo);

    // If request asks for json or has accept json
    const acceptsJson = request.headers.get('Accept')?.includes('application/json') || url.searchParams.get('format') === 'json';
    if (acceptsJson) {
      return jsonResponse({
        ok: true,
        session,
        message: 'Epomail OAuth 登录成功',
      });
    }

    // Redirect to frontend with session hash
    const targetUrl = new URL('/', url.origin);
    targetUrl.searchParams.set('auth', 'success');
    targetUrl.hash = `session=${encodeURIComponent(JSON.stringify({
      email: session.email,
      name: session.name,
      avatar: session.avatar,
      apiKey: session.apiKey,
      expiresAt: session.expiresAt,
    }))}`;

    return Response.redirect(targetUrl.toString(), 302);
  } catch (err: any) {
    console.error('[CFSolara Auth Callback Error]', err);
    return errorResponse(err?.message || 'OAuth 登录授权处理失败', 500);
  }
}
