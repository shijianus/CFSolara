// GET /api/sonic/search/netease
import { handleSingleProviderSearchRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  return handleSingleProviderSearchRequest('netease', request, env, waitUntil);
}
