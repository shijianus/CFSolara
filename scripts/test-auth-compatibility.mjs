// scripts/test-auth-compatibility.mjs
// Signed API key format, rotation, expiry, tampering and credential transport.

import {
  AuthConfigError,
  createSession,
  extractAuthCredentials,
  signApiKey,
  verifyAuth,
  buildAuthorizeUrl,
  getEpomailConfig,
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

const SECRET = 'test_signing_secret_that_is_at_least_32_chars_long_01';
const OLD_SECRET = 'old_signing_secret_that_is_at_least_32_chars_long_02';
const NEW_SECRET = 'new_signing_secret_that_is_at_least_32_chars_long_03';

function decodePayload(apiKey) {
  const rest = apiKey.slice('sonic_live_'.length);
  const [, payloadB64] = rest.split('.');
  return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function resignByTampering(apiKey, mutate) {
  const rest = apiKey.slice('sonic_live_'.length);
  const [version, payloadB64, signatureB64] = rest.split('.');
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  mutate(payload);
  return `sonic_live_${version}.${encodePayload(payload)}.${signatureB64}`;
}

function authRequest(key, header = 'X-Sonic-Key') {
  return new Request('https://sonic.epocanvas.com/api/sonic/search/nexus?q=test', {
    headers: { [header]: key },
  });
}

async function runAuthTests() {
  console.log('=== Running Signed API Key / Auth Test Suite ===\n');

  console.log('1. OAuth configuration and authorize URL');
  {
    const env = {
      EPOMAIL_BASE_URL: 'https://mail.epocanvas.com',
      EPOMAIL_CLIENT_ID: 'sonic_client_app',
      EPOMAIL_CLIENT_SECRET: 'oauth_client_secret_value',
      EPOMAIL_REDIRECT_URI: 'https://sonic.epocanvas.com/api/auth/callback',
    };
    const config = getEpomailConfig(env, 'https://sonic.epocanvas.com');
    assert(config.baseUrl === 'https://mail.epocanvas.com', 'Base URL parsed');
    assert(config.clientId === 'sonic_client_app', 'Client ID matched');
    assert(config.redirectUri === 'https://sonic.epocanvas.com/api/auth/callback', 'Redirect URI matched');

    const authUrl = buildAuthorizeUrl(env, 'https://sonic.epocanvas.com', 'custom_state_123');
    const parsedUrl = new URL(authUrl);
    assert(parsedUrl.pathname === '/oauth/authorize', 'Authorize pathname is correct');
    assert(parsedUrl.searchParams.get('client_id') === 'sonic_client_app', 'Authorize client_id parameter matches');
    assert(parsedUrl.searchParams.get('state') === 'custom_state_123', 'Custom state preserved');
  }

  console.log('\n2. createSession issues sonic_live_v1.<payload>.<signature>');
  let session;
  {
    const env = { SONIC_SECRET: SECRET };
    session = await createSession(env, {
      id: 'usr_epocanvas_001',
      email: 'Developer@Epocanvas.com',
      name: 'Epo Developer',
      avatar: 'https://mail.epocanvas.com/avatar/dev.png',
      role: 'developer',
    });

    assert(session.id === 'usr_epocanvas_001', 'Provided user ID preserved');
    assert(session.email === 'developer@epocanvas.com', 'Email normalized to lowercase');
    assert(session.apiKey.startsWith('sonic_live_v1.'), 'Key uses sonic_live_v1 prefix');
    const parts = session.apiKey.slice('sonic_live_'.length).split('.');
    assert(parts.length === 3 && parts[0] === 'v1', 'Key has version, payload and signature segments');
    assert(parts[2].length >= 42, 'Signature is not truncated (full HMAC-SHA256)');

    const payload = decodePayload(session.apiKey);
    assert(payload.v === 1, 'Payload v=1');
    assert(payload.email === 'developer@epocanvas.com', 'Payload email matches');
    assert(Number.isInteger(payload.exp) && payload.exp > Math.floor(Date.now() / 1000), 'Payload exp is future seconds');
    assert(typeof payload.kid === 'string' && payload.kid.length === 16, 'Payload carries key id');
    assert(new Date(session.expiresAt).getTime() === payload.exp * 1000, 'Session expiry matches payload');
  }

  console.log('\n3. Random user id uses crypto.randomUUID (no Math.random)');
  {
    const env = { SONIC_SECRET: SECRET };
    const a = await createSession(env, { email: 'uuid-a@epocanvas.com', name: 'A', avatar: '' });
    const b = await createSession(env, { email: 'uuid-b@epocanvas.com', name: 'B', avatar: '' });
    assert(/^usr_[0-9a-f-]{36}$/i.test(a.id), `Generated id looks like a UUID (${a.id})`);
    assert(a.id !== b.id, 'Generated ids are unique');
  }

  console.log('\n4. Valid key authenticates through headers');
  {
    const req = authRequest(session.apiKey);
    const res = await verifyAuth(req, { SONIC_SECRET: SECRET });
    assert(res.authenticated === true, 'Valid key authenticates');
    assert(res.user?.email === 'developer@epocanvas.com', 'Verified user email matches');
    assert(res.user?.apiKey === session.apiKey, 'Verified user keeps original key');

    const bearerReq = new Request('https://sonic.epocanvas.com/api/sonic/search', {
      headers: { Authorization: `Bearer ${session.apiKey}` },
    });
    const bearerRes = await verifyAuth(bearerReq, { SONIC_SECRET: SECRET });
    assert(bearerRes.authenticated === true, 'Bearer header authenticates');

    const apiKeyReq = new Request('https://sonic.epocanvas.com/api/sonic/search', {
      headers: { 'X-Api-Key': session.apiKey },
    });
    const apiKeyRes = await verifyAuth(apiKeyReq, { SONIC_SECRET: SECRET });
    assert(apiKeyRes.authenticated === true, 'X-Api-Key header authenticates');

    const legacyHeaderReq = new Request('https://sonic.epocanvas.com/api/sonic/search', {
      headers: { 'X-CFSolara-Key': session.apiKey },
    });
    const legacyHeaderRes = await verifyAuth(legacyHeaderReq, { SONIC_SECRET: SECRET });
    assert(legacyHeaderRes.authenticated === true, 'X-CFSolara-Key header still transports a valid new key');
  }

  console.log('\n5. Forged / tampered / expired keys are rejected');
  {
    const forgedEmail = Buffer.from('attacker@example.com', 'utf8').toString('base64url');
    const forged = `sonic_live_${forgedEmail}_${'a'.repeat(64)}`;
    assert((await verifyAuth(authRequest(forged), { SONIC_SECRET: SECRET })).authenticated === false, 'Legacy forged sonic_live_<b64(email)>_<sig> rejected');

    const tamperedEmail = resignByTampering(session.apiKey, (payload) => {
      payload.email = 'attacker@example.com';
    });
    assert((await verifyAuth(authRequest(tamperedEmail), { SONIC_SECRET: SECRET })).authenticated === false, 'Tampered email rejected');

    const tamperedExp = resignByTampering(session.apiKey, (payload) => {
      payload.exp += 86400;
    });
    assert((await verifyAuth(authRequest(tamperedExp), { SONIC_SECRET: SECRET })).authenticated === false, 'Tampered expiry rejected');

    const expiredKey = await signApiKey({ SONIC_SECRET: SECRET }, 'expired@example.com', Math.floor(Date.now() / 1000) - 10);
    assert((await verifyAuth(authRequest(expiredKey), { SONIC_SECRET: SECRET })).authenticated === false, 'Expired key rejected');

    const tooLongKey = await signApiKey(
      { SONIC_SECRET: SECRET },
      'future@example.com',
      Math.floor(Date.now() / 1000) + 400 * 86400,
    );
    assert((await verifyAuth(authRequest(tooLongKey), { SONIC_SECRET: SECRET })).authenticated === false, 'Absurdly far-future expiry rejected');

    assert((await verifyAuth(authRequest(session.apiKey), {})).authenticated === false, 'Key rejected when SONIC_SECRET is missing');
    assert((await verifyAuth(authRequest(session.apiKey), { SONIC_SECRET: 'too-short' })).authenticated === false, 'Key rejected when SONIC_SECRET is too short');
  }

  console.log('\n6. Legacy key formats are rejected');
  {
    const emailB64 = Buffer.from('legacy@example.com', 'utf8').toString('base64url');
    const legacySonic = `sonic_live_${emailB64}_d41d8cd98f00b204e9800998ecf8427e`;
    const legacySolara = `solara_live_${emailB64}_d41d8cd98f00b204e9800998ecf8427e`;
    assert((await verifyAuth(authRequest(legacySonic), { SONIC_SECRET: SECRET })).authenticated === false, 'Old sonic_live_ format rejected');
    assert((await verifyAuth(authRequest(legacySolara), { SONIC_SECRET: SECRET })).authenticated === false, 'Old solara_live_ format rejected');
  }

  console.log('\n7. Secret rotation via SONIC_SECRET_PREV');
  {
    const oldKey = await signApiKey({ SONIC_SECRET: OLD_SECRET }, 'rotate@example.com', Math.floor(Date.now() / 1000) + 3600);
    const onlyNew = await verifyAuth(authRequest(oldKey), { SONIC_SECRET: NEW_SECRET });
    assert(onlyNew.authenticated === false, 'Old key rejected after rotation without previous secret');
    const withPrev = await verifyAuth(authRequest(oldKey), { SONIC_SECRET: NEW_SECRET, SONIC_SECRET_PREV: OLD_SECRET });
    assert(withPrev.authenticated === true, 'Old key accepted via SONIC_SECRET_PREV');
    assert(withPrev.user?.email === 'rotate@example.com', 'Rotated key preserves email');
  }

  console.log('\n8. Signing fails closed without a strong secret');
  {
    let threw = false;
    try {
      await createSession({}, { email: 'no-secret@example.com', name: 'No Secret', avatar: '' });
    } catch (error) {
      threw = error instanceof AuthConfigError && error.status === 503;
    }
    assert(threw, 'createSession throws AuthConfigError (503) without SONIC_SECRET');

    let shortThrew = false;
    try {
      await signApiKey({ SONIC_SECRET: 'short' }, 'short@example.com', Math.floor(Date.now() / 1000) + 60);
    } catch (error) {
      shortThrew = error instanceof AuthConfigError;
    }
    assert(shortThrew, 'signApiKey rejects a short secret');
  }

  console.log('\n9. Query-string keys are opt-in only');
  {
    const queryReq = new Request(`https://sonic.epocanvas.com/api/sonic/search?api_key=${encodeURIComponent(session.apiKey)}`);
    const defaultRes = await verifyAuth(queryReq, { SONIC_SECRET: SECRET });
    assert(defaultRes.authenticated === false, 'Query api_key rejected by default');
    const enabledRes = await verifyAuth(queryReq, { SONIC_SECRET: SECRET, SONIC_ALLOW_QUERY_KEY: '1' });
    assert(enabledRes.authenticated === true, 'Query api_key accepted only with SONIC_ALLOW_QUERY_KEY=1');

    const extraction = extractAuthCredentials(queryReq, { SONIC_SECRET: SECRET });
    assert(extraction.apiKey === undefined, 'extractAuthCredentials omits query key by default');
  }

  console.log(`\n========================================`);
  console.log(`Auth Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runAuthTests().catch((err) => {
  console.error('Fatal auth test error:', err);
  process.exit(1);
});
