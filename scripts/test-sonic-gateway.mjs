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

  // Test 1: Lyrics Nexus with platform + platformId
  console.log('1. Testing GET /api/sonic/lyrics/nexus (with platformId)');
  {
    const req = new Request('http://localhost/api/sonic/lyrics/nexus?title=%E5%B9%B4%E5%B0%91%E6%9C%89%E4%B8%BA&artist=%E6%9D%8E%E6%8D%A3%E6%B5%A9&platform=netease&platformId=1293886117&nocache=1');
    const res = await handleNexusLyricsRequest(req, {});
    const json = await res.json();

    assert(res.status === 200, `Status is 200 (got ${res.status})`);
    assert(json.brand === 'Sonic', `Brand is Sonic (got ${json.brand})`);
    assert(json.data !== undefined, 'Data object exists');
    assert(json.meta !== undefined, 'Meta object exists');
    assert(Array.isArray(json.meta.attempts), 'Meta.attempts is an array');
    assert(typeof json.meta.latencyMs === 'number', `LatencyMs is number (${json.meta.latencyMs}ms)`);
    assert(json.meta.attempts.some(a => a.provider === 'netease'), 'Netease attempt recorded');
  }

  // Test 2: Lyrics Nexus with Title only (no platformId)
  console.log('\n2. Testing GET /api/sonic/lyrics/nexus (title only)');
  {
    const req = new Request('http://localhost/api/sonic/lyrics/nexus?title=Shape%20of%20You&artist=Ed%20Sheeran&nocache=1');
    const res = await handleNexusLyricsRequest(req, {});
    const json = await res.json();

    assert(res.status === 200, `Status is 200 (got ${res.status})`);
    assert(json.brand === 'Sonic', `Brand is Sonic`);
    assert(Array.isArray(json.meta.attempts), `Meta.attempts recorded (${json.meta.attempts.length} attempts)`);
  }

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

  // Test 4: Single provider lyric routes
  console.log('\n4. Testing GET /api/sonic/lyrics/netease');
  {
    const req = new Request('http://localhost/api/sonic/lyrics/netease?title=%E5%B9%B4%E5%B0%91%E6%9C%89%E4%B8%BA&platformId=1293886117&nocache=1');
    const res = await handleSingleProviderLyricsRequest('netease', req, {});
    const json = await res.json();
    assert(res.status === 200, `Status is 200 (got ${res.status})`);
    assert(json.brand === 'Sonic', `Brand is Sonic`);
    assert(json.meta.provider === 'netease', `Provider is netease`);
    assert(Array.isArray(json.meta.attempts), 'Attempts logged');
  }

  // Test 5: Search Nexus (parallel aggregation & merging)
  console.log('\n5. Testing GET /api/sonic/search/nexus');
  {
    const req = new Request('http://localhost/api/sonic/search/nexus?q=%E6%B5%B7%E9%98%94%E5%A4%A9%E7%A9%BA&count=5&nocache=1');
    const res = await handleNexusSearchRequest(req, {});
    const json = await res.json();

    assert(res.status === 200, `Status is 200 (got ${res.status})`);
    assert(json.brand === 'Sonic', `Brand is Sonic`);
    assert(json.data && Array.isArray(json.data.tracks), `Tracks array returned (${json.data?.tracks?.length} tracks)`);
    assert(Array.isArray(json.meta.attempts), `Meta.attempts logged (${json.meta?.attempts?.length} attempts)`);

    if (json.data.tracks.length > 0) {
      const t = json.data.tracks[0];
      assert(t.title !== undefined, `Track has title: "${t.title}"`);
      assert(t.artist !== undefined, `Track has artist: "${t.artist}"`);
      assert(t.platform !== undefined, `Track has platform: "${t.platform}"`);
      assert(t.platformId !== undefined, `Track has platformId: "${t.platformId}"`);
      assert(Array.isArray(t.sources), `Track has sources[]: ${JSON.stringify(t.sources)}`);
    }
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

  // Test 7: Timeout & Upstream isolation
  console.log('\n7. Testing Upstream Timeout Isolation (1ms timeout)');
  {
    const req = new Request('http://localhost/api/sonic/search/nexus?q=%E5%91%A8%E6%9D%B0%E4%BC%A6&nocache=1');
    const res = await handleNexusSearchRequest(req, { SONIC_TIMEOUT_MS: '1' });
    const json = await res.json();

    assert(res.status === 200, `Search returns 200 despite timeouts (got ${res.status})`);
    assert(json.brand === 'Sonic', `Brand is Sonic`);
    assert(Array.isArray(json.meta.attempts), `Attempts logged with timeout errors`);
  }

  // Test 8: QQ Desktop Search returns tracks
  console.log('\n8. Testing GET /api/sonic/search/qq (u.y.qq.com modern API)');
  {
    const req = new Request('http://localhost/api/sonic/search/qq?q=%E6%99%B4%E5%A4%A9&count=3&nocache=1');
    const res = await handleSingleProviderSearchRequest('qq', req, {});
    const json = await res.json();

    assert(res.status === 200, `Status is 200 (got ${res.status})`);
    assert(json.brand === 'Sonic', `Brand is Sonic`);
    assert(json.data && Array.isArray(json.data.tracks) && json.data.tracks.length > 0, `QQ returned ${json.data?.tracks?.length} tracks`);
  }

  // Test 9: Native NetEase & Kugou Single Provider Search + Default Third-Party Exclusion
  console.log('\n9. Testing Native NetEase/Kugou Search & meta.attempts Provenance');
  {
    const neReq = new Request('http://localhost/api/sonic/search/netease?q=%E8%B5%B7%E9%A3%8E%E4%BA%86&count=3&nocache=1');
    const neRes = await handleSingleProviderSearchRequest('netease', neReq, {});
    const neJson = await neRes.json();

    assert(neRes.status === 200, `NetEase Status is 200 (got ${neRes.status})`);
    assert(neJson.brand === 'Sonic', `Brand is Sonic`);
    assert(Array.isArray(neJson.data?.tracks) && neJson.data.tracks.length > 0, `Native NetEase returned ${neJson.data?.tracks?.length} tracks`);
    assert(neJson.meta.attempts.every(a => a.provider !== 'gdstudio'), `NetEase did not call gdstudio`);

    const nxReq = new Request('http://localhost/api/sonic/search/nexus?q=%E8%B5%B7%E9%A3%8E%E4%BA%86&count=3&nocache=1');
    const nxRes = await handleNexusSearchRequest(nxReq, {});
    const nxJson = await nxRes.json();
    assert(!nxJson.meta.attempts.some(a => a.provider === 'gdstudio'), `Nexus search excludes gdstudio by default`);
    assert(nxJson.meta.attempts.every(a => typeof a.source === 'string' && typeof a.via === 'string'), `Every attempt records truthful source & via`);
  }

  // Test 10: Kuwo Dynamic Search (no 404)
  console.log('\n10. Testing GET /api/sonic/search/kuwo (registered provider)');
  {
    const req = new Request('http://localhost/api/sonic/search/kuwo?q=%E6%B5%B7%E9%98%94%E5%A4%A9%E7%A9%BA&count=3&nocache=1');
    const res = await handleSingleProviderSearchRequest('kuwo', req, {});
    const json = await res.json();

    assert(res.status === 200, `Status is 200, NOT 404 (got ${res.status})`);
    assert(json.brand === 'Sonic', `Brand is Sonic`);
  }

  // Test 11: Musixmatch False-Positive Prevention for Gibberish Lyrics
  console.log('\n11. Testing Random String Lyrics (Must NOT return false-positive song)');
  {
    const req = new Request('http://localhost/api/sonic/lyrics/nexus?title=qx7z_unfindable_string_9182371928&nocache=1');
    const res = await handleNexusLyricsRequest(req, {});
    const json = await res.json();

    assert(res.status === 200, `Status is 200 (got ${res.status})`);
    assert(json.brand === 'Sonic', `Brand is Sonic`);
    assert(json.data.level === 'none', `Level is 'none' for gibberish (got '${json.data.level}')`);
    assert(json.data.syncedLyrics.length === 0, `No false-positive lyrics returned (length=${json.data.syncedLyrics.length})`);
  }

  // Test 12: Relative Threshold Audio Stream Evaluation (Rejects 320kbps 30~45s previews from being misidentified as full)
  console.log('\n12. Testing Relative Threshold Stream Evaluation (evaluateStreamTypeByRelativeBytes)');
  {
    const { evaluateStreamTypeByRelativeBytes } = await import('../functions/_lib/sonic/native-protocols.ts');

    // 1. 320kbps 45s trial preview (~1.8MB) on 240s song -> must be trial!
    const trial320k_45s = evaluateStreamTypeByRelativeBytes(1_800_000, 240, 320);
    assert(trial320k_45s.streamType === 'trial', `320k 45s preview (1.8MB) on 240s song is classified as trial (got ${trial320k_45s.streamType}, ratio=${trial320k_45s.ratio.toFixed(2)})`);

    // 2. 320kbps 30s trial preview (~1.2MB) on 240s song -> must be trial!
    const trial320k_30s = evaluateStreamTypeByRelativeBytes(1_200_000, 240, 320);
    assert(trial320k_30s.streamType === 'trial', `320k 30s preview (1.2MB) on 240s song is classified as trial (got ${trial320k_30s.streamType})`);

    // 3. 320kbps 45s trial preview on short 150s song (~1.8MB) -> must be trial!
    const trial320k_short = evaluateStreamTypeByRelativeBytes(1_800_000, 150, 320);
    assert(trial320k_short.streamType === 'trial', `320k 45s preview (1.8MB) on 150s song is classified as trial (got ${trial320k_short.streamType}, ratio=${trial320k_short.ratio.toFixed(2)})`);

    // 4. 128kbps 45s trial preview (721,023 bytes) on 240s song -> must be trial!
    const trial128k_45s = evaluateStreamTypeByRelativeBytes(721_023, 240, 128);
    assert(trial128k_45s.streamType === 'trial', `128k 45s preview (721KB) is classified as trial`);

    // 5. 128kbps 30s trial preview (481,115 bytes) on 240s song -> must be trial!
    const trial128k_30s = evaluateStreamTypeByRelativeBytes(481_115, 240, 128);
    assert(trial128k_30s.streamType === 'trial', `128k 30s preview (481KB) is classified as trial`);

    // 6. Genuine full 320kbps track (9.6MB) on 240s song -> must be full!
    const full320k = evaluateStreamTypeByRelativeBytes(9_600_000, 240, 320);
    assert(full320k.streamType === 'full', `Full 320k track (9.6MB) is classified as full (got ${full320k.streamType}, ratio=${full320k.ratio.toFixed(2)})`);

    // 7. Genuine full 128kbps track (3.8MB) on 240s song -> must be full!
    const full128k = evaluateStreamTypeByRelativeBytes(3_840_000, 240, 128);
    assert(full128k.streamType === 'full', `Full 128k track (3.8MB) is classified as full (got ${full128k.streamType}, ratio=${full128k.ratio.toFixed(2)})`);

    // 8. Kuwo 181,521 bytes fake prompt audio -> must be unavailable!
    const fakeKuwo = evaluateStreamTypeByRelativeBytes(181_521, 240, 320);
    assert(fakeKuwo.streamType === 'unavailable', `Kuwo 181,521 bytes fake prompt is rejected as unavailable`);

    // 9. Zero bytes -> unavailable
    const zeroBytes = evaluateStreamTypeByRelativeBytes(0, 240, 320);
    assert(zeroBytes.streamType === 'unavailable', `0 bytes is unavailable`);
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
