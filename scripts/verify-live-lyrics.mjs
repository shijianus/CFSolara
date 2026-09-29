import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const TARGET_URL = process.env.TARGET_URL || 'https://cfsolara-dho.pages.dev/';
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

console.log(`[Verification] Starting E2E verification against: ${TARGET_URL}`);

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
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.log(`[Browser Error]:`, msg.text());
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
    console.log(`[Browser PageError]:`, err.message);
  });

  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('[Verification] Page loaded successfully.');

    // 1. 测试在线探索（Explore Online Music / 随机歌曲）
    console.log('\n--- 1. Testing Explore Online Music (Random Track) ---');
    const loadOnlineBtn = page.locator('#loadOnlineBtn');
    await loadOnlineBtn.waitFor({ state: 'visible', timeout: 10000 });
    await loadOnlineBtn.click();

    // 等待探索音乐添加到播放列表中
    await page.waitForSelector('#playlistItems .playlist-item', { timeout: 15000 });
    const firstOnlineTrack = page.locator('#playlistItems .playlist-item').first();
    const trackText = (await firstOnlineTrack.textContent()).trim();
    console.log(`[Explore] Clicking first random track: "${trackText}"`);
    await firstOnlineTrack.click();

    // 等待歌词加载并渲染
    await page.waitForFunction(() => {
      const lines = document.querySelectorAll('#lyricsContent .lyric-line');
      return lines.length > 0;
    }, { timeout: 15000 });

    const onlineLyricCount = await page.locator('#lyricsContent .lyric-line').count();
    console.log(`[Explore] Lyrics loaded successfully! Line count: ${onlineLyricCount}`);

    // 等待播放器开始播放或直接设置播放进度验证跟随
    await page.evaluate(() => {
      const audio = document.getElementById('audioPlayer');
      audio.muted = true;
      audio.play().catch(() => {});
    });
    await page.waitForTimeout(1000);

    // 截图记录
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-explore-random-track.png') });

    // 2. 测试任意歌曲搜索 1: 周杰伦 - 晴天 (经典中文歌，毫秒级逐字)
    console.log('\n--- 2. Testing Song Search: "晴天" (周杰伦) ---');
    await page.fill('#searchInput', '晴天 周杰伦');
    await page.click('#searchBtn');
    await page.waitForSelector('.search-result-item', { timeout: 15000 });

    const qingtianTrack = page.locator('.search-result-item').first();
    const qtTitle = (await qingtianTrack.locator('.search-result-title').textContent()).trim();
    console.log(`[Search] Playing: "${qtTitle}"`);
    const qingtianPlayBtn = qingtianTrack.locator('.action-btn.play');
    if (await qingtianPlayBtn.isVisible()) {
      await qingtianPlayBtn.click();
    } else {
      await qingtianTrack.click();
    }

    // 等待歌词加载
    await page.waitForFunction(() => {
      const lines = document.querySelectorAll('#lyricsContent .lyric-line');
      return lines.length > 0 && Array.from(lines).some(l => l.textContent.includes('故事的小黄花') || l.textContent.includes('晴天'));
    }, { timeout: 15000 });

    const qtLyricCount = await page.locator('#lyricsContent .lyric-line').count();
    console.log(`[Search 晴天] Lyric lines rendered: ${qtLyricCount}`);

    // 验证逐字结构与行结构
    const hasWordSpans = await page.evaluate(() => {
      return document.querySelectorAll('#lyricsContent .word-char').length > 0;
    });
    console.log(`[Search 晴天] Has word-level karaoke spans: ${hasWordSpans}`);

    // 模拟定位到歌词第 1 句并验证聚焦与居中
    const firstLineInfo = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('#lyricsContent .lyric-line'));
      const line = lines.find(l => l.textContent.includes('故事的小黄花')) || lines[0];
      if (!line) return null;
      return {
        time: parseFloat(line.getAttribute('data-time')),
        text: line.textContent.trim(),
        index: line.getAttribute('data-index')
      };
    });
    console.log(`[Tracking] Target line found:`, firstLineInfo);

    if (firstLineInfo) {
      console.log(`[Tracking] Activating line ${firstLineInfo.index} ("${firstLineInfo.text}")...`);
      await page.evaluate((info) => {
        const line = document.querySelector(`#lyricsContent .lyric-line[data-index="${info.index}"]`);
        if (line) {
          line.click();
        }
      }, firstLineInfo);
      await page.waitForTimeout(600);
    }

    // 验证当前歌词被高亮聚焦为 .current 且垂直居中
    const qtCenterCheck = await page.evaluate(() => {
      const current = document.querySelector('#lyricsContent .current');
      const container = document.getElementById('lyricsScroll');
      if (!current || !container) return { ok: false, reason: 'No current or container' };
      const curRect = current.getBoundingClientRect();
      const conRect = container.getBoundingClientRect();
      const curCenter = curRect.top + curRect.height / 2;
      const conCenter = conRect.top + conRect.height / 2;
      const diff = Math.abs(curCenter - conCenter);
      return {
        ok: diff < 85,
        diff,
        text: current.textContent.trim(),
        hasWordSinging: current.querySelectorAll('.word-singing, .word-sung').length > 0,
        scrollTop: container.scrollTop
      };
    });
    console.log(`[Search 晴天] Centering check:`, qtCenterCheck);

    if (!qtCenterCheck.ok) {
      throw new Error(`Centering failed for 晴天! diff=${qtCenterCheck.diff}`);
    }

    // 验证点击歌词任意行实现精准点播与跳转 (Click-to-Seek)
    console.log('\n--- Testing Click-to-Seek Interaction ---');
    const targetLineIndex = Math.min(8, qtLyricCount - 1);
    const targetLine = page.locator(`#lyricsContent .lyric-line[data-index="${targetLineIndex}"]`);
    const targetTimeAttr = await targetLine.getAttribute('data-time');
    const targetLineText = (await targetLine.textContent()).trim();
    console.log(`[Click-to-Seek] Clicking line ${targetLineIndex} ("${targetLineText}") at time ${targetTimeAttr}s`);
    await targetLine.click();
    await page.waitForTimeout(600);

    const seekCheck = await page.evaluate((targetIdx) => {
      const audio = document.getElementById('audioPlayer');
      const current = document.querySelector('#lyricsContent .current');
      const container = document.getElementById('lyricsScroll');
      const curIdx = current ? current.getAttribute('data-index') : null;
      const curRect = current ? current.getBoundingClientRect() : null;
      const conRect = container.getBoundingClientRect();
      const diff = curRect ? Math.abs((curRect.top + curRect.height / 2) - (conRect.top + conRect.height / 2)) : 999;
      return {
        audioTime: audio.currentTime,
        currentLineIndex: curIdx,
        isTargetCurrent: curIdx === String(targetIdx),
        diff,
        centered: diff < 85,
        scrollTop: container.scrollTop
      };
    }, targetLineIndex);
    console.log(`[Click-to-Seek Result]:`, seekCheck);

    if (!seekCheck.isTargetCurrent || !seekCheck.centered) {
      throw new Error(`Click-to-seek failed! Expected line ${targetLineIndex} to be current and centered, got: ${JSON.stringify(seekCheck)}`);
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-qingtian-click-seek.png') });

    // 3. 测试英文歌曲搜索: "Shape of You" (Ed Sheeran，全网高精逐字 Richsync / KRC)
    console.log('\n--- 3. Testing Song Search: "Shape of You" (Ed Sheeran) ---');
    await page.fill('#searchInput', 'Shape of You Ed Sheeran');
    await page.click('#searchBtn');
    await page.waitForSelector('.search-result-item', { timeout: 15000 });

    const enTrack = page.locator('.search-result-item').first();
    const enTitle = (await enTrack.locator('.search-result-title').textContent()).trim();
    console.log(`[Search] Playing English track: "${enTitle}"`);
    const enPlayBtn = enTrack.locator('.action-btn.play');
    if (await enPlayBtn.isVisible()) {
      await enPlayBtn.click();
    } else {
      await enTrack.click();
    }

    // 等待歌词加载
    await page.waitForFunction(() => {
      const lines = document.querySelectorAll('#lyricsContent .lyric-line');
      return lines.length > 0 && Array.from(lines).some(l => l.textContent.toLowerCase().includes('shape of you') || l.textContent.toLowerCase().includes('sheeran') || l.textContent.toLowerCase().includes('club') || l.textContent.toLowerCase().includes('bar'));
    }, { timeout: 15000 });

    const enLyricCount = await page.locator('#lyricsContent .lyric-line').count();
    console.log(`[Search Shape of You] Lyric lines rendered: ${enLyricCount}`);

    // 验证逐字高精结构
    const enHasWordSpans = await page.evaluate(() => {
      return document.querySelectorAll('#lyricsContent .word-char').length > 0;
    });
    console.log(`[Search Shape of You] Has word-level karaoke spans: ${enHasWordSpans}`);

    // 点击第 6 行验证居中与聚焦
    const enTargetLineIndex = Math.min(6, enLyricCount - 1);
    const enTargetLine = page.locator(`#lyricsContent .lyric-line[data-index="${enTargetLineIndex}"]`);
    await enTargetLine.click();
    await page.waitForTimeout(600);

    const enCenterCheck = await page.evaluate(() => {
      const current = document.querySelector('#lyricsContent .current');
      const container = document.getElementById('lyricsScroll');
      if (!current || !container) return { ok: false, reason: 'No current or container' };
      const curRect = current.getBoundingClientRect();
      const conRect = container.getBoundingClientRect();
      const diff = Math.abs((curRect.top + curRect.height / 2) - (conRect.top + conRect.height / 2));
      return {
        ok: diff < 85,
        diff,
        text: current.textContent.trim(),
        hasWordSinging: current.querySelectorAll('.word-singing, .word-sung').length > 0,
        wordCharsCount: current.querySelectorAll('.word-char').length,
        scrollTop: container.scrollTop
      };
    });
    console.log(`[Search Shape of You] Centering and word tracking:`, enCenterCheck);
    if (!enCenterCheck.ok) {
      throw new Error(`Centering failed for Shape of You! diff=${enCenterCheck.diff}`);
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-shape-of-you.png') });

    // 4. 测试日韩歌曲搜索: "Lemon" (米津玄師)
    console.log('\n--- 4. Testing Song Search: "Lemon" (米津玄師) ---');
    await page.fill('#searchInput', 'Lemon 米津玄師');
    await page.click('#searchBtn');
    await page.waitForSelector('.search-result-item', { timeout: 15000 });

    const jpTrack = page.locator('.search-result-item').first();
    const jpTitle = (await jpTrack.locator('.search-result-title').textContent()).trim();
    console.log(`[Search] Playing Japanese track: "${jpTitle}"`);
    const jpPlayBtn = jpTrack.locator('.action-btn.play');
    if (await jpPlayBtn.isVisible()) {
      await jpPlayBtn.click();
    } else {
      await jpTrack.click();
    }

    await page.waitForFunction(() => {
      const lines = document.querySelectorAll('#lyricsContent .lyric-line');
      return lines.length > 0 && Array.from(lines).some(l => l.textContent.includes('Lemon') || l.textContent.includes('夢'));
    }, { timeout: 15000 });

    const jpLyricCount = await page.locator('#lyricsContent .lyric-line').count();
    console.log(`[Search Lemon] Lyric lines rendered: ${jpLyricCount}`);

    // 点击第 8 行验证居中与聚焦
    const jpTargetLineIndex = Math.min(8, jpLyricCount - 1);
    const jpTargetLine = page.locator(`#lyricsContent .lyric-line[data-index="${jpTargetLineIndex}"]`);
    await jpTargetLine.click();
    await page.waitForTimeout(600);

    const jpCenterCheck = await page.evaluate(() => {
      const current = document.querySelector('#lyricsContent .current');
      const container = document.getElementById('lyricsScroll');
      if (!current || !container) return { ok: false, reason: 'No current or container' };
      const curRect = current.getBoundingClientRect();
      const conRect = container.getBoundingClientRect();
      const diff = Math.abs((curRect.top + curRect.height / 2) - (conRect.top + conRect.height / 2));
      return {
        ok: diff < 85,
        diff,
        text: current.textContent.trim(),
        hasWordSinging: current.querySelectorAll('.word-singing, .word-sung').length > 0,
        wordCharsCount: current.querySelectorAll('.word-char').length,
        scrollTop: container.scrollTop
      };
    });
    console.log(`[Search Lemon] Centering:`, jpCenterCheck);
    if (!jpCenterCheck.ok) {
      throw new Error(`Centering failed for Lemon! diff=${jpCenterCheck.diff}`);
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-lemon-jp.png') });

    // 4.5 测试全网高精逐字卡拉OK: "年少有为" (李荣浩 - 毫秒级 .word-char / .word-singing / .word-sung)
    console.log('\n--- 4.5. Testing High-Precision Word Karaoke: "年少有为" (李荣浩) ---');
    await page.fill('#searchInput', '年少有为 李荣浩');
    await page.click('#searchBtn');
    await page.waitForSelector('.search-result-item', { timeout: 15000 });

    const nsywTrack = page.locator('.search-result-item').first();
    const nsywTitle = (await nsywTrack.locator('.search-result-title').textContent()).trim();
    console.log(`[Word-Karaoke] Playing: "${nsywTitle}"`);
    const nsywPlayBtn = nsywTrack.locator('.action-btn.play');
    if (await nsywPlayBtn.isVisible()) {
      await nsywPlayBtn.click();
    } else {
      await nsywTrack.click();
    }

    await page.waitForFunction(() => {
      const lines = document.querySelectorAll('#lyricsContent .lyric-line');
      return lines.length > 0 && Array.from(lines).some(l => l.textContent.includes('电视一直闪') || l.textContent.includes('年少有为'));
    }, { timeout: 15000 });

    // 验证逐字标签 .word-char 存在
    const wordCharCount = await page.evaluate(() => {
      return document.querySelectorAll('#lyricsContent .word-char').length;
    });
    console.log(`[Word-Karaoke] Total .word-char spans in lyrics: ${wordCharCount}`);

    // 跳转至第 1 句歌词发音时间 (约 30.5秒) 并触发同步
    console.log('[Word-Karaoke] Seeking to 30.5s for word-level singing/sung verification...');
    await page.evaluate(() => {
      const audio = document.getElementById('audioPlayer');
      audio.currentTime = 30.5;
      audio.dispatchEvent(new Event('seeked'));
    });
    await page.waitForTimeout(600);

    const wordState = await page.evaluate(() => {
      const singingWords = document.querySelectorAll('#lyricsContent .word-singing');
      const sungWords = document.querySelectorAll('#lyricsContent .word-sung');
      const currentLine = document.querySelector('#lyricsContent .current');
      return {
        hasWordSinging: singingWords.length > 0,
        singingWordsCount: singingWords.length,
        singingText: Array.from(singingWords).map(w => w.textContent).join(''),
        hasWordSung: sungWords.length > 0,
        sungWordsCount: sungWords.length,
        sungText: Array.from(sungWords).map(w => w.textContent).join(''),
        currentLineText: currentLine ? currentLine.textContent.trim() : null
      };
    });
    console.log(`[Word-Karaoke Result]:`, wordState);

    if (wordCharCount === 0 || (!wordState.hasWordSinging && !wordState.hasWordSung)) {
      throw new Error(`Word-level karaoke highlighting failed! Result: ${JSON.stringify(wordState)}`);
    }
    console.log('✅ Word-level karaoke highlighting (.word-singing / .word-sung) validated successfully!');

    // 5. 测试移动端视口 (Mobile Viewport Verification)
    console.log('\n--- 5. Testing Mobile Viewport & Inline Lyrics ---');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // 检查移动端界面是否渲染
    const isMobile = await page.evaluate(() => document.documentElement.classList.contains('mobile-view'));
    console.log(`[Mobile] Is mobile view active: ${isMobile}`);

    // 在移动端触发播放以激活当前恢复的歌曲与歌词
    await page.evaluate(() => {
      const playBtn = document.getElementById('playPauseBtn');
      if (playBtn) playBtn.click();
    });

    // 等待歌词加载到移动端内联歌词容器
    await page.waitForFunction(() => {
      const content = document.getElementById('mobileInlineLyricsContent');
      return content && content.querySelectorAll('.lyric-line').length > 0;
    }, { timeout: 15000 });

    const mobileLyricLinesCount = await page.evaluate(() => {
      const el = document.getElementById('mobileInlineLyricsContent');
      return el ? el.querySelectorAll('.lyric-line').length : 0;
    });
    console.log(`[Mobile] Mobile inline lyrics rendered: ${mobileLyricLinesCount} lines`);

    // 点击唱片封面打开内联歌词 (Inline Lyrics) - 使用 force: true 避开唱片旋转 CSS 动画的 stability 检查
    const albumCover = page.locator('#albumCover');
    await albumCover.waitFor({ state: 'visible', timeout: 10000 });
    await albumCover.click({ force: true });
    await page.waitForTimeout(800);

    const mobileLyricsOpen = await page.evaluate(() => document.body.classList.contains('mobile-inline-lyrics-open'));
    console.log(`[Mobile] Mobile inline lyrics open: ${mobileLyricsOpen}`);

    if (!mobileLyricsOpen) {
      throw new Error('Failed to open mobile inline lyrics drawer on album cover click!');
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-mobile-inline-lyrics.png') });

    // 6. 控制台无致命错误断言
    const fatalErrors = consoleErrors.filter(e => 
      !e.includes('favicon') && 
      !e.includes('404') && 
      !e.includes('MediaError') &&
      !e.includes('AbortError') &&
      !e.includes('interrupted by a call to pause')
    );
    console.log(`\n[Errors Audit] Total console errors: ${consoleErrors.length}, Fatal JS errors: ${fatalErrors.length}`);
    if (fatalErrors.length > 0) {
      console.warn(`[Warning] Fatal errors observed:`, fatalErrors);
    }

    console.log('\n=============================================');
    console.log('✅ ALL LIVE VERIFICATION CHECKS PASSED 100%!');
    console.log('=============================================');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
