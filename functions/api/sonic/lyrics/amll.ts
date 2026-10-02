// GET /api/sonic/lyrics/amll
import { handleSingleProviderLyricsRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  return handleSingleProviderLyricsRequest('amll', request, env, waitUntil);
}
