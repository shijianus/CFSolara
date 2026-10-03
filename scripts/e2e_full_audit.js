const puppeteer = require('/home/shijian/projects/shijianus-blog/node_modules/puppeteer');
const fs = require('fs');

async function runE2EAudit(targetUrl) {
    console.log(`\n======================================================================`);
    console.log(`>>> EXECUTING E2E PUPPETEER AUDIT FOR: ${targetUrl} <<<`);
    console.log(`======================================================================`);

    const consoleErrors = [];
    const pageErrors = [];
    const lyricsNetworkRequests = [];

    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800'],
        headless: 'new'
    });

    const report = {
        target: targetUrl,
        timestamp: new Date().toISOString(),
        tests: {},
        pass: true
    };

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        page.on('console', msg => {
            if (msg.type() === 'error') {
                const text = msg.text();
                // Filter benign errors like favicon 404 if any
                if (!text.includes('favicon')) {
                    consoleErrors.push(text);
                    console.log(`  [CONSOLE ERROR] ${text}`);
                }
            }
        });

        page.on('pageerror', err => {
            pageErrors.push(err.message);
            console.log(`  [UNCAUGHT PAGE ERROR] ${err.message}`);
        });

        page.on('request', req => {
            const url = req.url();
            if (url.includes('/lyrics/') || url.includes('/lyric') || url.includes('sonic/lyrics') || url.includes('sonic/forward')) {
                lyricsNetworkRequests.push({
                    url,
                    method: req.method(),
                    timestamp: Date.now()
                });
            }
        });

        console.log(`1. Navigating to ${targetUrl}...`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 35000 });
        await page.waitForSelector('#searchInput', { timeout: 10000 });
        console.log(`   Page loaded successfully.`);

        // -------------------------------------------------------------
        // SUB-TEST 1: Search & Preloading
        // -------------------------------------------------------------
        console.log(`\n[SUB-TEST 1] Search & Lyrics Preloading Verification`);
        const searchKeyword = "海阔天空";
        const reqCountBeforeSearch = lyricsNetworkRequests.length;

        console.log(`   Submitting search for: "${searchKeyword}" via searchBtn click...`);
        await page.evaluate((kw) => {
            const input = document.getElementById('searchInput');
            input.value = kw;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const btn = document.getElementById('searchBtn');
            btn.click();
        }, searchKeyword);

        await page.waitForSelector('.search-result-item', { timeout: 15000 });
        const resultCount = await page.$$eval('.search-result-item', items => items.length);
        console.log(`   Rendered search result items: ${resultCount}`);

        // Wait 1.5s for render-triggered preloads (staggered 200ms per song)
        console.log(`   Waiting 1500ms for background staggered preloading...`);
        await new Promise(r => setTimeout(r, 1500));

        const reqCountAfterRender = lyricsNetworkRequests.length;
        const renderPreloadTriggered = (reqCountAfterRender > reqCountBeforeSearch);
        console.log(`   Lyrics network requests after render: ${reqCountAfterRender} (new requests: ${reqCountAfterRender - reqCountBeforeSearch}) -> ${renderPreloadTriggered ? 'TRIGGERED' : 'NOT TRIGGERED'}`);

        // Test hover preloading on the 4th item (not in the first 3 auto-preloaded)
        console.log(`   Simulating pointer hover on 4th search result item...`);
        const fourthItem = await page.$('.search-result-item:nth-child(4)');
        let hoverPreloadTriggered = false;
        if (fourthItem) {
            const beforeHoverReqs = lyricsNetworkRequests.length;
            await fourthItem.hover();
            await new Promise(r => setTimeout(r, 800));
            const afterHoverReqs = lyricsNetworkRequests.length;
            hoverPreloadTriggered = (afterHoverReqs > beforeHoverReqs);
            console.log(`   Requests after hover on 4th item: ${afterHoverReqs} (new: ${afterHoverReqs - beforeHoverReqs}) -> ${hoverPreloadTriggered ? 'TRIGGERED' : 'NOT TRIGGERED'}`);
        }

        // Check window.lyricsCache vs internal cache
        const cacheCheck = await page.evaluate(async () => {
            const winCacheDefined = typeof window.lyricsCache !== 'undefined';
            let winCacheSize = null;
            if (winCacheDefined && window.lyricsCache instanceof Map) {
                winCacheSize = window.lyricsCache.size;
            }
            return {
                winCacheDefined,
                winCacheSize
            };
        });
        console.log(`   window.lyricsCache property inspection:`, cacheCheck);

        // Measure instant play latency (<50ms)
        console.log(`   Triggering song playback from search result to measure lyrics render latency...`);
        const renderBenchmark = await page.evaluate(async () => {
            return new Promise(resolve => {
                const playBtn = document.querySelector('.search-result-item .action-btn.play');
                if (!playBtn) {
                    resolve({ error: "playBtn not found", elapsedMs: -1 });
                    return;
                }
                const t0 = performance.now();
                playBtn.click();

                // Poll for .lyric-line with requestAnimationFrame
                const check = () => {
                    const lines = document.querySelectorAll('.lyrics-content .lyric-line');
                    if (lines && lines.length > 0) {
                        const t1 = performance.now();
                        const placeholder = document.getElementById('lyrics')?.dataset.placeholder;
                        resolve({
                            elapsedMs: t1 - t0,
                            linesCount: lines.length,
                            placeholder
                        });
                    } else {
                        requestAnimationFrame(check);
                    }
                };
                check();
            });
        });
        console.log(`   Playback lyrics render benchmark:`, renderBenchmark);

        report.tests.preloading = {
            resultCount,
            renderPreloadTriggered,
            hoverPreloadTriggered,
            windowLyricsCacheDefined: cacheCheck.winCacheDefined,
            windowLyricsCacheSize: cacheCheck.winCacheSize,
            lyricsRenderLatencyMs: renderBenchmark.elapsedMs,
            instantUnder50ms: renderBenchmark.elapsedMs <= 50,
            noBlankFlashing: renderBenchmark.placeholder === 'default',
            passed: resultCount > 0 && renderPreloadTriggered && renderBenchmark.linesCount > 0
        };

        // -------------------------------------------------------------
        // SUB-TEST 2: Word-by-Word Progressive Karaoke Wipe
        // -------------------------------------------------------------
        console.log(`\n[SUB-TEST 2] Word-by-Word Progressive Karaoke Wipe Test`);
        await page.waitForSelector('.lyrics-content .lyric-line', { timeout: 10000 });

        const wipeAudit = await page.evaluate(() => {
            const allSpans = Array.from(document.querySelectorAll('.lyrics-content .word-char'));
            let invalidSpans = 0;
            const invalidExamples = [];

            allSpans.forEach((span, idx) => {
                const start = span.getAttribute('data-start');
                const end = span.getAttribute('data-end');
                const sNum = parseFloat(start);
                const eNum = parseFloat(end);
                if (!Number.isFinite(sNum) || !Number.isFinite(eNum) || isNaN(sNum) || isNaN(eNum)) {
                    invalidSpans++;
                    if (invalidExamples.length < 3) {
                        invalidExamples.push({ idx, text: span.textContent, start, end });
                    }
                }
            });

            // Find a valid multi-word line with at least 4 word spans
            const lines = Array.from(document.querySelectorAll('.lyrics-content .lyric-line'));
            let targetLine = null;
            for (let i = 0; i < lines.length; i++) {
                const spans = Array.from(lines[i].querySelectorAll('.word-char'));
                if (spans.length >= 4) {
                    const timings = spans.map(s => ({
                        span: s,
                        text: s.textContent,
                        start: parseFloat(s.getAttribute('data-start')),
                        end: parseFloat(s.getAttribute('data-end'))
                    }));
                    if (timings.every(t => Number.isFinite(t.start) && Number.isFinite(t.end) && t.end > t.start)) {
                        targetLine = {
                            lineIndex: lines[i].getAttribute('data-index'),
                            lineText: lines[i].textContent,
                            words: timings
                        };
                        break;
                    }
                }
            }

            if (!targetLine) {
                return {
                    error: "No multi-word line with distinct timestamps found",
                    totalSpans: allSpans.length,
                    invalidSpans,
                    invalidExamples
                };
            }

            // Test active word (middle word: index 1)
            const activeIdx = 1;
            const activeWord = targetLine.words[activeIdx];
            const dur = activeWord.end - activeWord.start;
            const tMid = activeWord.start + dur * 0.45; // 45% into the word

            // Trigger syncLyrics(tMid)
            if (typeof window.syncLyrics === 'function') {
                window.syncLyrics(tMid);
            }

            const lineEl = document.querySelector(`.lyrics-content .lyric-line[data-index="${targetLine.lineIndex}"]`);
            const words = Array.from(lineEl.querySelectorAll('.word-char'));
            const singingWords = words.filter(w => w.classList.contains('word-singing'));
            const activeSpan = words[activeIdx];

            // Verify words before it have class word-sung and --fill: 100%
            const prevWordsCorrect = words.slice(0, activeIdx).every(w => {
                const fill = w.style.getPropertyValue('--fill');
                return w.classList.contains('word-sung') && !w.classList.contains('word-singing') && (fill === '100%' || fill === '100');
            });

            // Verify words after it have --fill: 0% and no word-sung or word-singing
            const nextWordsCorrect = words.slice(activeIdx + 1).every(w => {
                const fill = w.style.getPropertyValue('--fill');
                return !w.classList.contains('word-sung') && !w.classList.contains('word-singing') && (fill === '0%' || fill === '0');
            });

            const fillMid = activeSpan.style.getPropertyValue('--fill');
            const bgMid = activeSpan.style.backgroundImage;

            // Advance time by 0.1s
            const tAdv = tMid + 0.1;
            if (typeof window.syncLyrics === 'function') {
                window.syncLyrics(tAdv);
            }
            const fillAdv = activeSpan.style.getPropertyValue('--fill');
            const bgAdv = activeSpan.style.backgroundImage;

            return {
                totalSpans: allSpans.length,
                invalidSpans,
                invalidExamples,
                lineIndex: targetLine.lineIndex,
                lineText: targetLine.lineText,
                activeWordText: activeWord.text,
                tMid,
                tAdv,
                singingCount: singingWords.length,
                exactlyOneSinging: singingWords.length === 1 && singingWords[0] === activeSpan,
                prevWordsCorrect,
                nextWordsCorrect,
                fillMid,
                bgMid,
                fillAdv,
                bgAdv,
                fillProgressed: parseFloat(fillAdv) > parseFloat(fillMid)
            };
        });

        console.log(`   Wipe audit result:`, JSON.stringify(wipeAudit, null, 2));

        report.tests.karaokeWipe = {
            totalWordSpans: wipeAudit.totalSpans,
            invalidSpansCount: wipeAudit.invalidSpans,
            allWordCharsHaveValidTimestamps: wipeAudit.invalidSpans === 0 && wipeAudit.totalSpans > 0,
            singingCount: wipeAudit.singingCount,
            exactlyOneSinging: wipeAudit.exactlyOneSinging,
            prevWordsSungWith100Fill: wipeAudit.prevWordsCorrect,
            nextWordsHave0Fill: wipeAudit.nextWordsCorrect,
            activeWordHasGradient: Boolean(wipeAudit.bgMid && wipeAudit.bgMid.includes('linear-gradient')),
            fillProgressedWithTime: wipeAudit.fillProgressed,
            fillMid: wipeAudit.fillMid,
            fillAdv: wipeAudit.fillAdv,
            passed: wipeAudit.invalidSpans === 0 &&
                    wipeAudit.exactlyOneSinging &&
                    wipeAudit.prevWordsCorrect &&
                    wipeAudit.nextWordsCorrect &&
                    wipeAudit.fillProgressed
        };

        // -------------------------------------------------------------
        // SUB-TEST 3: Console & Runtime Quality Check
        // -------------------------------------------------------------
        console.log(`\n[SUB-TEST 3] Console Errors & Exception Quality Check`);
        console.log(`   Uncaught Page Errors: ${pageErrors.length}`);
        console.log(`   Console Errors: ${consoleErrors.length}`);

        report.tests.quality = {
            pageErrorsCount: pageErrors.length,
            consoleErrorsCount: consoleErrors.length,
            pageErrors,
            consoleErrors,
            passed: pageErrors.length === 0 && consoleErrors.length === 0
        };

        report.pass = report.tests.preloading.passed && report.tests.karaokeWipe.passed && report.tests.quality.passed;

    } catch (err) {
        console.error(`FATAL ERROR IN AUDIT FOR ${targetUrl}:`, err);
        report.pass = false;
        report.error = err.message;
    } finally {
        await browser.close();
    }

    console.log(`\n>>> AUDIT SUMMARY FOR ${targetUrl}: ${report.pass ? 'PASS' : 'FAIL'} <<<`);
    return report;
}

(async () => {
    const targets = ["https://sonic.epocanvas.com", "https://cfsolara-dho.pages.dev"];
    const allReports = {};
    for (const t of targets) {
        allReports[t] = await runE2EAudit(t);
    }
    const outputPath = '/root/.gemini/antigravity-cli/brain/344f44db-d511-415c-a72d-b7f4ab2b6ebc/full_e2e_results.json';
    fs.writeFileSync(outputPath, JSON.stringify(allReports, null, 2));
    console.log(`\nSaved complete E2E results to: ${outputPath}`);
})();
