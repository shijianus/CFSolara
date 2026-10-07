import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('/home/shijian/projects/shijianus-blog/node_modules/puppeteer');

const TARGET_HOSTS = [
  'https://cfsolara-dho.pages.dev',
  'https://sonic.epocanvas.com'
];

const report = {
  timestamp: new Date().toISOString(),
  environment: 'Cloudflare Pages Production',
  summary: {
    totalChecks: 0,
    passedChecks: 0,
    failedChecks: 0,
    status: 'PENDING'
  },
  domains: {},
  gitAudit: {}
};

function recordCheck(section, checkName, passed, details = {}) {
  report.summary.totalChecks++;
  if (passed) {
    report.summary.passedChecks++;
  } else {
    report.summary.failedChecks++;
  }
  section.push({
    check: checkName,
    passed,
    details
  });
  const statusStr = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`  [${statusStr}] ${checkName}`);
  if (!passed) {
    console.error(`      Detail:`, details);
  }
}

async function auditHost(baseUrl) {
  console.log(`\n================================================================`);
  console.log(`  Auditing Domain: ${baseUrl}`);
  console.log(`================================================================`);
  
  const hostReport = {
    htmlAudit: [],
    staticAssetsAudit: [],
    domHeaderAudit: [],
    apiGatewayAudit: []
  };

  // 1. Fetch Home Page HTML
  console.log(`\n[*] 1. Fetching Home Page HTML from ${baseUrl}...`);
  let html = '';
  try {
    const res = await fetch(baseUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SonicDeliveryVerifier/1.0'
      }
    });
    recordCheck(hostReport.htmlAudit, 'Home Page Status 200', res.status === 200, { status: res.status });
    html = await res.text();
  } catch (err) {
    recordCheck(hostReport.htmlAudit, 'Home Page Fetch', false, { error: err.message });
    return hostReport;
  }

  // 1.1 Check <title>
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const expectedTitle = 'Sonic - Cloud Music Platform';
  recordCheck(hostReport.htmlAudit, `Title is "${expectedTitle}"`, title === expectedTitle, { found: title, expected: expectedTitle });

  // 1.2 Check author
  const authorMatch = html.match(/<meta\s+name=["']author["']\s+content=["'](.*?)["']/i) ||
                      html.match(/<meta\s+content=["'](.*?)["']\s+name=["']author["']/i);
  const author = authorMatch ? authorMatch[1].trim() : '';
  const expectedAuthor = 'EpoCanvas';
  recordCheck(hostReport.htmlAudit, `Meta Author is "${expectedAuthor}"`, author === expectedAuthor, { found: author, expected: expectedAuthor });

  // 1.3 Check description
  const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i) ||
                    html.match(/<meta\s+content=["'](.*?)["']\s+name=["']description["']/i);
  const desc = descMatch ? descMatch[1].trim() : '';
  const expectedDesc = 'Sonic Music Cloud Platform (by EpoCanvas)';
  recordCheck(hostReport.htmlAudit, `Meta Description is "${expectedDesc}"`, desc === expectedDesc, { found: desc, expected: expectedDesc });

  // 1.4 Check absence of third-party tracking scripts
  const trackingIssues = [];
  if (html.includes('hm.baidu.com')) trackingIssues.push('Found hm.baidu.com');
  if (html.includes('_hmt')) trackingIssues.push('Found _hmt variable');
  if (html.includes('googletagmanager.com')) trackingIssues.push('Found googletagmanager.com');
  if (html.includes('google-analytics.com')) trackingIssues.push('Found google-analytics.com');
  if (html.includes('G-2GMSLM2MS1')) trackingIssues.push('Found legacy GA tracking ID G-2GMSLM2MS1');
  if (html.includes('5e7e5a99690d5877df4b244a2295231d')) trackingIssues.push('Found legacy Baidu tracking token');

  recordCheck(
    hostReport.htmlAudit,
    'No Third-Party Tracking Scripts (Baidu Analytics & Google Analytics)',
    trackingIssues.length === 0,
    { issues: trackingIssues }
  );

  // 1.5 Extract and Verify Static Assets
  console.log(`\n[*] 2. Checking Static Assets Referenced in HTML...`);
  const assetUrls = new Set();
  
  // Extract link hrefs
  const linkRegex = /<link\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    if (href.startsWith('/') && !href.startsWith('//')) {
      assetUrls.add(href);
    }
  }

  // Extract script srcs
  const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
  while ((match = scriptRegex.exec(html)) !== null) {
    const src = match[1];
    if (src.startsWith('/') && !src.startsWith('//')) {
      assetUrls.add(src);
    }
  }

  // Ensure /logo.svg is checked
  assetUrls.add('/logo.svg');

  console.log(`  Found ${assetUrls.size} local static assets to verify.`);
  for (const assetPath of Array.from(assetUrls).sort()) {
    const fullUrl = new URL(assetPath, baseUrl).toString();
    try {
      const assetRes = await fetch(fullUrl, { method: 'GET' });
      const contentLength = assetRes.headers.get('content-length') || 0;
      const contentType = assetRes.headers.get('content-type') || '';
      const is200 = assetRes.status === 200;
      recordCheck(
        hostReport.staticAssetsAudit,
        `Asset ${assetPath} returned HTTP 200`,
        is200,
        { fullUrl, status: assetRes.status, contentType, contentLength }
      );
    } catch (err) {
      recordCheck(
        hostReport.staticAssetsAudit,
        `Asset ${assetPath} returned HTTP 200`,
        false,
        { fullUrl, error: err.message }
      );
    }
  }

  // 1.6 Puppeteer DOM Audit: Live Header Elements
  console.log(`\n[*] 3. Inspecting Live Rendered DOM Header with Puppeteer...`);
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ],
      headless: 'new'
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    const headerDetails = await page.evaluate(() => {
      const header = document.querySelector('header');
      if (!header) return { found: false };

      const text = header.innerText || '';
      const htmlContent = header.outerHTML || '';

      // Check external links
      const links = Array.from(header.querySelectorAll('a')).map(a => ({
        href: a.href,
        text: a.innerText,
        title: a.title
      }));

      // Check buttons
      const buttons = Array.from(header.querySelectorAll('button')).map(b => ({
        text: b.innerText,
        title: b.title,
        ariaLabel: b.getAttribute('aria-label')
      }));

      return {
        found: true,
        text,
        htmlContent,
        links,
        buttons
      };
    });

    recordCheck(
      hostReport.domHeaderAudit,
      'Live <header> element rendered in DOM',
      headerDetails.found,
      { found: headerDetails.found }
    );

    if (headerDetails.found) {
      // Brand text check
      const hasBrand = headerDetails.text.includes('Sonic') || headerDetails.htmlContent.includes('Sonic');
      recordCheck(
        hostReport.domHeaderAudit,
        'Header contains "Sonic" branding',
        hasBrand,
        { headerText: headerDetails.text }
      );

      // Check no GlassMusicPlayer doc / external links:
      // miraitv, github.com/XiangZi7, gm-doc, gmpd
      const forbiddenDomains = [
        'github.com/XiangZi7',
        'miraitv.pages.dev',
        'gm-doc.pages.dev',
        'gmpd.netlify.app'
      ];
      const leakedLinks = headerDetails.links.filter(l => 
        forbiddenDomains.some(d => l.href.includes(d))
      );
      recordCheck(
        hostReport.domHeaderAudit,
        'Header has NO external GlassMusicPlayer doc links (github, miraitv, gm-doc, gmpd)',
        leakedLinks.length === 0,
        { leakedLinks, totalLinksInHeader: headerDetails.links.length }
      );

      // Check no Login button
      const loginTriggers = headerDetails.buttons.filter(b => {
        const full = `${b.text} ${b.title || ''} ${b.ariaLabel || ''}`.toLowerCase();
        return full.includes('login') || full.includes('登录') || full.includes('sign in');
      });
      const hasLoginInHtml = /t\(['"]auth\.login['"]\)|<LoginDialog/i.test(headerDetails.htmlContent);

      recordCheck(
        hostReport.domHeaderAudit,
        'Header has NO Login button (cleanly removed)',
        loginTriggers.length === 0 && !hasLoginInHtml,
        { loginTriggers, hasLoginInHtml }
      );
    }
  } catch (err) {
    recordCheck(
      hostReport.domHeaderAudit,
      'Puppeteer Header Inspection',
      false,
      { error: err.message }
    );
  } finally {
    if (browser) await browser.close();
  }

  // 2. Online Aggregation API Gateway Verification
  console.log(`\n[*] 4. Testing Aggregation API Gateway Endpoints...`);

  // 2.1 Metadata API /api
  try {
    const metaRes = await fetch(`${baseUrl}/api`);
    const metaStatusOk = metaRes.status === 200;
    const metaJson = await metaRes.json();
    const hasSonicName = metaJson.name && metaJson.name.includes('Sonic');
    const hasEpoCanvasCopyright = metaJson.copyright && metaJson.copyright.includes('© EpoCanvas');

    recordCheck(
      hostReport.apiGatewayAudit,
      'GET /api returns 200 with metadata (Platform: Sonic, Copyright: © EpoCanvas)',
      metaStatusOk && hasSonicName && hasEpoCanvasCopyright,
      { status: metaRes.status, name: metaJson.name, copyright: metaJson.copyright }
    );
  } catch (err) {
    recordCheck(
      hostReport.apiGatewayAudit,
      'GET /api returns 200 with metadata',
      false,
      { error: err.message }
    );
  }

  // 2.2 Parallel Search API /api/sonic/search/nexus?keyword=晴天
  try {
    const searchUrl = `${baseUrl}/api/sonic/search/nexus?keyword=${encodeURIComponent('晴天')}`;
    const searchRes = await fetch(searchUrl);
    const searchStatusOk = searchRes.status === 200;
    const searchJson = await searchRes.json();
    const isBrandSonic = searchJson.brand === 'Sonic';
    const hasTracks = searchJson.data && Array.isArray(searchJson.data.tracks) && searchJson.data.tracks.length > 0;
    const firstTrack = hasTracks ? searchJson.data.tracks[0] : null;

    recordCheck(
      hostReport.apiGatewayAudit,
      'GET /api/sonic/search/nexus returns 200, brand "Sonic", and tracks array',
      searchStatusOk && isBrandSonic && hasTracks,
      {
        status: searchRes.status,
        brand: searchJson.brand,
        totalTracks: hasTracks ? searchJson.data.tracks.length : 0,
        sampleTrack: firstTrack ? { title: firstTrack.title, artist: firstTrack.artist, platform: firstTrack.platform } : null
      }
    );
  } catch (err) {
    recordCheck(
      hostReport.apiGatewayAudit,
      'GET /api/sonic/search/nexus returns 200 and tracks',
      false,
      { error: err.message }
    );
  }

  // 2.3 Synced Lyrics API /api/sonic/lyrics/nexus?title=晴天&artist=周杰伦
  try {
    const lyricsUrl = `${baseUrl}/api/sonic/lyrics/nexus?title=${encodeURIComponent('晴天')}&artist=${encodeURIComponent('周杰伦')}`;
    const lyricsRes = await fetch(lyricsUrl);
    const lyricsStatusOk = lyricsRes.status === 200;
    const lyricsJson = await lyricsRes.json();
    const isBrandSonic = lyricsJson.brand === 'Sonic';
    const hasLyricsData = lyricsJson.data && (
      Boolean(lyricsJson.data.plainLyrics) ||
      (Array.isArray(lyricsJson.data.lyrics) && lyricsJson.data.lyrics.length > 0)
    );
    const level = lyricsJson.data ? lyricsJson.data.level : null;

    recordCheck(
      hostReport.apiGatewayAudit,
      'GET /api/sonic/lyrics/nexus returns 200, brand "Sonic", and synchronized lyrics',
      lyricsStatusOk && isBrandSonic && hasLyricsData,
      {
        status: lyricsRes.status,
        brand: lyricsJson.brand,
        level: level,
        provider: lyricsJson.data?.provider,
        samplePreview: lyricsJson.data?.plainLyrics ? lyricsJson.data.plainLyrics.slice(0, 100) : null
      }
    );
  } catch (err) {
    recordCheck(
      hostReport.apiGatewayAudit,
      'GET /api/sonic/lyrics/nexus returns 200 and synchronized lyrics',
      false,
      { error: err.message }
    );
  }

  return hostReport;
}

function auditGitStatus() {
  console.log(`\n================================================================`);
  console.log(`  Auditing Local Codebase Git Status`);
  console.log(`================================================================`);
  
  const gitChecks = [];

  // 3.1 Check .gitignore contains temp_glass_player and temp_sonic_ui
  const gitignoreContent = fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf8');
  const hasGlassInIgnore = gitignoreContent.includes('temp_glass_player');
  const hasSonicInIgnore = gitignoreContent.includes('temp_sonic_ui');

  recordCheck(
    gitChecks,
    '.gitignore contains temp_glass_player/ and temp_sonic_ui/',
    hasGlassInIgnore && hasSonicInIgnore,
    { hasGlassInIgnore, hasSonicInIgnore }
  );

  // 3.2 Verify git check-ignore reports both folders
  try {
    const checkIgnoreOutput = execSync('git check-ignore temp_glass_player temp_sonic_ui', { encoding: 'utf8' }).trim();
    const lines = checkIgnoreOutput.split('\n');
    const ignoredCorrectly = lines.some(l => l.includes('temp_glass_player')) && lines.some(l => l.includes('temp_sonic_ui'));
    recordCheck(
      gitChecks,
      'git check-ignore confirms both temporary folders are ignored',
      ignoredCorrectly,
      { output: checkIgnoreOutput }
    );
  } catch (err) {
    recordCheck(
      gitChecks,
      'git check-ignore confirms both temporary folders are ignored',
      false,
      { error: err.message }
    );
  }

  // 3.3 Verify git staged area is clean (no accidental commits staged)
  try {
    const stagedOutput = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim();
    recordCheck(
      gitChecks,
      'Git index / staged changes are clean (no uncommitted source staged)',
      stagedOutput === '',
      { stagedFiles: stagedOutput ? stagedOutput.split('\n') : [] }
    );
  } catch (err) {
    recordCheck(
      gitChecks,
      'Git index / staged changes check',
      false,
      { error: err.message }
    );
  }

  // 3.4 Verify git history never committed temp_glass_player or temp_sonic_ui
  try {
    const commitHistory = execSync('git log --all -- "temp_glass_player*" "temp_sonic_ui*"', { encoding: 'utf8' }).trim();
    recordCheck(
      gitChecks,
      'Git history has zero commits containing temp_glass_player or temp_sonic_ui',
      commitHistory === '',
      { commitCount: commitHistory ? commitHistory.split('\n').length : 0 }
    );
  } catch (err) {
    recordCheck(
      gitChecks,
      'Git commit history check',
      false,
      { error: err.message }
    );
  }

  return gitChecks;
}

async function run() {
  console.log(`Starting Sonic Delivery Verification at ${new Date().toISOString()}`);

  for (const host of TARGET_HOSTS) {
    report.domains[host] = await auditHost(host);
  }

  report.gitAudit = auditGitStatus();

  report.summary.status = report.summary.failedChecks === 0 ? 'PASSED' : 'FAILED';

  const outputPath = path.join(__dirname, 'final_delivery_verification_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`\n================================================================`);
  console.log(`  VERIFICATION COMPLETED: ${report.summary.status}`);
  console.log(`  Passed: ${report.summary.passedChecks}/${report.summary.totalChecks} checks`);
  console.log(`  Report saved to: ${outputPath}`);
  console.log(`================================================================\n`);

  if (report.summary.failedChecks > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
