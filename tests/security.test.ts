import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession,
  verifyAuth,
  base64UrlEncode,
  stringToBase64Url,
  resetAuthCacheForTest,
} from '../functions/_lib/auth';
import {
  getPublicClientIp,
  getForwardedClientIp,
  evaluateGatewayRateLimit,
  resetRateLimitsForTest,
  isBlockedSsrfHost,
  validateSafeUrl,
  safeFetch,
} from '../functions/_lib/sonic/security';
import { onRequest as handleAuthCallback } from '../functions/api/auth/callback';

const VALID_SECRET_1 = 'super_secret_sonic_key_2026_primary_abcdef123456'; // >= 32 chars
const VALID_SECRET_2 = 'super_secret_sonic_key_2026_rotated_xyz789012345'; // >= 32 chars
const SHORT_SECRET = 'short_secret_123'; // < 32 chars

describe('Task 1 & Task 2: API Key Signature & Secret Hardening', () => {
  beforeEach(() => {
    resetAuthCacheForTest();
  });

  it('rejects forged sonic_live_<base64(email)>_xxx keys', async () => {
    const forgedEmail = 'victim@epocanvas.com';
    const b64Email = btoa(forgedEmail).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const forgedKey = `sonic_live_${b64Email}_arbitrary_sig_123456`;

    const req = new Request('https://sonic.epocanvas.tech/api/music/search', {
      headers: { 'X-Sonic-Key': forgedKey },
    });
    const res = await verifyAuth(req, { SONIC_SECRET: VALID_SECRET_1 });
    expect(res.authenticated).toBe(false);
  });

  it('rejects legacy solara_live_* keys', async () => {
    const legacyKey = 'solara_live_ZGV2ZWxvcGVyQGVwb2NhbnZhcy5jb20_d41d8cd98f00b204e9800998ecf8427e';
    const req = new Request('https://sonic.epocanvas.tech/api/music/search', {
      headers: { 'X-CFSolara-Key': legacyKey },
    });
    const res = await verifyAuth(req, { SONIC_SECRET: VALID_SECRET_1 });
    expect(res.authenticated).toBe(false);
  });

  it('rejects tampered email in payload', async () => {
    const env = { SONIC_SECRET: VALID_SECRET_1 };
    const session = await createSession(env, {
      email: 'original@epocanvas.com',
      name: 'Original',
      avatar: '',
    });

    // Tamper payload email from original@ to attacker@
    const parts = session.apiKey.split('.');
    expect(parts.length).toBe(3);
    const tamperedPayload = {
      v: 1,
      email: 'attacker@epocanvas.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      kid: 'current',
    };
    const tamperedPayloadB64 = stringToBase64Url(JSON.stringify(tamperedPayload));
    const tamperedKey = `sonic_live_v1.${tamperedPayloadB64}.${parts[2]}`;

    const req = new Request('https://sonic.epocanvas.tech/api/music/search', {
      headers: { 'X-Sonic-Key': tamperedKey },
    });
    const res = await verifyAuth(req, env);
    expect(res.authenticated).toBe(false);
  });

  it('rejects tampered exp in payload', async () => {
    const env = { SONIC_SECRET: VALID_SECRET_1 };
    const session = await createSession(env, {
      email: 'user@epocanvas.com',
      name: 'User',
      avatar: '',
    });

    const parts = session.apiKey.split('.');
    const tamperedPayload = {
      v: 1,
      email: 'user@epocanvas.com',
      exp: Math.floor(Date.now() / 1000) + 1000000,
      kid: 'current',
    };
    const tamperedPayloadB64 = stringToBase64Url(JSON.stringify(tamperedPayload));
    const tamperedKey = `sonic_live_v1.${tamperedPayloadB64}.${parts[2]}`;

    const req = new Request('https://sonic.epocanvas.tech/api/music/search', {
      headers: { 'X-Sonic-Key': tamperedKey },
    });
    const res = await verifyAuth(req, env);
    expect(res.authenticated).toBe(false);
  });

  it('rejects expired keys', async () => {
    const env = { SONIC_SECRET: VALID_SECRET_1 };
    const expiredPayload = {
      v: 1,
      email: 'expired@epocanvas.com',
      exp: Math.floor(Date.now() / 1000) - 60, // expired 60s ago
      kid: 'current',
    };
    const payloadB64 = stringToBase64Url(JSON.stringify(expiredPayload));
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(VALID_SECRET_1),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(`v1.${payloadB64}`));
    const sigB64 = base64UrlEncode(new Uint8Array(sigBuf));
    const expiredKey = `sonic_live_v1.${payloadB64}.${sigB64}`;

    const req = new Request('https://sonic.epocanvas.tech/api/music/search', {
      headers: { 'X-Sonic-Key': expiredKey },
    });
    const res = await verifyAuth(req, env);
    expect(res.authenticated).toBe(false);
  });

  it('verifies valid keys and supports rotation with SONIC_SECRET_PREV', async () => {
    // 1. Valid with primary secret
    const envPrimary = { SONIC_SECRET: VALID_SECRET_1 };
    const session1 = await createSession(envPrimary, {
      email: 'alice@epocanvas.com',
      name: 'Alice',
      avatar: '',
    });

    const req1 = new Request('https://sonic.epocanvas.tech/api/music/search', {
      headers: { 'X-Sonic-Key': session1.apiKey },
    });
    const res1 = await verifyAuth(req1, envPrimary);
    expect(res1.authenticated).toBe(true);
    expect(res1.user?.email).toBe('alice@epocanvas.com');

    // 2. Secret rotated: VALID_SECRET_2 is now primary, VALID_SECRET_1 is PREV
    resetAuthCacheForTest();
    const envRotated = {
      SONIC_SECRET: VALID_SECRET_2,
      SONIC_SECRET_PREV: VALID_SECRET_1,
    };
    const res2 = await verifyAuth(req1, envRotated);
    expect(res2.authenticated).toBe(true);
    expect(res2.user?.email).toBe('alice@epocanvas.com');

    // 3. Fails when older secret is retired and not in PREV
    resetAuthCacheForTest();
    const envRetired = { SONIC_SECRET: VALID_SECRET_2 };
    const res3 = await verifyAuth(req1, envRetired);
    expect(res3.authenticated).toBe(false);
  });

  it('rejects when SONIC_SECRET is unconfigured or shorter than 32 chars', async () => {
    // 1. Missing secret
    const req = new Request('https://sonic.epocanvas.tech/api/music/search', {
      headers: { 'X-Sonic-Key': 'sonic_live_v1.payload.sig' },
    });
    const resMissing = await verifyAuth(req, {});
    expect(resMissing.authenticated).toBe(false);

    // 2. Short secret (< 32 chars)
    const resShort = await verifyAuth(req, { SONIC_SECRET: SHORT_SECRET });
    expect(resShort.authenticated).toBe(false);

    // 3. createSession fails closed
    await expect(
      createSession({}, { email: 'test@epocanvas.com', name: 'Test', avatar: '' }),
    ).rejects.toThrow('SONIC_SECRET is not configured or shorter than 32 characters');

    await expect(
      createSession({ SONIC_SECRET: SHORT_SECRET }, { email: 'test@epocanvas.com', name: 'Test', avatar: '' }),
    ).rejects.toThrow('SONIC_SECRET is not configured or shorter than 32 characters');
  });

  it('disallows URL query key ?api_key= by default, and allows when SONIC_ALLOW_QUERY_KEY=1', async () => {
    const env = { SONIC_SECRET: VALID_SECRET_1 };
    const session = await createSession(env, {
      email: 'query_user@epocanvas.com',
      name: 'Query User',
      avatar: '',
    });

    // Default: query key rejected
    const reqDefault = new Request(`https://sonic.epocanvas.tech/api/music/search?api_key=${encodeURIComponent(session.apiKey)}`);
    const resDefault = await verifyAuth(reqDefault, env);
    expect(resDefault.authenticated).toBe(false);

    // With explicit toggle enabled
    const envWithQuery = { ...env, SONIC_ALLOW_QUERY_KEY: '1' };
    const resAllowed = await verifyAuth(reqDefault, envWithQuery);
    expect(resAllowed.authenticated).toBe(true);
    expect(resAllowed.user?.email).toBe('query_user@epocanvas.com');
  });
});

