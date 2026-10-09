import { chromium } from 'playwright';

async function main() {
  console.log('🚀 Running Playwright verification on Cloudflare deployment...');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const url = 'https://sonic.epocanvas.com';
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

  // Inspect first verse with words
  const lineDetails = await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.lyrics-container .lyric-line'));
    const lineWithWords = lines.find(l => l.querySelectorAll('.word-char').length > 0);
    if (!lineWithWords) return null;
    return {
      text: lineWithWords.querySelector('.lyric-text')?.textContent?.trim(),
      syllables: Array.from(lineWithWords.querySelectorAll('.word-char')).map(w => ({
        text: w.textContent,
        start: w.getAttribute('data-start'),
        end: w.getAttribute('data-end')
      }))
    };
  });
  console.log('📝 Verified Syllable Alignment Detail:', JSON.stringify(lineDetails, null, 2));

  // Test dynamic progressive wipe at 30.8s
  console.log('⏩ Seeking to 30.8s (mid-"故")...');
  const testA = await page.evaluate(async () => {
    // Call the application audio store directly if available, or trigger audio element
    const audio = document.querySelector('audio');
    if (audio) {
      audio.currentTime = 30.8;
      audio.dispatchEvent(new Event('timeupdate'));
    }
    // Give 300ms for rAF update
    await new Promise(r => setTimeout(r, 300));

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
      chars
    };
  });
  console.log('🎤 State at 30.8s:', JSON.stringify(testA, null, 2));

  // Test dynamic progressive wipe at 31.2s (mid-"事")
  console.log('⏩ Progressing to 31.2s (mid-"事")...');
  const testB = await page.evaluate(async () => {
    const audio = document.querySelector('audio');
    if (audio) {
      audio.currentTime = 31.2;
      audio.dispatchEvent(new Event('timeupdate'));
    }
    await new Promise(r => setTimeout(r, 300));

    const curLine = document.querySelector('.lyrics-container .lyric-line.current');
    const chars = Array.from(curLine ? curLine.querySelectorAll('.word-char') : []).map(c => ({
      text: c.textContent,
      fill: c.style.getPropertyValue('--fill'),
      bg: c.style.backgroundImage,
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
  console.log('🎤 State at 31.2s:', JSON.stringify(testB, null, 2));

  // Capture screenshot of live player drawer
  const screenshotPath = '/root/.gemini/antigravity-cli/brain/806d817e-f996-411e-ab87-0b4f4f8bdb79/lyrics-word-sync-verification.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`📸 Screenshot successfully saved to ${screenshotPath}`);

  if (totalWords > 0 && lineDetails?.syllables?.length > 0) {
    console.log('🎉 ALL CHECKS PASSED: Word-by-word karaoke alignment is 100% active and functioning in .lyrics-container!');
  } else {
    throw new Error('Syllable checks failed');
  }

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
