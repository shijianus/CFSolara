import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('/home/shijian/projects/shijianus-blog/node_modules/puppeteer');

const TARGET_HOST = 'https://sonic.epocanvas.com';
const BACKUP_HOST = 'https://cfsolara-dho.pages.dev';
const SCREENSHOTS_DIR = path.join(__dirname, '../screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const auditResult = {
  timestamp: new Date().toISOString(),
  target: TARGET_HOST,
  backup: BACKUP_HOST,
  checks: [],
  consoleErrors: [],
  screenshots: []
};

function logCheck(name, passed, detail = {}) {
  auditResult.checks.push({ name, passed, detail });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${icon}] ${name}`);
  if (!passed) console.error('       Detail:', detail);
}

async function runAudit() {
  console.log(`\n================================================================`);
  console.log(`  Starting Comprehensive Sonic Delivery Audit for ${TARGET_HOST}`);
  console.log(`================================================================\n`);

  // 1. API Gateway Tests
  console.log('[*] 1. Auditing Sonic API Gateway endpoints...');
  try {
    const metaRes = await fetch(`${TARGET_HOST}/api`);
    const meta = await metaRes.json();
    logCheck('API Metadata GET /api returns Sonic and © EpoCanvas', 
      metaRes.status === 200 && meta.name?.includes('Sonic') && meta.copyright?.includes('EpoCanvas'),
      { status: metaRes.status, meta }
    );
  } catch (err) {
    logCheck('API Metadata GET /api', false, { error: err.message });
  }

  try {
    const searchRes = await fetch(`${TARGET_HOST}/api/sonic/search/nexus?q=${encodeURIComponent('晴天')}&count=5`);
    const search = await searchRes.json();
    logCheck('API Search GET /api/sonic/search/nexus returns tracks and brand Sonic',
      searchRes.status === 200 && search.brand === 'Sonic' && Array.isArray(search.data?.tracks) && search.data.tracks.length > 0,
      { status: searchRes.status, trackCount: search.data?.tracks?.length, sample: search.data?.tracks?.[0]?.title }
    );
  } catch (err) {
    logCheck('API Search GET /api/sonic/search/nexus', false, { error: err.message });
  }

  try {
    const lyricRes = await fetch(`${TARGET_HOST}/api/sonic/lyrics/nexus?title=${encodeURIComponent('晴天')}&artist=${encodeURIComponent('周杰伦')}`);
    const lyric = await lyricRes.json();
    logCheck('API Lyrics GET /api/sonic/lyrics/nexus returns synchronized lyrics',
      lyricRes.status === 200 && lyric.brand === 'Sonic' && (lyric.data?.plainLyrics || lyric.data?.lyrics?.length > 0),
      { status: lyricRes.status, provider: lyric.data?.provider, level: lyric.data?.level }
    );
  } catch (err) {
    logCheck('API Lyrics GET /api/sonic/lyrics/nexus', false, { error: err.message });
  }

  // 2. Puppeteer DOM & Visual Audit
  console.log('\n[*] 2. Launching Headless Chrome for DOM & Visual Verification...');
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      headless: 'new'
    });

    const page = await browser.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') {
        auditResult.consoleErrors.push(msg.text());
      }
    });

    // 2.1 Desktop Verification (1440x900)
    console.log('\n[*] 2.1 Desktop Viewport (1440x900) Audit...');
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(TARGET_HOST, { waitUntil: 'networkidle2', timeout: 35000 });
    await new Promise(r => setTimeout(r, 2500)); // Allow animations to settle

    const desktopAudit = await page.evaluate(() => {
      const header = document.querySelector('header');
      const headerText = header?.innerText || '';
      const headerHtml = header?.outerHTML || '';
      const headerLinks = Array.from(header ? header.querySelectorAll('a') : []).map(a => a.href);
      const headerButtons = Array.from(header ? header.querySelectorAll('button') : []).map(b => b.innerText || b.title || b.getAttribute('aria-label') || '');

      const forbiddenDocs = ['github.com/XiangZi7', 'miraitv', 'gm-doc', 'gmpd'];
      const leakedDocs = headerLinks.filter(l => forbiddenDocs.some(d => l.includes(d)));
      const hasLogin = headerButtons.some(b => /login|登录|sign in/i.test(b)) || /t\(['"]auth\.login['"]\)/i.test(headerHtml);

      const hasSonicBrand = headerText.includes('Sonic') || headerHtml.includes('Sonic');

      const mainContainer = document.querySelector('.glass-container');
      const containerRadius = mainContainer ? window.getComputedStyle(mainContainer).borderRadius : '';

      const aside = document.querySelector('aside');
      const asideRadius = aside ? window.getComputedStyle(aside).borderRadius : '';

      const footer = document.querySelector('footer');
      const footerRadius = footer ? window.getComputedStyle(footer).borderRadius : '';

      return {
        hasSonicBrand,
        headerText,
        leakedDocs,
        hasLogin,
        containerRadius,
        asideRadius,
        footerRadius,
        headerButtonsCount: headerButtons.length
      };
    });

    logCheck('Desktop Header contains "Sonic" branding', desktopAudit.hasSonicBrand, { text: desktopAudit.headerText });
    logCheck('Desktop Header has ZERO external doc links from GlassMusicPlayer', desktopAudit.leakedDocs.length === 0, { leakedDocs: desktopAudit.leakedDocs });
    logCheck('Desktop Header has ZERO Login button', !desktopAudit.hasLogin, { hasLogin: desktopAudit.hasLogin });
    logCheck('Main container uses rounded squircle styling (>= 24px)', parseInt(desktopAudit.containerRadius) >= 24, { radius: desktopAudit.containerRadius });

    const desktopScreenshotPath = path.join(SCREENSHOTS_DIR, 'production_desktop_1440.png');
    await page.screenshot({ path: desktopScreenshotPath, fullPage: false });
    auditResult.screenshots.push(desktopScreenshotPath);
    console.log(`  [📸 Screenshot] Saved desktop screenshot to ${desktopScreenshotPath}`);

    // 2.2 Mobile Verification (390x844 - iPhone 14 style)
    console.log('\n[*] 2.2 Mobile Viewport (390x844) Audit...');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(TARGET_HOST, { waitUntil: 'networkidle2', timeout: 35000 });
    await new Promise(r => setTimeout(r, 2500));

    const mobileAudit = await page.evaluate(() => {
      const header = document.querySelector('header');
      const headerText = header?.innerText || '';
      const headerButtons = Array.from(header ? header.querySelectorAll('button') : []).map(b => b.innerText || b.title || '');
      const hasLogin = headerButtons.some(b => /login|登录/i.test(b));
      const hasSonicBrand = headerText.includes('Sonic');
      const notGlassPlayer = !headerText.includes('Glass Music Player');

      const mobileNav = document.querySelector('nav.fixed');
      const navRadius = mobileNav ? window.getComputedStyle(mobileNav).borderRadius : '';
      const navLinks = Array.from(mobileNav ? mobileNav.querySelectorAll('a') : []).length;

      return {
        hasSonicBrand,
        notGlassPlayer,
        hasLogin,
        navRadius,
        navLinks
      };
    });

    logCheck('Mobile Header contains "Sonic" branding and not "Glass Music Player"', mobileAudit.hasSonicBrand && mobileAudit.notGlassPlayer, mobileAudit);
    logCheck('Mobile Header has ZERO Login button', !mobileAudit.hasLogin, { hasLogin: mobileAudit.hasLogin });
    logCheck('Mobile floating TabBar uses rounded pill styling (>= 20px) with navigation links', parseInt(mobileAudit.navRadius) >= 20 && mobileAudit.navLinks >= 4, mobileAudit);

    const mobileScreenshotPath = path.join(SCREENSHOTS_DIR, 'production_mobile_390.png');
    await page.screenshot({ path: mobileScreenshotPath, fullPage: false });
    auditResult.screenshots.push(mobileScreenshotPath);
    console.log(`  [📸 Screenshot] Saved mobile screenshot to ${mobileScreenshotPath}`);

    // 2.3 Fatal Console Errors Check
    const fatalErrors = auditResult.consoleErrors.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'));
    logCheck('Zero fatal client-side JavaScript console errors', fatalErrors.length === 0, { fatalErrors });

  } catch (err) {
    logCheck('Puppeteer Execution', false, { error: err.message });
  } finally {
    if (browser) await browser.close();
  }

  // 3. Overall Summary
  const allPassed = auditResult.checks.every(c => c.passed);
  auditResult.status = allPassed ? 'SUCCESS' : 'FAILED';
  const reportPath = path.join(SCREENSHOTS_DIR, 'delivery_audit_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(auditResult, null, 2), 'utf8');

  console.log(`\n================================================================`);
  console.log(`  DELIVERY AUDIT FINISHED: ${auditResult.status}`);
  console.log(`  Total Checks: ${auditResult.checks.length} | Passed: ${auditResult.checks.filter(c => c.passed).length}`);
  console.log(`  Report saved to: ${reportPath}`);
  console.log(`================================================================\n`);

  if (!allPassed) process.exit(1);
}

runAudit().catch(err => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
