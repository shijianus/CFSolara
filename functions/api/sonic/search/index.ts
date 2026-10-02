// GET /api/sonic/search
// Forward to /api/sonic/search/nexus
import { handleNexusSearchRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  return handleNexusSearchRequest(request, env, waitUntil);
}
