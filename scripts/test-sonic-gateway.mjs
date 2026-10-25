// Test suite for Sonic Multi-Source Aggregation Gateway
import { handleNexusLyricsRequest } from '../functions/api/sonic/lyrics/nexus';
import { handleSingleProviderLyricsRequest } from '../functions/_lib/sonic/route-helpers';
import { handleNexusSearchRequest, handleSingleProviderSearchRequest } from '../functions/_lib/sonic/route-helpers';

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
  console.log('=== Running Sonic Gateway Test Suite ===\n');

  // Test 3: Lyrics Apple / YTMusic disabled handling (501 + message)
  console.log('\n3. Testing GET /api/sonic/lyrics/apple & ytmusic (disabled without keys)');
  {
    const appleReq = new Request('http://localhost/api/sonic/lyrics/apple?title=Hello&artist=Adele');
    const appleRes = await handleSingleProviderLyricsRequest('apple', appleReq, {});
    const appleJson = await appleRes.json();
    assert(appleRes.status === 501, `Apple returns 501 Not Implemented (got ${appleRes.status})`);
    assert(appleJson.error?.code === 'PROVIDER_DISABLED', `Apple error code is PROVIDER_DISABLED`);
    assert(appleJson.brand === 'Sonic', 'Brand is Sonic');

    const ytReq = new Request('http://localhost/api/sonic/lyrics/ytmusic?title=Hello&artist=Adele');
    const ytRes = await handleSingleProviderLyricsRequest('ytmusic', ytReq, {});
    const ytJson = await ytRes.json();
    assert(ytRes.status === 501, `YouTube Music returns 501 Not Implemented (got ${ytRes.status})`);
    assert(ytJson.error?.code === 'PROVIDER_DISABLED', `YouTube Music error code is PROVIDER_DISABLED`);
  }

  // Test 6: Single platform search gdstudio (disabled by default per Condition 1b)
  console.log('\n6. Testing GET /api/sonic/search/gdstudio (disabled by default)');
  {
    const req = new Request('http://localhost/api/sonic/search/gdstudio?q=%E6%B5%B7%E9%98%94%E5%A4%A9%E7%A9%BA&count=3&nocache=1');
    const res = await handleSingleProviderSearchRequest('gdstudio', req, {});
    const json = await res.json();

    assert(res.status === 200, `Status is 200 (got ${res.status})`);
    assert(json.brand === 'Sonic', `Brand is Sonic`);
    assert(json.meta.provider === 'gdstudio', `Meta provider is gdstudio`);
    assert(json.meta.disabled === true, `GDStudio is disabled by default (got ${json.meta.disabled})`);
    assert(Array.isArray(json.data.tracks) && json.data.tracks.length === 0, `Disabled GDStudio returns 0 tracks`);
  }

  // Test 12: Stream quality evaluation (duration-based via real MP3 frame header)
  console.log('\n12. Testing Stream Quality Evaluation (evaluateStreamQuality / relative fallback)');
  {
    const { evaluateStreamQuality, evaluateStreamTypeByRelativeBytes } = await import('../functions/_lib/sonic/native-protocols.ts');
    const head = (brIdx) => new Uint8Array([0xff, 0xfb, brIdx << 4, 0xc0, 0x00, 0x01, 0x02, 0x03]);
    const BR = { 128: 9, 320: 14 };

    // 1. 320kbps 45s trial preview (~1.8MB) on 240s song -> must be trial!
    const trial320k_45s = evaluateStreamQuality(1_800_000, 240, head(BR[320]), 320);
    assert(trial320k_45s.streamType === 'trial', `320k 45s preview (1.8MB) on 240s song is classified as trial (got ${trial320k_45s.streamType}, est=${trial320k_45s.estimatedDurationSec?.toFixed(0)}s)`);

    // 2. 320kbps 30s trial preview (~1.2MB) on 240s song -> must be trial!
    const trial320k_30s = evaluateStreamQuality(1_200_000, 240, head(BR[320]), 320);
    assert(trial320k_30s.streamType === 'trial', `320k 30s preview (1.2MB) on 240s song is classified as trial (got ${trial320k_30s.streamType})`);

    // 3. 320kbps 45s trial preview on short 150s song (~1.8MB) -> must be trial!
    const trial320k_short = evaluateStreamQuality(1_800_000, 150, head(BR[320]), 320);
    assert(trial320k_short.streamType === 'trial', `320k 45s preview (1.8MB) on 150s song is classified as trial (got ${trial320k_short.streamType})`);

    // 4. Audit counter-example: 90s COMPLETE 128kbps track requested as 320k -> full (duration-based, real bitrate)
    const full90s = evaluateStreamQuality(90 * 16_000, 90, head(BR[128]), 320);
    assert(full90s.streamType === 'full' && full90s.realBitrateKbps === 128, `90s complete 128kbps track is classified as full via real frame header (got ${full90s.streamType})`);

    // 5. Audit counter-example: lossless requested but 320k complete MP3 served -> full
    const flacReq = evaluateStreamQuality(9_600_000, 240, head(BR[320]), 800);
    assert(flacReq.streamType === 'full', `320k complete MP3 under a lossless request is classified as full (got ${flacReq.streamType})`);

    // 6. Genuine full 128kbps track (3.84MB) on 240s song with header -> full
    const full128k = evaluateStreamQuality(3_840_000, 240, head(BR[128]), 128);
    assert(full128k.streamType === 'full', `Full 128k track is classified as full (got ${full128k.streamType})`);

    // 7. Kuwo 181,521 bytes fake prompt audio -> must be unavailable!
    const fakeKuwo = evaluateStreamQuality(181_521, 240, head(BR[128]), 320);
    assert(fakeKuwo.streamType === 'unavailable', `Kuwo 181,521 bytes fake prompt is rejected as unavailable`);

    // 8. Neighbouring size with real header -> unavailable via range+duration rule
    const fakeNeighbor = evaluateStreamQuality(181_522, 240, head(BR[128]), 320);
    assert(fakeNeighbor.streamType === 'unavailable', `181,522 bytes (~11s @128k) rejected via byte-range + short-duration rule`);

    // 9. Zero bytes -> unavailable
    const zeroBytes = evaluateStreamQuality(0, 240, head(BR[320]), 320);
    assert(zeroBytes.streamType === 'unavailable', `0 bytes is unavailable`);

    // 10. Header-unparseable payload falls back to byte-ratio heuristic with low confidence
    const fallback = evaluateStreamQuality(3_840_000, 240, new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00]), 128);
    assert(fallback.streamType === 'full' && fallback.confidence === 'low' && fallback.method === 'byte-ratio-fallback', `Unparseable header (fLaC) falls back with confidence=low (got ${fallback.confidence})`);
  }


  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
