// Pure unit tests for API key signature verification (no network).
// Reproduces audit finding #1: verifyAuth accepted forged sonic_live_ keys.
import crypto from 'node:crypto';
import {
  createSession,
  verifyAuth,
  extractAuthCredentials,
  getEpomailConfig,
  exchangeCode,
} from '../functions/_lib/auth.ts';

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

const SECRET = 'audit_fix_test_secret_0123456789abcdef';

// Mirror of the documented key format: sonic_live_<b64url(email)>_<b64url(expiresAtISO)>_<sig>
function signKey(email, expiresAtISO, secret, prefix = 'sonic_live_') {
  const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${email}|${expiresAtISO}`).digest('hex').slice(0, 32);
  return `${prefix}${b64u(email)}_${b64u(expiresAtISO)}_${sig}`;
}

async function run() {
  // ── 1. createSession requires a configured secret ──
  console.log('\n1. Key issuance refuses to run without a signing secret');
  let threwMissing = null;
  try {
    await createSession({}, { id: 'u1', email: 'a@b.test', name: 'A', avatar: '' });
  } catch (err) {
    threwMissing = err?.message || String(err);
  }
  assert(Boolean(threwMissing), `createSession without SONIC_SECRET throws (got: ${threwMissing ? threwMissing.slice(0, 60) : 'no error'})`);

  // ── 2. Valid key: issued + verified stateless (headers only) ──
  console.log('\n2. Valid key round-trips (issue → verify, stateless)');
  const session = await createSession({ SONIC_SECRET: SECRET }, { id: 'u1', email: 'dev@epocanvas.test', name: 'Dev', avatar: '' });
  assert(session.apiKey.startsWith('sonic_live_'), 'Issued key keeps sonic_live_ prefix');
  const keyParts = session.apiKey.slice('sonic_live_'.length).split('_');
  assert(keyParts.length === 3, `Key has 3 parts email|expiry|signature (got ${keyParts.length})`);

  const hdr = new Request('https://x.test/api', { headers: { 'X-Sonic-Key': session.apiKey } });
  const ok = await verifyAuth(hdr, { SONIC_SECRET: SECRET });
  assert(ok.authenticated === true, 'Valid key authenticates via X-Sonic-Key header');
  assert(ok.user?.email === 'dev@epocanvas.test', 'Email recovered from key');

  const bearer = new Request('https://x.test/api', { headers: { Authorization: `Bearer ${session.apiKey}` } });
  assert((await verifyAuth(bearer, { SONIC_SECRET: SECRET })).authenticated === true, 'Valid key authenticates via Bearer');

  // ── 3. Forged / tampered keys are rejected (audit repro cases) ──
  console.log('\n3. Forged and tampered keys are rejected');
  const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
  const futureISO = new Date(Date.now() + 30 * 86400_000).toISOString();

  const garbageSig = `sonic_live_${b64u('victim@epocanvas.test')}_${b64u(futureISO)}_deadbeefdeadbeefdeadbeefdeadbeef`;
  assert((await verifyAuth(new Request('https://x.test', { headers: { 'X-Sonic-Key': garbageSig } }), { SONIC_SECRET: SECRET })).authenticated === false,
    'Garbage signature rejected (old audit repro now fails)');

  const tamperedEmail = `sonic_live_${b64u('attacker@epocanvas.test')}_${b64u(futureISO)}_${keyParts[2]}`;
  assert((await verifyAuth(new Request('https://x.test', { headers: { 'X-Sonic-Key': tamperedEmail } }), { SONIC_SECRET: SECRET })).authenticated === false,
    'Tampered email with stolen signature rejected');

  const pastISO = new Date(Date.now() - 1000).toISOString();
  const expiredKey = signKey('dev@epocanvas.test', pastISO, SECRET);
  assert((await verifyAuth(new Request('https://x.test', { headers: { 'X-Sonic-Key': expiredKey } }), { SONIC_SECRET: SECRET })).authenticated === false,
    'Expired key rejected');

  const extendedISO = new Date(Date.now() + 365 * 86400_000).toISOString();
  const tamperedExpiry = session.apiKey.replace(keyParts[1], b64u(extendedISO));
  assert(tamperedExpiry !== session.apiKey, 'Expiry part is independently replaceable in a forged attempt');
  assert((await verifyAuth(new Request('https://x.test', { headers: { 'X-Sonic-Key': tamperedExpiry } }), { SONIC_SECRET: SECRET })).authenticated === false,
    'Tampered (extended) expiry with original signature rejected');

  // ── 4. Missing secret fails closed ──
  console.log('\n4. Verification fails closed when no signing secret is configured');
  assert((await verifyAuth(hdr, {})).authenticated === false, 'Valid-format key rejected when SONIC_SECRET absent');
  assert((await verifyAuth(hdr, { SONIC_SECRET: 'another_secret_value' })).authenticated === false, 'Key signed under a different secret rejected');

  // ── 5. Legacy 2-part (unsigned) keys are dead ──
  console.log('\n5. Legacy unsigned key format is invalid');
  const legacy = `sonic_live_${b64u('legacy@epocanvas.test')}_d41d8cd98f00b204e9800998ecf8427e`;
  assert((await verifyAuth(new Request('https://x.test', { headers: { 'X-Sonic-Key': legacy } }), { SONIC_SECRET: SECRET })).authenticated === false,
    'Old 2-part sonic_live_ key rejected');
  const legacySolara = `solara_live_${b64u('legacy@epocanvas.test')}_d41d8cd98f00b204e9800998ecf8427e`;
  assert((await verifyAuth(new Request('https://x.test', { headers: { 'X-CFSolara-Key': legacySolara } }), { SONIC_SECRET: SECRET })).authenticated === false,
    'Old 2-part solara_live_ key rejected');

  // ── 6. Query-parameter keys are no longer accepted ──
  console.log('\n6. Query-parameter key passing is removed');
  const q = new Request('https://x.test/api?api_key=sonic_live_xxx_yyy_zzz&key=whatever');
  const extracted = extractAuthCredentials(q);
  assert(extracted.apiKey === undefined, 'Neither ?api_key= nor ?key= yields credentials');
  assert((await verifyAuth(q, { SONIC_SECRET: SECRET })).authenticated === false, 'Query-param-only request is unauthenticated');

  // ── 7. Cross-header compatibility for signed keys ──
  console.log('\n7. Signed key works across legacy header names');
  for (const h of ['X-CFSolara-Key', 'X-Api-Key']) {
    const r = new Request('https://x.test', { headers: { [h]: session.apiKey } });
    assert((await verifyAuth(r, { SONIC_SECRET: SECRET })).authenticated === true, `Signed key accepted via ${h}`);
  }

  // ── 8. Epomail client secret: no source default ──
  console.log('\n8. OAuth client secret has no hardcoded default');
  assert(getEpomailConfig({}).clientSecret === '', 'clientSecret empty when EPOMAIL_CLIENT_SECRET unset');
  let oauthThrew = null;
  try {
    await exchangeCode({}, 'https://x.test', 'some_code');
  } catch (err) {
    oauthThrew = err?.message || String(err);
  }
  assert(Boolean(oauthThrew) && /EPOMAIL_CLIENT_SECRET/i.test(oauthThrew), `exchangeCode without EPOMAIL_CLIENT_SECRET errors clearly (got: ${oauthThrew ? oauthThrew.slice(0, 80) : 'no error'})`);

  console.log(`\n========================================`);
  console.log(`Auth Signature Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
