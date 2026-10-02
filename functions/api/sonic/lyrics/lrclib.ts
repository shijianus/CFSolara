// GET /api/sonic/lyrics/lrclib
import { handleSingleProviderLyricsRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  return handleSingleProviderLyricsRequest('lrclib', request, env, waitUntil);
}
