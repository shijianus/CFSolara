import { chromium } from 'playwright';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const LIVE_URL = 'https://sonic.epocanvas.com';
const OUTPUT_DIR = path.resolve('screenshots/audit-external-links');

async function testInStationClosedLoop() {
  console.log('=== 🚀 Starting In-Station Closed-Loop Verification ===');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // 1. Verify Gateway API using browser request context
    console.log(`\n1. Fetching Live API: ${LIVE_URL}/api/banner?type=0`);
    const reqContext = await browser.newContext();
    const apiRes = await reqContext.request.get(`${LIVE_URL}/api/banner?type=0`);
    assert.strictEqual(apiRes.status(), 200, 'API returns 200');
    const data = await apiRes.json();
    const banners = data.banners || [];
    console.log(`Retrieved ${banners.length} banners from live API:`);

    for (const b of banners) {
      console.log(`  Banner: targetType=${b.targetType} | targetId=${b.targetId} | typeTitle="${b.typeTitle}" | url="${b.url}"`);
      assert.notStrictEqual(b.targetType, 3000, 'Must NOT contain commercial banner (targetType 3000)');
      assert(!String(b.url).startsWith('http'), 'Banner url must NOT start with http(s)');
      assert(!String(b.url).startsWith('orpheus'), 'Banner url must NOT start with orpheus://');
      assert(String(b.url).startsWith('/'), 'Banner url must be an in-station route (/song, /album, /playlist, /mv-player)');
    }
    console.log('✓ Gateway API verification passed! All banners are strictly mapped to in-station routes!');
    await reqContext.close();

    // 2. Desktop Verification
    console.log('\n2. Auditing Desktop Viewport (1440x900)...');
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN'
    });
    const desktopPage = await desktopContext.newPage();

    let newTabsOpened = 0;
    desktopContext.on('page', () => {
      newTabsOpened++;
    });

    console.log(`Navigating to ${LIVE_URL}...`);
    await desktopPage.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Waiting for banner slides to render...');
    await desktopPage.waitForSelector('.swiper-slide [role="button"]', { timeout: 15000 });
    await desktopPage.waitForTimeout(1000);

    // Verify 0 <a> tags inside Swiper Banner
    const swiperALinks = await desktopPage.locator('.swiper .swiper-slide a').count();
    console.log(`<a> tags count inside Banner Swiper: ${swiperALinks}`);
    assert.strictEqual(swiperALinks, 0, 'Swiper slides must NOT contain <a> tags');

    const swiperTargetBlank = await desktopPage.locator('.swiper [target="_blank"]').count();
    console.log(`[target="_blank"] count inside Banner Swiper: ${swiperTargetBlank}`);
    assert.strictEqual(swiperTargetBlank, 0, 'Swiper slides must NOT have target="_blank"');

    // Verify clickable slides
    const clickableSlides = desktopPage.locator('.swiper .swiper-slide [role="button"]');
    const slideCount = await clickableSlides.count();
    console.log(`Found ${slideCount} clickable in-station banner slides`);
    assert(slideCount > 0, 'At least 1 clickable banner slide rendered');

    // Test clicking the first banner slide
    console.log('Clicking the first in-station banner slide...');
    await clickableSlides.first().click();
    await desktopPage.waitForTimeout(3000);

    const currentUrl = desktopPage.url();
    console.log(`✓ After click, in-station navigated URL: ${currentUrl}`);
    assert(currentUrl.startsWith(LIVE_URL), 'Navigation stayed 100% in-station on sonic.epocanvas.com');
    assert(currentUrl.includes('/song/') || currentUrl.includes('/album/'), 'Navigated to /song/ or /album/');
    assert.strictEqual(newTabsOpened, 0, 'NO external tabs opened! Everything is within the current UI!');

    await desktopPage.screenshot({ path: path.join(OUTPUT_DIR, '01-closed-loop-desktop-banner-click.png') });
    console.log('✓ Captured 01-closed-loop-desktop-banner-click.png');

    await desktopContext.close();

    // 3. Mobile Verification
    console.log('\n3. Auditing Mobile Viewport (390x844)...');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: 'zh-CN'
    });
    const mobilePage = await mobileContext.newPage();

    let mobileNewTabsOpened = 0;
    mobileContext.on('page', () => {
      mobileNewTabsOpened++;
    });

    console.log(`Navigating to ${LIVE_URL} on Mobile...`);
    await mobilePage.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Waiting for mobile banner slides to render...');
    await mobilePage.waitForSelector('.home-swiper [role="button"], .swiper-slide [role="button"]', { timeout: 15000 });
    await mobilePage.waitForTimeout(1000);

    const mobileSwiperALinks = await mobilePage.locator('.swiper .swiper-slide a').count();
    console.log(`Mobile: <a> tags inside Swiper: ${mobileSwiperALinks}`);
    assert.strictEqual(mobileSwiperALinks, 0, 'Mobile swiper must NOT contain <a> tags');

    const mobileClickable = mobilePage.locator('.swiper .swiper-slide [role="button"]');
    const mobileCount = await mobileClickable.count();
    console.log(`Found ${mobileCount} mobile in-station banner slides`);
    assert(mobileCount > 0, 'Mobile has in-station banner slides');

    console.log('Tapping mobile in-station banner slide...');
    await mobileClickable.first().click();
    await mobilePage.waitForTimeout(3000);

    const mobileUrl = mobilePage.url();
    console.log(`✓ After mobile tap, current URL: ${mobileUrl}`);
    assert(mobileUrl.startsWith(LIVE_URL), 'Mobile navigation stayed 100% in-station');
    assert.strictEqual(mobileNewTabsOpened, 0, 'NO external windows or popups opened on Mobile!');

    await mobilePage.screenshot({ path: path.join(OUTPUT_DIR, '02-closed-loop-mobile-banner-click.png') });
    console.log('✓ Captured 02-closed-loop-mobile-banner-click.png');

    await mobileContext.close();

    console.log('\n🎉 ALL IN-STATION CLOSED-LOOP AUDITS PASSED WITH 100% SUCCESS!');
  } finally {
    await browser.close();
  }
}

testInStationClosedLoop().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
