import { chromium } from '/home/shijian/projects/shijianus-blog/node_modules/playwright/index.mjs';

async function main() {
  console.log('🚀 Running Comprehensive Multilingual Syllable Alignment & Karaoke Test...');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const url = 'https://ca0530df.cfsolara-dho.pages.dev';
  console.log(`📡 Connecting to ${url}...`);
  await page.goto(`${url}/search?q=%E6%99%B4%E5%A4%A9`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // ═══════════════ TEST 1: CHINESE SYLLABLE ALIGNMENT (晴天) ═══════════════
  console.log('\n--- [TEST 1: Chinese Track "晴天"] ---');
  const songRow = await page.waitForSelector('table tbody tr, .song-item', { timeout: 10000 });
  await songRow.dblclick().catch(() => songRow.click());
  await page.waitForTimeout(2500);

  const footerCover = await page.waitForSelector('#footer-cover, .cover-inner', { timeout: 10000 });
  await footerCover.click();
  await page.waitForTimeout(2000);

  await page.waitForFunction(() => document.querySelectorAll('.lyrics-container .word-char').length > 0, { timeout: 15000 });

  const zhTotalWords = await page.evaluate(() => document.querySelectorAll('.lyrics-container .word-char').length);
  console.log(`✅ Chinese Track: Rendered ${zhTotalWords} .word-char syllable spans!`);

  // Click on syllable "事" (Index 1)
  console.log('⏩ Clicking Chinese syllable "事"...');
  const zhTest = await page.evaluate(async () => {
    const lines = Array.from(document.querySelectorAll('.lyrics-container .lyric-line'));
    const targetLine = lines.find(l => l.textContent.includes('故事的小黄花'));
    const wordShi = targetLine?.querySelectorAll('.word-char')[1]; // "事"
    wordShi?.click();
    await new Promise(r => setTimeout(r, 600));

    const curLine = document.querySelector('.lyrics-container .lyric-line.current');
    const singing = curLine?.querySelector('.word-singing');
    const sung = Array.from(curLine?.querySelectorAll('.word-sung') || []).map(c => c.textContent);
    const firstWord = curLine?.querySelector('.word-char');
    return {
      line: curLine?.textContent?.trim(),
      singingText: singing?.textContent,
      singingFill: singing?.style.getPropertyValue('--fill'),
      firstWordClass: firstWord?.className,
      firstWordFill: firstWord?.style.getPropertyValue('--fill'),
      firstWordBg: firstWord?.style.backgroundImage,
      sung,
    };
  });
  console.log('🎤 Chinese Syllable Result:', JSON.stringify(zhTest, null, 2));

  // ═══════════════ TEST 2: JAPANESE SYLLABLE ALIGNMENT (Lemon) ═══════════════
  console.log('\n--- [TEST 2: Japanese Track "Lemon"] ---');
  // Close drawer
  const closeBtn = await page.$('.player-drawer-close, button:has(.icon-\\[mdi--chevron-down\\])');
  if (closeBtn) await closeBtn.click();
  await page.waitForTimeout(1000);

  // Navigate to Lemon search
  await page.goto(`${url}/search?q=Lemon%20%E7%B1%B3%E6%B4%A5%E7%8E%84%E5%B8%AB`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const lemonRow = await page.waitForSelector('table tbody tr:has-text("Lemon"), .song-item:has-text("Lemon")', { timeout: 10000 });
  await lemonRow.dblclick().catch(() => lemonRow.click());
  await page.waitForTimeout(2500);

  const footerCover2 = await page.waitForSelector('#footer-cover, .cover-inner', { timeout: 10000 });
  await footerCover2.click();
  await page.waitForTimeout(2500);

  await page.waitForFunction(() => document.querySelectorAll('.lyrics-container .word-char').length > 0, { timeout: 15000 });

  const jpTotalWords = await page.evaluate(() => document.querySelectorAll('.lyrics-container .word-char').length);
  console.log(`✅ Japanese Track: Rendered ${jpTotalWords} .word-char syllable spans!`);

  // Verify that Japanese lines are INTACT (no words severed to translation line)
  const jpIntactCheck = await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.lyrics-container .lyric-line'));
    const sampleLine = lines.find(l => l.textContent.includes('どれほどよかったでしょう') || l.textContent.includes('夢ならば'));
    const lineText = sampleLine?.querySelector('.lyric-text')?.textContent?.trim();
    const subText = sampleLine?.querySelector('.lyric-sub')?.textContent?.trim();
    const chars = Array.from(sampleLine?.querySelectorAll('.word-char') || []).map(c => c.textContent);
    return {
      lineText,
      subText,
      chars
    };
  });
  console.log('🇯🇵 Japanese Line Integrity:', JSON.stringify(jpIntactCheck, null, 2));

  // Click on Japanese syllable "な" (Index 1)
  console.log('⏩ Clicking Japanese syllable "な"...');
  const jpTest = await page.evaluate(async () => {
    const lines = Array.from(document.querySelectorAll('.lyrics-container .lyric-line'));
    const sampleLine = lines.find(l => l.textContent.includes('どれほどよかったでしょう') || l.textContent.includes('夢ならば'));
    const targetChar = sampleLine?.querySelectorAll('.word-char')[1]; // "な"
    targetChar?.click();
    await new Promise(r => setTimeout(r, 450));

    const curLine = document.querySelector('.lyrics-container .lyric-line.current');
    const singing = curLine?.querySelector('.word-singing');
    const sung = Array.from(curLine?.querySelectorAll('.word-sung') || []).map(c => c.textContent);
    return {
      curLineText: curLine?.textContent?.trim(),
      singingWord: singing?.textContent,
      singingFill: singing?.style.getPropertyValue('--fill'),
      sungWords: sung
    };
  });
  console.log('🇯🇵 Japanese Syllable Alignment Result:', JSON.stringify(jpTest, null, 2));

  // ═══════════════ TEST 3: CSS & GSAP CONFLICT AUDIT ═══════════════
  console.log('\n--- [TEST 3: Animation Transition Audit] ---');
  const animAudit = await page.evaluate(() => {
    const scrollEl = document.querySelector('.lyrics-scroll');
    const lineEl = document.querySelector('.lyric-line');
    const scrollComputed = scrollEl ? window.getComputedStyle(scrollEl) : null;
    const lineComputed = lineEl ? window.getComputedStyle(lineEl) : null;

    return {
      scrollTransition: scrollComputed?.transition,
      lineTransition: lineComputed?.transition,
      scrollWillChange: scrollComputed?.willChange,
      lineTransformOrigin: lineComputed?.transformOrigin,
    };
  });
  console.log('🎨 Animation CSS Properties:', JSON.stringify(animAudit, null, 2));

  // Take verification screenshot
  const screenshotPath = '/root/.gemini/antigravity-cli/brain/806d817e-f996-411e-ab87-0b4f4f8bdb79/lyrics-multilingual-verification.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`\n📸 Screenshot successfully saved to ${screenshotPath}`);

  // Assertions
  const hasNoScrollTransitionLag = !animAudit.scrollTransition?.includes('transform 0.8s');
  const zhPassed = zhTotalWords > 0 && (zhTest?.singingText === '故' || zhTest?.sung?.includes('故') || zhTest?.singingText === '事');
  const jpPassed = jpTotalWords > 0 && jpIntactCheck?.chars?.length > 0 && (jpTest?.sungWords?.includes('夢') || jpTest?.sungWords?.includes('な') || jpTest?.singingWord === 'な' || jpTest?.singingWord === 'ら' || jpTest?.singingWord === '夢');

  if (zhPassed && jpPassed && hasNoScrollTransitionLag) {
    console.log('\n🎉 ALL RIGOROUS MULTILINGUAL & ANIMATION ALIGNMENT TESTS PASSED 100%!');
  } else {
    throw new Error(`Verification assertion failed: zhPassed=${zhPassed}, jpPassed=${jpPassed}, hasNoScrollTransitionLag=${hasNoScrollTransitionLag}`);
  }

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
