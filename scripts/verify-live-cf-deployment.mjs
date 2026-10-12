import assert from 'node:assert';
import { chromium } from 'playwright';

const LIVE_BASE_URL = 'https://cfsolara-dho.pages.dev';

async function verifyLiveApi() {
  console.log(`\n=== 1. Verifying Live API on Cloudflare: ${LIVE_BASE_URL} ===`);
  const apiUrl = `${LIVE_BASE_URL}/api/sonic/search/nexus?q=${encodeURIComponent('海阔天空')}&nocache=1`;
  console.log(`Fetching: ${apiUrl}`);

  const res = await fetch(apiUrl);
  assert.strictEqual(res.status, 200, `Live API status is 200 (got ${res.status})`);
  const json = await res.json();

  assert.strictEqual(json.brand, 'Sonic', 'Live API brand is Sonic');
  assert(json.data && Array.isArray(json.data.tracks), 'Live API returned tracks');
  assert(json.data.tracks.length > 0, `Live API returned ${json.data.tracks.length} tracks`);

  const topTrack = json.data.tracks[0];
  console.log(`✓ Top live track: "${topTrack.title}" by "${topTrack.artist}" [${topTrack.qualityBadge}]`);
  console.log(`✓ Sources count in cluster: ${topTrack.sources?.length || 1}`);

  assert(Array.isArray(topTrack.qualities), 'Top track has qualities array');
  console.log(`✓ Consolidated qualities:`, topTrack.qualities.map(q => `${q.label} (${q.bitrate})`).join(', '));
  assert(topTrack.qualities.length >= 2, 'Top track has >= 2 quality tiers');

  // Verify SHA is not exposed in public display title or name
  assert(!topTrack.title.includes('#'), 'Title does not expose SHA hash');
  console.log('✓ Live API verification passed!');
}

