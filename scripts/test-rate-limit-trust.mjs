// Pure unit tests for the rate-limit trust chain (no network).
// Reproduces audit finding #2: client-forgeable X-Sonic-Client-IP rotated buckets.
import {
  evaluateGatewayRateLimit,
  resetRateLimitsForTest,
  extractClientIp,
} from '../functions/_lib/sonic/security.ts';

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

const ENGINE_SECRET = 'engine_secret_for_rate_limit_trust_tests';

function req(url, headers = {}) {
  return new Request(url, { headers });
}

async function run() {
  const url = 'https://sonic.epocanvas.tech/api/sonic/search/nexus?q=test';

  // ── 1. Forged X-Sonic-Client-IP must NOT create fresh buckets ──
  console.log('\n1. Forged X-Sonic-Client-IP rotation cannot bypass the anonymous limit');
  {
    resetRateLimitsForTest();
    const env = { SONIC_RATE_LIMIT_ANON_RPM: '5' };
    let saw429 = false;
    // 12 requests each claiming a different fake IP
    for (let i = 0; i < 12; i++) {
      const r = req(url, { 'X-Sonic-Client-IP': `10.${Math.floor(i / 250)}.${i % 250}.${i % 250 + 1}` });
      const d = await evaluateGatewayRateLimit(r, env);
      if (!d.allowed) saw429 = true;
    }
    assert(saw429, 'Anonymous limit trips despite rotating forged X-Sonic-Client-IP');
  }

  // ── 2. X-Forwarded-For is not trusted ──
  console.log('\n2. X-Forwarded-For is not trusted for bucketing');
  {
    resetRateLimitsForTest();
    const env = { SONIC_RATE_LIMIT_ANON_RPM: '5' };
    let saw429 = false;
    for (let i = 0; i < 12; i++) {
      const d = await evaluateGatewayRateLimit(req(url, { 'X-Forwarded-For': `198.51.100.${i}` }), env);
      if (!d.allowed) saw429 = true;
    }
    assert(saw429, 'Rotating X-Forwarded-For does not evade the limit');
  }

  // ── 3. CF-Connecting-IP keys the anonymous bucket (legit edge behavior) ──
  console.log('\n3. CF-Connecting-IP keys the anonymous bucket');
  {
    resetRateLimitsForTest();
    const env = { SONIC_RATE_LIMIT_ANON_RPM: '5' }; // effective floor is 10 (Math.max(10, n))
    let denials = 0;
    for (let i = 0; i < 12; i++) {
      const d = await evaluateGatewayRateLimit(req(url, { 'CF-Connecting-IP': '203.0.113.7' }), env);
      if (!d.allowed) denials++;
    }
    assert(denials >= 2, 'Same terminal IP shares one bucket (trips past the limit)');
    const b1 = await evaluateGatewayRateLimit(req(url, { 'CF-Connecting-IP': '203.0.113.8' }), env);
    assert(b1.allowed, 'Different terminal IP gets its own bucket');
    assert(extractClientIp(req(url, { 'CF-Connecting-IP': '203.0.113.9', 'X-Sonic-Client-IP': '1.2.3.4' }), {}) === '203.0.113.9',
      'CF-Connecting-IP wins over unauthenticated X-Sonic-Client-IP');
  }

  // ── 4. Authenticated engine hop may forward the terminal IP ──
  console.log('\n4. Valid engine secret makes X-Sonic-Client-IP trusted');
  {
    resetRateLimitsForTest();
    const env = { SONIC_RATE_LIMIT_ANON_RPM: '5', SONIC_ENGINE_SECRET: ENGINE_SECRET };
    const engineHeaders = { 'X-Sonic-Engine-Key': ENGINE_SECRET, 'X-Sonic-Client-IP': '198.51.100.11' };
    let denials = 0;
    for (let i = 0; i < 12; i++) {
      const d = await evaluateGatewayRateLimit(req(url, engineHeaders), env);
      if (!d.allowed) denials++;
    }
    // Engine tier has a 600rpm floor, so instead of tripping it we assert bucket
    // sharing via the remaining counter: same forwarded IP drains one bucket,
    // a different forwarded IP starts from a fresh one.
    const dSame = await evaluateGatewayRateLimit(req(url, engineHeaders), env);
    const dFresh = await evaluateGatewayRateLimit(req(url, { ...engineHeaders, 'X-Sonic-Client-IP': '198.51.100.12' }), env);
    assert(dSame.remaining < dFresh.remaining, 'Engine-forwarded terminal IP shares one bucket (remaining drains within bucket)');
    assert(dFresh.remaining === dFresh.limit - 1, 'Different engine-forwarded terminal IP starts a fresh bucket');
    assert(extractClientIp(req(url, engineHeaders), env) === '198.51.100.11', 'extractClientIp honors forwarded IP for engine callers');
  }

  // ── 5. Fallback: no CF header, no engine secret → shared fixed bucket ──
  console.log('\n5. Missing terminal IP falls back to one fixed bucket');
  {
    resetRateLimitsForTest();
    const env = { SONIC_RATE_LIMIT_ANON_RPM: '5' };
    let denials = 0;
    for (let i = 0; i < 12; i++) {
      const r = req(url, i === 0 ? {} : { 'X-Sonic-Client-IP': i % 2 ? '8.8.8.8' : '9.9.9.9' });
      const d = await evaluateGatewayRateLimit(r, env);
      if (!d.allowed) denials++;
    }
    assert(denials >= 2, 'Header-only clients share the fixed fallback bucket (trips past the limit)');
    assert(extractClientIp(req(url), {}) === 'fallback:no-terminal-ip', 'extractClientIp returns the documented fallback key');
  }

  console.log(`\n========================================`);
  console.log(`Rate Limit Trust Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
