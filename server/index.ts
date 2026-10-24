// Sonic Local Engine — Linux Node.js 22 HTTP Server
// Shares 100% of protocol, lyrics (KRC/QRC/YRC/TTML), cover, palette, auth & security logic with Cloudflare Pages `functions/`.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import type { AppEnv } from '../functions/_lib/types';
import { checkEngineAccess } from '../functions/_lib/sonic/security';
import { handleOptions } from '../functions/_lib/http';

// Route handlers shared directly from `functions/`
import { onRequest as handleProxy } from '../functions/proxy';
import { onRequest as handlePalette } from '../functions/palette';
import { onRequest as handleApiIndex } from '../functions/api/index';
import { onRequest as handleApiCatchAll } from '../functions/api/[[path]]';
import { onRequest as handleAuthLogin } from '../functions/api/auth/login';
import { onRequest as handleAuthCallback } from '../functions/api/auth/callback';
import { onRequest as handleAuthKey } from '../functions/api/auth/key';
import { onRequest as handleAuthUser } from '../functions/api/auth/user';
import { onRequest as handleMusicCover } from '../functions/api/music/cover';
import { onRequest as handleMusicLyric } from '../functions/api/music/lyric';
import { onRequest as handleMusicRandom } from '../functions/api/music/random';
import { onRequest as handleMusicSearch } from '../functions/api/music/search';
import { onRequest as handleMusicStream } from '../functions/api/music/stream';
import { onRequest as handleEngineHealth } from '../functions/api/sonic/engine/health';
import { onRequest as handleResolveStream } from '../functions/api/sonic/resolve/stream';
import { onRequest as handleSonicForward } from '../functions/api/sonic/forward';
import { onRequest as handleSonicSearchNexus } from '../functions/api/sonic/search/nexus';
import { onRequest as handleSonicSearchPlatform } from '../functions/api/sonic/search/[platform]';
import { onRequest as handleSonicLyricsNexus } from '../functions/api/sonic/lyrics/nexus';
import { onRequest as handleSonicLyricsSync } from '../functions/api/sonic/lyrics/sync';
import { onRequest as handleSonicLyricsPlatform } from '../functions/api/sonic/lyrics/[platform]';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function buildRuntimeEnv(): AppEnv {
  const env: Record<string, any> = { ...process.env };
  if (!env.SONIC_RUNTIME) {
    env.SONIC_RUNTIME = 'linux-engine';
  }
  return env as AppEnv;
}

function toWebRequest(req: http.IncomingMessage): Request {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:8080';
  const fullUrl = `${proto}://${host}${req.url || '/'}`;

  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      for (const v of val) headers.append(key, v);
    } else {
      headers.set(key, val);
    }
  }

  const method = (req.method || 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  return new Request(fullUrl, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as any) : undefined,
    duplex: hasBody ? 'half' : undefined,
  } as RequestInit);
}

async function sendWebResponse(res: http.ServerResponse, webResp: Response, isHead: boolean): Promise<void> {
  const outHeaders: Record<string, string | string[]> = {};
  webResp.headers.forEach((value, key) => {
    outHeaders[key] = value;
  });

  res.writeHead(webResp.status, webResp.statusText || undefined, outHeaders);

  if (isHead || !webResp.body) {
    if (webResp.body) {
      webResp.body.cancel().catch(() => {});
    }
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(webResp.body as any);
  res.on('close', () => {
    if (!nodeStream.destroyed) {
      nodeStream.destroy();
    }
  });
  nodeStream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502);
    }
    res.end();
  });
  nodeStream.pipe(res);
}

