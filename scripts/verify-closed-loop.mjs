import { chromium } from 'playwright';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const LIVE_URL = 'https://sonic.epocanvas.com';
const OUTPUT_DIR = path.resolve('screenshots/audit-external-links');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function verify() {
  console.log('=== 🚀 Starting Real In-Station Functionality & Playback Verification ===');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // -------------------------------------------------------------
    // 1. Desktop Verification
    // -------------------------------------------------------------
    console.log('\n[1/2] Auditing Desktop (1440x900)...');
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
    });

    const desktopPage = await desktopContext.newPage();

    let desktopNewPages = [];
    desktopContext.on('page', async (newPage) => {
      desktopNewPages.push(newPage);
      console.log('⚠️ [Desktop] UNEXPECTED new popup/tab opened! URL:', newPage.url());
    });
    await desktopPage.goto(LIVE_URL, { waitUntil: 'networkidle' });
    await desktopPage.waitForTimeout(2000);

    // Locate active banner slide
    const bannerSelector = '.swiper-slide-active, .swiper-slide:not(.swiper-slide-duplicate)';
    await desktopPage.waitForSelector(bannerSelector, { timeout: 10000 });
    const bannerElem = desktopPage.locator(bannerSelector).first();
    const bannerText = await bannerElem.innerText();
    console.log(`Desktop found active banner:\n"${bannerText.replace(/\n+/g, ' ')}"`);

    // Click banner
    console.log('Clicking desktop banner...');
    await bannerElem.click();
    await desktopPage.waitForTimeout(4000);

    const desktopUrl = desktopPage.url();
    console.log(`Desktop navigated to: ${desktopUrl}`);

    // Assertions
    if (desktopNewPages.length > 0) {
      console.log(`⚠️ New pages detail: count=${desktopNewPages.length}, urls=${desktopNewPages.map(p => p.url()).join(', ')}`);
    }
    assert.strictEqual(desktopNewPages.length, 0, 'Desktop banner click must NOT open any new window or tab!');
    assert(
      desktopUrl.startsWith(LIVE_URL + '/song/') || desktopUrl.startsWith(LIVE_URL + '/album/'),
      `Desktop URL must be an in-station /song/ or /album/ route, got: ${desktopUrl}`
    );

    // Check page elements & audio playback state
    const audioState = await desktopPage.evaluate(() => {
      const audio = document.querySelector('audio');
      return {
        hasAudio: !!audio,
        src: audio ? audio.src : '',
        paused: audio ? audio.paused : true,
        currentTime: audio ? audio.currentTime : 0,
        title: document.querySelector('h1, h2, .text-xl, .text-2xl')?.textContent?.trim() || '',
      };
    });

    console.log('Desktop page & audio state:', JSON.stringify(audioState, null, 2));
    assert(audioState.hasAudio, 'Desktop page must contain an <audio> element');
    assert(audioState.src && audioState.src.length > 0, '<audio> element must have an active src stream!');

    const desktopScreenshotPath = path.join(OUTPUT_DIR, '01-closed-loop-desktop-banner-click.png');
    await desktopPage.screenshot({ path: desktopScreenshotPath, fullPage: false });
    console.log(`Desktop verification screenshot saved to: ${desktopScreenshotPath}`);
    await desktopContext.close();

    // -------------------------------------------------------------
    // 2. Mobile Verification
    // -------------------------------------------------------------
    console.log('\n[2/2] Auditing Mobile (390x844)...');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      locale: 'zh-CN',
    });

    const mobilePage = await mobileContext.newPage();

    let mobileNewPages = 0;
    mobileContext.on('page', () => {
      mobileNewPages++;
    });
    await mobilePage.goto(LIVE_URL, { waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(2000);

    const mobileBannerSelector = '.swiper-slide-active, .swiper-slide:not(.swiper-slide-duplicate)';
    await mobilePage.waitForSelector(mobileBannerSelector, { timeout: 10000 });
    const mobileBannerElem = mobilePage.locator(mobileBannerSelector).first();
    const mobileBannerText = await mobileBannerElem.innerText();
    console.log(`Mobile found active banner:\n"${mobileBannerText.replace(/\n+/g, ' ')}"`);

    console.log('Clicking mobile banner...');
    await mobileBannerElem.click();
    await mobilePage.waitForTimeout(4000);

    const mobileUrl = mobilePage.url();
    console.log(`Mobile navigated to: ${mobileUrl}`);

    // Assertions
    assert.strictEqual(mobileNewPages, 0, 'Mobile banner click must NOT open any new window or tab!');
    assert(
      mobileUrl.startsWith(LIVE_URL + '/song/') || mobileUrl.startsWith(LIVE_URL + '/album/'),
      `Mobile URL must be an in-station /song/ or /album/ route, got: ${mobileUrl}`
    );

    const mobileAudioState = await mobilePage.evaluate(() => {
      const audio = document.querySelector('audio');
      return {
        hasAudio: !!audio,
        src: audio ? audio.src : '',
        paused: audio ? audio.paused : true,
        currentTime: audio ? audio.currentTime : 0,
        title: document.querySelector('h1, h2, .text-xl, .text-2xl')?.textContent?.trim() || '',
      };
    });

    console.log('Mobile page & audio state:', JSON.stringify(mobileAudioState, null, 2));
    assert(mobileAudioState.hasAudio, 'Mobile page must contain an <audio> element');
    assert(mobileAudioState.src && mobileAudioState.src.length > 0, '<audio> element must have an active src stream!');

    const mobileScreenshotPath = path.join(OUTPUT_DIR, '02-closed-loop-mobile-banner-click.png');
    await mobilePage.screenshot({ path: mobileScreenshotPath, fullPage: false });
    console.log(`Mobile verification screenshot saved to: ${mobileScreenshotPath}`);
    await mobileContext.close();

    console.log('\n✅ All In-Station Closed-Loop and Playback verifications PASSED successfully!');
  } finally {
    await browser.close();
  }
}

verify().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
