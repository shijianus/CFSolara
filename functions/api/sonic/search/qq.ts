// GET /api/sonic/search/qq
import { handleSingleProviderSearchRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  return handleSingleProviderSearchRequest('qq', request, env, waitUntil);
}
