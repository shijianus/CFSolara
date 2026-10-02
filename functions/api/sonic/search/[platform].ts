// GET /api/sonic/search/[platform]
// Dynamic platform search router
import { handleSingleProviderSearchRequest } from '../../../_lib/sonic/route-helpers';

export async function onRequest({
  request,
  params,
  env,
  waitUntil,
}: {
  request: Request;
  params: { platform: string };
  env: any;
  waitUntil?: (promise: Promise<any>) => void;
}): Promise<Response> {
  const platform = params?.platform || '';
  return handleSingleProviderSearchRequest(platform, request, env, waitUntil);
}
