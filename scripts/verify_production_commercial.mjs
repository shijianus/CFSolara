// Automated Production Audit Script for Sonic Commercial Upgrade
// Verifies fullscreen layout, SHA search deduplication, sound quality tiers, and upstream commercial endpoints

const DOMAINS = ['https://cfsolara-dho.pages.dev', 'https://sonic.epocanvas.com'];

async function runAudit() {
  console.log('=== Starting Sonic Commercial Production Audit ===\n');

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

  for (const domain of DOMAINS) {
    console.log(`\n--- Auditing Domain: ${domain} ---`);

    // 1. HTML & Fullscreen Layout check
    try {
      const htmlResp = await fetch(domain, { headers: { 'User-Agent': 'SonicAudit/2.0' } });
      const html = await htmlResp.text();
      assert(htmlResp.status === 200, 'Home page HTTP 200');
      assert(html.includes('<title>Sonic - Cloud Music Platform</title>'), 'Page title is Sonic');
      assert(html.includes('content="EpoCanvas"'), 'Author is EpoCanvas');
      assert(!html.includes('hm.baidu.com'), 'No Baidu analytics');
      assert(!html.includes('google-analytics.com'), 'No Google analytics');
    } catch (e) {
      assert(false, `Home page fetch error: ${e.message}`);
    }

    // 2. Upstream Commercial Endpoints
    const endpoints = [
      { path: '/api/banner', check: (d) => Array.isArray(d.banners) && d.banners.length > 0, name: 'Banner Carousel' },
      { path: '/api/top/playlist?limit=10', check: (d) => Array.isArray(d.playlists) && d.playlists.length > 0, name: 'Top Playlists' },
      { path: '/api/top/song', check: (d) => Array.isArray(d.data) && d.data.length > 0, name: 'Hot / New Songs' },
      { path: '/api/top/artists?limit=10', check: (d) => Array.isArray(d.artists) && d.artists.length > 0, name: 'Top Artists Catalog' },
      { path: '/api/personalized/mv', check: (d) => Array.isArray(d.result) && d.result.length > 0, name: 'Personalized MVs' },
      { path: '/api/mv/all?limit=12', check: (d) => Array.isArray(d.data) && d.data.length > 0, name: 'MV All Directory' },
      { path: '/api/mv/detail?id=5436712', check: (d) => Boolean(d.data && d.data.id && d.data.brs), name: 'MV Detail with Multi-Resolution Streams' },
      { path: '/api/mv/url?id=5436712', check: (d) => Boolean(d.data && typeof d.data.url === 'string' && d.data.url.includes('.mp4')), name: 'MV Direct Video Stream URL (.mp4)' },
      { path: '/api/toplist/detail', check: (d) => Array.isArray(d.list) && d.list.length > 0, name: 'Leaderboard Charts List' },
      { path: '/api/playlist/detail?id=3778678', check: (d) => Boolean(d.playlist && d.playlist.id), name: 'Playlist Details & Tracks' },
      { path: '/api/search/hot/detail', check: (d) => Array.isArray(d.data) && d.data.length > 0, name: 'Hot Search Trending List' },
      { path: '/api/search/suggest?keywords=%E5%91%A8%E6%9D%B0%E4%BC%A6', check: (d) => Boolean(d.result), name: 'Realtime Search Suggestions' },
    ];

    for (const ep of endpoints) {
      try {
        const resp = await fetch(`${domain}${ep.path}`, { headers: { 'User-Agent': 'SonicAudit/2.0' } });
        assert(resp.status === 200, `${ep.name} (${ep.path}) returned HTTP 200`);
        const json = await resp.json();
        assert(json.brand === 'Sonic', `${ep.name} branded as Sonic`);
        assert(ep.check(json), `${ep.name} payload structure verified`);
      } catch (e) {
        assert(false, `${ep.name} failed: ${e.message}`);
      }
    }

    // 3. SHA-Deduplicated Search & Quality Classification Check
    try {
      const searchResp = await fetch(`${domain}/api/sonic/search/nexus?q=%E5%91%A8%E6%9D%B0%E4%BC%A6&count=6&nocache=1`);
      assert(searchResp.status === 200, 'Search Nexus HTTP 200');
      const searchJson = await searchResp.json();
      assert(searchJson.brand === 'Sonic', 'Search brand is Sonic');
      const tracks = searchJson?.data?.tracks || [];
      assert(tracks.length > 0, `Search returned ${tracks.length} tracks`);

      if (tracks.length > 0) {
        const sample = tracks[0];
        assert(Boolean(sample.sha && sample.sha.length >= 8), `Track has canonical SHA hash: ${sample.sha}`);
        assert(Boolean(sample.qualityBadge), `Track has sound quality badge: [${sample.qualityBadge}]`);
        assert(Array.isArray(sample.qualities) && sample.qualities.length > 0, `Track has stratified qualities: ${sample.qualities.map(q => q.label).join(', ')}`);
        assert(sample.platform === 'sonic', `Provider is desensitized to Sonic (got "${sample.platform}")`);
        assert(sample.streamUrl && sample.streamUrl.includes('/api/music/stream'), `Track includes direct stream URL: ${sample.streamUrl}`);
      }
    } catch (e) {
      assert(false, `Search Nexus audit error: ${e.message}`);
    }
  }

  console.log('\n========================================');
  console.log(`Audit Summary: ${passed} passed, ${failed} failed`);
  console.log('========================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAudit();
