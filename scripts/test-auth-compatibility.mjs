// scripts/test-auth-compatibility.mjs
// Comprehensive test suite for Sonic & Solara Auth Compatibility (functions/_lib/auth.ts)

import {
  createSession,
  extractAuthCredentials,
  verifyAuth,
  buildAuthorizeUrl,
  getEpomailConfig,
  stringToBase64Url,
  base64UrlEncode,
  resetAuthCacheForTest,
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

async function runAuthTests() {
  console.log('=== Running Sonic & Solara Auth Compatibility Test Suite ===\n');

  const PRIMARY_SECRET = 'sonic_secure_test_secret_32chars_long_12345';
  const SECONDARY_SECRET = 'solara_secure_test_secret_32chars_long_67890';
  const ROTATED_SECRET = 'sonic_prev_test_secret_32chars_long_abcde';

  // Test 1: Config & OAuth URL generation
  console.log('1. Testing OAuth Config & Authorize URL Generation');
  {
    const env = {
      EPOMAIL_BASE_URL: 'https://mail.epocanvas.com',
      EPOMAIL_CLIENT_ID: 'sonic_client_app',
      EPOMAIL_CLIENT_SECRET: 'sonic_secret_xyz',
      EPOMAIL_REDIRECT_URI: 'https://sonic.epocanvas.com/api/auth/callback',
    };
    const config = getEpomailConfig(env);
    assert(config.baseUrl === 'https://mail.epocanvas.com', 'Base URL parsed');
    assert(config.clientId === 'sonic_client_app', 'Client ID matched');
    assert(config.redirectUri === 'https://sonic.epocanvas.com/api/auth/callback', 'Redirect URI matched');

    const authUrl = buildAuthorizeUrl(env, 'https://sonic.epocanvas.com', 'custom_state_123', 'mock_challenge');
    const parsedUrl = new URL(authUrl);
    assert(parsedUrl.pathname === '/oauth/authorize', 'Authorize pathname is correct');
    assert(parsedUrl.searchParams.get('client_id') === 'sonic_client_app', 'Authorize client_id parameter matches');
    assert(parsedUrl.searchParams.get('state') === 'custom_state_123', 'Custom state preserved');
    assert(parsedUrl.searchParams.get('code_challenge') === 'mock_challenge', 'PKCE code_challenge added');
  }

  // Test 2: Session creation generates sonic_live_v1. key
  console.log('\n2. Testing Session Creation & sonic_live_v1 API Key Generation');
  let testSession;
  {
    const env = { SONIC_SECRET: PRIMARY_SECRET };
    const userInfo = {
      id: 'usr_epocanvas_001',
      email: 'developer@epocanvas.com',
      name: 'Epo Developer',
      avatar: 'https://mail.epocanvas.com/avatar/dev.png',
      role: 'developer',
    };
    testSession = await createSession(env, userInfo);

    assert(testSession.id === 'usr_epocanvas_001', 'User ID preserved');
    assert(testSession.email === 'developer@epocanvas.com', 'User email preserved');
    assert(testSession.apiKey.startsWith('sonic_live_v1.'), `API key has sonic_live_v1. prefix (got ${testSession.apiKey})`);

    // Check parts: sonic_live_v1.<payloadB64url>.<sigB64url>
    const parts = testSession.apiKey.split('.');
    assert(parts.length === 3, 'API key contains v1, payload, and signature separated by dot');
  }

  // Test 3: Secret fallback chain (SONIC_SECRET -> SOLARA_SECRET)
  console.log('\n3. Testing Secret Priority & Fallback');
  {
    const user = { email: 'fallback@epocanvas.com', name: 'Fallback User', avatar: '' };
    // With SOLARA_SECRET only
    const sessionSolara = await createSession({ SOLARA_SECRET: SECONDARY_SECRET }, user);
    assert(sessionSolara.apiKey.startsWith('sonic_live_v1.'), 'Key generated using SOLARA_SECRET fallback has sonic_live_v1. prefix');

    // With SONIC_SECRET taking precedence over SOLARA_SECRET
    const sessionBoth = await createSession({ SONIC_SECRET: PRIMARY_SECRET, SOLARA_SECRET: SECONDARY_SECRET }, user);
    assert(sessionBoth.apiKey.startsWith('sonic_live_v1.'), 'Key generated with both secrets present');
  }

  // Test 4: Credential extraction across headers & parameters
  console.log('\n4. Testing Credential Extraction (Headers & Query Params)');
  {
    // 4.1 X-Sonic-Key header
    const req1 = new Request('https://sonic.epocanvas.com/api/test', {
      headers: { 'X-Sonic-Key': 'sonic_live_v1.payload.sig' },
    });
    const ext1 = extractAuthCredentials(req1);
    assert(ext1.apiKey === 'sonic_live_v1.payload.sig', 'Extracted from X-Sonic-Key header');

    // 4.2 Legacy X-CFSolara-Key header
    const req2 = new Request('https://sonic.epocanvas.com/api/test', {
      headers: { 'X-CFSolara-Key': 'sonic_live_v1.payload.sig' },
    });
    const ext2 = extractAuthCredentials(req2);
    assert(ext2.apiKey === 'sonic_live_v1.payload.sig', 'Extracted from legacy X-CFSolara-Key header');

    // 4.3 Standard X-Api-Key header
    const req3 = new Request('https://sonic.epocanvas.com/api/test', {
      headers: { 'X-Api-Key': 'sonic_live_v1.payload.sig' },
    });
    const ext3 = extractAuthCredentials(req3);
    assert(ext3.apiKey === 'sonic_live_v1.payload.sig', 'Extracted from X-Api-Key header');

    // 4.4 Authorization: Bearer sonic_live_v1...
    const req4 = new Request('https://sonic.epocanvas.com/api/test', {
      headers: { Authorization: 'Bearer sonic_live_v1.payload.sig' },
    });
    const ext4 = extractAuthCredentials(req4);
    assert(ext4.apiKey === 'sonic_live_v1.payload.sig', 'Extracted from Bearer token');
    assert(ext4.token === 'sonic_live_v1.payload.sig', 'Bearer token string preserved');

    // 4.5 Query param ?api_key=... (disabled by default)
    const req5 = new Request('https://sonic.epocanvas.com/api/test?api_key=sonic_live_v1.payload.sig');
    const ext5 = extractAuthCredentials(req5, {});
    assert(ext5.apiKey === undefined, 'Query param api_key ignored by default');

    // 4.6 Query param ?api_key=... (enabled via SONIC_ALLOW_QUERY_KEY=1)
    const ext6 = extractAuthCredentials(req5, { SONIC_ALLOW_QUERY_KEY: '1' });
    assert(ext6.apiKey === 'sonic_live_v1.payload.sig', 'Query param api_key accepted when SONIC_ALLOW_QUERY_KEY=1');

    // 4.7 Header takes precedence over query key
    const req7 = new Request('https://sonic.epocanvas.com/api/test?api_key=query_key', {
      headers: { 'X-Sonic-Key': 'header_key' },
    });
    const ext7 = extractAuthCredentials(req7, { SONIC_ALLOW_QUERY_KEY: '1' });
    assert(ext7.apiKey === 'header_key', 'Header key takes precedence over query key');
  }

  // Test 5: In-memory session cache verification
  console.log('\n5. Testing In-Memory Session Cache Verification');
  {
    const req = new Request('https://sonic.epocanvas.com/api/music/search?q=test', {
      headers: { 'X-Sonic-Key': testSession.apiKey },
    });
    const res = await verifyAuth(req, { SONIC_SECRET: PRIMARY_SECRET });
    assert(res.authenticated === true, 'Session authenticated successfully via in-memory cache');
    assert(res.user?.email === 'developer@epocanvas.com', 'Session user email matches');
    assert(res.user?.apiKey === testSession.apiKey, 'Session user apiKey matches');
  }

  // Test 6: Cross-Header Verification for Newly Generated sonic_live_v1 Key
  console.log('\n6. Testing Cross-Header Verification for sonic_live_v1 Key');
  {
    const env = { SONIC_SECRET: PRIMARY_SECRET };

    // Using legacy header X-CFSolara-Key with new sonic_live_v1 key
    const reqSolaraHeader = new Request('https://sonic.epocanvas.com/api/music/search?q=test', {
      headers: { 'X-CFSolara-Key': testSession.apiKey },
    });
    const resSolaraHeader = await verifyAuth(reqSolaraHeader, env);
    assert(resSolaraHeader.authenticated === true, 'New sonic_live_v1 key authenticated via legacy X-CFSolara-Key header');
    assert(resSolaraHeader.user?.email === 'developer@epocanvas.com', 'User email matched');

    // Using Bearer token with new sonic_live_v1 key
    const reqBearer = new Request('https://sonic.epocanvas.com/api/music/search?q=test', {
      headers: { Authorization: `Bearer ${testSession.apiKey}` },
    });
    const resBearer = await verifyAuth(reqBearer, env);
    assert(resBearer.authenticated === true, 'New sonic_live_v1 key authenticated via Bearer token');
  }

  // Test 7: Secret Rotation with SONIC_SECRET_PREV
  console.log('\n7. Testing Secret Rotation Support');
  {
    resetAuthCacheForTest();
    const envRotated = {
      SONIC_SECRET: ROTATED_SECRET,
      SONIC_SECRET_PREV: PRIMARY_SECRET,
    };
    const req = new Request('https://sonic.epocanvas.com/api/music/stream?id=123', {
      headers: { 'X-Sonic-Key': testSession.apiKey },
    });
    const resRotated = await verifyAuth(req, envRotated);
    assert(resRotated.authenticated === true, 'Key verified via SONIC_SECRET_PREV during secret rotation');
    assert(resRotated.user?.email === 'developer@epocanvas.com', 'Recovered email from rotated key accurately');
  }

  // Test 8: Rejection of Unsigned Legacy Keys
  console.log('\n8. Testing Rejection of Unsigned Legacy Keys (sonic_live_* and solara_live_*)');
  {
    const legacyEmail = 'legacy_tester@epocanvas.com';
    const enc = btoa(legacyEmail).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const legacySolara = `solara_live_${enc}_d41d8cd98f00b204e9800998ecf8427e`;
    const legacySonic = `sonic_live_${enc}_a1b2c3d4e5f67890123456789abcdef0`;

    const reqSolara = new Request('https://sonic.epocanvas.com/api/test', {
      headers: { 'X-CFSolara-Key': legacySolara },
    });
    const resSolara = await verifyAuth(reqSolara, { SONIC_SECRET: PRIMARY_SECRET });
    assert(resSolara.authenticated === false, 'Legacy solara_live_ key is strictly rejected');

    const reqSonic = new Request('https://sonic.epocanvas.com/api/test', {
      headers: { 'X-Sonic-Key': legacySonic },
    });
    const resSonic = await verifyAuth(reqSonic, { SONIC_SECRET: PRIMARY_SECRET });
    assert(resSonic.authenticated === false, 'Legacy sonic_live_ key without v1 signature is strictly rejected');
  }

  // Test 9: Negative & Edge Cases
  console.log('\n9. Testing Negative & Edge Cases');
  {
    const env = { SONIC_SECRET: PRIMARY_SECRET };

    // 9.1 No auth headers or params
    const emptyReq = new Request('https://sonic.epocanvas.com/api/music/search');
    const emptyRes = await verifyAuth(emptyReq, env);
    assert(emptyRes.authenticated === false, 'Request with no auth is rejected');

    // 9.2 Arbitrary invalid key prefix
    const invalidPrefixReq = new Request('https://sonic.epocanvas.com/api/music/search', {
      headers: { 'X-Sonic-Key': 'random_prefix_abc123' },
    });
    const invalidPrefixRes = await verifyAuth(invalidPrefixReq, env);
    assert(invalidPrefixRes.authenticated === false, 'Invalid key prefix is rejected');

    // 9.3 Malformed payload in sonic_live_v1
    const malformedKeyReq = new Request('https://sonic.epocanvas.com/api/music/search', {
      headers: { 'X-Sonic-Key': 'sonic_live_v1.%%%notbase64%%%.sig' },
    });
    const malformedKeyRes = await verifyAuth(malformedKeyReq, env);
    assert(malformedKeyRes.authenticated === false, 'Malformed base64 is rejected gracefully');

    // 9.4 Missing secret or short secret
    const shortSecretReq = new Request('https://sonic.epocanvas.com/api/music/search', {
      headers: { 'X-Sonic-Key': testSession.apiKey },
    });
    const shortRes = await verifyAuth(shortSecretReq, { SONIC_SECRET: 'short_key_123' });
    assert(shortRes.authenticated === false, 'Secret shorter than 32 characters rejects authentication');

    // 9.5 Key with missing signature part
    const noSigReq = new Request('https://sonic.epocanvas.com/api/music/search', {
      headers: { 'X-Sonic-Key': 'sonic_live_v1.onlyonepart' },
    });
    const noSigRes = await verifyAuth(noSigReq, env);
    assert(noSigRes.authenticated === false, 'Key with missing signature part is rejected');
  }

  console.log(`\n========================================`);
  console.log(`Auth Compatibility Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthTests().catch((err) => {
  console.error('Fatal auth test error:', err);
  process.exit(1);
});
