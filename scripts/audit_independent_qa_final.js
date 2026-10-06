const puppeteer = require('/home/shijian/projects/shijianus-blog/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

async function runDynamicSyncAudit() {
    console.log("================================================================================");
    console.log("  INDEPENDENT E2E AUDIO-LYRIC DYNAMIC SYNC AUDIT (PUPPETEER E2E)");
    console.log("  Target: https://sonic.epocanvas.com/ (Production)");
    console.log("================================================================================");

    const screenshotsDir = path.join(__dirname, '../screenshots');
    if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
    }

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

    const report = {
        timestamp: new Date().toISOString(),
        testedUrl: 'https://sonic.epocanvas.com/',
        testCases: []
    };

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // Navigate to production
        console.log("[*] Navigating to https://sonic.epocanvas.com/ ...");
        await page.goto('https://sonic.epocanvas.com/', { waitUntil: 'networkidle2', timeout: 35000 });

        // ────────────────────────────────────────────────────────────────
        // TEST CASE 1: 宇多田光 - First Love (Japanese Ballad with Long Vowels)
        // ────────────────────────────────────────────────────────────────
        console.log("\n========================================================");
        console.log("  TEST CASE 1: 宇多田光 - First Love (Japanese Ballad)");
        console.log("========================================================");
        const tc1 = { song: 'First Love', artist: '宇多田ヒカル', checks: [] };

        await page.waitForSelector('#searchInput', { timeout: 10000 });
        await page.evaluate(() => { document.querySelector('#searchInput').value = ''; });
        await page.type('#searchInput', 'First Love 宇多田ヒカル');
        await page.click('#searchBtn');
        await page.waitForSelector('.search-result-item', { timeout: 20000 });

        console.log("[*] Search completed. Clicking first result...");
        await page.evaluate(() => playSearchResult(0));

        // Wait for lyrics to render
        await page.waitForFunction(() => {
            const lines = document.querySelectorAll('.lyrics-content .lyric-line');
            return lines && lines.length > 0;
        }, { timeout: 15000 });

        const tc1Metadata = await page.evaluate(() => {
            const lines = Array.from(document.querySelectorAll('.lyrics-content .lyric-line'));
            const firstLine = lines[0];
            const words = Array.from(firstLine.querySelectorAll('.word-char')).map(w => ({
                text: w.textContent,
                start: parseFloat(w.getAttribute('data-start') || '0'),
                end: parseFloat(w.getAttribute('data-end') || '0'),
            }));
            return {
                totalLines: lines.length,
                line0Text: firstLine.textContent,
                line0Time: parseFloat(firstLine.getAttribute('data-time') || '0'),
                wordsCount: words.length,
                words: words,
                cacheInfo: window.lyricsCache ? Array.from(window.lyricsCache.values())[0] : null
            };
        });

        console.log(`[+] Rendered lines count: ${tc1Metadata.totalLines}`);
        console.log(`[+] First line text: "${tc1Metadata.line0Text}", time: ${tc1Metadata.line0Time}s`);
        console.log(`[+] First line words:`, tc1Metadata.words);

        // Verification 1.1: Metadata credits must NOT be the first line
        const hasNoCreditInLine1 = !/(Arrangement|Programming|Synthesizer|Strings|作词|作曲)/i.test(tc1Metadata.line0Text);
        console.log(`[1.1] Staff Credit Cleanliness: ${hasNoCreditInLine1 ? 'PASS' : 'FAIL'} (Line 1 text: "${tc1Metadata.line0Text}")`);
        tc1.checks.push({ name: 'Staff Credit Cleanliness', passed: hasNoCreditInLine1, detail: tc1Metadata.line0Text });

        // Verification 1.2: Dynamic Time Stepping (Tracking audio & lyric synchronization)
        // Check 1.2a: Prelude at t = 10.0s (Before vocal start ~21.899s)
        const preludeState = await page.evaluate(() => {
            syncLyrics(10.0);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const singingWords = Array.from(document.querySelectorAll('.lyrics-content .word-singing'));
            const sungWords = Array.from(document.querySelectorAll('.lyrics-content .word-sung'));
            return {
                hasCurrentLine: Boolean(currentLine),
                singingCount: singingWords.length,
                sungCount: sungWords.length,
            };
        });
        const passPrelude = !preludeState.hasCurrentLine && preludeState.singingCount === 0 && preludeState.sungCount === 0;
        console.log(`[1.2a] Prelude at t=10.0s (Zero highlight leak): ${passPrelude ? 'PASS' : 'FAIL'}`);
        tc1.checks.push({ name: 'Prelude Isolation (t=10.0s)', passed: passPrelude, state: preludeState });

        // Check 1.2b: Opening word "最" singing at t = 22.5s (Vocal range for "最": [21.899s, 23.899s])
        const singingWord1 = await page.evaluate(() => {
            syncLyrics(22.5);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const lineText = currentLine ? currentLine.textContent : '';
            const singingWords = Array.from(document.querySelectorAll('.lyrics-content .word-singing')).map(w => ({
                text: w.textContent,
                fill: w.style.getPropertyValue('--fill')
            }));
            const sungWords = Array.from(currentLine ? currentLine.querySelectorAll('.word-sung') : []).map(w => w.textContent);
            return {
                lineText,
                singingWords,
                sungWords
            };
        });
        const passWord1 = singingWord1.singingWords.some(w => w.text.includes('最')) && singingWord1.singingWords.length === 1;
        console.log(`[1.2b] Word "最" Singing at t=22.5s: ${passWord1 ? 'PASS' : 'FAIL'}`, singingWord1);
        tc1.checks.push({ name: 'Accurate Word Progression (t=22.5s)', passed: passWord1, state: singingWord1 });

        // Check 1.2c: Sequential mora progression
        // At t = 23.2s: "最" sung, "后" singing
        const singingWord2 = await page.evaluate(() => {
            syncLyrics(23.2);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const singingWords = Array.from(document.querySelectorAll('.lyrics-content .word-singing')).map(w => ({
                text: w.textContent,
                fill: w.style.getPropertyValue('--fill')
            }));
            const sungWords = Array.from(currentLine ? currentLine.querySelectorAll('.word-sung') : []).map(w => w.textContent);
            return {
                singingWords,
                sungWords
            };
        });
        const passWord2 = singingWord2.sungWords.includes('最') && singingWord2.singingWords.some(w => w.text.includes('后') || w.text.includes('後'));
        console.log(`[1.2c] Word "后/後" Singing at t=23.2s ("最" sung): ${passWord2 ? 'PASS' : 'FAIL'}`, singingWord2);
        tc1.checks.push({ name: 'Sequential Mora Progression (t=23.2s)', passed: passWord2, state: singingWord2 });

        // Screenshot for visual audit
        const ss1Path = path.join(screenshotsDir, 'audit_first_love_sync.png');
        await page.screenshot({ path: ss1Path });
        console.log(`[+] Visual Screenshot saved: ${ss1Path}`);
        tc1.screenshot = ss1Path;
        report.testCases.push(tc1);

        // ────────────────────────────────────────────────────────────────
        // TEST CASE 2: 米津玄師 - Lemon (Fast Syllable Japanese)
        // ────────────────────────────────────────────────────────────────
        console.log("\n========================================================");
        console.log("  TEST CASE 2: 米津玄師 - Lemon (Japanese Rapid Mora)");
        console.log("========================================================");
        const tc2 = { song: 'Lemon', artist: '米津玄師', checks: [] };

        // Clear previous search results to avoid stale element race condition
        await page.evaluate(() => {
            const el = document.querySelector('#searchResults');
            if (el) el.innerHTML = '';
            document.querySelector('#searchInput').value = '';
        });
        await page.type('#searchInput', 'Lemon 米津玄師');
        await page.click('#searchBtn');
        await page.waitForSelector('#searchResults .search-result-item', { timeout: 20000 });

        await page.evaluate(() => playSearchResult(0));

        await page.waitForFunction(() => {
            const lines = document.querySelectorAll('.lyrics-content .lyric-line');
            return lines && lines.length > 0 && lines[0].textContent.includes('夢ならば');
        }, { timeout: 15000 });

        const tc2Metadata = await page.evaluate(() => {
            const lines = Array.from(document.querySelectorAll('.lyrics-content .lyric-line'));
            const line0 = lines[0];
            const words = Array.from(line0.querySelectorAll('.word-char')).map(w => ({
                text: w.textContent,
                start: parseFloat(w.getAttribute('data-start') || '0'),
                end: parseFloat(w.getAttribute('data-end') || '0'),
            }));
            return {
                totalLines: lines.length,
                line0Text: line0.textContent,
                line0Time: parseFloat(line0.getAttribute('data-time') || '0'),
                words
            };
        });

        console.log(`[+] Lemon lines count: ${tc2Metadata.totalLines}, Line 0 text: "${tc2Metadata.line0Text}", time: ${tc2Metadata.line0Time}s`);
        console.log(`[+] Lemon Line 0 words sample:`, tc2Metadata.words.slice(0, 4));

        // Test 2.1a: Prelude at t = 0.5s (Before vocal start ~1.134s / 1.372s) - Zero highlight leak
        const lemonPrelude = await page.evaluate(() => {
            syncLyrics(0.5);
            const singing = Array.from(document.querySelectorAll('.lyrics-content .word-singing')).map(w => w.textContent);
            const sung = Array.from(document.querySelectorAll('.lyrics-content .word-sung')).map(w => w.textContent);
            return { singing, sung };
        });
        const passLemonPrelude = lemonPrelude.singing.length === 0 && lemonPrelude.sung.length === 0;
        console.log(`[2.1a] Lemon Prelude at t=0.5s (Zero premature highlight): ${passLemonPrelude ? 'PASS' : 'FAIL'}`, lemonPrelude);
        tc2.checks.push({ name: 'Lemon Prelude Isolation (Zero Premature Highlight)', passed: passLemonPrelude, state: lemonPrelude });

        // Test 2.1b: Dynamic progress at t = 1.5s (singing "夢" in "夢ならば")
        const lemonSync1 = await page.evaluate(() => {
            syncLyrics(1.5);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const singing = Array.from(document.querySelectorAll('.lyrics-content .word-singing')).map(w => ({
                text: w.textContent,
                fill: w.style.getPropertyValue('--fill')
            }));
            return {
                currentText: currentLine ? currentLine.textContent : '',
                singing
            };
        });
        const passLemon1 = lemonSync1.singing.some(w => w.text.includes('夢'));
        console.log(`[2.1b] Lemon at t=1.5s (Singing "夢"): ${passLemon1 ? 'PASS' : 'FAIL'}`, lemonSync1);
        tc2.checks.push({ name: 'Lemon Opening Word Sync (t=1.5s)', passed: passLemon1, state: lemonSync1 });

        const ss2Path = path.join(screenshotsDir, 'audit_lemon_sync.png');
        await page.screenshot({ path: ss2Path });
        tc2.screenshot = ss2Path;
        report.testCases.push(tc2);

        // ────────────────────────────────────────────────────────────────
        // TEST CASE 3: 周杰伦 - 晴天 (Chinese Baseline Benchmark)
        // ────────────────────────────────────────────────────────────────
        console.log("\n========================================================");
        console.log("  TEST CASE 3: 周杰伦 - 晴天 (Chinese Baseline Benchmark)");
        console.log("========================================================");
        const tc3 = { song: '晴天', artist: '周杰伦', checks: [] };

        // Clear previous search results to avoid stale element race condition
        await page.evaluate(() => {
            const el = document.querySelector('#searchResults');
            if (el) el.innerHTML = '';
            document.querySelector('#searchInput').value = '';
        });
        await page.type('#searchInput', '晴天 周杰伦');
        await page.click('#searchBtn');
        await page.waitForSelector('#searchResults .search-result-item', { timeout: 20000 });

        await page.evaluate(() => playSearchResult(0));

        await page.waitForFunction(() => {
            const lines = document.querySelectorAll('.lyrics-content .lyric-line');
            return lines && lines.length > 0 && lines[0].textContent.includes('故事的小黄花');
        }, { timeout: 15000 });

        const tc3Metadata = await page.evaluate(() => {
            const lines = Array.from(document.querySelectorAll('.lyrics-content .lyric-line'));
            const line0 = lines[0];
            return {
                totalLines: lines.length,
                line0Text: line0.textContent,
                line0Time: parseFloat(line0.getAttribute('data-time') || '0'),
            };
        });

        console.log(`[+] 晴天 lines count: ${tc3Metadata.totalLines}, Line 0 text: "${tc3Metadata.line0Text}", time: ${tc3Metadata.line0Time}s`);

        // Prelude check at t=15.0s (vocal starts at ~29s)
        const qingtianPrelude = await page.evaluate(() => {
            syncLyrics(15.0);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const singing = document.querySelectorAll('.lyrics-content .word-singing').length;
            return { hasCurrent: Boolean(currentLine), singingCount: singing };
        });
        const passQtPrelude = !qingtianPrelude.hasCurrent && qingtianPrelude.singingCount === 0;
        console.log(`[3.1] 晴天 Prelude at t=15.0s (Zero highlight leak): ${passQtPrelude ? 'PASS' : 'FAIL'}`);
        tc3.checks.push({ name: 'Chinese Prelude Isolation', passed: passQtPrelude, state: qingtianPrelude });

        // Vocal singing check at t=31.5s (singing "故事的小黄花", vocal starts at 30.542s)
        const qingtianVocal = await page.evaluate(() => {
            syncLyrics(31.5);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const singing = Array.from(document.querySelectorAll('.lyrics-content .word-singing')).map(w => ({
                text: w.textContent,
                fill: w.style.getPropertyValue('--fill')
            }));
            const sung = Array.from(document.querySelectorAll('.lyrics-content .word-sung')).map(w => w.textContent);
            return {
                currentText: currentLine ? currentLine.textContent : '',
                singing,
                sung
            };
        });
        const passQtVocal = qingtianVocal.currentText.includes('故事的小黄花') && (qingtianVocal.singing.length > 0 || qingtianVocal.sung.length > 0);
        console.log(`[3.2] 晴天 Vocal at t=31.5s: ${passQtVocal ? 'PASS' : 'FAIL'}`, qingtianVocal);
        tc3.checks.push({ name: 'Chinese Vocal Sync (t=31.5s)', passed: passQtVocal, state: qingtianVocal });

        const ss3Path = path.join(screenshotsDir, 'audit_qingtian_sync.png');
        await page.screenshot({ path: ss3Path });
        tc3.screenshot = ss3Path;
        report.testCases.push(tc3);

        const resultJsonPath = path.join(__dirname, 'audit_independent_qa_results_final.json');
        fs.writeFileSync(resultJsonPath, JSON.stringify(report, null, 2));
        console.log(`\n[*] SUCCESS: Complete E2E Audit Results written to ${resultJsonPath}`);

    } catch (err) {
        console.error("[-] Audit Failed with Exception:", err);
    } finally {
        await browser.close();
    }
}

runDynamicSyncAudit();
