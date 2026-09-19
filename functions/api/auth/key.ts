import { createSession, verifyAuth } from '../../_lib/auth';
import { errorResponse, handleOptions, jsonResponse } from '../../_lib/http';
import type { AppEnv } from '../../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();

  const auth = await verifyAuth(request, env);
  if (!auth.authenticated || !auth.user) {
    return errorResponse('未登录或未提供有效身份凭证 (Unauthorized)', 401);
  }

  // If POST, regenerate a fresh API Key
  if (request.method === 'POST') {
    const newSession = await createSession(env, {
      id: auth.user.id,
      email: auth.user.email,
      name: auth.user.name,
      avatar: auth.user.avatar,
      role: auth.user.role,
    });

    return jsonResponse({
      ok: true,
      apiKey: newSession.apiKey,
      expiresAt: newSession.expiresAt,
      message: '新 API Key 生成成功，已就绪可连结至外部专案',
    });
  }

  return jsonResponse({
    ok: true,
    apiKey: auth.user.apiKey,
    expiresAt: auth.user.expiresAt,
    usage: {
      rateLimit: '120 requests/minute',
      allowedSources: ['netease', 'kuwo', 'qq'],
      allowedBitrates: ['128', '192', '320', 'flac'],
    },
    instructions: '在外部专案的请求头中添加 X-CFSolara-Key: <your_api_key> 或 Authorization: Bearer <your_api_key> 即可使用全量音乐 API。',
  });
}
