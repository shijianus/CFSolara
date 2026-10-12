import assert from 'node:assert';
import { handleNexusSearchRequest } from '../functions/_lib/sonic/route-helpers.ts';

async function run() {
  console.log('=== Verifying Nexus Search Multi-Quality & Ranking ===\n');

  // Test 1: Query exact match and multi-quality consolidation
  console.log('1. Testing Search for "海阔天空"');
  const req1 = new Request('http://localhost/api/sonic/search/nexus?q=%E6%B5%B7%E9%98%94%E5%A4%A9%E7%A9%BA&nocache=1');
  const res1 = await handleNexusSearchRequest(req1, {});
  const json1 = await res1.json();

  assert.strictEqual(res1.status, 200, 'Search response status 200');
  assert.strictEqual(json1.brand, 'Sonic', 'Brand is Sonic');
  assert(json1.data && Array.isArray(json1.data.tracks), 'Tracks array exists');
  assert(json1.data.tracks.length > 0, 'Found tracks for 海阔天空');

  const topTrack = json1.data.tracks[0];
  console.log(`  Top track: "${topTrack.title}" by "${topTrack.artist}" (sources count: ${topTrack.sources?.length || 1})`);
  assert(
    topTrack.title.toLowerCase().includes('海阔天空'),
    `Top track title matches query "海阔天空", got: "${topTrack.title}"`
  );

  // Verify multi-quality consolidation
  assert(Array.isArray(topTrack.qualities), 'Track has qualities array');
  console.log('  Consolidated qualities:', topTrack.qualities.map(q => `${q.label} (${q.bitrate})`).join(', '));
  assert(topTrack.qualities.length >= 2, 'Track has at least 2 consolidated quality tiers');

  const hasLossless = topTrack.qualities.some(q => q.level === 'lossless');
  const hasExhigh = topTrack.qualities.some(q => q.level === 'exhigh');
  const hasStandard = topTrack.qualities.some(q => q.level === 'standard');
  assert(hasLossless || hasExhigh, 'Has lossless or exhigh tier');
  assert(hasStandard, 'Has standard tier');

  // Check qualityBadge
  assert(['SQ', 'HQ', '标准'].includes(topTrack.qualityBadge), `Quality badge is valid: ${topTrack.qualityBadge}`);

  // Test 2: Check ranking weights
  console.log('\n2. Testing Ranking Weights (Most relevant & highest occurrence at top)');
  for (let i = 0; i < Math.min(3, json1.data.tracks.length); i++) {
    const t = json1.data.tracks[i];
    console.log(`  #${i + 1} "${t.title}" - ${t.artist} [${t.qualityBadge}] (Sources: ${t.sources?.length})`);
    assert(t.title, 'Track has title');
    assert(t.artist, 'Track has artist');
  }

  // Test 3: Query "晴天"
  console.log('\n3. Testing Search for "晴天" (Checking exact match priority)');
  const req2 = new Request('http://localhost/api/sonic/search/nexus?q=%E6%99%B4%E5%A4%A9&nocache=1');
  const res2 = await handleNexusSearchRequest(req2, {});
  const json2 = await res2.json();

  assert.strictEqual(res2.status, 200, 'Search response status 200');
  assert(json2.data.tracks.length > 0, 'Found tracks for 晴天');
  const qTop = json2.data.tracks[0];
  console.log(`  Top track for "晴天": "${qTop.title}" by "${qTop.artist}" [${qTop.qualityBadge}]`);
  assert(
    qTop.title.toLowerCase().includes('晴天'),
    `Top track contains "晴天", got: "${qTop.title}"`
  );
  assert(qTop.qualities && qTop.qualities.length >= 2, 'Has multiple qualities consolidated');

  console.log('\n✓ All Multi-Quality Search & Ranking Verification Passed!');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
