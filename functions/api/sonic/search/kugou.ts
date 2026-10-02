// GET /api/sonic/search/kugou
import { handleSingleProviderSearchRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  return handleSingleProviderSearchRequest('kugou', request, env, waitUntil);
}
