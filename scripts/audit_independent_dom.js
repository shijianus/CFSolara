const puppeteer = require('/home/shijian/projects/shijianus-blog/node_modules/puppeteer');
const fs = require('fs');

async function runBrowserDomAudit() {
    console.log("================================================================================");
    console.log("  BROWSER DOM & FRONTEND PIPELINE AUDIT (Puppeteer E2E)");
    console.log("================================================================================");

    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1280,800'
        ],
        headless: 'new'
    });

    const results = {};

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        const baseUrl = "https://cfsolara-dho.pages.dev";
        console.log(`[*] Navigating to ${baseUrl} ...`);
        await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 35000 });

        // Search for "晴天"
        await page.waitForSelector('#searchInput', { timeout: 10000 });
        await page.type('#searchInput', '晴天');
        await page.click('#searchBtn');
        await page.waitForSelector('.search-result-item', { timeout: 15000 });

        console.log("[*] Search results loaded. Triggering playSearchResult(0)...");
        await page.evaluate(() => playSearchResult(0));

        // Wait for lyrics to render
        await page.waitForFunction(() => {
            const lines = document.querySelectorAll('.lyrics-content .lyric-line');
            return lines && lines.length > 0;
        }, { timeout: 10000 });
        console.log("[*] SUCCESS: Lyrics rendered in live DOM!");

        // 1. Check window.lyricsCache
        const cacheDump = await page.evaluate(() => {
            if (!window.lyricsCache) return null;
            const entries = [];
            for (const [k, v] of window.lyricsCache.entries()) {
                entries.push({
                    key: k,
                    type: v.type,
                    provider: v.provider,
                    lyricSyncType: v.lyricSyncType,
                    lyricSourceQuality: v.lyricSourceQuality,
                    linesCount: (v.lyricsData || []).length
                });
            }
            return entries;
        });
        console.log("[*] window.lyricsCache dump:", JSON.stringify(cacheDump, null, 2));
        results.cacheDump = cacheDump;

        // 2. DOM Structure Inspection of first 3 lyric lines
        const domInspection = await page.evaluate(() => {
            const lines = Array.from(document.querySelectorAll('.lyrics-content .lyric-line'));
            return lines.slice(0, 3).map((line, idx) => {
                const words = Array.from(line.querySelectorAll('.word-char')).map(w => ({
                    text: w.textContent,
                    dataStart: w.getAttribute('data-start'),
                    dataEnd: w.getAttribute('data-end'),
                    dataWindex: w.getAttribute('data-windex'),
                    styleFill: w.style.getPropertyValue('--fill'),
                    className: w.className
                }));
                return {
                    lineIndex: idx,
                    lineDataTime: line.getAttribute('data-time'),
                    lineDataIndex: line.getAttribute('data-index'),
                    className: line.className,
                    text: line.textContent,
                    wordsCount: words.length,
                    words: words
                };
            });
        });
        console.log("[*] DOM Inspection (First 3 lines in DOM):", JSON.stringify(domInspection, null, 2));
        results.domInspection = domInspection;

        // 3. Dynamic syncLyrics invocation test at specific timestamps
        // Test 3.1: Prelude (t = 10.0s, vocal starts at 29.264s)
        console.log("\n[*] 3.1 Testing Prelude at t=10.0s (Before vocal start 29.264s)...");
        const syncTestPrelude = await page.evaluate(() => {
            syncLyrics(10.0);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const anySinging = document.querySelector('.lyrics-content .word-singing');
            const anySung = document.querySelector('.lyrics-content .word-sung');
            return {
                hasCurrentLine: !!currentLine,
                hasAnySingingWord: !!anySinging,
                hasAnySungWord: !!anySung
            };
        });
        console.log("    Results at prelude t=10.0s:", JSON.stringify(syncTestPrelude, null, 2));
        results.syncTestPrelude = syncTestPrelude;

        // Test 3.2: Mid-vocal word wiping (t = 29.8s)
        // Line 0: "故事的小黄花"
        // Word 0 "故": [29.264 - 29.654] -> should be word-sung (--fill: 100%)
        // Word 1 "事": [29.654 - 30.046] -> should be word-singing (--fill: ~37.2%)
        // Word 2 "的": [30.046 - 30.494] -> should be unsung (--fill: 0%)
        console.log("\n[*] 3.2 Testing Mid-vocal Progressive Wipe at t=29.800s (inside Word 1 '事')...");
        const syncTestMidVocal = await page.evaluate(() => {
            syncLyrics(29.8);
            const line0 = document.querySelector('.lyrics-content .lyric-line[data-index="0"]');
            const words = Array.from(line0.querySelectorAll('.word-char')).map(w => ({
                text: w.textContent,
                start: w.getAttribute('data-start'),
                end: w.getAttribute('data-end'),
                fill: w.style.getPropertyValue('--fill'),
                classes: w.className,
                bgImage: w.style.backgroundImage
            }));
            return {
                line0Current: line0.classList.contains('current'),
                words
            };
        });
        console.log("    Results at t=29.8s:", JSON.stringify(syncTestMidVocal, null, 2));
        results.syncTestMidVocal = syncTestMidVocal;

        // Test 3.3: Interlude between Line 0 and Line 1 (t = 32.500s)
        // Line 0 ends at 32.294s, Line 1 starts at 32.710s
        console.log("\n[*] 3.3 Testing Interlude between Line 0 and Line 1 at t=32.500s...");
        const syncTestInterlude = await page.evaluate(() => {
            syncLyrics(32.5);
            const line0 = document.querySelector('.lyrics-content .lyric-line[data-index="0"]');
            const line1 = document.querySelector('.lyrics-content .lyric-line[data-index="1"]');
            const singingWordsInLine0 = Array.from(line0.querySelectorAll('.word-singing')).map(w => w.textContent);
            const sungWordsInLine0 = Array.from(line0.querySelectorAll('.word-sung')).map(w => w.textContent);
            const words = Array.from(line0.querySelectorAll('.word-char')).map(w => ({
                text: w.textContent,
                fill: w.style.getPropertyValue('--fill'),
                classes: w.className
            }));
            return {
                line0IsCurrent: line0.classList.contains('current'),
                line1IsCurrent: line1.classList.contains('current'),
                singingWordsInLine0,
                sungWordsCountInLine0: sungWordsInLine0.length,
                totalWordsInLine0: line0.querySelectorAll('.word-char').length,
                words
            };
        });
        console.log("    Results at interlude t=32.5s:", JSON.stringify(syncTestInterlude, null, 2));
        results.syncTestInterlude = syncTestInterlude;

        // Test 3.4: Audio pause freeze verification
        console.log("\n[*] 3.4 Testing Audio Pause Freeze...");
        const pauseTest = await page.evaluate(() => {
            const player = document.querySelector('#audioPlayer');
            player.pause();
            const isPaused = player.paused;
            const lyricSyncRaf = typeof lyricSyncRafId !== 'undefined' ? lyricSyncRafId : null;
            return {
                isPaused,
                lyricSyncRafId: lyricSyncRaf
            };
        });
        console.log("    Results on pause:", JSON.stringify(pauseTest, null, 2));
        results.pauseTest = pauseTest;

        // Save DOM audit output
        const outPath = "/home/shijian/projects/CFSolara/scripts/audit_independent_dom_results.json";
        fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
        console.log(`\n[+] DOM Audit Results successfully saved to: ${outPath}`);

    } catch (err) {
        console.error("[!] Browser DOM Audit Error:", err);
    } finally {
        await browser.close();
    }
}

runBrowserDomAudit();
