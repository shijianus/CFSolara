// GET /api/[[path]]
// Catch-all route for commercial music features: home, banner, playlists, charts, artists, MVs, comments
import { handleUpstreamEndpoint } from '../_lib/sonic/upstream';
import { onRequest as handleApiIndex } from './index';
import type { AppEnv } from '../_lib/types';

export async function onRequest(ctx: { request: Request; params: any; env: AppEnv }): Promise<Response> {
  const { request, params, env } = ctx;
  const url = new URL(request.url);
  const pathArr = params?.path;
  const endpoint = (Array.isArray(pathArr) ? pathArr.join('/') : (pathArr || '')).replace(/^\/+|\/+$/g, '');

  if (!endpoint) {
    return handleApiIndex({ request, env });
  }

  return handleUpstreamEndpoint(endpoint, url, request, env);
}