async function verifyLiveUi() {
  console.log(`\n=== 2. Verifying Live UI on Cloudflare with Headless Browser ===`);
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN'
  });

  try {
    page.on('console', msg => console.log(`[Browser Console ${msg.type()}]:`, msg.text()));
    page.on('pageerror', err => console.error('[Browser PageError]:', err));
    page.on('response', res => {
      if (res.url().includes('/api/')) {
        console.log(`[Browser API ${res.status()}]:`, res.url());
      }
    });

    // 2.1 Test Navigation to Search Page
    console.log(`Navigating to: ${LIVE_BASE_URL}/search?q=${encodeURIComponent('海阔天空')}`);
    await page.goto(`${LIVE_BASE_URL}/search?q=${encodeURIComponent('海阔天空')}`, { waitUntil: 'load', timeout: 30000 });

    // Wait for song list container or song items
    console.log('Waiting for search results to render...');
    await page.waitForTimeout(3000);
    console.log('Current URL in browser:', page.url());
    await page.waitForSelector('.song-item', { timeout: 15000 });

    const songCount = await page.locator('.song-item').count();
    console.log(`✓ Rendered ${songCount} songs on live search page`);
    assert(songCount > 0, 'At least 1 song rendered');

    // 2.2 Verify No SHA hash (#xxxxxx) is exposed in song items
    const songItemTexts = await page.locator('.song-item').allTextContents();
    const shaMatchesInItems = songItemTexts.filter(t => /#[0-9a-f]{6}/i.test(t));
    console.log(`SHA hash matches in song items: ${shaMatchesInItems.length > 0 ? shaMatchesInItems.join(', ') : 'None (clean)'}`);
    assert.strictEqual(shaMatchesInItems.length, 0, 'No SHA hash (#xxxxxx) exposed in song items');
    console.log('✓ Verified: SHA is NOT exposed in song items or song titles!');

    // 2.3 Verify Quality Badges (SQ 无损 / HQ 极高 / 多音质)
    const badgeTexts = await page.locator('.song-item span').allTextContents();
    const hasSQ = badgeTexts.some(t => t.includes('SQ 无损') || t.includes('SQ'));
    const hasHQ = badgeTexts.some(t => t.includes('HQ 极高') || t.includes('HQ'));
    const hasMulti = badgeTexts.some(t => t.includes('多音质'));
    console.log(`✓ Found SQ badge: ${hasSQ}, HQ badge: ${hasHQ}, 多音质 badge: ${hasMulti}`);
    assert(hasSQ || hasHQ, 'Quality badge is displayed on song items');

    // 2.4 Verify Download Button and Quality Modal
    console.log('Testing Download button...');
    const downloadBtn = page.locator('.song-item button:has(.icon-\\[mdi--tray-arrow-down\\])').first();
    const hasDownloadBtn = await downloadBtn.count() > 0;
    console.log(`✓ Found download button on song item: ${hasDownloadBtn}`);
    assert(hasDownloadBtn, 'Song item has download button');

    await downloadBtn.click();
    console.log('Clicked download button, checking for Download Quality Dialog modal...');
    await page.waitForTimeout(500);

    const dialogTitle = await page.locator('h3:has-text("下载音质选择")').count();
    console.log(`✓ Download Quality Dialog visible: ${dialogTitle > 0}`);
    assert(dialogTitle > 0, 'Download Quality Dialog opened successfully');

    // Verify dialog options
    const dialogOptions = await page.locator('label:has(input[name="audioQuality"])').allTextContents();
    console.log('✓ Dialog options:', dialogOptions.map(t => t.replace(/\s+/g, ' ').trim()));
    assert(dialogOptions.length >= 2, 'Dialog has quality options');

    // Close dialog
    const cancelBtn = page.locator('button:has-text("取消")');
    if (await cancelBtn.count() > 0) {
      await cancelBtn.first().click();
    } else {
      await page.locator('button:has(.icon-\\[mdi--close\\])').first().click({ force: true });
    }
    await page.waitForTimeout(500);

    // 2.5 Test Play Song & Player Dock Quality Switcher
    console.log('Testing song playback & player dock quality switcher button...');
    const firstSongItem = page.locator('.song-item').first();
    await firstSongItem.dblclick();
    await page.waitForTimeout(2000);

    // Verify player dock has quality switcher button
    const playerDock = page.locator('footer.player-panel');
    assert(await playerDock.count() > 0, 'Player dock exists');

    const qualitySwitcherBtn = playerDock.locator('button:has-text("SQ"), button:has-text("HQ"), button:has-text("标准")');
    const hasQualityBtn = await qualitySwitcherBtn.count() > 0;
    console.log(`✓ Found Quality Switcher button in player dock: ${hasQualityBtn}`);
    assert(hasQualityBtn, 'Player dock contains quality switcher button');

    const qualityBtnText = await qualitySwitcherBtn.first().textContent();
    console.log(`✓ Current active quality button text: "${qualityBtnText.trim()}"`);

    // Click quality switcher to test floating popover
    await qualitySwitcherBtn.first().click();
    await page.waitForTimeout(400);

    const qualityPopover = page.locator('div:has-text("音质切换"):has-text("Hi-Fi")');
    const popoverCount = await qualityPopover.count();
    console.log(`✓ Quality switch menu popover opened: ${popoverCount > 0}`);
    assert(popoverCount > 0, 'Quality switch menu popover opened');

    // Close popover
    await page.keyboard.press('Escape');

    // 2.6 Test Downloads Page Route (/downloads)
    console.log(`Navigating to: ${LIVE_BASE_URL}/downloads`);
    await page.goto(`${LIVE_BASE_URL}/downloads`, { waitUntil: 'networkidle', timeout: 20000 });

    const downloadPageHeader = page.locator('h1:has-text("下载列表")');
    const hasDownloadPage = await downloadPageHeader.count() > 0;
    console.log(`✓ Downloads page header rendered: ${hasDownloadPage}`);
    assert(hasDownloadPage, 'Downloads page rendered successfully');

    // 2.7 Verify Sidebar Navigation contains "下载列表"
    const asideLink = page.locator('nav a[href*="/downloads"]');
    const hasAsideLink = await asideLink.count() > 0;
    console.log(`✓ Aside navigation has Downloads link: ${hasAsideLink}`);
    assert(hasAsideLink, 'Aside navigation contains Downloads link');

    console.log('\n======================================================');
    console.log('✓ All Live Cloudflare Production Verifications PASSED!');
    console.log('======================================================');
  } finally {
    await browser.close();
  }
}

async function main() {
  await verifyLiveApi();
  await verifyLiveUi();
}

main().catch((err) => {
  console.error('\n❌ Live Verification Failed:', err);
  process.exit(1);
});
