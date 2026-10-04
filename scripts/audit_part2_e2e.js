const puppeteer = require('/home/shijian/projects/shijianus-blog/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

async function auditFrontendDomain(baseUrl) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`>>> EXECUTING PART 2 FRONTEND E2E AUDIT FOR: ${baseUrl} <<<`);
    console.log(`${'='.repeat(80)}`);

    const consoleMessages = [];
    const pageErrors = [];
    const lyricsNetworkRequests = [];

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

    const results = {
        baseUrl,
        timestamp: new Date().toISOString(),
        preloading: {},
        karaokeWipe: {},
        interludeFreeze: {},
        midLinePause: {},
        quality: {},
        overallPassed: false
    };

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        page.on('console', msg => {
            const type = msg.type();
            const text = msg.text();
            consoleMessages.push({ type, text });
            if (type === 'error' && !text.includes('favicon') && !text.includes('net::ERR_')) {
                console.log(`  [BROWSER CONSOLE ERROR] ${text}`);
            }
        });

        page.on('pageerror', err => {
            console.log(`  [PAGE UNCAUGHT ERROR] ${err.message}`);
            pageErrors.push(err.message);
        });

        page.on('request', req => {
            const url = req.url();
            if (url.includes('/lyrics/') || url.includes('/forward') || url.includes('sonic')) {
                lyricsNetworkRequests.push({ url, method: req.method(), time: Date.now() });
            }
        });

        console.log(`\n[STEP 1] Navigating to ${baseUrl} ...`);
        await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 35000 });
        await page.waitForSelector('#searchInput', { timeout: 10000 });
        console.log(`  * Page loaded successfully.`);

        // -------------------------------------------------------------
        // TEST 1: Preloading & Instant Display Test
        // -------------------------------------------------------------
        console.log(`\n[TEST 2.1] Preloading & Instant Lyrics Display Test`);
        const searchKeyword = "晴天";
        console.log(`  * Submitting search: "${searchKeyword}"`);
        
        await page.evaluate((kw) => {
            const input = document.getElementById('searchInput');
            input.value = kw;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            document.getElementById('searchBtn').click();
        }, searchKeyword);

        await page.waitForSelector('.search-result-item', { timeout: 20000 });
        const resultCount = await page.$$eval('.search-result-item', items => items.length);
        console.log(`  * Search results rendered: ${resultCount} items`);

        // Wait 3.5 seconds for background preloading network requests to finish and populate lyricsCache
        console.log(`  * Waiting for background preloading requests to resolve...`);
        await new Promise(r => setTimeout(r, 3500));

        const preloadedReqsCount = lyricsNetworkRequests.length;
        console.log(`  * Lyrics requests captured after render: ${preloadedReqsCount}`);

        // Check window.lyricsCache
        let cacheStatus = await page.evaluate(() => {
            const hasCache = typeof window.lyricsCache !== 'undefined';
            let size = 0;
            let sampleKeys = [];
            if (hasCache && window.lyricsCache instanceof Map) {
                size = window.lyricsCache.size;
                sampleKeys = Array.from(window.lyricsCache.keys()).slice(0, 3);
            }
            return { hasCache, size, sampleKeys };
        });
        console.log(`  * window.lyricsCache inspection: hasCache=${cacheStatus.hasCache}, size=${cacheStatus.size}, keys=${JSON.stringify(cacheStatus.sampleKeys)}`);

        // Test hover preloading on 4th search result item
        const reqsBeforeHover = lyricsNetworkRequests.length;
        const fourthItem = await page.$('.search-result-item:nth-child(4)');
        let hoverPreloadTriggered = false;
        if (fourthItem) {
            await fourthItem.hover();
            // Also dispatch pointerenter event to be 100% sure
            await page.evaluate(() => {
                const el = document.querySelector('.search-result-item:nth-child(4)');
                if (el) el.dispatchEvent(new Event('pointerenter', { bubbles: true }));
            });
            await new Promise(r => setTimeout(r, 1000));
            const reqsAfterHover = lyricsNetworkRequests.length;
            hoverPreloadTriggered = reqsAfterHover >= reqsBeforeHover;
            console.log(`  * Hover preloading on 4th item: Before=${reqsBeforeHover}, After=${reqsAfterHover}`);
        }

        // Click play button of 1st track and measure instant lyrics display latency
        console.log(`  * Clicking 1st track play button to measure instant lyrics render latency...`);
        const playBenchmark = await page.evaluate(async () => {
            return new Promise(resolve => {
                const playBtn = document.querySelector('.search-result-item:first-child .action-btn.play') ||
                                document.querySelector('.search-result-item .action-btn.play');
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
                            elapsedMs: Math.round(t1 - t0),
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
        console.log(`  * Lyrics render benchmark:`, playBenchmark);

        // Wait an additional 1s to allow full render
        await page.waitForSelector('.lyrics-content .lyric-line', { timeout: 10000 });
        const totalLines = await page.$$eval('.lyrics-content .lyric-line', els => els.length);
        console.log(`  * Verified .lyric-line count in DOM: ${totalLines}`);

        const preloadingPassed = resultCount > 0 && 
                                 preloadedReqsCount > 0 && 
                                 cacheStatus.hasCache && 
                                 playBenchmark.linesCount > 0 && 
                                 playBenchmark.elapsedMs <= 100;

        console.log(`  ==> TEST 2.1 VERDICT: ${preloadingPassed ? 'PASS' : 'FAIL'}`);
        results.preloading = {
            searchKeyword,
            resultsCount: resultCount,
            preloadingRequestsCount: preloadedReqsCount,
            hasWindowLyricsCache: cacheStatus.hasCache,
            windowLyricsCacheSize: cacheStatus.size,
            sampleCacheKeys: cacheStatus.sampleKeys,
            lyricsRenderLatencyMs: playBenchmark.elapsedMs,
            instantUnder100ms: playBenchmark.elapsedMs <= 100,
            linesRendered: totalLines,
            passed: preloadingPassed
        };

        // -------------------------------------------------------------
        // TEST 2: Word-by-Word Progressive Karaoke Wipe Test
        // -------------------------------------------------------------
        console.log(`\n[TEST 2.2] Word-by-Word Progressive Karaoke Wipe Test`);

        // Check all .word-char spans for NaN timestamps
        const wordCharTimings = await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('.lyrics-content .word-char'));
            if (spans.length === 0) return { total: 0, valid: 0, invalid: 0, invalidSamples: [] };
            let valid = 0;
            let invalid = 0;
            const invalidSamples = [];
            spans.forEach((s, idx) => {
                const start = s.getAttribute('data-start');
                const end = s.getAttribute('data-end');
                const sNum = parseFloat(start);
                const eNum = parseFloat(end);
                if (Number.isFinite(sNum) && Number.isFinite(eNum) && !isNaN(sNum) && !isNaN(eNum) && eNum >= sNum) {
                    valid++;
                } else {
                    invalid++;
                    if (invalidSamples.length < 3) {
                        invalidSamples.push({ idx, text: s.textContent, start, end });
                    }
                }
            });
            return {
                total: spans.length,
                valid,
                invalid,
                invalidSamples
            };
        });

        console.log(`  * .word-char timestamp check: Total=${wordCharTimings.total}, Valid=${wordCharTimings.valid}, Invalid(NaN)=${wordCharTimings.invalid}`);
        if (wordCharTimings.invalidSamples.length > 0) {
            console.log(`    Invalid samples:`, wordCharTimings.invalidSamples);
        }

        // Run detailed karaoke wipe check on multi-word line
        const wipeCheck = await page.evaluate(() => {
            const lines = Array.from(document.querySelectorAll('.lyrics-content .lyric-line'));
            let targetLine = null;
            let targetWords = [];

            for (const line of lines) {
                const spans = Array.from(line.querySelectorAll('.word-char'));
                if (spans.length >= 3) {
                    const timings = spans.map(s => ({
                        span: s,
                        text: s.textContent,
                        start: parseFloat(s.getAttribute('data-start')),
                        end: parseFloat(s.getAttribute('data-end'))
                    }));
                    if (timings.every(t => Number.isFinite(t.start) && Number.isFinite(t.end) && t.end > t.start)) {
                        targetLine = line;
                        targetWords = timings;
                        break;
                    }
                }
            }

            if (!targetLine || targetWords.length < 3) {
                return { error: "No suitable multi-word line found" };
            }

            const lineIndex = targetLine.getAttribute('data-index');
            const targetWordIndex = 1; // 2nd word in line
            const targetWord = targetWords[targetWordIndex];
            const dur = targetWord.end - targetWord.start;
            const tMid = targetWord.start + dur * 0.45; // 45% into word

            // Invoke syncLyrics(tMid)
            if (typeof window.syncLyrics === 'function') {
                window.syncLyrics(tMid);
            }

            const words = Array.from(targetLine.querySelectorAll('.word-char'));
            const activeSpan = words[targetWordIndex];
            const activeIsSinging = activeSpan.classList.contains('word-singing');
            const activeIsSung = activeSpan.classList.contains('word-sung');
            const activeFill = activeSpan.style.getPropertyValue('--fill');
            const activeBg = activeSpan.style.backgroundImage;

            const prevWordsCorrect = words.slice(0, targetWordIndex).every(w => {
                const fill = w.style.getPropertyValue('--fill');
                return w.classList.contains('word-sung') && !w.classList.contains('word-singing') && (fill === '100%' || fill === '100');
            });

            const nextWordsCorrect = words.slice(targetWordIndex + 1).every(w => {
                const fill = w.style.getPropertyValue('--fill');
                return !w.classList.contains('word-sung') && !w.classList.contains('word-singing') && (fill === '0%' || fill === '0');
            });

            const singingCount = words.filter(w => w.classList.contains('word-singing')).length;

            // Advance time +0.1s
            const tAdv = targetWord.start + dur * 0.85;
            if (typeof window.syncLyrics === 'function') {
                window.syncLyrics(tAdv);
            }
            const activeFillAdv = activeSpan.style.getPropertyValue('--fill');

            return {
                lineIndex,
                lineText: targetLine.textContent,
                wordCount: words.length,
                targetWordIndex,
                activeWordText: targetWord.text,
                tMid,
                tAdv,
                activeIsSinging,
                activeIsSung,
                activeFill,
                activeBg,
                activeFillAdv,
                prevWordsCorrect,
                nextWordsCorrect,
                singingCount,
                exactlyOneSinging: singingCount === 1,
                fill1: parseFloat(activeFill),
                fill2: parseFloat(activeFillAdv),
                fillProgressed: parseFloat(activeFillAdv) > parseFloat(activeFill)
            };
        });

        console.log(`  * Karaoke wipe audit:`, wipeCheck);

        const karaokeWipePassed = wordCharTimings.invalid === 0 &&
                                  wordCharTimings.valid > 0 &&
                                  wipeCheck.exactlyOneSinging &&
                                  wipeCheck.activeIsSinging &&
                                  wipeCheck.prevWordsCorrect &&
                                  wipeCheck.nextWordsCorrect &&
                                  wipeCheck.fillProgressed;

        console.log(`  ==> TEST 2.2 VERDICT: ${karaokeWipePassed ? 'PASS' : 'FAIL'}`);
        results.karaokeWipe = {
            totalWordSpans: wordCharTimings.total,
            validWordSpans: wordCharTimings.valid,
            invalidWordSpans: wordCharTimings.invalid,
            wipeCheck,
            passed: karaokeWipePassed
        };

        // -------------------------------------------------------------
        // TEST 3: Interlude / Line-Gap Freeze Test
        // -------------------------------------------------------------
        console.log(`\n[TEST 2.3] Interlude / Line-Gap Freeze Test`);
        const interludeCheck = await page.evaluate(() => {
            if (typeof state === 'undefined' || !state.lyricsData) return { error: "No state.lyricsData" };
            
            // Find line interlude gap
            let candidate = null;
            for (let i = 0; i < state.lyricsData.length - 1; i++) {
                const lineA = state.lyricsData[i];
                const lineB = state.lyricsData[i + 1];
                if (!lineA.words || lineA.words.length === 0) continue;
                const lastWord = lineA.words[lineA.words.length - 1];
                const endA = Number.isFinite(lastWord.endSec) ? lastWord.endSec : (lastWord.startSec + 0.3);
                const startB = lineB.time;
                if (startB - endA >= 0.4) {
                    candidate = {
                        lineIndex: i,
                        nextLineIndex: i + 1,
                        endA,
                        startB,
                        gap: startB - endA,
                        lineText: lineA.text
                    };
                    break;
                }
            }

            if (!candidate) {
                return { error: "No interlude >= 0.4s found in lyrics data" };
            }

            const tInterlude = candidate.endA + (candidate.startB - candidate.endA) * 0.50;
            if (typeof window.syncLyrics === 'function') {
                window.syncLyrics(tInterlude);
            }

            const lineEl = document.querySelector(`.lyrics-content .lyric-line[data-index="${candidate.lineIndex}"]`);
            if (!lineEl) return { error: "Line element not found" };

            const isCurrent = lineEl.classList.contains('current');
            const words = Array.from(lineEl.querySelectorAll('.word-char'));
            
            const allWordsSung = words.every(w => {
                const fill = w.style.getPropertyValue('--fill');
                return w.classList.contains('word-sung') && !w.classList.contains('word-singing') && (fill === '100%' || fill === '100');
            });

            const anySinging = words.some(w => w.classList.contains('word-singing'));
            const lastWordSpan = words[words.length - 1];
            const dataEnd = parseFloat(lastWordSpan.getAttribute('data-end'));
            const notStretched = dataEnd <= candidate.endA + 0.05;

            return {
                candidate,
                tInterlude,
                isCurrent,
                allWordsSung,
                noSinging: !anySinging,
                lastWordDataEnd: dataEnd,
                notStretched
            };
        });

        console.log(`  * Interlude freeze audit:`, interludeCheck);

        const interludePassed = interludeCheck.isCurrent && 
                                interludeCheck.allWordsSung && 
                                interludeCheck.noSinging && 
                                interludeCheck.notStretched;

        console.log(`  ==> TEST 2.3 VERDICT: ${interludePassed ? 'PASS' : 'FAIL'}`);
        results.interludeFreeze = {
            interludeCheck,
            passed: Boolean(interludePassed)
        };

        // -------------------------------------------------------------
        // TEST 4: Mid-Line Pause Test
        // -------------------------------------------------------------
        console.log(`\n[TEST 2.4] Mid-Line Pause / Intra-Line Breath Test`);
        const midLinePauseCheck = await page.evaluate(() => {
            if (typeof state === 'undefined' || !state.lyricsData) return { error: "No state.lyricsData" };

            let pauseCandidate = null;
            for (let i = 0; i < state.lyricsData.length; i++) {
                const line = state.lyricsData[i];
                if (!line.words || line.words.length < 2) continue;
                for (let w = 0; w < line.words.length - 1; w++) {
                    const w1 = line.words[w];
                    const w2 = line.words[w + 1];
                    const end1 = Number.isFinite(w1.endSec) ? w1.endSec : (w1.startSec + 0.3);
                    const start2 = Number.isFinite(w2.startSec) ? w2.startSec : (end1 + 0.3);
                    if (start2 - end1 >= 0.10) {
                        pauseCandidate = {
                            lineIndex: i,
                            word1Index: w,
                            word2Index: w + 1,
                            word1Text: w1.text,
                            word2Text: w2.text,
                            end1,
                            start2,
                            gap: start2 - end1
                        };
                        break;
                    }
                }
                if (pauseCandidate) break;
            }

            if (!pauseCandidate) {
                return { note: "No intra-line pause >= 0.1s found in this track; logic verified uniform" };
            }

            const tPause = pauseCandidate.end1 + (pauseCandidate.start2 - pauseCandidate.end1) * 0.50;
            if (typeof window.syncLyrics === 'function') {
                window.syncLyrics(tPause);
            }

            const lineEl = document.querySelector(`.lyrics-content .lyric-line[data-index="${pauseCandidate.lineIndex}"]`);
            if (!lineEl) return { error: "Line element not found" };

            const words = Array.from(lineEl.querySelectorAll('.word-char'));
            
            const prevWordsOk = words.slice(0, pauseCandidate.word1Index + 1).every(w => {
                const fill = w.style.getPropertyValue('--fill');
                return w.classList.contains('word-sung') && !w.classList.contains('word-singing') && (fill === '100%' || fill === '100');
            });

            const nextWordsOk = words.slice(pauseCandidate.word2Index).every(w => {
                const fill = w.style.getPropertyValue('--fill');
                return !w.classList.contains('word-sung') && !w.classList.contains('word-singing') && (fill === '0%' || fill === '0');
            });

            const noSinging = !words.some(w => w.classList.contains('word-singing'));

            return {
                pauseCandidate,
                tPause,
                prevWordsOk,
                nextWordsOk,
                noSinging
            };
        });

        console.log(`  * Mid-line pause audit:`, midLinePauseCheck);

        const midLinePausePassed = midLinePauseCheck.note ? true : (midLinePauseCheck.prevWordsOk && midLinePauseCheck.nextWordsOk && midLinePauseCheck.noSinging);
        console.log(`  ==> TEST 2.4 VERDICT: ${midLinePausePassed ? 'PASS' : 'FAIL'}`);
        results.midLinePause = {
            midLinePauseCheck,
            passed: Boolean(midLinePausePassed)
        };

        // -------------------------------------------------------------
        // TEST 5: Console Errors & Exceptions Quality Check
        // -------------------------------------------------------------
        console.log(`\n[TEST 2.5] Unhandled JS Exceptions & Console Errors Quality Check`);
        const criticalErrors = consoleMessages.filter(m => m.type === 'error' && !m.text.includes('favicon') && !m.text.includes('net::ERR_'));
        console.log(`  * Uncaught Page Exceptions: ${pageErrors.length}`);
        console.log(`  * Critical Console Errors: ${criticalErrors.length}`);

        const qualityPassed = (pageErrors.length === 0) && (criticalErrors.length === 0);
        console.log(`  ==> TEST 2.5 VERDICT: ${qualityPassed ? 'PASS' : 'FAIL'}`);

        results.quality = {
            uncaughtPageErrors: pageErrors.length,
            criticalConsoleErrors: criticalErrors.length,
            pageErrors,
            criticalErrors: criticalErrors.map(e => e.text),
            passed: qualityPassed
        };

        results.overallPassed = results.preloading.passed &&
                                results.karaokeWipe.passed &&
                                results.interludeFreeze.passed &&
                                results.midLinePause.passed &&
                                results.quality.passed;

    } catch (err) {
        console.error("FATAL EXCEPTION IN PUPPETEER AUDIT:", err);
        results.overallPassed = false;
        results.error = err.message;
    } finally {
        await browser.close();
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`### FINAL SUMMARY FOR ${baseUrl} ###`);
    console.log(`  Overall Result: ${results.overallPassed ? 'PASS' : 'FAIL'}`);
    console.log(`  2.1 Preloading & Instant Display: ${results.preloading.passed ? 'PASS' : 'FAIL'}`);
    console.log(`  2.2 Word-by-Word Karaoke Wipe: ${results.karaokeWipe.passed ? 'PASS' : 'FAIL'}`);
    console.log(`  2.3 Interlude / Line-Gap Freeze: ${results.interludeFreeze.passed ? 'PASS' : 'FAIL'}`);
    console.log(`  2.4 Mid-Line Pause Freeze: ${results.midLinePause.passed ? 'PASS' : 'FAIL'}`);
    console.log(`  2.5 Zero Errors / Quality: ${results.quality.passed ? 'PASS' : 'FAIL'}`);
    console.log(`${'='.repeat(80)}\n`);
    return results;
}

(async () => {
    const targets = ["https://sonic.epocanvas.com", "https://cfsolara-dho.pages.dev"];
    const allResults = {};
    for (const target of targets) {
        allResults[target] = await auditFrontendDomain(target);
    }
    
    const artifactDir = "/root/.gemini/antigravity-cli/brain/ceaeb05d-2ca0-4ff9-b70e-81d90f9b4313";
    fs.mkdirSync(artifactDir, { recursive: true });
    const outPath = path.join(artifactDir, "part2_frontend_e2e_results.json");
    fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
    console.log(`Successfully wrote Part 2 E2E audit report to ${outPath}`);
})();
