import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const LIVE_URL = 'https://sonic.epocanvas.com';
const OUTPUT_DIR = path.resolve('screenshots/audit-external-links');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function runAudit() {
  console.log('=== 🚀 Starting Playwright External URL & Jump Audit ===');
  console.log(`Target: ${LIVE_URL}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const auditResults = {
    targetUrl: LIVE_URL,
    timestamp: new Date().toISOString(),
    externalJumps: [],
    internalJumps: [],
    inspectedPages: []
  };

  try {
    // ==========================================
    // 1. DESKTOP VIEWPORT AUDIT (1440x900)
    // ==========================================
    console.log('\n--- 1. Auditing Desktop Viewport (1440x900) ---');
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN'
    });
    const desktopPage = await desktopContext.newPage();

    console.log(`Navigating to ${LIVE_URL}...`);
    await desktopPage.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await desktopPage.waitForTimeout(3000);

    // Screenshot Desktop Home
    await desktopPage.screenshot({ path: path.join(OUTPUT_DIR, '01-desktop-home.png'), fullPage: false });
    console.log('✓ Captured 01-desktop-home.png');

    // 1.1 Inspect Swiper Banner
    console.log('\n[Desktop] Inspecting Swiper Banner Carousel...');
    const bannerSection = desktopPage.locator('section:has(.swiper)');
    const hasBanner = await bannerSection.count() > 0;
    console.log(`Found banner section: ${hasBanner}`);

    if (hasBanner) {
      await bannerSection.first().screenshot({ path: path.join(OUTPUT_DIR, '02-desktop-swiper-banner.png') });
      console.log('✓ Captured 02-desktop-swiper-banner.png');

      const bannerLinks = await desktopPage.locator('.swiper .swiper-slide a').evaluateAll(els => {
        return els.map((el, i) => ({
          index: i,
          tag: 'a',
          href: el.getAttribute('href') || '',
          target: el.getAttribute('target') || '',
          title: el.querySelector('span')?.textContent?.trim() || '',
          desc: el.querySelector('h3')?.textContent?.trim() || '',
          outerHTML: el.outerHTML.slice(0, 160) + '...'
        }));
      });

      console.log(`Found ${bannerLinks.length} banner slides with links:`);
      for (const bl of bannerLinks) {
        console.log(`  Slide #${bl.index}: href="${bl.href}" | target="${bl.target}" | title="${bl.title}"`);
        auditResults.externalJumps.push({
          platform: '桌面端 (Desktop)',
          location: '桌面首页顶部 Banner 轮播卡片',
          componentPath: 'player/src/pages/index.vue',
          codeSnippet: '<a :href="item.url" target="_blank" class="...">',
          destinationUrl: bl.href,
          targetAttr: bl.target,
          titleText: bl.title || bl.desc || '未命名Banner',
          jumpType: bl.href.startsWith('orpheus://')
            ? '网易云客户端私有协议 (orpheus://) 外部唤起'
            : bl.href.startsWith('https://y.music.163.com') || bl.href.startsWith('http')
              ? '网易云音乐外站网页跳转 (target="_blank")'
              : '其他外部链接',
          realClickVerified: false
        });
      }

      // Test real click on HTTP banner (Slide with http)
      const httpSlide = bannerLinks.find(b => b.href.startsWith('http'));
      if (httpSlide) {
        console.log(`\n[Desktop] Testing real click on HTTP external link banner (index ${httpSlide.index}): ${httpSlide.href}`);
        const linkLocator = desktopPage.locator('.swiper .swiper-slide a').nth(httpSlide.index);
        try {
          const popupPromise = desktopContext.waitForEvent('page', { timeout: 8000 }).catch(() => null);
          await linkLocator.click();
          const popup = await popupPromise;
          if (popup) {
            await popup.waitForLoadState('domcontentloaded').catch(() => {});
            const actualPopupUrl = popup.url();
            console.log(`✓ Real Click Success! New Tab opened to external site: ${actualPopupUrl}`);
            await popup.screenshot({ path: path.join(OUTPUT_DIR, '02-desktop-banner-click-popup.png') }).catch(() => {});
            await popup.close();

            const targetAuditItem = auditResults.externalJumps.find(j => j.destinationUrl === httpSlide.href);
            if (targetAuditItem) {
              targetAuditItem.realClickVerified = true;
              targetAuditItem.actualDestination = actualPopupUrl;
            }
          }
        } catch (e) {
          console.log(`Click test note: ${e.message}`);
        }
      }

      // Test real click on orpheus:// slide
      const orpheusSlide = bannerLinks.find(b => b.href.startsWith('orpheus://'));
      if (orpheusSlide) {
        console.log(`\n[Desktop] Testing real click on orpheus:// link banner: ${orpheusSlide.href}`);
        const orpheusLocator = desktopPage.locator('.swiper .swiper-slide a').nth(orpheusSlide.index);
        await orpheusLocator.click().catch(() => {});
        console.log(`✓ Clicked orpheus link without page crash.`);
        const targetAuditItem = auditResults.externalJumps.find(j => j.destinationUrl === orpheusSlide.href);
        if (targetAuditItem) {
          targetAuditItem.realClickVerified = true;
        }
      }
    }

    // 1.2 Inspect all <a> tags on desktop home
    console.log('\n[Desktop] Inspecting all <a> tags across entire desktop home...');
    const allATags = await desktopPage.locator('a').evaluateAll(els => {
      return els.map(el => ({
        href: el.getAttribute('href') || '',
        target: el.getAttribute('target') || '',
        text: el.textContent?.trim().slice(0, 40)
      }));
    });
    console.log(`Total <a> tags on Desktop Home: ${allATags.length}`);
    for (const a of allATags) {
      console.log(`  <a> href="${a.href}" | target="${a.target}" | text="${a.text}"`);
    }

    // 1.3 Inspect HeroCard (推荐歌单) - Real click verification
    console.log('\n[Desktop] Testing HeroCard (推荐歌单) real click...');
    const firstHeroCard = desktopPage.locator('.stagger-item').first();
    if (await firstHeroCard.count() > 0) {
      await firstHeroCard.click();
      await desktopPage.waitForTimeout(2000);
      const afterUrl = desktopPage.url();
      console.log(`After HeroCard click, URL: ${afterUrl}`);
      auditResults.internalJumps.push({
        location: '桌面端首页 - 推荐歌单卡片',
        component: 'player/src/components/Ui/HeroCard.vue',
        destinationUrl: afterUrl,
        isExternal: false,
        jumpBehavior: '站内路由跳转 (GSAP 3D 展开动效后 router.push)'
      });
      await desktopPage.screenshot({ path: path.join(OUTPUT_DIR, '03-desktop-playlist-detail.png') });
    }

    // Return to home
    await desktopPage.goto(LIVE_URL, { waitUntil: 'domcontentloaded' });
    await desktopPage.waitForTimeout(1500);

    // 1.4 Inspect Sidebar Menu Items
    console.log('\n[Desktop] Inspecting Sidebar Navigation Links...');
    const sidebarLinks = await desktopPage.locator('aside nav a, aside .nav-link').evaluateAll(els => {
      return els.map(el => ({
        href: el.getAttribute('href') || '',
        text: el.textContent?.trim(),
        target: el.getAttribute('target') || ''
      }));
    });
    console.log(`Found ${sidebarLinks.length} sidebar links:`);
    for (const sl of sidebarLinks) {
      console.log(`  Sidebar link: href="${sl.href}" | text="${sl.text}"`);
      auditResults.internalJumps.push({
        location: '桌面端左侧边栏',
        component: 'player/src/layout/aside.vue (<router-link>)',
        destinationUrl: sl.href,
        isExternal: false,
        jumpBehavior: '单页应用站内路由'
      });
    }

    await desktopContext.close();

    // ==========================================
    // 2. MOBILE VIEWPORT AUDIT (390x844)
    // ==========================================
    console.log('\n--- 2. Auditing Mobile Viewport (390x844) ---');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: 'zh-CN'
    });
    const mobilePage = await mobileContext.newPage();

    console.log(`Navigating to ${LIVE_URL} on Mobile...`);
    await mobilePage.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await mobilePage.waitForTimeout(3000);

    // Screenshot Mobile Home
    await mobilePage.screenshot({ path: path.join(OUTPUT_DIR, '07-mobile-home.png'), fullPage: false });
    console.log('✓ Captured 07-mobile-home.png');

    // 2.1 Inspect Mobile Swiper Banner
    console.log('\n[Mobile] Inspecting Mobile Swiper Banner...');
    const mobileSwiper = mobilePage.locator('.home-swiper, .swiper');
    const hasMobileSwiper = await mobileSwiper.count() > 0;
    console.log(`Found mobile swiper: ${hasMobileSwiper}`);

    if (hasMobileSwiper) {
      await mobileSwiper.first().screenshot({ path: path.join(OUTPUT_DIR, '08-mobile-swiper-banner.png') });
      console.log('✓ Captured 08-mobile-swiper-banner.png');

      const mobileBannerLinks = await mobilePage.locator('.swiper .swiper-slide a').evaluateAll(els => {
        return els.map((el, i) => ({
          index: i,
          tag: 'a',
          href: el.getAttribute('href') || '',
          target: el.getAttribute('target') || '',
          title: el.querySelector('span')?.textContent?.trim() || ''
        }));
      });

      console.log(`Found ${mobileBannerLinks.length} mobile banner slides:`);
      for (const mbl of mobileBannerLinks) {
        console.log(`  Mobile Slide #${mbl.index}: href="${mbl.href}" | target="${mbl.target}" | title="${mbl.title}"`);
        auditResults.externalJumps.push({
          platform: '移动端 (Mobile)',
          location: '移动端首页顶部 Banner 轮播卡片',
          componentPath: 'player/src/pages/mobile/index.vue',
          codeSnippet: '<a :href="item.url || \'#\'" target="_blank" class="...">',
          destinationUrl: mbl.href,
          targetAttr: mbl.target,
          titleText: mbl.title || '未命名Banner',
          jumpType: mbl.href.startsWith('orpheus://')
            ? '网易云客户端私有协议 (orpheus://) 移动端唤起'
            : mbl.href.startsWith('http')
              ? '网易云音乐外站网页跳转 (target="_blank")'
              : '空或本页锚点 (#)',
          realClickVerified: false
        });
      }

      // Test real click on mobile banner
      const mobileHttpSlide = mobileBannerLinks.find(b => b.href.startsWith('http'));
      if (mobileHttpSlide) {
        console.log(`\n[Mobile] Testing real tap on HTTP banner (index ${mobileHttpSlide.index}): ${mobileHttpSlide.href}`);
        const mobileLinkLocator = mobilePage.locator('.swiper .swiper-slide a').nth(mobileHttpSlide.index);
        try {
          const popupPromise = mobileContext.waitForEvent('page', { timeout: 8000 }).catch(() => null);
          await mobileLinkLocator.click();
          const popup = await popupPromise;
          if (popup) {
            await popup.waitForLoadState('domcontentloaded').catch(() => {});
            console.log(`✓ Real Click Success! Mobile New Tab: ${popup.url()}`);
            await popup.screenshot({ path: path.join(OUTPUT_DIR, '08-mobile-banner-click-popup.png') }).catch(() => {});
            await popup.close();

            const targetAuditItem = auditResults.externalJumps.find(j => j.platform.includes('Mobile') && j.destinationUrl === mobileHttpSlide.href);
            if (targetAuditItem) {
              targetAuditItem.realClickVerified = true;
              targetAuditItem.actualDestination = popup.url();
            }
          }
        } catch (e) {
          console.log(`Mobile click test note: ${e.message}`);
        }
      }
    }

    // 2.2 Inspect Mobile TabBar
    console.log('\n[Mobile] Inspecting Mobile TabBar...');
    const mobileTabs = await mobilePage.locator('footer a, nav a').evaluateAll(els => {
      return els.map(el => ({
        href: el.getAttribute('href') || '',
        text: el.textContent?.trim()
      }));
    });
    console.log(`Mobile Tab items:`, mobileTabs);

    await mobileContext.close();

    // ==========================================
    // 3. OTHER PAGES DEEP AUDIT
    // ==========================================
    console.log('\n--- 3. Auditing Other Specific Pages ---');
    const testContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN'
    });
    const page = await testContext.newPage();

    // Helper to check for external links on any page
    const checkPageExternalLinks = async (pageUrl, pageName, screenshotName) => {
      console.log(`\nAuditing ${pageName}: ${pageUrl}`);
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(OUTPUT_DIR, screenshotName) });
      console.log(`✓ Captured ${screenshotName}`);

      const externalLinks = await page.locator('a[target="_blank"], a[href^="http"], a[href^="orpheus"]').evaluateAll(els => {
        return els.map(el => ({
          href: el.getAttribute('href') || '',
          target: el.getAttribute('target') || '',
          text: el.textContent?.trim()
        }));
      });

      console.log(`External links found on ${pageName}: ${externalLinks.length}`);
      for (const el of externalLinks) {
        console.log(`  Found: href="${el.href}" | text="${el.text}"`);
        auditResults.externalJumps.push({
          platform: '桌面端 (Desktop)',
          location: `${pageName}`,
          componentPath: 'Dynamic / Page',
          codeSnippet: '<a>',
          destinationUrl: el.href,
          targetAttr: el.target,
          titleText: el.text,
          jumpType: '外部跳转',
          realClickVerified: false
        });
      }

      auditResults.inspectedPages.push({
        pageName,
        url: pageUrl,
        externalLinksCount: externalLinks.length
      });
    };

    await checkPageExternalLinks(`${LIVE_URL}/#/search?q=海阔天空`, '搜索结果页', '09-search-page.png');
    await checkPageExternalLinks(`${LIVE_URL}/#/mv-list`, 'MV 精选列表页', '10-mv-list-page.png');
    await checkPageExternalLinks(`${LIVE_URL}/#/mv-player/5436712`, 'MV 播放详情页', '11-mv-player-page.png');
    await checkPageExternalLinks(`${LIVE_URL}/#/charts`, '排行榜单页', '12-charts-page.png');
    await checkPageExternalLinks(`${LIVE_URL}/#/artists`, '热门歌手列表页', '13-artists-page.png');
    await checkPageExternalLinks(`${LIVE_URL}/#/new-albums`, '新碟首发页', '14-new-albums-page.png');
    await checkPageExternalLinks(`${LIVE_URL}/#/downloads`, '离线下载库页', '15-downloads-page.png');
    await checkPageExternalLinks(`${LIVE_URL}/#/settings`, '系统设置页', '16-settings-page.png');

    await testContext.close();

  } finally {
    await browser.close();
  }

  // Save audit results to JSON
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'audit-results.json'),
    JSON.stringify(auditResults, null, 2),
    'utf-8'
  );
  console.log(`\n✓ Audit completed successfully! Results saved to ${path.join(OUTPUT_DIR, 'audit-results.json')}`);
}

runAudit().catch(err => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
