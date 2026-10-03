const puppeteer = require('/home/shijian/projects/shijianus-blog/node_modules/puppeteer');
const fs = require('fs');

async function auditFrontend(baseUrl) {
    console.log(`\n======================================================================`);
    console.log(`>>> STARTING FRONTEND E2E AUDIT FOR: ${baseUrl} <<<`);
    console.log(`======================================================================`);

    const consoleMessages = [];
    const pageErrors = [];

    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800'],
        headless: 'new'
    });

    const results = {
        baseUrl,
        preloading: {},
        karaokeWipe: {},
        quality: {},
        pass: true
    };

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        page.on('console', msg => {
            const type = msg.type();
            const text = msg.text();
            consoleMessages.push({ type, text });
            if (type === 'error') {
                console.log(`  [BROWSER ERROR] ${text}`);
            }
        });

        page.on('pageerror', err => {
            console.log(`  [PAGE UNCAUGHT ERROR] ${err.message}`);
            pageErrors.push(err.message);
        });

        // Track network requests for lyrics
        const lyricsRequests = [];
        page.on('request', req => {
            const url = req.url();
            if (url.includes('/lyrics/') || url.includes('/lyric') || url.includes('sonic')) {
                lyricsRequests.push({ url, time: Date.now() });
            }
        });

        console.log(`1. Navigating to ${baseUrl} ...`);
        await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for search input
        await page.waitForSelector('#searchInput', { timeout: 10000 });
        console.log(`   Page loaded successfully.`);

        // Test 1: Preloading Test
        console.log(`\n--- TEST 1: Preloading & Instant Lyrics Display ---`);
        const searchKeyword = "海阔天空";
        console.log(`   Searching for: "${searchKeyword}"`);
        await page.type('#searchInput', searchKeyword);
        await page.click('#searchBtn');

        // Wait for search results
        await page.waitForSelector('.search-result-item', { timeout: 15000 });
        const resultItemsCount = await page.$$eval('.search-result-item', items => items.length);
        console.log(`   Search results rendered: ${resultItemsCount} items`);

        // Wait 1 second to allow staggered preloading on render to trigger
        await new Promise(r => setTimeout(r, 1200));

        // Check if preloading triggered
        const preloadReqsAfterRender = lyricsRequests.length;
        console.log(`   Lyrics network requests triggered so far: ${preloadReqsAfterRender}`);

        // Check window.lyricsCache vs internal cache
        const cacheEvaluation = await page.evaluate(async () => {
            const hasWinCache = typeof window.lyricsCache !== 'undefined';
            let winCacheSize = null;
            if (hasWinCache && window.lyricsCache instanceof Map) {
                winCacheSize = window.lyricsCache.size;
            }

            // Check if preloadLyrics is callable and instant
            // Get first song from state.searchResults if accessible or via UI
            let internalCached = false;
            let songTitle = null;
            if (typeof window.getLyricCacheKey === 'function' && typeof window.preloadLyrics === 'function') {
                // Check items
                const item = document.querySelector('.search-result-item');
                const idx = item ? parseInt(item.dataset.index, 10) : 0;
                // If we can inspect via test preload
                const t0 = performance.now();
                // We test calling preloadLyrics for item
            }
            return {
                hasWinCache,
                winCacheSize
            };
        });
        console.log(`   window.lyricsCache check:`, cacheEvaluation);

        // Hover over the second search result item to test hover preloading
        console.log(`   Simulating hover on second result item...`);
        const preReqCountBeforeHover = lyricsRequests.length;
        const secondItem = await page.$('.search-result-item:nth-child(2)');
        if (secondItem) {
            await secondItem.hover();
            await new Promise(r => setTimeout(r, 600));
        }
        const preReqCountAfterHover = lyricsRequests.length;
        console.log(`   Lyrics requests before hover: ${preReqCountBeforeHover}, after hover: ${preReqCountAfterHover}`);

        // Click first item to play and measure display latency
        console.log(`   Clicking first song to play and measuring lyric render latency...`);
        const firstItem = await page.$('.search-result-item:first-child');
        
        // Measure time to lyrics rendered
        const tStart = Date.now();
        await firstItem.click();

        // Check how fast .lyric-line appears
        let lyricsAppearMs = -1;
        try {
            await page.waitForFunction(() => {
                const lines = document.querySelectorAll('.lyrics-content .lyric-line');
                return lines && lines.length > 0;
            }, { timeout: 3000 });
            lyricsAppearMs = Date.now() - tStart;
            console.log(`   Lyrics appeared in DOM in: ${lyricsAppearMs} ms!`);
        } catch (e) {
            console.log(`   Timed out waiting for lyrics lines in DOM!`);
        }

        results.preloading = {
            searchKeyword,
            resultsCount: resultItemsCount,
            preloadingRequestsTriggered: preReqCountAfterHover > 0,
            hasWindowLyricsCache: cacheEvaluation.hasWinCache,
            windowLyricsCacheSize: cacheEvaluation.winCacheSize,
            lyricsDisplayLatencyMs: lyricsAppearMs,
            instantDisplayUnder50ms: lyricsAppearMs <= 50,
            passed: resultItemsCount > 0 && lyricsAppearMs >= 0 && lyricsAppearMs <= 100
        };

        // Test 2: Word-by-Word Progressive Karaoke Wipe Test
        console.log(`\n--- TEST 2: Word-by-Word Progressive Karaoke Wipe Test ---`);
        // Verify .word-char spans and data-start / data-end attributes
        const wordCharStats = await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('.lyrics-content .word-char'));
            if (spans.length === 0) return { count: 0, validSpans: 0, invalidSpans: 0 };
            let valid = 0;
            let invalid = 0;
            const invalidExamples = [];
            spans.forEach(s => {
                const start = s.getAttribute('data-start');
                const end = s.getAttribute('data-end');
                const startNum = parseFloat(start);
                const endNum = parseFloat(end);
                if (Number.isFinite(startNum) && Number.isFinite(endNum) && !isNaN(startNum) && !isNaN(endNum)) {
                    valid++;
                } else {
                    invalid++;
                    if (invalidExamples.length < 3) {
                        invalidExamples.push({ text: s.textContent, start, end });
                    }
                }
            });
            return {
                count: spans.length,
                validSpans: valid,
                invalidSpans: invalid,
                invalidExamples
            };
        });
        console.log(`   Word spans total: ${wordCharStats.count}, valid data-start/end: ${wordCharStats.validSpans}, invalid: ${wordCharStats.invalidSpans}`);

        // Find a suitable line with multiple words for karaoke wipe test
        const targetLineInfo = await page.evaluate(() => {
            const lines = Array.from(document.querySelectorAll('.lyrics-content .lyric-line'));
            for (const line of lines) {
                const words = Array.from(line.querySelectorAll('.word-char'));
                if (words.length >= 3) {
                    const wordData = words.map(w => ({
                        text: w.textContent,
                        start: parseFloat(w.getAttribute('data-start')),
                        end: parseFloat(w.getAttribute('data-end'))
                    }));
                    // Check if they have distinct increasing timestamps
                    const hasValidTiming = wordData.every(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
                    if (hasValidTiming) {
                        return {
                            lineIndex: line.getAttribute('data-index'),
                            lineTime: parseFloat(line.getAttribute('data-time')),
                            words: wordData
                        };
                    }
                }
            }
            return null;
        });

        console.log(`   Selected line for wipe test:`, targetLineInfo ? `Line ${targetLineInfo.lineIndex} with ${targetLineInfo.words.length} words: "${targetLineInfo.words.map(w=>w.text).join('')}"` : "None found!");

        let wipeVerification = null;
        if (targetLineInfo && targetLineInfo.words.length >= 3) {
            // Target the middle word (index 1)
            const targetWordIndex = 1;
            const targetWord = targetLineInfo.words[targetWordIndex];
            const testTime = targetWord.start + (targetWord.end - targetWord.start) * 0.45; // 45% into the word
            console.log(`   Testing at timestamp: ${testTime.toFixed(3)}s (inside word[${targetWordIndex}]: "${targetWord.text}" [${targetWord.start}s - ${targetWord.end}s])`);

            wipeVerification = await page.evaluate((lineIdx, activeIdx, curTime) => {
                // Call window.syncLyrics(curTime)
                if (typeof window.syncLyrics === 'function') {
                    window.syncLyrics(curTime);
                }

                const lineEl = document.querySelector(`.lyrics-content .lyric-line[data-index="${lineIdx}"]`);
                if (!lineEl) return { error: "Line element not found" };

                const words = Array.from(lineEl.querySelectorAll('.word-char'));
                const singingWords = words.filter(w => w.classList.contains('word-singing'));
                const sungWords = words.filter(w => w.classList.contains('word-sung'));

                const activeWord = words[activeIdx];
                const activeFill = activeWord ? activeWord.style.getPropertyValue('--fill') : null;
                const activeBg = activeWord ? activeWord.style.backgroundImage : null;

                const prevWordsCorrect = words.slice(0, activeIdx).every(w => {
                    const fill = w.style.getPropertyValue('--fill');
                    return w.classList.contains('word-sung') && !w.classList.contains('word-singing') && (fill === '100%' || fill === '100');
                });

                const nextWordsCorrect = words.slice(activeIdx + 1).every(w => {
                    const fill = w.style.getPropertyValue('--fill');
                    return !w.classList.contains('word-sung') && !w.classList.contains('word-singing') && (fill === '0%' || fill === '0');
                });

                return {
                    singingCount: singingWords.length,
                    exactlyOneSinging: singingWords.length === 1 && singingWords[0] === activeWord,
                    activeWordText: activeWord ? activeWord.textContent : null,
                    activeFill,
                    activeBg,
                    prevWordsCorrect,
                    nextWordsCorrect
                };
            }, targetLineInfo.lineIndex, targetWordIndex, testTime);

            console.log(`   Wipe verification at t=${testTime.toFixed(3)}s:`, wipeVerification);

            // Advance time by 0.1s and verify fill progression
            const advanceTime = testTime + 0.1;
            const advanceCheck = await page.evaluate((lineIdx, activeIdx, newTime) => {
                if (typeof window.syncLyrics === 'function') {
                    window.syncLyrics(newTime);
                }
                const lineEl = document.querySelector(`.lyrics-content .lyric-line[data-index="${lineIdx}"]`);
                const activeWord = lineEl.querySelectorAll('.word-char')[activeIdx];
                return {
                    newFill: activeWord ? activeWord.style.getPropertyValue('--fill') : null,
                    newBg: activeWord ? activeWord.style.backgroundImage : null
                };
            }, targetLineInfo.lineIndex, targetWordIndex, advanceTime);

            console.log(`   Wipe verification at t=${advanceTime.toFixed(3)}s (advanced +0.1s): newFill = ${advanceCheck.newFill}`);

            const fill1 = parseFloat(wipeVerification.activeFill);
            const fill2 = parseFloat(advanceCheck.newFill);
            const fillProgressed = !isNaN(fill1) && !isNaN(fill2) && fill2 > fill1;
            console.log(`   Fill progressed: ${fill1}% -> ${fill2}% (Increase: ${(fill2 - fill1).toFixed(1)}%) -> ${fillProgressed ? "PASS" : "FAIL"}`);

            results.karaokeWipe = {
                totalWordsCount: wordCharStats.count,
                allValidTimestamps: wordCharStats.invalidSpans === 0 && wordCharStats.validSpans > 0,
                exactlyOneSinging: wipeVerification.exactlyOneSinging,
                prevWordsCorrect: wipeVerification.prevWordsCorrect,
                nextWordsCorrect: wipeVerification.nextWordsCorrect,
                activeWordGradient: Boolean(wipeVerification.activeBg && wipeVerification.activeBg.includes('linear-gradient')),
                fillProgressed,
                fill1,
                fill2,
                passed: wordCharStats.invalidSpans === 0 &&
                        wipeVerification.exactlyOneSinging &&
                        wipeVerification.prevWordsCorrect &&
                        wipeVerification.nextWordsCorrect &&
                        fillProgressed
            };
        } else {
            results.karaokeWipe = {
                passed: false,
                reason: "Could not find target line with multiple word-char elements"
            };
        }

        // Test 3: Responsive & Quality Check
        console.log(`\n--- TEST 3: Console & Exception Quality Check ---`);
        console.log(`   Uncaught page errors count: ${pageErrors.length}`);
        const seriousErrors = consoleMessages.filter(m => m.type === 'error' && !m.text.includes('favicon'));
        console.log(`   Console error messages: ${seriousErrors.length}`);
        if (pageErrors.length > 0) {
            console.log(`   Page errors:`, pageErrors);
        }
        if (seriousErrors.length > 0) {
            console.log(`   Console errors:`, seriousErrors);
        }

        results.quality = {
            uncaughtPageErrors: pageErrors.length,
            consoleErrors: seriousErrors.length,
            passed: pageErrors.length === 0 && seriousErrors.length === 0
        };

        results.pass = results.preloading.passed && results.karaokeWipe.passed && results.quality.passed;

    } catch (err) {
        console.error("FATAL ERROR IN E2E AUDIT:", err);
        results.pass = false;
        results.error = err.message;
    } finally {
        await browser.close();
    }

    console.log(`\n================ SUMMARY FOR ${baseUrl} ================`);
    console.log(`Overall Pass: ${results.pass}`);
    console.log(`Preloading: ${results.preloading.passed}`);
    console.log(`Karaoke Wipe: ${results.karaokeWipe.passed}`);
    console.log(`Quality / No Errors: ${results.quality.passed}`);
    return results;
}

(async () => {
    const targets = ["https://sonic.epocanvas.com", "https://cfsolara-dho.pages.dev"];
    const allResults = {};
    for (const target of targets) {
        allResults[target] = await auditFrontend(target);
    }
    fs.writeFileSync('/root/.gemini/antigravity-cli/brain/344f44db-d511-415c-a72d-b7f4ab2b6ebc/part2_results.json', JSON.stringify(allResults, null, 2));
    console.log("\nSaved PART 2 results to brain directory.");
})();
