// GET /api/sonic/lyrics/lyriva
// Brand: Sonic (Lyriva Synchronized Lyrics Provider)
import { handleSingleProviderLyricsRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  return handleSingleProviderLyricsRequest('lyriva', request, env, waitUntil);
}
