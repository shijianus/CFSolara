// Comprehensive Test Suite for Sonic Linux Local Engine, Provenance, Auth, Rate-Limiting & Degradation State Machine
import http from 'node:http';
import crypto from 'node:crypto';
import {
  md5Hex,
  aes128EcbEncryptHex,
  buildNeteaseLinuxApiParams,
  buildNeteaseEapiParams,
} from '../functions/_lib/sonic/crypto';
import { getSonicConfig } from '../functions/_lib/sonic/config';
import {
  checkEngineAccess,
  evaluateGatewayRateLimit,
  resetRateLimitsForTest,
  isBlockedSsrfHost,
} from '../functions/_lib/sonic/security';
import { resetLocalEngineCircuitForTest, getLocalEngineCircuitSnapshot } from '../functions/_lib/sonic/local-engine';
import { clearSonicMemoryCacheForTest } from '../functions/_lib/sonic/cache';
import {
  handleNexusSearchRequest,
  handleSingleProviderSearchRequest,
  handleSingleProviderLyricsRequest,
} from '../functions/_lib/sonic/route-helpers';
import { handleNexusLyricsRequest } from '../functions/api/sonic/lyrics/nexus';
import { onRequest as handleEngineHealth } from '../functions/api/sonic/engine/health';
import { onRequest as handleMusicStream } from '../functions/api/music/stream';
import { onRequest as handleApiCatchAll } from '../functions/api/[[path]]';
import { onRequest as handleSonicForward } from '../functions/api/sonic/forward';
import { createSession } from '../functions/_lib/auth';
import { createSonicServer } from '../server/index';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('=== Running Sonic Local Engine, Security & Degradation Test Suite ===\n');

  // 1. Pure-TS Crypto Parity (Shared across Linux Node 22 & Cloudflare Workers)
  console.log('1. Testing Pure-TS MD5 & AES-128-ECB Crypto Parity');
  {
    for (const sample of ['', 'abc', 'nobody/api/song/enhance/player/url/v1use{}d5126', '起风了 - 买辣椒也用券']) {
      const expected = crypto.createHash('md5').update(sample, 'utf8').digest('hex');
      const actual = md5Hex(sample);
      assert(actual === expected, `MD5 matches node:crypto for "${sample.slice(0, 24)}"`);
    }

    const key = 'rFgB&h#%2?^eDg:Q';
    const payload = JSON.stringify({ method: 'POST', url: 'http://music.163.com/api/cloudsearch/pc', params: { s: '晴天' } });
    const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
    const nodeHex = (c.update(payload, 'utf8', 'hex') + c.final('hex')).toUpperCase();
    assert(aes128EcbEncryptHex(payload, key) === nodeHex, 'AES-128-ECB matches node:crypto byte-for-byte');
    assert(buildNeteaseLinuxApiParams(JSON.parse(payload)) === nodeHex, 'buildNeteaseLinuxApiParams matches');
    assert(buildNeteaseEapiParams('/api/song/enhance/player/url/v1', { ids: '[1330348068]' }).length >= 64, 'buildNeteaseEapiParams generates encrypted hex');
  }

  // 2. Condition 1b: Default Config & Honest meta.attempts Provenance
  console.log('\n2. Testing Condition 1b (Third-Party & VIP Unblock Disabled by Default + Honest Provenance)');
  {
    const cfg = getSonicConfig({});
    assert(cfg.enableGdstudio === false, 'SONIC_ENABLE_GDSTUDIO defaults to false');
    assert(cfg.enableLyriva === false, 'SONIC_ENABLE_LYRIVA defaults to false');
    assert(cfg.enableUnblock === false, 'SONIC_ENABLE_UNBLOCK defaults to false');

    const gdRes = await handleSingleProviderSearchRequest(
      'gdstudio',
      new Request('http://localhost/api/sonic/search/gdstudio?q=test&nocache=1'),
      {},
    );
    const gdJson = await gdRes.json();
    assert(gdJson.meta.disabled === true, 'Single gdstudio search reports meta.disabled=true');
    assert(gdJson.meta.attempts[0]?.via === 'third-party' && gdJson.meta.attempts[0]?.ok === false, 'gdstudio attempt honestly marked via=third-party, ok=false');

    const lyRes = await handleSingleProviderLyricsRequest(
      'lyriva',
      new Request('http://localhost/api/sonic/lyrics/lyriva?title=test&nocache=1'),
      {},
    );
    const lyJson = await lyRes.json();
    assert(lyJson.meta.disabled === true, 'Single lyriva lyrics reports meta.disabled=true');
    assert(lyJson.meta.attempts[0]?.via === 'third-party' && lyJson.meta.attempts[0]?.ok === false, 'lyriva attempt honestly marked via=third-party, ok=false');
  }

  // 3. Condition 2c & Hard Problem 5: Engine Authentication & SSRF Guard
  console.log('\n3. Testing Condition 2c (Mandatory X-Sonic-Engine-Key on engine-sonic.*)');
  {
    const engineEnv = { SONIC_ENGINE_SECRET: 'test_super_secret_engine_key_999', SONIC_RUNTIME: 'linux-engine' };

    // Anonymous access to engine-sonic.epocanvas.tech MUST fail 401
    const anonReq = new Request('https://engine-sonic.epocanvas.tech/api/sonic/engine/health');
    const anonRes = await handleEngineHealth({ request: anonReq, env: engineEnv });
    assert(anonRes.status === 401, `Anonymous access to engine-sonic returns 401 (got ${anonRes.status})`);
    const anonJson = await anonRes.json();
    assert(anonJson.error?.code === 'ENGINE_UNAUTHORIZED', `Error code is ENGINE_UNAUTHORIZED`);

    // Wrong key MUST fail 401
    const wrongReq = new Request('https://engine-sonic.epocanvas.tech/api/sonic/search/nexus?q=test', {
      headers: { 'X-Sonic-Engine-Key': 'wrong_key' },
    });
    const wrongRes = await handleNexusSearchRequest(wrongReq, engineEnv);
    assert(wrongRes.status === 401, `Wrong engine key returns 401 (got ${wrongRes.status})`);

    // Missing secret on engine host MUST fail-closed 503 (never fail-open!)
    const misconfigRes = checkEngineAccess(new Request('https://engine-sonic.epocanvas.tech/api'), {});
    assert(misconfigRes && misconfigRes.status === 503, `Unconfigured secret on engine host fails closed with 503`);

    // Valid key succeeds 200
    const validReq = new Request('https://engine-sonic.epocanvas.tech/api/sonic/engine/health', {
      headers: { 'X-Sonic-Engine-Key': 'test_super_secret_engine_key_999' },
    });
    const validRes = await handleEngineHealth({ request: validReq, env: engineEnv });
    assert(validRes.status === 200, `Valid X-Sonic-Engine-Key returns 200 (got ${validRes.status})`);
    const validJson = await validRes.json();
    assert(validJson.ok === true && validJson.runtime === 'linux-engine', 'Engine health payload ok=true & runtime=linux-engine');

    // SSRF guard blocks loopback, RFC1918, cloud metadata, and engine-sonic
    assert(isBlockedSsrfHost('127.0.0.1') === true, 'SSRF blocks 127.0.0.1');
    assert(isBlockedSsrfHost('169.254.169.254') === true, 'SSRF blocks cloud metadata IP 169.254.169.254');
    assert(isBlockedSsrfHost('172.18.0.2') === true, 'SSRF blocks Docker internal bridge 172.18.0.2');
    assert(isBlockedSsrfHost('engine-sonic.epocanvas.tech') === true, 'SSRF blocks engine-sonic loop');
    assert(isBlockedSsrfHost('m701.music.126.net') === false, 'SSRF allows public music CDN');

    const ssrfRes = await handleSonicForward({
      request: new Request('http://localhost/api/sonic/forward?url=http://127.0.0.1:8080/api'),
      env: {},
    });
    assert(ssrfRes.status === 400, `Forwarding to 127.0.0.1 rejected with 400 (got ${ssrfRes.status})`);
  }

  // 4. Hard Problem 5: Sliding-Window Tiered Rate Limiter
  console.log('\n4. Testing Tiered Rate Limiter (Anonymous vs API Key)');
  {
    resetRateLimitsForTest();
    const rlEnv = {
      SONIC_RATE_LIMIT_ANON_RPM: '10',
      SONIC_RATE_LIMIT_AUTH_RPM: '50',
      SONIC_JWT_SECRET: 'test_jwt_secret_for_rate_limit',
      SONIC_SECRET: 'test_signing_secret_for_rate_limit',
    };

    let lastDecision = null;
    for (let i = 0; i < 11; i++) {
      lastDecision = await evaluateGatewayRateLimit(
        new Request('https://sonic.epocanvas.tech/api/sonic/search/nexus?q=a', {
          headers: { 'CF-Connecting-IP': '203.0.113.42' },
        }),
        rlEnv,
        'rl-test',
      );
    }
    assert(
      lastDecision.allowed === false && lastDecision.tier === 'anonymous',
      `Anonymous burst > limit is rate-limited (got allowed=${lastDecision?.allowed}, tier=${lastDecision?.tier}, limit=${lastDecision?.limit})`,
    );

    // Same IP with valid sonic_live_ API Key gets elevated api-key bucket
    const session = await createSession(rlEnv, { id: 'u1', email: 'tester@epocanvas.com', name: 'Tester', avatar: '' });
    const authDecision = await evaluateGatewayRateLimit(
      new Request('https://sonic.epocanvas.tech/api/sonic/search/nexus?q=a', {
        headers: {
          'CF-Connecting-IP': '203.0.113.42',
          'X-Sonic-Key': session.apiKey,
        },
      }),
      rlEnv,
      'rl-test',
    );
    assert(authDecision.allowed === true && authDecision.tier === 'api-key', 'Valid sonic_live_ API Key upgrades to api-key tier');
    resetRateLimitsForTest();
  }

  // 5. Hard Problem 3: Pages -> Engine RPC + 3-State Circuit Breaker + Stale Cache + Explicit 503 Stream Degradation
  console.log('\n5. Testing Degradation State Machine (CLOSED -> 530 OPEN -> Fast-Fail -> HALF_OPEN -> CLOSED)');
  {
    resetLocalEngineCircuitForTest();
    clearSonicMemoryCacheForTest();

    let engineMode = 'healthy'; // 'healthy' | 'tunnel-530'
    let engineHits = 0;
    const secret = 'mock_engine_secret_abc';

    const mockServer = http.createServer((req, res) => {
      engineHits++;
      if (req.headers['x-sonic-engine-key'] !== secret) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'ENGINE_UNAUTHORIZED' } }));
        return;
      }
      if (engineMode === 'tunnel-530') {
        res.writeHead(530, { 'Content-Type': 'text/plain' });
        res.end('Cloudflare Tunnel error 1033');
        return;
      }
      if (req.url?.startsWith('/api/sonic/search/nexus')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            brand: 'Sonic',
            data: {
              query: '起风了',
              page: 1,
              count: 1,
              total: 1,
              tracks: [
                {
                  id: '1330348068',
                  title: '起风了',
                  name: '起风了',
                  artist: '买辣椒也用券',
                  album: '起风了',
                  duration: 325,
                  cover: 'https://p2.music.126.net/test.jpg',
                  coverUrl: 'https://p2.music.126.net/test.jpg',
                  platform: 'sonic',
                  platformId: '1330348068',
                  sources: [{ platform: 'netease', platformId: '1330348068', duration: 325 }],
                },
              ],
            },
            meta: {
              attempts: [{ provider: 'local-netease', via: 'local-engine', source: 'local-engine', ok: true, ms: 42 }],
            },
          }),
        );
        return;
      }
      if (req.url?.startsWith('/api/sonic/resolve/stream')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'STREAM_NOT_AVAILABLE' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const port = mockServer.address().port;
    const cfEnv = {
      SONIC_RUNTIME: 'cf-pages',
      SONIC_LOCAL_ENGINE_URL: `http://127.0.0.1:${port}`,
      SONIC_ENGINE_SECRET: secret,
      SONIC_CB_COOLDOWN_MS: '150',
      SONIC_ENABLE_NETEASE: '0',
      SONIC_ENABLE_QQ: '0',
      SONIC_ENABLE_KUGOU: '0',
    };

    try {
      // Step 5a: Healthy local engine -> CLOSED, populates cache, records local-engine + local-netease
      const res1 = await handleNexusSearchRequest(
        new Request('https://sonic.epocanvas.tech/api/sonic/search/nexus?q=%E8%B5%B7%E9%A3%8E%E4%BA%86'),
        cfEnv,
      );
      const json1 = await res1.json();
      assert(res1.status === 200, 'Healthy engine search returns 200');
      assert(res1.headers.get('X-Sonic-Degraded') === null, 'Healthy response has no X-Sonic-Degraded header');
      assert(json1.meta.attempts[0]?.provider === 'local-engine' && json1.meta.attempts[0]?.ok === true, 'Primary attempt is local-engine ok=true');
      assert(json1.meta.attempts.some((a) => a.provider === 'local-netease' && a.via === 'local-engine'), 'Engine sub-attempt preserves local-netease provenance');

      // Step 5b: Simulate Cloudflare Tunnel 530 outage -> instant circuit OPEN
      engineMode = 'tunnel-530';
      const hitsBeforeOutage = engineHits;
      const res2 = await handleNexusSearchRequest(
        new Request('https://sonic.epocanvas.tech/api/sonic/search/nexus?q=%E8%B5%B7%E9%A3%8E%E4%BA%86&nocache=1'),
        cfEnv,
      );
      const json2 = await res2.json();
      assert(getLocalEngineCircuitSnapshot(cfEnv).state === 'OPEN', '530 Tunnel error trips circuit breaker immediately to OPEN');
      assert(res2.headers.get('X-Sonic-Degraded') === '1', 'Outage response sets X-Sonic-Degraded: 1');
      assert(json2.meta.degraded === true, 'Outage response sets meta.degraded=true');

      // Step 5c: Next request while OPEN fast-fails (0 engine hits!) and serves stale cache if nocache=1 is NOT set (or fast-fails in 0ms)
      const hitsWhileOpen = engineHits;
      const res3 = await handleNexusSearchRequest(
        new Request('https://sonic.epocanvas.tech/api/sonic/search/nexus?q=unseen_song&nocache=1'),
        cfEnv,
      );
      const json3 = await res3.json();
      assert(engineHits === hitsWhileOpen, 'OPEN circuit fast-fails without hitting dead tunnel');
      assert(String(json3.meta.attempts[0]?.error || '').includes('Circuit OPEN'), 'Fast-fail recorded in meta.attempts');

      // Step 5c-bis: Stale cache fallback serves previously cached "起风了" while circuit is OPEN!
      const staleEnv = { ...cfEnv, SONIC_CACHE_SEARCH_TTL_SEC: '0' };
      const resStale = await handleNexusSearchRequest(
        new Request('https://sonic.epocanvas.tech/api/sonic/search/nexus?q=%E8%B5%B7%E9%A3%8E%E4%BA%86'),
        cfEnv,
      );
      const jsonStale = await resStale.json();
      assert(resStale.status === 200 && jsonStale.data.tracks.length === 1, 'Cached search result served immediately during outage');

      // Step 5d: Stream endpoint returns explicit 503 STREAM_UNAVAILABLE_DEGRADED when engine is down & CF cannot resolve
      const streamRes = await handleMusicStream({
        request: new Request('https://sonic.epocanvas.tech/api/music/stream?id=999999999999&source=kuwo'),
        env: cfEnv,
      });
      const streamJson = await streamRes.json();
      assert(streamRes.status === 503, `Degraded unresolvable stream returns 503 (got ${streamRes.status})`);
      assert(streamRes.headers.get('X-Sonic-Degraded') === '1', 'Degraded 503 stream sets X-Sonic-Degraded: 1');
      assert(streamJson.error?.code === 'STREAM_UNAVAILABLE_DEGRADED', 'Degraded stream returns machine-readable STREAM_UNAVAILABLE_DEGRADED');

      // Step 5e: Cooldown elapses -> HALF_OPEN probe -> recovers to CLOSED
      await new Promise((r) => setTimeout(r, 180));
      engineMode = 'healthy';
      const resRecover = await handleNexusSearchRequest(
        new Request('https://sonic.epocanvas.tech/api/sonic/search/nexus?q=%E8%B5%B7%E9%A3%8E%E4%BA%86&nocache=1'),
        cfEnv,
      );
      const jsonRecover = await resRecover.json();
      assert(getLocalEngineCircuitSnapshot(cfEnv).state === 'CLOSED', 'Circuit recovers HALF_OPEN -> CLOSED after healthy probe');
      assert(jsonRecover.meta.degraded === false, 'Recovered response clears degraded=false');
    } finally {
      await new Promise((resolve) => mockServer.close(resolve));
      resetLocalEngineCircuitForTest();
    }
  }

  // 6. Discrepancy 5 Fix: GET /api empty-path catch-all returns 200 index
  console.log('\n6. Testing GET /api Empty-Path Index & login/status Compatibility');
  {
    const idxRes = await handleApiCatchAll({
      request: new Request('https://sonic.epocanvas.tech/api'),
      params: { path: [] },
      env: {},
    });
    const idxJson = await idxRes.json();
    assert(idxRes.status === 200 && idxJson.brand === 'Sonic' && idxJson?.branding?.wireBrand === 'Sonic', 'GET /api returns 200 Sonic index');

    const loginStatusRes = await handleApiCatchAll({
      request: new Request('https://sonic.epocanvas.tech/api/login/status'),
      params: { path: ['login', 'status'] },
      env: {},
    });
    const loginStatusJson = await loginStatusRes.json();
    assert(loginStatusRes.status === 200 && loginStatusJson?.data?.code === 200, 'GET /api/login/status returns clean guest session');
  }

  // 7. Linux Node 22 HTTP Server (`server/index.ts`) End-to-End Verification
  console.log('\n7. Testing Linux Node 22 HTTP Server (createSonicServer)');
  {
    const prevSecret = process.env.SONIC_ENGINE_SECRET;
    process.env.SONIC_ENGINE_SECRET = 'node_server_test_secret_777';
    const srv = createSonicServer();
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const port = srv.address().port;

    try {
      // Anonymous request with Host: engine-sonic.epocanvas.tech on root `/` -> 401!
      const rAnonRoot = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { 'X-Forwarded-Host': 'engine-sonic.epocanvas.tech' },
      });
      assert(rAnonRoot.status === 401, `Anonymous root request on engine-sonic returns 401 (got ${rAnonRoot.status})`);

      // Authenticated request on `/api/sonic/engine/health` -> 200!
      const rAuthHealth = await fetch(`http://127.0.0.1:${port}/api/sonic/engine/health`, {
        headers: {
          'X-Forwarded-Host': 'engine-sonic.epocanvas.tech',
          'X-Sonic-Engine-Key': 'node_server_test_secret_777',
        },
      });
      const jAuthHealth = await rAuthHealth.json();
      assert(rAuthHealth.status === 200 && jAuthHealth.ok === true, 'Authenticated engine health over HTTP returns 200');
    } finally {
      if (prevSecret === undefined) delete process.env.SONIC_ENGINE_SECRET;
      else process.env.SONIC_ENGINE_SECRET = prevSecret;
      await new Promise((resolve) => srv.close(resolve));
    }
  }

  console.log(`\n========================================`);
  console.log(`Local Engine & Degradation Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
