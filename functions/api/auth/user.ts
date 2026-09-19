import { verifyAuth } from '../../_lib/auth';
import { errorResponse, handleOptions, jsonResponse } from '../../_lib/http';
import type { AppEnv } from '../../_lib/types';

export async function onRequest({ request, env }: { request: Request; env: AppEnv }): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions();

  const auth = await verifyAuth(request, env);
  if (!auth.authenticated || !auth.user) {
    return errorResponse('未登录或 API Key 无效 (Unauthorized)', 401);
  }

  return jsonResponse({
    ok: true,
    user: {
      id: auth.user.id,
      email: auth.user.email,
      name: auth.user.name,
      avatar: auth.user.avatar,
      role: auth.user.role,
      apiKey: auth.user.apiKey,
      expiresAt: auth.user.expiresAt,
    },
  });
}
