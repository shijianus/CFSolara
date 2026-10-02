// GET /api/sonic/lyrics/apple
// Optional adapter — returns 501 when no credentials configured
import { handleSingleProviderLyricsRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  return handleSingleProviderLyricsRequest('apple', request, env, waitUntil);
}
