import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const ARTIFACT_DIR = '/root/.gemini/antigravity-cli/brain/f6e8d79f-aa07-40e6-a6fd-b735f76cd982';
const CF_BASE_URL = 'https://cfsolara-dho.pages.dev';

async function verifyPageImages(page, pageName) {
  console.log(`\n--- Inspecting Images on ${pageName} ---`);
  // Wait for all images to finish loading/decoding
  await page.waitForFunction(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.length > 0 && imgs.every(img => img.complete);
  }, { timeout: 8000 }).catch(() => {});

  const imageStats = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.map((img) => ({
      src: img.src,
      currentSrc: img.currentSrc,
      alt: img.alt,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      complete: img.complete,
      visible: img.offsetWidth > 0 && img.offsetHeight > 0,
      classes: img.className,
    }));
  });

  let loadedCount = 0;
  let brokenCount = 0;
  const brokenList = [];

  for (const info of imageStats) {
    if (!info.src) continue;
    if (info.complete && info.naturalWidth > 0) {
      loadedCount++;
    } else {
      brokenCount++;
      brokenList.push(info);
    }
  }

  console.log(`Total <img> tags: ${imageStats.length}`);
  console.log(`Successfully loaded & rendered: ${loadedCount}`);
  console.log(`Broken or failed: ${brokenCount}`);

  if (brokenList.length > 0) {
    console.error(`Broken image details:`, JSON.stringify(brokenList, null, 2));
  } else {
    console.log(`✓ All visible images loaded with positive dimensions!`);
  }

  return { total: imageStats.length, loadedCount, brokenCount, brokenList };
}

async function runVisualVerification() {
  console.log(`Launching Chromium to visually test Cloudflare deployment: ${CF_BASE_URL}`);

  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    // 1. Desktop Verification
    console.log('\n[1/3] Testing Desktop Viewport (1440x900)...');
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const desktopPage = await desktopContext.newPage();

    // Listen to console and network errors
    const networkFailures = [];
    desktopPage.on('response', (response) => {
      const url = response.url();
      const status = response.status();
      if (status >= 400 && (url.includes('.jpg') || url.includes('.png') || url.includes('.webp') || url.includes('/cover') || url.includes('gtimg') || url.includes('126.net'))) {
        networkFailures.push({ url, status });
        console.warn(`  [Network Warning] ${status} for image ${url}`);
      }
    });

    await desktopPage.goto(CF_BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    // Scroll down to trigger lazy loading of playlists, songs, artists, MVs
    await desktopPage.evaluate(async () => {
      window.scrollTo(0, 500);
      await new Promise((r) => setTimeout(r, 1000));
      window.scrollTo(0, 1200);
      await new Promise((r) => setTimeout(r, 1500));
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 500));
    });

    const desktopStats = await verifyPageImages(desktopPage, 'Desktop Home');
    const desktopScreenshotPath = path.join(ARTIFACT_DIR, 'cf-desktop-verification.png');
    await desktopPage.screenshot({ path: desktopScreenshotPath, fullPage: false });
    console.log(`Desktop screenshot saved to: ${desktopScreenshotPath}`);
    await desktopContext.close();

    // 2. Mobile Verification
    console.log('\n[2/4] Testing Mobile Viewport (iPhone 14 / 390x844)...');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`${CF_BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await mobilePage.waitForTimeout(2000);

    await mobilePage.evaluate(async () => {
      window.scrollTo(0, 400);
      await new Promise((r) => setTimeout(r, 1000));
      window.scrollTo(0, 800);
      await new Promise((r) => setTimeout(r, 1200));
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 500));
    });

    const mobileStats = await verifyPageImages(mobilePage, 'Mobile Home');
    const mobileScreenshotPath = path.join(ARTIFACT_DIR, 'cf-mobile-verification.png');
    await mobilePage.screenshot({ path: mobileScreenshotPath, fullPage: false });
    console.log(`Mobile screenshot saved to: ${mobileScreenshotPath}`);
    await mobileContext.close();

    // 3. Search Page Multi-Channel Verification
    console.log('\n[3/4] Testing Multi-Channel Search Results Image Loading...');
    const searchContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const searchPage = await searchContext.newPage();
    await searchPage.goto(`${CF_BASE_URL}/search?q=%E6%B5%B7%E9%95%94%E5%A4%A9%E7%A9%BA`, { waitUntil: 'networkidle', timeout: 30000 });
    await searchPage.waitForTimeout(3000);

    const searchStats = await verifyPageImages(searchPage, 'Search Page ("海阔天空")');
    const searchScreenshotPath = path.join(ARTIFACT_DIR, 'cf-search-verification.png');
    await searchPage.screenshot({ path: searchScreenshotPath, fullPage: false });
    console.log(`Search screenshot saved to: ${searchScreenshotPath}`);
    await searchContext.close();

    // 4. Artists Page Verification
    console.log('\n[4/4] Testing Artists Page Portrait Image Loading...');
    const artistsContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const artistsPage = await artistsContext.newPage();
    await artistsPage.goto(`${CF_BASE_URL}/artists`, { waitUntil: 'networkidle', timeout: 30000 });
    await artistsPage.waitForTimeout(3000);

    const artistsStats = await verifyPageImages(artistsPage, 'Artists Directory Page');
    const artistsScreenshotPath = path.join(ARTIFACT_DIR, 'cf-artists-verification.png');
    await artistsPage.screenshot({ path: artistsScreenshotPath, fullPage: false });
    console.log(`Artists screenshot saved to: ${artistsScreenshotPath}`);
    await artistsContext.close();

    console.log('\n========================================');
    console.log('Visual & Image Verification Summary:');
    console.log(`Desktop: ${desktopStats.loadedCount}/${desktopStats.total} images loaded`);
    console.log(`Mobile:  ${mobileStats.loadedCount}/${mobileStats.total} images loaded`);
    console.log(`Search:  ${searchStats.loadedCount}/${searchStats.total} images loaded`);
    console.log(`Artists: ${artistsStats.loadedCount}/${artistsStats.total} images loaded`);
    console.log(`Total Image Network Failures: ${networkFailures.length}`);
    console.log('========================================\n');

    if (desktopStats.brokenCount > 0 || mobileStats.brokenCount > 0 || searchStats.brokenCount > 0 || artistsStats.brokenCount > 0) {
      console.error('Visual test detected broken images!');
      process.exit(1);
    } else {
      console.log('✓ Visual verification passed completely! Zero broken images!');
    }
  } finally {
    await browser.close();
  }
}

runVisualVerification().catch((err) => {
  console.error('Visual verification execution error:', err);
  process.exit(1);
});
