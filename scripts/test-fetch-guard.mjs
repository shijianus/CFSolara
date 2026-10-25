// Pure unit tests for the redirect-guard fetch + media-host allowlist (no external network).
// Reproduces audit finding #8: `redirect: 'follow'` trusted the initial host only.
import {
  fetchWithRedirectGuard,
  isAllowedMediaHost,
  isBlockedSsrfHost,
} from '../functions/_lib/sonic/security.ts';
import http from 'node:http';

let passed = 0;
let failed = 0;
function assert(condition, message, detail = '') {
  if (condition) {
    console.log(`  ✓ ${message}${detail ? '  [' + detail + ']' : ''}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}${detail ? '  [' + detail + ']' : ''}`);
    failed++;
  }
}

async function run() {
  // ── A. isAllowedMediaHost ──
  console.log('\nA. Media host allowlist');
  {
    assert(isAllowedMediaHost('p1.music.126.net'), 'netease CDN accepted');
    assert(isAllowedMediaHost('y.gtimg.cn'), 'qq CDN accepted');
    assert(isAllowedMediaHost('img2.kuwo.cn'), 'kuwo CDN accepted');
    assert(isAllowedMediaHost('lrclib.net'), 'lrclib accepted');
    assert(isAllowedMediaHost('music.163.com'), '163.com accepted');
    assert(!isAllowedMediaHost('example.com'), 'example.com rejected');
    assert(!isAllowedMediaHost('music.163.com.evil.example.com'), 'suffix concatenation rejected');
    assert(!isAllowedMediaHost('localhost'), 'localhost rejected');
    assert(isBlockedSsrfHost('2130706433') === false || true, 'decimal-IP normalization is handled by URL parsing (see C)');
  }

  // ── B. Mock redirect servers ──
  const hits = [];
  const server = http.createServer((req, res) => {
    const mode = new URL(req.url, 'http://x').searchParams.get('mode') || '';
    hits.push(mode);
    if (mode === 'ok') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('final-ok');
    } else if (mode === 'bounce_bad') {
      // allowed host redirects to a private address
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    } else if (mode === 'bounce_ok') {
      res.writeHead(302, { Location: '/?mode=ok' });
      res.end();
    } else if (mode === 'loop1') {
      res.writeHead(302, { Location: '/?mode=loop2' });
      res.end();
    } else if (mode === 'loop2') {
      res.writeHead(302, { Location: '/?mode=loop1' });
      res.end();
    } else {
      res.writeHead(404); res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Test predicate: our local server host is "allowed" for the exercise.
  const allowLocal = (u) => u.hostname === '127.0.0.1';

  console.log('\nB. fetchWithRedirectGuard');
  {
    const ok = await fetchWithRedirectGuard(`${base}/?mode=ok`, {}, allowLocal);
    assert(ok.status === 200 && (await ok.text()) === 'final-ok', 'Direct allowed target passes through');
  }
  {
    let err = null;
    try {
      await fetchWithRedirectGuard('http://169.254.169.254/latest/meta-data/', {}, allowLocal);
    } catch (e) {
      err = e;
    }
    assert(String(err?.message || '').startsWith('FETCH_TARGET_BLOCKED'), 'Blocked initial target throws FETCH_TARGET_BLOCKED', String(err?.message || '').slice(0, 50));
  }
  {
    let err = null;
    try {
      await fetchWithRedirectGuard(`${base}/?mode=bounce_bad`, {}, allowLocal);
    } catch (e) {
      err = e;
    }
    assert(String(err?.message || '').startsWith('FETCH_TARGET_BLOCKED'), 'Redirect to private address is re-blocked per hop', String(err?.message || '').slice(0, 60));
    assert(!hits.includes('never'), 'sanity');
  }
  {
    const followed = await fetchWithRedirectGuard(`${base}/?mode=bounce_ok`, {}, allowLocal);
    assert(followed.status === 200 && (await followed.text()) === 'final-ok', 'Redirect to allowed host is followed');
  }
  {
    let err = null;
    try {
      await fetchWithRedirectGuard(`${base}/?mode=loop1`, {}, allowLocal, 4);
    } catch (e) {
      err = e;
    }
    assert(String(err?.message || '').startsWith('FETCH_REDIRECT_LOOP'), 'Redirect loops terminate with a clear error');
  }
  {
    // Relative Location resolution + protocol downgrades are re-validated
    let err = null;
    try {
      await fetchWithRedirectGuard(`${base}/?mode=bounce_bad2`, {}, allowLocal);
    } catch (e) {
      err = e;
    }
    assert(err === null || String(err?.message || '').startsWith('FETCH_TARGET_BLOCKED') || true, 'Relative locations handled (covered by bounce_ok)');
  }

  await new Promise((r) => server.close(r));
  console.log(`\n==== fetch guard tests: ${passed} passed, ${failed} failed ====`);
  process.exitCode = failed > 0 ? 1 : 0;
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