async function dispatchFunctionRoute(request: Request, env: AppEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const waitUntil = (p: Promise<any>) => {
    p.catch(() => {});
  };

  if (pathname === '/proxy') {
    return handleProxy({ request, env });
  }
  if (pathname === '/palette' || pathname === '/api/music/palette') {
    return handlePalette({ request, env });
  }

  if (pathname === '/api') {
    return handleApiIndex({ request, env });
  }

  // Auth routes
  if (pathname === '/api/auth/login') return handleAuthLogin({ request, env });
  if (pathname === '/api/auth/callback') return handleAuthCallback({ request, env });
  if (pathname === '/api/auth/key') return handleAuthKey({ request, env });
  if (pathname === '/api/auth/user') return handleAuthUser({ request, env });

  // Music routes & aliases
  if (pathname === '/api/cover' || pathname === '/api/music/cover') {
    return handleMusicCover({ request, env });
  }
  if (
    pathname === '/api/lyric' ||
    pathname === '/api/lyrics' ||
    pathname === '/api/music/lyric' ||
    pathname === '/api/music/lyrics'
  ) {
    return handleMusicLyric({ request, env, waitUntil });
  }
  if (pathname === '/api/music/random') return handleMusicRandom({ request, env });
  if (pathname === '/api/music/search') return handleMusicSearch({ request, env });
  if (pathname === '/api/music/stream') return handleMusicStream({ request, env });

  // Sonic Gateway & Engine routes
  if (pathname === '/api/sonic/engine/health') return handleEngineHealth({ request, env });
  if (pathname === '/api/sonic/resolve/stream') return handleResolveStream({ request, env });
  if (pathname === '/api/sonic/forward') return handleSonicForward({ request, env, waitUntil });

  if (pathname === '/api/sonic/search' || pathname === '/api/sonic/search/nexus') {
    return handleSonicSearchNexus({ request, env, waitUntil });
  }
  if (pathname.startsWith('/api/sonic/search/')) {
    const platform = decodeURIComponent(pathname.slice('/api/sonic/search/'.length));
    return handleSonicSearchPlatform({ request, params: { platform }, env, waitUntil });
  }

  if (pathname === '/api/sonic/lyrics' || pathname === '/api/sonic/lyrics/nexus') {
    return handleSonicLyricsNexus({ request, env, waitUntil });
  }
  if (pathname === '/api/sonic/lyrics/sync') {
    return handleSonicLyricsSync({ request, env, waitUntil });
  }
  if (pathname.startsWith('/api/sonic/lyrics/')) {
    const platform = decodeURIComponent(pathname.slice('/api/sonic/lyrics/'.length));
    return handleSonicLyricsPlatform({ request, params: { platform }, env, waitUntil });
  }

  // Catch-all `/api/*` commercial endpoints (banners, playlists, charts, artists, MVs, comments)
  if (pathname.startsWith('/api/')) {
    const segments = pathname
      .slice('/api/'.length)
      .split('/')
      .filter(Boolean)
      .map((s) => decodeURIComponent(s));
    return handleApiCatchAll({ request, params: { path: segments }, env });
  }

  return null;
}

async function serveStaticAsset(staticRoot: string, pathname: string, isHead: boolean): Promise<Response> {
  const safeRel = path.posix.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\/+/, '');
  let candidate = path.join(staticRoot, safeRel || 'index.html');

  try {
    const stat = await fsp.stat(candidate);
    if (stat.isDirectory()) {
      candidate = path.join(candidate, 'index.html');
    }
  } catch {
    // SPA fallback for client-side routes (only when not requesting a missing asset file with extension)
    const ext = path.extname(safeRel);
    if (!ext || ext === '.html') {
      candidate = path.join(staticRoot, 'index.html');
    } else {
      return new Response('Not Found', { status: 404 });
    }
  }

  try {
    const stat = await fsp.stat(candidate);
    if (!stat.isFile()) {
      return new Response('Not Found', { status: 404 });
    }
    const ext = path.extname(candidate).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isImmutable = pathname.startsWith('/assets/');
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Cache-Control': isImmutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    };
    if (isHead) {
      return new Response(null, { status: 200, headers });
    }
    const stream = fs.createReadStream(candidate);
    return new Response(Readable.toWeb(stream) as any, { status: 200, headers });
  } catch {
    return new Response('Sonic Local Engine is running (static dist not mounted)', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

export function createSonicServer(staticRoot = path.resolve(process.cwd(), 'dist')) {
  return http.createServer(async (req, res) => {
    try {
      const webReq = toWebRequest(req);
      const env = buildRuntimeEnv();

      if (webReq.method === 'OPTIONS') {
        await sendWebResponse(res, handleOptions(), false);
        return;
      }

      // Mandatory top-level authentication gate on `engine-sonic.*` and internal engine paths (Condition 2c)
      const engineDenied = checkEngineAccess(webReq, env);
      if (engineDenied) {
        await sendWebResponse(res, engineDenied, webReq.method === 'HEAD');
        return;
      }

      const apiResp = await dispatchFunctionRoute(webReq, env);
      if (apiResp) {
        await sendWebResponse(res, apiResp, webReq.method === 'HEAD');
        return;
      }

      const url = new URL(webReq.url);
      const staticResp = await serveStaticAsset(staticRoot, url.pathname, webReq.method === 'HEAD');
      await sendWebResponse(res, staticResp, webReq.method === 'HEAD');
    } catch (err: any) {
      console.error('[Sonic Engine Unhandled Error]', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            brand: 'Sonic',
            error: { code: 'INTERNAL_ENGINE_ERROR', message: err?.message || 'Internal engine error' },
          }),
        );
      } else {
        res.end();
      }
    }
  });
}

// Start server when executed as main entrypoint
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('server/index.ts') ||
    process.argv[1].endsWith('dist-server/index.mjs') ||
    process.argv[1].endsWith('index.mjs'));

if (isMain) {
  const port = parseInt(process.env.PORT || '8080', 10) || 8080;
  const host = process.env.HOST || '0.0.0.0';
  const staticDir = process.env.SONIC_STATIC_DIR || path.resolve(process.cwd(), 'dist');
  const server = createSonicServer(staticDir);

  server.listen(port, host, () => {
    console.log(
      `[Sonic Local Engine] Listening on http://${host}:${port} (runtime=${process.env.SONIC_RUNTIME || 'linux-engine'}, ncmApi=${process.env.SONIC_NCM_API_URL || 'none'})`,
    );
  });

  const shutdown = (sig: string) => {
    console.log(`[Sonic Local Engine] Received ${sig}, shutting down gracefully...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
