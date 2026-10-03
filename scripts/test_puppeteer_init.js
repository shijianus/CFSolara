const puppeteer = require('/home/shijian/projects/shijianus-blog/node_modules/puppeteer');

(async () => {
    try {
        console.log("Launching browser...");
        const browser = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            headless: 'new'
        });
        const page = await browser.newPage();
        console.log("Navigating to https://sonic.epocanvas.com ...");
        await page.goto('https://sonic.epocanvas.com', { waitUntil: 'networkidle2', timeout: 30000 });
        const title = await page.title();
        console.log("Page title:", title);
        
        const winKeys = await page.evaluate(() => {
            return {
                hasLyricsCache: typeof window.lyricsCache !== 'undefined',
                hasSyncLyrics: typeof window.syncLyrics !== 'undefined',
                hasSolaraDom: typeof window.SolaraDom !== 'undefined',
                hasPlayer: typeof dom !== 'undefined' || typeof window.dom !== 'undefined'
            };
        });
        console.log("Window check:", winKeys);
        
        await browser.close();
        console.log("Puppeteer test completed successfully.");
    } catch (err) {
        console.error("Puppeteer init error:", err);
        process.exit(1);
    }
})();
