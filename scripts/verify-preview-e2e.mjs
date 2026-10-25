import puppeteer from 'puppeteer';
import path from 'path';

async function main() {
  console.log('=== Starting E2E Verification on Cloudflare Pages Preview Branch ===');
  const previewUrl = 'https://preview-full-stream.cfsolara-dho.pages.dev';
  console.log(`Target URL: ${previewUrl}`);

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);
    await page.setViewport({ width: 1440, height: 900 });

    console.log('\n1. Navigating to preview domain...');
    await page.goto(previewUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2000));
    console.log('  ✓ Preview domain loaded successfully');

    // 2. Play verified trial song
    console.log('\n2. Testing Trial Playback & Badge in Footer');
    const playRes = await page.evaluate(async () => {
      const app = document.querySelector('#app').__vue_app__;
      const audioStore = app.config.globalProperties.$pinia._s.get('audio');

      const trialSong = {
        id: '1293886117',
        name: '年少有为',
        artist: '李荣浩',
        album: '耳朵',
        duration: 279,
        cover: 'https://p4.music.126.net/tt8xwK-ASC2iqXNUXYKoDQ==/109951163606377163.jpg',
        url: '/api/music/stream?id=netease:1293886117&source=netease',
        streamType: 'trial',
        trialDuration: 30,
      };

      audioStore.setPlaylist([trialSong], 0);
      await audioStore.playSong(trialSong, 0, true);

      return {
        currentSongName: audioStore.audio.currentSong?.name,
        currentSongStreamType: audioStore.audio.currentSong?.streamType,
        isPlaying: audioStore.audio.isPlaying,
      };
    });
    console.log('  ✓ Play state:', playRes);

    await new Promise((r) => setTimeout(r, 1500));

    // 3. Assert Trial Badge in DOM
    const badgeInfo = await page.evaluate(() => {
      const el = document.querySelector('footer .border-amber-500\\/30, .border-amber-500\\/30');
      return el
        ? {
            text: el.textContent.trim(),
            title: el.getAttribute('title'),
            className: el.className,
          }
        : null;
    });
    console.log('  ✓ DOM Trial Badge:', badgeInfo);
    if (!badgeInfo || badgeInfo.text !== '试听') {
      throw new Error(`Expected Trial Badge '试听', got ${JSON.stringify(badgeInfo)}`);
    }

    // 4. Simulate Ended Event: Verify Toast & No Silent Skip
    console.log('\n3. Testing Trial Ended Behavior (Toast & No Silent Skip)');
    const endedRes = await page.evaluate(async () => {
      const app = document.querySelector('#app').__vue_app__;
      const audioStore = app.config.globalProperties.$pinia._s.get('audio');
      const toastStore = app.config.globalProperties.$pinia._s.get('toast');

      // Dispatch HTML5 audio ended event
      audioStore.audio.audio.dispatchEvent(new Event('ended'));
      await new Promise((r) => setTimeout(r, 500));

      const toastEls = Array.from(document.querySelectorAll('[class*="toast"], [role="alert"]')).map((el) => el.textContent.trim());

      return {
        isPlaying: audioStore.audio.isPlaying,
        currentIndex: audioStore.audio.currentIndex,
        currentSongName: audioStore.audio.currentSong?.name,
        storeToasts: toastStore ? JSON.parse(JSON.stringify(toastStore.toasts)) : [],
        domToasts: toastEls,
      };
    });
    console.log('  ✓ After ended event result:', endedRes);

    if (endedRes.isPlaying !== false) {
      throw new Error(`Expected audio.isPlaying to be false after trial ended, got ${endedRes.isPlaying}`);
    }
    if (endedRes.currentIndex !== 0) {
      throw new Error(`Expected currentIndex to remain 0 (no silent skip), got ${endedRes.currentIndex}`);
    }
    const hasTrialEndedToast = endedRes.storeToasts.some((t) => t.message && t.message.includes('试听片段，已播放完毕'));
    if (!hasTrialEndedToast) {
      throw new Error(`Expected toast '当前曲目为试听片段，已播放完毕', got: ${JSON.stringify(endedRes.storeToasts)}`);
    }

    // 5. Take screenshot
    const screenshotPath = path.resolve('reports/preview_trial_verification.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`  ✓ Screenshot saved to ${screenshotPath}`);

    // 6. Verify Cross-Source Fallback Priority via Preview HTTP API
    console.log('\n4. Verifying Cross-Source Fallback Priority via Preview API');
    const fallbackRes = await page.evaluate(async (url) => {
      const res = await fetch(`${url}/api/music/stream?id=netease:308299&source=netease&title=喜帖街&artist=谢安琪`, {
        method: 'HEAD',
      });
      return {
        status: res.status,
        contentLength: res.headers.get('content-length'),
        streamType: res.headers.get('x-sonic-stream-type'),
        provider: res.headers.get('x-sonic-provider'),
        via: res.headers.get('x-sonic-via'),
      };
    }, previewUrl);
    console.log('  ✓ Fallback response headers:', fallbackRes);

    if (fallbackRes.streamType !== 'full') {
      throw new Error(`Expected fallback streamType to be 'full', got ${fallbackRes.streamType}`);
    }
    if (fallbackRes.provider !== 'local-kuwo') {
      throw new Error(`Expected fallback provider 'local-kuwo', got ${fallbackRes.provider}`);
    }
    if (parseInt(fallbackRes.contentLength, 10) < 3000000) {
      throw new Error(`Expected full stream > 3MB, got ${fallbackRes.contentLength} bytes`);
    }

    console.log('\n========================================');
    console.log('ALL 4 PREVIEW VERIFICATION CHECKS PASSED (100%)');
    console.log('========================================');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Preview verification failed:', err);
  process.exit(1);
});
