// scripts/test-auth-compatibility.mjs
// Comprehensive test suite for Sonic & Solara Auth Compatibility (functions/_lib/auth.ts)

import {
  createSession,
  extractAuthCredentials,
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

async function runAuthTests() {
  console.log('=== Running Sonic & Solara Auth Compatibility Test Suite ===\n');

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

    const authUrl = buildAuthorizeUrl(env, 'https://sonic.epocanvas.com', 'custom_state_123');
    const parsedUrl = new URL(authUrl);
    assert(parsedUrl.pathname === '/oauth/authorize', 'Authorize pathname is correct');
    assert(parsedUrl.searchParams.get('client_id') === 'sonic_client_app', 'Authorize client_id parameter matches');
    assert(parsedUrl.searchParams.get('state') === 'custom_state_123', 'Custom state preserved');
  }

  // Test 2: Session creation generates sonic_live_ key
  console.log('\n2. Testing Session Creation & sonic_live_ API Key Generation');
  let testSession;
  {
    const env = { SONIC_SECRET: 'test_super_secret_sonic' };
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
    assert(testSession.apiKey.startsWith('sonic_live_'), `API key has sonic_live_ prefix (got ${testSession.apiKey})`);
    
    // Check parts: sonic_live_<encodedEmail>_<keySig>
    const parts = testSession.apiKey.replace('sonic_live_', '').split('_');
    assert(parts.length >= 2, 'API key contains encodedEmail and signature');
    const decodedEmail = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'));
    assert(decodedEmail === 'developer@epocanvas.com', `Encoded email decodes back to original (${decodedEmail})`);
  }

  // Test 3: Secret fallback chain (SONIC_SECRET -> SOLARA_SECRET -> DEFAULT)
  console.log('\n3. Testing Secret Priority & Fallback');
  {
    const user = { email: 'fallback@epocanvas.com', name: 'Fallback User', avatar: '' };
    // With SOLARA_SECRET only
    const sessionSolara = await createSession({ SOLARA_SECRET: 'solara_legacy_sec' }, user);
    assert(sessionSolara.apiKey.startsWith('sonic_live_'), 'Key generated using SOLARA_SECRET fallback has sonic_live_ prefix');
    
    // With SONIC_SECRET taking precedence over SOLARA_SECRET
    const sessionBoth = await createSession({ SONIC_SECRET: 'sonic_primary', SOLARA_SECRET: 'solara_secondary' }, user);
    assert(sessionBoth.apiKey.startsWith('sonic_live_'), 'Key generated with both secrets present');
  }

  // Test 4: Credential extraction across all headers & parameters
  console.log('\n4. Testing Credential Extraction (Headers & Query Params)');
  {
    // 4.1 X-Sonic-Key header
    const req1 = new Request('https://sonic.epocanvas.com/api/test', {
      headers: { 'X-Sonic-Key': 'sonic_live_key_01' },
    });
    const ext1 = extractAuthCredentials(req1);
    assert(ext1.apiKey === 'sonic_live_key_01', 'Extracted from X-Sonic-Key header');

    // 4.2 Legacy X-CFSolara-Key header
    const req2 = new Request('https://sonic.epocanvas.com/api/test', {
      headers: { 'X-CFSolara-Key': 'solara_live_key_02' },
    });
    const ext2 = extractAuthCredentials(req2);
    assert(ext2.apiKey === 'solara_live_key_02', 'Extracted from legacy X-CFSolara-Key header');

    // 4.3 Standard X-API-Key header
    const req3 = new Request('https://sonic.epocanvas.com/api/test', {
      headers: { 'X-Api-Key': 'sonic_live_key_03' },
    });
    const ext3 = extractAuthCredentials(req3);
    assert(ext3.apiKey === 'sonic_live_key_03', 'Extracted from X-Api-Key header');

    // 4.4 Authorization: Bearer sonic_live_...
    const req4 = new Request('https://sonic.epocanvas.com/api/test', {
      headers: { Authorization: 'Bearer sonic_live_bearer_04' },
    });
    const ext4 = extractAuthCredentials(req4);
    assert(ext4.apiKey === 'sonic_live_bearer_04', 'Extracted sonic_live_ from Bearer token');
    assert(ext4.token === 'sonic_live_bearer_04', 'Bearer token string preserved');

    // 4.5 Authorization: Bearer solara_live_...
    const req5 = new Request('https://sonic.epocanvas.com/api/test', {
      headers: { Authorization: 'Bearer solara_live_bearer_05' },
    });
    const ext5 = extractAuthCredentials(req5);
    assert(ext5.apiKey === 'solara_live_bearer_05', 'Extracted legacy solara_live_ from Bearer token');

    // 4.6 Query param ?api_key=...
    const req6 = new Request('https://sonic.epocanvas.com/api/test?api_key=sonic_live_query_06');
    const ext6 = extractAuthCredentials(req6);
    assert(ext6.apiKey === 'sonic_live_query_06', 'Extracted from query param api_key');

    // 4.7 Query param ?key=...
    const req7 = new Request('https://sonic.epocanvas.com/api/test?key=solara_live_query_07');
    const ext7 = extractAuthCredentials(req7);
    assert(ext7.apiKey === 'solara_live_query_07', 'Extracted from query param key');

    // 4.8 Header precedence (X-Sonic-Key over query param)
    const req8 = new Request('https://sonic.epocanvas.com/api/test?api_key=query_key', {
      headers: { 'X-Sonic-Key': 'header_key' },
    });
    const ext8 = extractAuthCredentials(req8);
    assert(ext8.apiKey === 'header_key', 'Header key takes precedence over query key');
  }

  // Test 5: In-memory session verification
  console.log('\n5. Testing In-Memory Session Verification');
  {
    const req = new Request('https://sonic.epocanvas.com/api/music/search?q=test', {
      headers: { 'X-Sonic-Key': testSession.apiKey },
    });
    const res = await verifyAuth(req, {});
    assert(res.authenticated === true, 'Session authenticated successfully via in-memory cache');
    assert(res.user?.email === 'developer@epocanvas.com', 'Session user email matches');
    assert(res.user?.apiKey === testSession.apiKey, 'Session user apiKey matches');
  }

  // Test 6: Cross-Header Verification for Newly Generated sonic_live_ Key
  console.log('\n6. Testing Cross-Header Verification for sonic_live_ Key');
  {
    // Using legacy header X-CFSolara-Key with new sonic_live_ key
    const reqSolaraHeader = new Request('https://sonic.epocanvas.com/api/music/search?q=test', {
      headers: { 'X-CFSolara-Key': testSession.apiKey },
    });
    const resSolaraHeader = await verifyAuth(reqSolaraHeader, {});
    assert(resSolaraHeader.authenticated === true, 'New sonic_live_ key authenticated via legacy X-CFSolara-Key header');
    assert(resSolaraHeader.user?.email === 'developer@epocanvas.com', 'User email matched');

    // Using Bearer token with new sonic_live_ key
    const reqBearer = new Request('https://sonic.epocanvas.com/api/music/search?q=test', {
      headers: { Authorization: `Bearer ${testSession.apiKey}` },
    });
    const resBearer = await verifyAuth(reqBearer, {});
    assert(resBearer.authenticated === true, 'New sonic_live_ key authenticated via Bearer token');

    // Using URL query parameter ?api_key=
    const reqQuery = new Request(`https://sonic.epocanvas.com/api/music/search?api_key=${encodeURIComponent(testSession.apiKey)}`);
    const resQuery = await verifyAuth(reqQuery, {});
    assert(resQuery.authenticated === true, 'New sonic_live_ key authenticated via query param');
  }

  // Test 7: Backward Compatibility for Legacy solara_live_ Keys (Stateless reconstruction)
  console.log('\n7. Testing Backward Compatibility for solara_live_ Keys (Stateless verification)');
  {
    // Construct a legacy solara_live_ key that was generated on an older system and is NOT in memory
    const legacyEmail = 'legacy_tester@epocanvas.com';
    const encodedLegacyEmail = btoa(legacyEmail).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const legacyApiKey = `solara_live_${encodedLegacyEmail}_d41d8cd98f00b204e9800998ecf8427e`;

    // 7.1 Verify legacy key via X-CFSolara-Key header
    const reqSolara = new Request('https://sonic.epocanvas.com/api/music/stream?id=123', {
      headers: { 'X-CFSolara-Key': legacyApiKey },
    });
    const resSolara = await verifyAuth(reqSolara, {});
    assert(resSolara.authenticated === true, 'Legacy solara_live_ key authenticated via X-CFSolara-Key');
    assert(resSolara.user?.email === 'legacy_tester@epocanvas.com', 'Stateless session recovered email accurately');
    assert(resSolara.user?.apiKey === legacyApiKey, 'Stateless session preserves original legacy apiKey');

    // 7.2 Verify legacy key via new X-Sonic-Key header
    const reqSonic = new Request('https://sonic.epocanvas.com/api/music/stream?id=123', {
      headers: { 'X-Sonic-Key': legacyApiKey },
    });
    const resSonic = await verifyAuth(reqSonic, {});
    assert(resSonic.authenticated === true, 'Legacy solara_live_ key authenticated via X-Sonic-Key header');

    // 7.3 Verify legacy key via Authorization: Bearer
    const reqBearerLegacy = new Request('https://sonic.epocanvas.com/api/music/stream?id=123', {
      headers: { Authorization: `Bearer ${legacyApiKey}` },
    });
    const resBearerLegacy = await verifyAuth(reqBearerLegacy, {});
    assert(resBearerLegacy.authenticated === true, 'Legacy solara_live_ key authenticated via Bearer token');
  }

  // Test 8: Stateless verification of un-cached sonic_live_ key
  console.log('\n8. Testing Stateless Verification of Uncached sonic_live_ Key');
  {
    const freshEmail = 'fresh_user@epocanvas.com';
    const encFresh = btoa(freshEmail).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const uncachedSonicKey = `sonic_live_${encFresh}_a1b2c3d4e5f67890123456789abcdef0`;

    const req = new Request('https://sonic.epocanvas.com/api/music/search', {
      headers: { 'X-Sonic-Key': uncachedSonicKey },
    });
    const res = await verifyAuth(req, {});
    assert(res.authenticated === true, 'Uncached sonic_live_ key authenticated via stateless fallback');
    assert(res.user?.email === 'fresh_user@epocanvas.com', 'Stateless fallback recovered user email');
  }

  // Test 9: Negative & Edge Cases
  console.log('\n9. Testing Negative & Edge Cases');
  {
    // 9.1 No auth headers or params
    const emptyReq = new Request('https://sonic.epocanvas.com/api/music/search');
    const emptyRes = await verifyAuth(emptyReq, {});
    assert(emptyRes.authenticated === false, 'Request with no auth is rejected');

    // 9.2 Arbitrary invalid key prefix
    const invalidPrefixReq = new Request('https://sonic.epocanvas.com/api/music/search', {
      headers: { 'X-Sonic-Key': 'random_prefix_abc123' },
    });
    const invalidPrefixRes = await verifyAuth(invalidPrefixReq, {});
    assert(invalidPrefixRes.authenticated === false, 'Invalid key prefix is rejected');

    // 9.3 Malformed base64 in sonic_live_
    const malformedKeyReq = new Request('https://sonic.epocanvas.com/api/music/search', {
      headers: { 'X-Sonic-Key': 'sonic_live_%%%notbase64%%%_sig' },
    });
    const malformedKeyRes = await verifyAuth(malformedKeyReq, {});
    assert(malformedKeyRes.authenticated === false, 'Malformed base64 email is rejected gracefully');

    // 9.4 Base64 without valid email (@ symbol missing)
    const noEmailKey = `sonic_live_${btoa('notanemail').replace(/=/g, '')}_sig123`;
    const noEmailReq = new Request('https://sonic.epocanvas.com/api/music/search', {
      headers: { 'X-Sonic-Key': noEmailKey },
    });
    const noEmailRes = await verifyAuth(noEmailReq, {});
    assert(noEmailRes.authenticated === false, 'Base64 string without @ is rejected');

    // 9.5 Key without underscore separators
    const noUnderscoreReq = new Request('https://sonic.epocanvas.com/api/music/search', {
      headers: { 'X-Sonic-Key': 'sonic_live_onlyonepart' },
    });
    const noUnderscoreRes = await verifyAuth(noUnderscoreReq, {});
    assert(noUnderscoreRes.authenticated === false, 'Key with missing signature part is rejected');
  }

  console.log(`\n========================================`);
  console.log(`Auth Compatibility Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthTests().catch(err => {
  console.error('Fatal auth test error:', err);
  process.exit(1);
});
