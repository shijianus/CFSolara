// GET /api/sonic/search/[platform]
// Dynamic platform search router
import { handleSingleProviderSearchRequest } from '../../../_lib/sonic/route-helpers';
import { onRequest as handleSmartSearch } from './smart';

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
  if (platform.toLowerCase() === 'smart') {
    return handleSmartSearch({ request, env, waitUntil });
  }
  return handleSingleProviderSearchRequest(platform, request, env, waitUntil);
}
