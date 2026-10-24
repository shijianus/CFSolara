const puppeteer = require('puppeteer-core');

const DOMAIN = 'https://sonic.epocanvas.tech/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runScenario(name, { quic = false, breakStorage = false, blockApi = false } = {}) {
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'];
  if (quic) {
    args.push('--enable-quic', '--origin-to-force-quic-on=sonic.epocanvas.tech:443');
  }
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const pageErrors = [];
  const consoleErrors = [];
  const failed = [];
  const statuses = {};
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('requestfailed', (r) => failed.push({ url: r.url().slice(0, 140), err: r.failure()?.errorText }));
  page.on('response', (r) => {
    const u = r.url();
    if (u.startsWith(DOMAIN) || u.includes('/static/')) {
      const p = u.replace(DOMAIN, '/');
      statuses[p] = r.status();
    }
  });

  if (breakStorage) {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(window, 'localStorage', {
        get() { throw new DOMException('Access denied', 'SecurityError'); },
      });
    });
  }
  if (blockApi) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('/api/')) req.abort('failed');
      else req.continue();
    });
  }

  let gotoErr = null;
  try {
    await page.goto(DOMAIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    gotoErr = String(e).slice(0, 200);
  }
  await sleep(9000);

  const state = await page.evaluate(() => {
    const app = document.querySelector('#app');
    return {
      title: document.title,
      appHTML: app ? app.innerHTML.length : 0,
      appText: app ? app.innerText.replace(/\s+/g, ' ').slice(0, 120) : null,
      bodyText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 120),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      hasSidebar: !!document.querySelector('aside'),
      staticResources: performance.getEntriesByType('resource').filter((r) => r.name.includes('/static/')).length,
    };
  });
  await page.screenshot({ path: `/data/workspace/sonic/diag-${name}.png` });

  await browser.close();
  return { name, quic, breakStorage, blockApi, gotoErr, state, pageErrors, consoleErrors, failed: failed.slice(0, 8), statusCount: Object.keys(statuses).length, statuses };
}

(async () => {
  const out = [];
  out.push(await runScenario('baseline'));
  out.push(await runScenario('quic', { quic: true }));
  out.push(await runScenario('nostorage', { breakStorage: true }));
  out.push(await runScenario('noapi', { blockApi: true }));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error('DIAG_FAILED', e); process.exit(1); });