describe('Task 3: OAuth State CSRF & Security', () => {
  it('returns 400 when OAuth callback state is missing or mismatched', async () => {
    const env = {
      EPOMAIL_CLIENT_ID: 'client_123',
      EPOMAIL_CLIENT_SECRET: 'secret_123',
      EPOMAIL_BASE_URL: 'https://mail.epocanvas.com',
      EPOMAIL_REDIRECT_URI: 'https://sonic.epocanvas.tech/api/auth/callback',
      SONIC_SECRET: VALID_SECRET_1,
    };

    // 1. Missing state in query param
    const reqNoState = new Request('https://sonic.epocanvas.tech/api/auth/callback?code=mock_code', {
      headers: { Cookie: 'sonic_oauth_state=valid_random_state_123' },
    });
    const resNoState = await handleAuthCallback({ request: reqNoState, env });
    expect(resNoState.status).toBe(400);

    // 2. Missing cookie state
    const reqNoCookie = new Request('https://sonic.epocanvas.tech/api/auth/callback?code=mock_code&state=valid_random_state_123');
    const resNoCookie = await handleAuthCallback({ request: reqNoCookie, env });
    expect(resNoCookie.status).toBe(400);

    // 3. Mismatched state (attacker forged request)
    const reqMismatch = new Request('https://sonic.epocanvas.tech/api/auth/callback?code=mock_code&state=attacker_state', {
      headers: { Cookie: 'sonic_oauth_state=victim_legit_state' },
    });
    const resMismatch = await handleAuthCallback({ request: reqMismatch, env });
    expect(resMismatch.status).toBe(400);
    const json = await resMismatch.json();
    expect(json.error).toContain('CSRF');
  });
});

