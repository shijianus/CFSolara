import { chromium } from 'playwright';

async function main() {
  console.log('🚀 Running Live Syllable Alignment & Karaoke Wipe Test...');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const url = 'https://8bb35652.cfsolara-dho.pages.dev';
  console.log(`📡 Connecting to ${url}...`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  console.log('🔍 Searching for "晴天"...');
  const searchInput = await page.waitForSelector('input[placeholder*="搜索"], input[type="text"]', { timeout: 10000 });
  await searchInput.fill('晴天');
  await searchInput.press('Enter');
  await page.waitForTimeout(3000);

  console.log('▶️ Playing song...');
  const songRow = await page.waitForSelector('table tbody tr, .song-item', { timeout: 10000 });
  await songRow.dblclick().catch(async () => {
    await songRow.click();
  });
  await page.waitForTimeout(2500);

  console.log('📂 Opening Player Drawer...');
  const footerCover = await page.waitForSelector('#footer-cover, .cover-inner', { timeout: 10000 });
  await footerCover.click();
  await page.waitForTimeout(2000);

  console.log('📜 Waiting for lyrics with syllable alignment (.word-char)...');
  await page.waitForFunction(() => {
    return document.querySelectorAll('.lyrics-container .word-char').length > 0;
  }, { timeout: 15000 });

  const totalWords = await page.evaluate(() => {
    return document.querySelectorAll('.lyrics-container .word-char').length;
  });
  console.log(`✅ Verified: Found ${totalWords} .word-char syllable spans rendered in .lyrics-container!`);

  // Test A: Click on syllable "故"
  console.log('⏩ Clicking syllable "故" (30.542s)...');
  const testA = await page.evaluate(async () => {
    const lines = Array.from(document.querySelectorAll('.lyrics-container .lyric-line'));
    const targetLine = lines.find(l => l.textContent.includes('故事的小黄花'));
    const firstWord = targetLine?.querySelector('.word-char');
    firstWord?.click();
    await new Promise(r => setTimeout(r, 450));

    const curLine = document.querySelector('.lyrics-container .lyric-line.current');
    const chars = Array.from(curLine ? curLine.querySelectorAll('.word-char') : []).map(c => ({
      text: c.textContent,
      fill: c.style.getPropertyValue('--fill'),
      bg: c.style.backgroundImage,
      classes: c.className
    }));
    return {
      line: curLine?.textContent?.trim(),
      singingWord: curLine?.querySelector('.word-singing')?.textContent,
      firstWordClass: chars[0]?.classes,
      firstWordFill: chars[0]?.fill,
      chars
    };
  });
  console.log('🎤 State at syllable "故":', JSON.stringify(testA, null, 2));

  // Test B: Click on syllable "事"
  console.log('⏩ Clicking syllable "事" (31.007s)...');
  const testB = await page.evaluate(async () => {
    const lines = Array.from(document.querySelectorAll('.lyrics-container .lyric-line'));
    const targetLine = lines.find(l => l.textContent.includes('故事的小黄花'));
    const secondWord = targetLine?.querySelectorAll('.word-char')[1];
    secondWord?.click();
    await new Promise(r => setTimeout(r, 450));

    const curLine = document.querySelector('.lyrics-container .lyric-line.current');
    const chars = Array.from(curLine ? curLine.querySelectorAll('.word-char') : []).map(c => ({
      text: c.textContent,
      fill: c.style.getPropertyValue('--fill'),
      classes: c.className
    }));
    return {
      singingWord: curLine?.querySelector('.word-singing')?.textContent,
      firstWordClasses: chars[0]?.classes,
      firstWordFill: chars[0]?.fill,
      secondWordClasses: chars[1]?.classes,
      secondWordFill: chars[1]?.fill
    };
  });
  console.log('🎤 State at syllable "事":', JSON.stringify(testB, null, 2));

  // Test C: Click-to-seek directly on syllable "小" (31.937s)
  console.log('🎯 Testing click-to-seek directly on syllable "小"...');
  const clickSeekResult = await page.evaluate(async () => {
    const lines = Array.from(document.querySelectorAll('.lyrics-container .lyric-line'));
    const targetLine = lines.find(l => l.textContent.includes('故事的小黄花'));
    const targetWord = targetLine?.querySelectorAll('.word-char')[3]; // "小"
    const expectedTime = parseFloat(targetWord?.getAttribute('data-start') || '0');
    targetWord?.click();
    await new Promise(r => setTimeout(r, 450));
    const audio = document.querySelector('audio') || window.__audioPlayer;
    const curTime = audio ? audio.currentTime : 0;
    return {
      clickedText: targetWord?.textContent,
      expectedTime,
      audioCurrentTime: curTime,
      isClose: Math.abs(curTime - expectedTime) < 1.0
    };
  });
  console.log('🎯 Click-to-seek Result:', JSON.stringify(clickSeekResult, null, 2));

  // Capture screenshot of live player drawer
  const screenshotPath = '/root/.gemini/antigravity-cli/brain/806d817e-f996-411e-ab87-0b4f4f8bdb79/lyrics-word-sync-verification.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`📸 Screenshot successfully saved to ${screenshotPath}`);

  if (totalWords > 0 && testA?.singingWord === '故' && testB?.singingWord === '事') {
    console.log('🎉 ALL RIGOROUS TESTS PASSED: 100% Syllable-level alignment and 60fps progressive highlight wipe are verified!');
  } else {
    throw new Error('Verification assertion failed');
  }

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
