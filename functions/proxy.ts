import { getUniversalLyrics, searchTracks } from "./_lib/music";
import { getSonicConfig } from "./_lib/sonic/config";
import {
  buildRateLimitErrorResponse,
  checkEngineAccess,
  evaluateGatewayRateLimit,
  fetchWithRedirectGuard,
} from "./_lib/sonic/security";
import type { AppEnv } from "./_lib/types";

const KUWO_HOST_PATTERN = /(^|\.)kuwo\.cn$/i;
const SAFE_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "accept-ranges",
  "content-length",
  "content-range",
  "etag",
  "last-modified",
  "expires",
];

function createCorsHeaders(init?: Headers): Headers {
  const headers = new Headers();
  if (init) {
    for (const [key, value] of init.entries()) {
      if (SAFE_RESPONSE_HEADERS.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
  }
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function isAllowedKuwoHost(hostname: string): boolean {
  if (!hostname) return false;
  return KUWO_HOST_PATTERN.test(hostname);
}

function normalizeKuwoUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (!isAllowedKuwoHost(parsed.hostname)) {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.protocol = "https:";
    return parsed;
  } catch {
    return null;
  }
}

async function proxyKuwoAudio(targetUrl: string, request: Request): Promise<Response> {
  const normalized = normalizeKuwoUrl(targetUrl);
  if (!normalized) {
    return new Response("Invalid target", { status: 400 });
  }

  const init: RequestInit = {
    method: request.method,
    headers: {
      "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
      Referer: "https://www.kuwo.cn/",
    },
  };

  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    (init.headers as Record<string, string>)["Range"] = rangeHeader;
  }

  // Per-hop re-validation: a kuwo.cn URL that 302s elsewhere is not followed.
  const upstream = await fetchWithRedirectGuard(normalized.toString(), init, (u) => isAllowedKuwoHost(u.hostname));
  const headers = createCorsHeaders(upstream.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=3600");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function proxyApiRequest(url: URL, request: Request, env?: AppEnv): Promise<Response> {
  const types = (url.searchParams.get("types") || "").toLowerCase().trim();
  if (!types) {
    return new Response("Missing types", { status: 400, headers: createCorsHeaders() });
  }

  const headers = createCorsHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");

  const rawSource = (url.searchParams.get("source") || "netease").toLowerCase().trim();
  const rawId = (url.searchParams.get("id") || "").replace(/^[a-z0-9_-]+:/i, "").trim();

  // 1. Native local-first handlers (zero third-party free aggregation dependency)
  if (types === "search") {
    const keyword = (url.searchParams.get("name") || url.searchParams.get("q") || "").trim();
    const count = Math.min(50, Math.max(1, parseInt(url.searchParams.get("count") || "20", 10) || 20));
    const page = Math.max(1, parseInt(url.searchParams.get("pages") || url.searchParams.get("page") || "1", 10) || 1);
    if (!keyword) {
      return new Response(JSON.stringify([]), { status: 200, headers });
    }
    const tracks = await searchTracks(env || {}, keyword, rawSource, count, page);
    if (tracks.length > 0 || !getSonicConfig(env).enableGdstudio) {
      const legacyItems = tracks.map((t) => ({
        id: t.id,
        name: t.name,
        artist: [t.artist],
        album: t.album,
        pic_id: t.picId || t.id,
        url_id: t.urlId || t.id,
        lyric_id: t.lyricId || t.id,
        source: t.source,
      }));
      return new Response(JSON.stringify(legacyItems), { status: 200, headers });
    }
  } else if (types === "url") {
    if (!rawId) {
      return new Response(JSON.stringify({ url: "", br: 0 }), { status: 200, headers });
    }
    const br = parseInt(url.searchParams.get("br") || "320", 10) || 320;
    const quality = br >= 740 ? "flac" : br >= 320 ? "320" : br >= 192 ? "192" : "128";
    if (!getSonicConfig(env).enableGdstudio) {
      return new Response(
        JSON.stringify({
          url: `/api/music/stream?id=${encodeURIComponent(rawId)}&source=${encodeURIComponent(rawSource)}&quality=${quality}`,
          br,
          source: "local",
        }),
        { status: 200, headers },
      );
    }
  } else if (types === "pic") {
    if (!getSonicConfig(env).enableGdstudio) {
      return new Response(
        JSON.stringify({
          url: rawId ? `/api/music/cover?id=${encodeURIComponent(rawId)}&source=${encodeURIComponent(rawSource)}` : "",
        }),
        { status: 200, headers },
      );
    }
  } else if (types === "lyric") {
    const lyr = await getUniversalLyrics(env || {}, { id: rawId, source: rawSource });
    if (lyr.rawLyric || !getSonicConfig(env).enableGdstudio) {
      return new Response(
        JSON.stringify({
          lyric: lyr.rawLyric || "",
          tlyric: "",
        }),
        { status: 200, headers },
      );
    }
  }

  // 2. Optional third-party GDStudio fallback (ONLY when SONIC_ENABLE_GDSTUDIO=1)
  const cfg = getSonicConfig(env);
  if (!cfg.enableGdstudio) {
    return new Response(
      JSON.stringify({
        error: "Third-party proxy disabled by default (SONIC_ENABLE_GDSTUDIO=false)",
      }),
      { status: 501, headers },
    );
  }

  const apiUrl = new URL(cfg.upstreamGdstudio);
  url.searchParams.forEach((value, key) => {
    if (key === "target" || key === "callback") return;
    apiUrl.searchParams.set(key, value);
  });

  try {
    const upstreamResponse = await fetch(apiUrl.toString(), {
      headers: {
        "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
        Accept: "application/json",
      },
    });
    const outHeaders = createCorsHeaders(upstreamResponse.headers);
    if (!outHeaders.has("Content-Type")) {
      outHeaders.set("Content-Type", "application/json; charset=utf-8");
    }
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: outHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ error: "Upstream fetch failed" }), {
      status: 502,
      headers,
    });
  }
}

export async function onRequest({ request, env }: { request: Request; env?: AppEnv }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const engineDenied = checkEngineAccess(request, env);
  if (engineDenied) return engineDenied;
  const rl = await evaluateGatewayRateLimit(request, env, "legacy-proxy");
  if (!rl.allowed) return buildRateLimitErrorResponse(rl);

  const url = new URL(request.url);
  const target = url.searchParams.get("target");

  if (target) {
    return proxyKuwoAudio(target, request);
  }

  return proxyApiRequest(url, request, env);
}