describe('Task 4: Rate Limiting & Client IP Spoofing Prevention', () => {
  beforeEach(() => {
    resetRateLimitsForTest();
  });

  it('ignores X-Sonic-Client-IP for anonymous requests and keys on CF-Connecting-IP', async () => {
    const env = {
      SONIC_RATE_LIMIT_ANON_RPM: '2',
      SONIC_SECRET: VALID_SECRET_1,
    };

    // Request with spoofed X-Sonic-Client-IP but real CF-Connecting-IP
    const makeReq = () =>
      new Request('https://sonic.epocanvas.tech/api/test', {
        headers: {
          'CF-Connecting-IP': '198.51.100.10',
          'X-Sonic-Client-IP': '1.2.3.4', // Spoofed
        },
      });

    // Extract IP should only be CF-Connecting-IP
    expect(getPublicClientIp(makeReq())).toBe('198.51.100.10');

    // First request
    const d1 = await evaluateGatewayRateLimit(makeReq(), env, 'test-ip-spoof');
    expect(d1.allowed).toBe(true);

    // Second request (same CF IP, different forged IP)
    const req2 = new Request('https://sonic.epocanvas.tech/api/test', {
      headers: {
        'CF-Connecting-IP': '198.51.100.10',
        'X-Sonic-Client-IP': '5.6.7.8', // Attempt to evade bucket
      },
    });
    const d2 = await evaluateGatewayRateLimit(req2, env, 'test-ip-spoof');
    expect(d2.allowed).toBe(true);

    // Third request exceeds limit of 2 for this CF-Connecting-IP bucket
    const req3 = new Request('https://sonic.epocanvas.tech/api/test', {
      headers: {
        'CF-Connecting-IP': '198.51.100.10',
        'X-Sonic-Client-IP': '9.10.11.12',
      },
    });
    const d3 = await evaluateGatewayRateLimit(req3, env, 'test-ip-spoof');
    expect(d3.allowed).toBe(false);
  });

  it('only trusts X-Sonic-Client-IP when request has valid Engine Key', async () => {
    const engineSecret = 'engine_secret_must_be_32_characters_long_minimum!';
    const env = { SONIC_ENGINE_SECRET: engineSecret };

    // Request with invalid engine key
    const reqUntrusted = new Request('https://sonic.epocanvas.tech/api/test', {
      headers: {
        'X-Sonic-Engine-Key': 'wrong_key',
        'X-Sonic-Client-IP': '198.51.100.77',
      },
    });
    expect(getForwardedClientIp(reqUntrusted, env)).toBe('unknown');

    // Request with valid engine key and valid IPv4
    const reqTrusted = new Request('https://sonic.epocanvas.tech/api/test', {
      headers: {
        'X-Sonic-Engine-Key': engineSecret,
        'X-Sonic-Client-IP': '198.51.100.77',
      },
    });
    expect(getForwardedClientIp(reqTrusted, env)).toBe('198.51.100.77');

    // Request with valid engine key but invalid IP literal
    const reqBadIp = new Request('https://sonic.epocanvas.tech/api/test', {
      headers: {
        'X-Sonic-Engine-Key': engineSecret,
        'X-Sonic-Client-IP': 'not-an-ip; evil',
      },
    });
    expect(getForwardedClientIp(reqBadIp, env)).toBe('unknown');
  });
});

