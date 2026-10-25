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
  console.log('=== Running Sonic Gateway LIVE Suite (network) ===\n');

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

