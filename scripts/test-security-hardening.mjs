// scripts/test-security-hardening.mjs
// SSRF / outbound URL guard coverage shared by Pages Functions and the Linux
// engine. Run with: npm run test:security

import {
  OutboundError,
  isBlockedSsrfHost,
  isHostAllowed,
  safeFetch,
  validateOutboundUrl,
  validateRedirectTarget,
} from '../functions/_lib/sonic/net-guard.ts';
import { onRequest as handleSonicForward } from '../functions/api/sonic/forward.ts';
import { onRequest as handlePalette } from '../functions/palette.ts';
import { onRequest as handleMusicStream } from '../functions/api/music/stream.ts';
import { onRequest as handleMusicCover } from '../functions/api/music/cover.ts';
import { validateEngineOutboundTarget } from '../server/dns-guard.ts';

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

function forwardRequest(target) {
  return new Request(`https://sonic.epocanvas.tech/api/sonic/forward?url=${encodeURIComponent(target)}`);
}

async function runTests() {
  console.log('=== Running SSRF / Outbound URL Hardening Tests ===\n');

  console.log('1. IP literal normalization and private ranges');
  {
    const blocked = [
      ['127.0.0.1', 'IPv4 loopback'],
      ['2130706433', 'decimal IPv4 loopback'],
      ['0x7f.0.0.1', 'hex IPv4 loopback'],
      ['0177.0.0.1', 'octal IPv4 loopback'],
      ['[::ffff:127.0.0.1]', 'IPv4-mapped IPv6 loopback'],
      ['::1', 'IPv6 loopback'],
      ['::', 'IPv6 unspecified'],
      ['169.254.169.254', 'cloud metadata'],
      ['localhost.', 'localhost with trailing dot'],
      ['0.0.0.0', '0.0.0.0/8'],
      ['100.64.0.1', 'CGNAT 100.64/10'],
      ['192.0.0.1', '192.0.0.0/24'],
      ['192.168.1.1', 'RFC1918'],
      ['198.18.0.1', 'benchmark 198.18/15'],
      ['224.0.0.1', 'multicast'],
      ['fc00::1', 'IPv6 ULA'],
      ['fe80::1', 'IPv6 link-local'],
      ['::ffff:10.0.0.1', 'IPv4-mapped private'],
      ['127.0.0.1.nip.io', 'IP-echo DNS service'],
      ['metadata.google.internal', 'cloud metadata hostname'],
      ['engine-sonic.epocanvas.tech', 'internal engine hostname'],
    ];
    for (const [host, label] of blocked) {
      assert(isBlockedSsrfHost(host) === true, `Blocks ${label} (${host})`);
    }
    const allowed = ['example.com', 'm701.music.126.net', 'y.gtimg.cn'];
    for (const host of allowed) {
      assert(isBlockedSsrfHost(host) === false, `Allows public host ${host}`);
    }
  }

  console.log('\n2. Protocol / port / userinfo validation');
  {
    assert(validateOutboundUrl('https://example.com/a', {}).ok === true, 'HTTPS target allowed');
    assert(validateOutboundUrl('http://example.com/a', {}).ok === false, 'Plain HTTP rejected by default');
    assert(
      validateOutboundUrl('http://example.com/a', { SONIC_ALLOW_HTTP_OUTBOUND: '1' }).ok === true,
      'Plain HTTP allowed only when SONIC_ALLOW_HTTP_OUTBOUND=1',
    );
    assert(validateOutboundUrl('https://example.com:8443/a', {}).ok === false, 'Non-80/443 port rejected');
    assert(validateOutboundUrl('https://user:pass@example.com/a', {}).ok === false, 'Userinfo in URL rejected');
    assert(validateOutboundUrl('file:///etc/passwd', {}).ok === false, 'file:// rejected');
    assert(validateOutboundUrl('gopher://example.com/', {}).ok === false, 'gopher:// rejected');
  }

  console.log('\n3. Allow-list suffix matching');
  {
    assert(isHostAllowed('music.com', ['music.com']) === true, 'Exact allow-list host matches');
    assert(isHostAllowed('a.music.com', ['music.com']) === true, 'Dotted subdomain matches');
    assert(isHostAllowed('evil-music.com', ['music.com']) === false, 'evil-music.com does not match music.com');
    assert(isHostAllowed('music.com.evil.net', ['music.com']) === false, 'Suffix after host does not match');
    assert(isHostAllowed('music.com', []) === false, 'Empty allow-list matches nothing');
    const validation = validateOutboundUrl('https://evil-music.com/a', {}, { allowedHosts: ['music.com'] });
    assert(validation.ok === false && validation.reason === 'host_not_allowed', 'Outbound target outside allow-list rejected');
  }

  console.log('\n4. Redirect revalidation');
  {
    const previous = new URL('https://example.com/start');
    const toInternal = validateRedirectTarget(previous, 'http://169.254.169.254/latest/meta-data/', {});
    assert(toInternal.ok === false, 'Redirect to cloud metadata rejected');
    const toLoopback = validateRedirectTarget(previous, 'https://127.0.0.1/admin', {});
    assert(toLoopback.ok === false, 'Redirect to loopback rejected');
    const downgrade = validateRedirectTarget(
      previous,
      'http://example.com/next',
      { SONIC_ALLOW_HTTP_OUTBOUND: '1' },
    );
    assert(downgrade.ok === false && downgrade.reason === 'https_downgrade', 'HTTPS -> HTTP downgrade rejected');
    const allowlistEscape = validateRedirectTarget(
      previous,
      'https://evil-music.com/next',
      {},
      { allowedHosts: ['music.com', 'example.com'] },
    );
    assert(allowlistEscape.ok === false, 'Redirect outside allow-list rejected');
  }

  console.log('\n4b. safeFetch follows redirects manually and strips credentials');
  {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        new Response(null, { status: 302, headers: { Location: 'https://169.254.169.254/latest/meta-data/' } });
      let redirectRejected = false;
      try {
        await safeFetch('https://example.com/start', {}, {}, { maxRedirects: 3 });
      } catch (error) {
        redirectRejected = error instanceof OutboundError && error.code === 'blocked_host';
      }
      assert(redirectRejected, 'safeFetch rejects a redirect to an internal IP');

      globalThis.fetch = async () =>
        new Response(null, { status: 302, headers: { Location: 'https://example.com/next' } });
      let loopRejected = false;
      try {
        await safeFetch('https://example.com/start', {}, {}, { maxRedirects: 1 });
      } catch (error) {
        loopRejected = error instanceof OutboundError && error.code === 'too_many_redirects';
      }
      assert(loopRejected, 'safeFetch enforces the redirect limit');

      let capturedHeaders;
      globalThis.fetch = async (_url, init) => {
        capturedHeaders = init.headers;
        return new Response('ok', { status: 200 });
      };
      await safeFetch(
        'https://example.com/file',
        { headers: { Cookie: 'session=secret', Authorization: 'Bearer secret', 'X-Test': 'kept' } },
        {},
      );
      assert(!capturedHeaders.has('cookie'), 'safeFetch strips Cookie from proxied requests');
      assert(!capturedHeaders.has('authorization'), 'safeFetch strips Authorization from proxied requests');
      assert(capturedHeaders.get('x-test') === 'kept', 'safeFetch preserves allow-listed request headers');

      globalThis.fetch = async () =>
        new Response('x'.repeat(64), { status: 200, headers: { 'Content-Length': '64' } });
      let sizeRejected = false;
      try {
        await safeFetch('https://example.com/big', {}, {}, { maxBytes: 16 });
      } catch (error) {
        sizeRejected = error instanceof OutboundError && error.code === 'response_too_large';
      }
      assert(sizeRejected, 'safeFetch enforces the response size cap');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  console.log('\n5. Proxy handlers reject dangerous targets before fetch');
  {
    const forwardLoopback = await handleSonicForward({
      request: forwardRequest('http://127.0.0.1:8080/api'),
      env: {},
    });
    assert(forwardLoopback.status === 400, `Forward to 127.0.0.1 rejected with 400 (got ${forwardLoopback.status})`);

    const forwardDecimal = await handleSonicForward({
      request: forwardRequest('https://2130706433/'),
      env: {},
    });
    assert(forwardDecimal.status === 400, `Forward to decimal loopback rejected with 400 (got ${forwardDecimal.status})`);

    const forwardUserinfo = await handleSonicForward({
      request: forwardRequest('https://user:pass@example.com/'),
      env: {},
    });
    assert(forwardUserinfo.status === 400, `Forward with userinfo rejected with 400 (got ${forwardUserinfo.status})`);

    const paletteUserinfo = await handlePalette({
      request: new Request('https://sonic.epocanvas.tech/palette?image=https%3A%2F%2Fuser%3Apass%40example.com%2Fa.png'),
      env: {},
    });
    assert(paletteUserinfo.status === 400, `Palette with userinfo rejected with 400 (got ${paletteUserinfo.status})`);

    const streamLoopback = await handleMusicStream({
      request: new Request('https://sonic.epocanvas.tech/api/music/stream?target=http%3A%2F%2F127.0.0.1%2Faudio.mp3'),
      env: {},
    });
    assert(streamLoopback.status === 400, `Stream target loopback rejected with 400 (got ${streamLoopback.status})`);

    const coverLoopback = await handleMusicCover({
      request: new Request('https://sonic.epocanvas.tech/api/music/cover?url=https%3A%2F%2F127.0.0.1%2Fa.png'),
      env: {},
    });
    assert(coverLoopback.status === 200, 'Cover falls back to branded SVG instead of fetching loopback');
    assert(coverLoopback.headers.get('X-Sonic-Cover-Fallback') === 'svg', 'Cover SSRF fallback marked');
  }

  console.log('\n6. Engine-side DNS resolution guard');
  {
    const loopback = await validateEngineOutboundTarget('https://127.0.0.1/', {});
    assert(loopback.ok === false, 'Engine DNS guard rejects loopback literal');
    const privateV6 = await validateEngineOutboundTarget('https://[::ffff:10.0.0.1]/', {});
    assert(privateV6.ok === false, 'Engine DNS guard rejects IPv4-mapped private literal');
    const publicIp = await validateEngineOutboundTarget('https://1.1.1.1/', {});
    assert(publicIp.ok === true, 'Engine DNS guard allows a public IP literal');
  }

  console.log(`\n========================================`);
  console.log(`SSRF Hardening Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch((error) => {
  console.error('Fatal SSRF test error:', error);
  process.exit(1);
});