describe('Task 5: SSRF Triple Validation & Canonicalization', () => {
  it('blocks all private, loopback, and metadata IP representations', () => {
    // 127.0.0.1 in standard and alternative formats
    expect(isBlockedSsrfHost('127.0.0.1')).toBe(true);
    expect(isBlockedSsrfHost('2130706433')).toBe(true); // Decimal 127.0.0.1
    expect(isBlockedSsrfHost('0x7f.0.0.1')).toBe(true);  // Hex dotted
    expect(isBlockedSsrfHost('0x7f.1')).toBe(true);      // Hex compact
    expect(isBlockedSsrfHost('[::ffff:127.0.0.1]')).toBe(true); // IPv4-mapped IPv6
    expect(isBlockedSsrfHost('::ffff:127.0.0.1')).toBe(true);

    // Cloud metadata IP
    expect(isBlockedSsrfHost('169.254.169.254')).toBe(true);

    // Localhost variations
    expect(isBlockedSsrfHost('localhost')).toBe(true);
    expect(isBlockedSsrfHost('localhost.')).toBe(true);
    expect(isBlockedSsrfHost('sub.localhost')).toBe(true);

    // RFC1918 Private ranges
    expect(isBlockedSsrfHost('10.0.0.1')).toBe(true);
    expect(isBlockedSsrfHost('172.16.0.1')).toBe(true);
    expect(isBlockedSsrfHost('172.31.255.255')).toBe(true);
    expect(isBlockedSsrfHost('192.168.1.1')).toBe(true);

    // Public music CDN hosts are allowed
    expect(isBlockedSsrfHost('m701.music.126.net')).toBe(false);
    expect(isBlockedSsrfHost('y.qq.com')).toBe(false);
  });

  it('rejects URLs with userinfo', () => {
    const res = validateSafeUrl('https://user:pass@m701.music.126.net/audio.mp3');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('userinfo');
  });

  it('enforces domain whitelist suffix and blocks whitelist bypass attempts', () => {
    const allowed = ['music.com'];

    // Valid subdomain
    const resValid = validateSafeUrl('https://cdn.music.com/song.mp3', { allowedDomains: allowed });
    expect(resValid.valid).toBe(true);

    // Whitelist bypass attempt: evil-music.com
    const resBypass = validateSafeUrl('https://evil-music.com/song.mp3', { allowedDomains: allowed });
    expect(resBypass.valid).toBe(false);
    expect(resBypass.error).toContain('allowed domain whitelist');
  });

  it('rejects redirect to internal network in safeFetch', async () => {
    // Attempting to fetch internal loopback
    await expect(
      safeFetch('http://127.0.0.1/evil', undefined, { allowHttp: false }),
    ).rejects.toThrow('SSRF check rejected');
  });
});
