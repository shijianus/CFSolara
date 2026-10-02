// GET /api/sonic/lyrics/[platform]
// Dynamic platform router
import { handleSingleProviderLyricsRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({
  request,
  params,
  env,
  waitUntil,
}: {
  request: Request;
  params: { platform: string };
  env: any;
  waitUntil?: (promise: Promise<any>) => void;
}): Promise<Response> {
  const platform = params?.platform || '';
  return handleSingleProviderLyricsRequest(platform, request, env, waitUntil);
}
