import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const TARGET_URL = process.env.TARGET_URL || 'https://cfsolara-dho.pages.dev/';
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

console.log(`[Lyric QA] Starting end-to-end verification against: ${TARGET_URL}`);

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('[Lyric QA] Home page loaded.');

    // 1. 验证热歌榜或推荐歌曲点击播放并查看歌词
    console.log('[Lyric QA] Step 1: Searching for "晴天"...');
    // 使用 History 路由模式 /search?q=
    await page.goto(`${TARGET_URL}search?q=%E6%99%B4%E5%A4%A9`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // 截屏搜索页
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_search_qingtian.png'), fullPage: false });

    // 查找搜索结果列表项
    await page.waitForSelector('.song-item', { timeout: 15000 });
    const songItems = page.locator('.song-item');
    const count = await songItems.count();
    console.log(`[Lyric QA] Found ${count} search results.`);

    if (count > 0) {
      console.log('[Lyric QA] Double clicking first song to play...');
      await songItems.first().dblclick();
      await page.waitForTimeout(3000);

      // 验证底部播放条中当前歌曲信息
      const songTitle = await page.locator('footer [title], footer .font-medium, .truncate').first().textContent();
      console.log(`[Lyric QA] Current playing title: "${songTitle?.trim()}"`);

      // 打开全屏/抽屉播放器
      console.log('[Lyric QA] Opening Player Drawer...');
      // 点击底部封面 #footer-cover 展开抽屉
      await page.locator('#footer-cover').click();
      await page.waitForTimeout(3000);

      // 截屏播放器抽屉
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_player_drawer.png'), fullPage: false });

      // 检查歌词行渲染
      const lyricLines = page.locator('.lyric-line, .lyrics-scroll p, .lyrics-container p');
      const lyricCount = await lyricLines.count();
      console.log(`[Lyric QA] Found ${lyricCount} lyric elements in Drawer!`);

      if (lyricCount > 0) {
        const firstFew = [];
        for (let i = 0; i < Math.min(5, lyricCount); i++) {
          const txt = await lyricLines.nth(i).textContent();
          firstFew.push(txt?.trim());
        }
        console.log('[Lyric QA] Sample lyrics:', firstFew);
        const hasValidWords = firstFew.some(t => t && !t.includes('暂无歌词') && !t.includes('歌词获取失败'));
        console.log(`[Lyric QA] Are lyrics valid and non-empty? ${hasValidWords ? 'YES (SUCCESS)' : 'NO (FAIL)'}`);
      }
    }

    // 2. 验证多源英文歌曲 (如 "Cruel Summer" - Taylor Swift)
    console.log('\n[Lyric QA] Step 2: Testing English Track "Cruel Summer"...');
    await page.goto(`${TARGET_URL}search?q=Cruel%20Summer`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    await page.waitForSelector('.song-item', { timeout: 15000 });
    const enSongItems = page.locator('.song-item');
    const enCount = await enSongItems.count();
    console.log(`[Lyric QA] Found ${enCount} English search results.`);
    if (enCount > 0) {
      console.log('[Lyric QA] Double clicking first English song...');
      await enSongItems.first().dblclick();
      await page.waitForTimeout(3000);

      // 展开抽屉
      await page.locator('#footer-cover').click();
      await page.waitForTimeout(3000);

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_player_drawer_en.png'), fullPage: false });

      const lyricLinesEn = page.locator('.lyric-line, .lyrics-scroll p, .lyrics-container p');
      const enLyricCount = await lyricLinesEn.count();
      console.log(`[Lyric QA] Found ${enLyricCount} lyric elements for English track!`);
      if (enLyricCount > 0) {
        const firstFewEn = [];
        for (let i = 0; i < Math.min(5, enLyricCount); i++) {
          const txt = await lyricLinesEn.nth(i).textContent();
          firstFewEn.push(txt?.trim());
        }
        console.log('[Lyric QA] Sample English lyrics:', firstFewEn);
      }
    }

    console.log('\n[Lyric QA] E2E Verification complete!');
  } catch (err) {
    console.error('[Lyric QA Error]', err);
  } finally {
    await browser.close();
  }
}

run();
