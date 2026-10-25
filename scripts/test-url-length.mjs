// Pure unit tests for oversized request URL handling (no network).
// Reproduces audit finding #16.5: an ~8KB target URL used to surface as a 500.
import { onRequest as handleMusicStream } from '../functions/api/music/stream.ts';
import { onRequest as handleSonicForward } from '../functions/api/sonic/forward.ts';
import { onRequest as handleProxy } from '../functions/proxy.ts';

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

function longTargetUrl() {
  const filler = 'a'.repeat(4000);
  return `http://127.0.0.1:1/${filler}`;
}

async function run() {
  console.log('\n1. /api/music/stream rejects oversized request URLs with 414');
  {
    const req = new Request(`https://sonic.epocanvas.tech/api/music/stream?target=${encodeURIComponent(longTargetUrl())}`);
    const res = await handleMusicStream({ request: req, env: {} });
    assert(res.status === 414, `stream returns 414 (got ${res.status})`);
  }

  console.log('2. /api/sonic/forward rejects oversized request URLs with 414');
  {
    const req = new Request(`https://sonic.epocanvas.tech/api/sonic/forward?url=${encodeURIComponent(longTargetUrl())}`);
    const res = await handleSonicForward({ request: req, env: {} });
    assert(res.status === 414, `forward returns 414 (got ${res.status})`);
  }

  console.log('3. legacy /proxy rejects oversized request URLs with 414');
  {
    const req = new Request(`https://sonic.epocanvas.tech/proxy?target=${encodeURIComponent(longTargetUrl())}`);
    const res = await handleProxy({ request: req, env: {} });
    assert(res.status === 414, `proxy returns 414 (got ${res.status})`);
  }

  console.log('4. Normal-sized requests are not affected');
  {
    const req = new Request('https://sonic.epocanvas.tech/api/music/stream');
    const res = await handleMusicStream({ request: req, env: {} });
    assert(res.status === 400, `normal-size missing-param request keeps its 400 semantics (got ${res.status})`);
  }

  console.log(`\n==== URL length tests: ${passed} passed, ${failed} failed ====`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
