// GET /api/sonic/lyrics/ytmusic
// Optional adapter — returns 501 when no credentials configured
import { handleSingleProviderLyricsRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  return handleSingleProviderLyricsRequest('ytmusic', request, env, waitUntil);
}
