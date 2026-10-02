// GET /api/sonic/search/gdstudio
import { handleSingleProviderSearchRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  return handleSingleProviderSearchRequest('gdstudio', request, env, waitUntil);
}
