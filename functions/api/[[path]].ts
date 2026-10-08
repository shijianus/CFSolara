// GET /api/[[path]]
// Catch-all route for commercial music features: home, banner, playlists, charts, artists, MVs, comments
import { handleUpstreamEndpoint } from '../_lib/sonic/upstream';

export async function onRequest({ request, params }: any): Promise<Response> {
  const url = new URL(request.url);
  const pathArr = params.path;
  const endpoint = Array.isArray(pathArr) ? pathArr.join('/') : (pathArr || '');

  return handleUpstreamEndpoint(endpoint, url, request);
}
