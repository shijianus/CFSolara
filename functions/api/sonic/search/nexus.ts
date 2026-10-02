// GET /api/sonic/search/nexus
// Multi-source parallel search with timeout isolation, deduplication and merging
import { handleNexusSearchRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({ request, env, waitUntil }: any): Promise<Response> {
  return handleNexusSearchRequest(request, env, waitUntil);
}
