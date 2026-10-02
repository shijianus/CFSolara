// GET /api/sonic/lyrics/kugou
import { handleSingleProviderLyricsRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  return handleSingleProviderLyricsRequest('kugou', request, env, waitUntil);
}
