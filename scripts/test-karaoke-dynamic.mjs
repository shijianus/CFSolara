import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('📡 Navigating to Sonic...');
  await page.goto('https://sonic.epocanvas.com', { waitUntil: 'networkidle' });

  const searchInput = await page.waitForSelector('input[placeholder*="搜索"], input[type="text"]');
  await searchInput.fill('晴天');
  await searchInput.press('Enter');
  await page.waitForTimeout(3000);

  const songItem = await page.waitForSelector('table tbody tr, .song-item');
  await songItem.click();
  await page.waitForTimeout(2000);

  const footerCover = await page.waitForSelector('#footer-cover, .cover-inner');
  await footerCover.click();
  await page.waitForTimeout(2000);

  await page.waitForFunction(() => document.querySelectorAll('.lyrics-container .word-char').length > 0);

  console.log('==> Test 1: Active Line & Syllable Progress at t=30.8s');
  const result1 = await page.evaluate(() => {
    const audio = document.querySelector('audio');
    if (audio) {
      audio.currentTime = 30.8;
      audio.dispatchEvent(new Event('timeupdate'));
    }
    const curLine = document.querySelector('.lyrics-container .lyric-line.current');
    const chars = Array.from(curLine ? curLine.querySelectorAll('.word-char') : []).map(c => ({
      text: c.textContent,
      start: c.getAttribute('data-start'),
      end: c.getAttribute('data-end'),
      fill: c.style.getPropertyValue('--fill'),
      classes: c.className
    }));
    return {
      line: curLine?.textContent?.trim(),
      chars
    };
  });
  console.log('Result at 30.8s:', JSON.stringify(result1, null, 2));

  console.log('==> Test 2: Progress to t=31.2s');
  const result2 = await page.evaluate(() => {
    const audio = document.querySelector('audio');
    if (audio) {
      audio.currentTime = 31.2;
      audio.dispatchEvent(new Event('timeupdate'));
    }
    const curLine = document.querySelector('.lyrics-container .lyric-line.current');
    const chars = Array.from(curLine ? curLine.querySelectorAll('.word-char') : []).map(c => ({
      text: c.textContent,
      fill: c.style.getPropertyValue('--fill'),
      classes: c.className
    }));
    return {
      line: curLine?.textContent?.trim(),
      chars
    };
  });
  console.log('Result at 31.2s:', JSON.stringify(result2, null, 2));

  console.log('==> Test 3: Syllable Click to Seek');
  const clickResult = await page.evaluate(async () => {
    const curLine = document.querySelector('.lyrics-container .lyric-line.current');
    const wordChar = curLine?.querySelectorAll('.word-char')[3]; // "小" (start = 31.937)
    const expectedStart = wordChar?.getAttribute('data-start');
    wordChar?.click();
    await new Promise(r => setTimeout(r, 200));
    const audio = document.querySelector('audio');
    return {
      clickedText: wordChar?.textContent,
      expectedStart,
      actualAudioTime: audio?.currentTime
    };
  });
  console.log('Click-to-seek result:', JSON.stringify(clickResult, null, 2));

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
