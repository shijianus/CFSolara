const puppeteer = require('/home/shijian/projects/shijianus-blog/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

async function runMultilingualDomAudit() {
    console.log("================================================================================");
    console.log("  INDEPENDENT MULTILINGUAL AUDIO-LYRIC DYNAMIC SYNC AUDIT (PUPPETEER E2E)");
    console.log("  Target: https://sonic.epocanvas.com/ (Production)");
    console.log("  Languages: 粤语 (Cantonese) | 英语 (English) | 韩语 (Korean)");
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

        console.log("[*] Navigating to https://sonic.epocanvas.com/ ...");
        await page.goto('https://sonic.epocanvas.com/', { waitUntil: 'networkidle2', timeout: 35000 });

        // ────────────────────────────────────────────────────────────────
        // TEST CASE 1: 粤语 (Cantonese) - Beyond《海阔天空》
        // ────────────────────────────────────────────────────────────────
        console.log("\n========================================================");
        console.log("  TEST CASE 1: 粤语 (Cantonese) - Beyond《海阔天空》");
        console.log("========================================================");
        const tc1 = { language: '粤语', song: '海阔天空', artist: 'Beyond', checks: [] };

        await page.waitForSelector('#searchInput', { timeout: 10000 });
        await page.evaluate(() => { document.querySelector('#searchInput').value = ''; });
        await page.type('#searchInput', '海阔天空 Beyond');
        await page.click('#searchBtn');
        await page.waitForFunction(() => {
            const results = document.querySelectorAll('.search-result-item');
            return results && results.length > 0;
        }, { timeout: 20000 });

        await page.evaluate(() => playSearchResult(0));

        await page.waitForFunction(() => {
            const lines = document.querySelectorAll('.lyrics-content .lyric-line');
            return lines && lines.length > 0;
        }, { timeout: 15000 });

        const tc1Meta = await page.evaluate(() => {
            const lines = Array.from(document.querySelectorAll('.lyrics-content .lyric-line'));
            const l0 = lines[0];
            const words = Array.from(l0.querySelectorAll('.word-char')).map(w => ({
                text: w.textContent,
                start: parseFloat(w.getAttribute('data-start') || '0'),
                end: parseFloat(w.getAttribute('data-end') || '0')
            }));
            return {
                totalLines: lines.length,
                line0Text: l0.textContent,
                line0Time: parseFloat(l0.getAttribute('data-time') || '0'),
                words
            };
        });

        console.log(`[+] 粤语《海阔天空》Lines: ${tc1Meta.totalLines}, L0: "${tc1Meta.line0Text}" (${tc1Meta.line0Time}s)`);
        console.log(`[+] L0 Words Sample:`, tc1Meta.words.slice(0, 5));

        // 1.1 Prelude check at t=10.0s (vocal starts ~19.25s)
        const c1Prelude = await page.evaluate(() => {
            syncLyrics(10.0);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const singing = document.querySelectorAll('.lyrics-content .word-singing').length;
            const sung = document.querySelectorAll('.lyrics-content .word-sung').length;
            return { hasCurrent: Boolean(currentLine), singing, sung };
        });
        const passC1Prelude = !c1Prelude.hasCurrent && c1Prelude.singing === 0 && c1Prelude.sung === 0;
        console.log(`[1.1] 粤语前奏隔离 (t=10.0s, 无提前高亮): ${passC1Prelude ? 'PASS' : 'FAIL'}`);
        tc1.checks.push({ name: 'Cantonese Prelude Isolation', passed: passC1Prelude, state: c1Prelude });

        // 1.2 Opening vocal check at t=18.6s ("今天我 寒夜里看雪飘过" -> singing "今", start: 18.432s, end: 18.818s)
        const c1Vocal1 = await page.evaluate(() => {
            syncLyrics(18.6);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const singing = Array.from(document.querySelectorAll('.lyrics-content .word-singing')).map(w => ({
                text: w.textContent,
                fill: w.style.getPropertyValue('--fill')
            }));
            const sung = Array.from(currentLine ? currentLine.querySelectorAll('.word-sung') : []).map(w => w.textContent);
            return { currentText: currentLine ? currentLine.textContent : '', singing, sung };
        });
        const passC1Vocal1 = c1Vocal1.singing.some(w => w.text.includes('今'));
        console.log(`[1.2] 粤语开口对齐 (t=18.6s, 高亮"今"): ${passC1Vocal1 ? 'PASS' : 'FAIL'}`, c1Vocal1);
        tc1.checks.push({ name: 'Cantonese Opening Word Sync', passed: passC1Vocal1, state: c1Vocal1 });

        // 1.3 Long vocal hold on "我" at t=21.0s (word "我" start: 20.0s, dur: 2.704s)
        const c1VocalHold = await page.evaluate(() => {
            syncLyrics(21.0);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const singing = Array.from(document.querySelectorAll('.lyrics-content .word-singing')).map(w => ({
                text: w.textContent,
                fill: w.style.getPropertyValue('--fill')
            }));
            const sung = Array.from(currentLine ? currentLine.querySelectorAll('.word-sung') : []).map(w => w.textContent);
            return { singing, sung };
        });
        const passC1Hold = c1VocalHold.singing.some(w => w.text.includes('我')) && c1VocalHold.sung.includes('今') && c1VocalHold.sung.includes('天');
        console.log(`[1.3] 粤语长拖音跟随 (t=21.0s, "我"持续唱响): ${passC1Hold ? 'PASS' : 'FAIL'}`, c1VocalHold);
        tc1.checks.push({ name: 'Cantonese Sustained Vocal Hold', passed: passC1Hold, state: c1VocalHold });

        const ss1Path = path.join(screenshotsDir, 'audit_cantonese_haikuotiankong.png');
        await page.screenshot({ path: ss1Path });
        tc1.screenshot = ss1Path;
        report.testCases.push(tc1);

        // ────────────────────────────────────────────────────────────────
        // TEST CASE 2: 英语 (English) - Adele《Someone Like You》
        // ────────────────────────────────────────────────────────────────
        console.log("\n========================================================");
        console.log("  TEST CASE 2: 英语 (English) - Adele《Someone Like You》");
        console.log("========================================================");
        const tc2 = { language: '英语', song: 'Someone Like You', artist: 'Adele', checks: [] };

        await page.evaluate(() => { document.querySelector('#searchInput').value = ''; });
        await page.type('#searchInput', 'Someone Like You Adele');
        await page.click('#searchBtn');
        await page.waitForFunction(() => {
            const results = document.querySelectorAll('.search-result-item');
            return results && results.length > 0;
        }, { timeout: 20000 });

        await page.evaluate(() => playSearchResult(0));

        await page.waitForFunction(() => {
            const lines = document.querySelectorAll('.lyrics-content .lyric-line');
            return lines && lines.length > 0;
        }, { timeout: 15000 });

        const tc2Meta = await page.evaluate(() => {
            const lines = Array.from(document.querySelectorAll('.lyrics-content .lyric-line'));
            const l0 = lines[0];
            const words = Array.from(l0.querySelectorAll('.word-char')).map(w => ({
                text: w.textContent,
                start: parseFloat(w.getAttribute('data-start') || '0'),
                end: parseFloat(w.getAttribute('data-end') || '0')
            }));
            return {
                totalLines: lines.length,
                line0Text: l0.textContent,
                line0Time: parseFloat(l0.getAttribute('data-time') || '0'),
                words
            };
        });

        console.log(`[+] 英语《Someone Like You》Lines: ${tc2Meta.totalLines}, L0: "${tc2Meta.line0Text}" (${tc2Meta.line0Time}s)`);
        console.log(`[+] L0 English Words:`, tc2Meta.words);

        // 2.1 Prelude isolation at t=8.0s (vocal starts ~14.3s)
        const ePrelude = await page.evaluate(() => {
            syncLyrics(8.0);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const singing = document.querySelectorAll('.lyrics-content .word-singing').length;
            return { hasCurrent: Boolean(currentLine), singing };
        });
        const passEPrelude = !ePrelude.hasCurrent && ePrelude.singing === 0;
        console.log(`[2.1] 英语前奏隔离 (t=8.0s, 钢琴伴奏无跳字): ${passEPrelude ? 'PASS' : 'FAIL'}`);
        tc2.checks.push({ name: 'English Piano Prelude Isolation', passed: passEPrelude, state: ePrelude });

        // 2.2 Word "I" singing at t=14.8s (start: 14.327s, dur: 1.273s)
        const eWord1 = await page.evaluate(() => {
            syncLyrics(14.8);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const singing = Array.from(document.querySelectorAll('.lyrics-content .word-singing')).map(w => ({
                text: w.textContent,
                fill: w.style.getPropertyValue('--fill')
            }));
            return { currentText: currentLine ? currentLine.textContent : '', singing };
        });
        const passEWord1 = eWord1.singing.some(w => w.text.trim() === 'I');
        console.log(`[2.2] 英语首词 "I" 发音高亮 (t=14.8s): ${passEWord1 ? 'PASS' : 'FAIL'}`, eWord1);
        tc2.checks.push({ name: 'English Word "I" Sync', passed: passEWord1, state: eWord1 });

        // 2.3 Word "heard" singing at t=16.0s (start: 15.6s, dur: 1.944s)
        const eWord2 = await page.evaluate(() => {
            syncLyrics(16.0);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const singing = Array.from(document.querySelectorAll('.lyrics-content .word-singing')).map(w => ({
                text: w.textContent,
                fill: w.style.getPropertyValue('--fill')
            }));
            const sung = Array.from(currentLine ? currentLine.querySelectorAll('.word-sung') : []).map(w => w.textContent.trim());
            return { singing, sung };
        });
        const passEWord2 = eWord2.singing.some(w => w.text.trim() === 'heard') && eWord2.sung.includes('I');
        console.log(`[2.3] 英语词间空格吸附与 "heard" 推进 (t=16.0s): ${passEWord2 ? 'PASS' : 'FAIL'}`, eWord2);
        tc2.checks.push({ name: 'English Word "heard" Hold & Space Binding', passed: passEWord2, state: eWord2 });

        const ss2Path = path.join(screenshotsDir, 'audit_english_adele.png');
        await page.screenshot({ path: ss2Path });
        tc2.screenshot = ss2Path;
        report.testCases.push(tc2);

        // ────────────────────────────────────────────────────────────────
        // TEST CASE 3: 韩语 (Korean) - IU《Celebrity》
        // ────────────────────────────────────────────────────────────────
        console.log("\n========================================================");
        console.log("  TEST CASE 3: 韩语 (Korean) - IU《Celebrity》");
        console.log("========================================================");
        const tc3 = { language: '韩语', song: 'Celebrity', artist: 'IU', checks: [] };

        await page.evaluate(() => { document.querySelector('#searchInput').value = ''; });
        await page.type('#searchInput', 'Celebrity IU');
        await page.click('#searchBtn');
        await page.waitForFunction(() => {
            const results = document.querySelectorAll('.search-result-item');
            return results && results.length > 0;
        }, { timeout: 20000 });

        await page.evaluate(() => playSearchResult(0));

        await page.waitForFunction(() => {
            const lines = document.querySelectorAll('.lyrics-content .lyric-line');
            return lines && lines.length > 0;
        }, { timeout: 15000 });

        const tc3Meta = await page.evaluate(() => {
            const lines = Array.from(document.querySelectorAll('.lyrics-content .lyric-line'));
            const l0 = lines[0];
            const words = Array.from(l0.querySelectorAll('.word-char')).map(w => ({
                text: w.textContent,
                start: parseFloat(w.getAttribute('data-start') || '0'),
                end: parseFloat(w.getAttribute('data-end') || '0')
            }));
            return {
                totalLines: lines.length,
                line0Text: l0.textContent,
                line0Time: parseFloat(l0.getAttribute('data-time') || '0'),
                words
            };
        });

        console.log(`[+] 韩语《Celebrity》Lines: ${tc3Meta.totalLines}, L0: "${tc3Meta.line0Text}" (${tc3Meta.line0Time}s)`);
        console.log(`[+] L0 Korean Syllables:`, tc3Meta.words);

        // 3.1 Korean opening syllable sync at t=1.7s ("세상의 모서리" -> singing "세")
        const kWord1 = await page.evaluate(() => {
            syncLyrics(1.7);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const singing = Array.from(document.querySelectorAll('.lyrics-content .word-singing')).map(w => ({
                text: w.textContent,
                fill: w.style.getPropertyValue('--fill')
            }));
            return { currentText: currentLine ? currentLine.textContent : '', singing };
        });
        const passKWord1 = kWord1.singing.some(w => w.text.includes('세'));
        console.log(`[3.1] 韩语谚文音节 "세" 毫秒对齐 (t=1.7s): ${passKWord1 ? 'PASS' : 'FAIL'}`, kWord1);
        tc3.checks.push({ name: 'Korean Hangul Syllable "세" Sync', passed: passKWord1, state: kWord1 });

        // 3.2 Korean sequential syllable sync at t=2.2s (singing "의")
        const kWord2 = await page.evaluate(() => {
            syncLyrics(2.2);
            const currentLine = document.querySelector('.lyrics-content .lyric-line.current');
            const singing = Array.from(document.querySelectorAll('.lyrics-content .word-singing')).map(w => ({
                text: w.textContent,
                fill: w.style.getPropertyValue('--fill')
            }));
            const sung = Array.from(currentLine ? currentLine.querySelectorAll('.word-sung') : []).map(w => w.textContent.trim());
            return { singing, sung };
        });
        const passKWord2 = kWord2.singing.some(w => w.text.includes('의')) && kWord2.sung.includes('세');
        console.log(`[3.2] 韩语连续音节推进 (t=2.2s, "세/상"已唱毕，"의"高亮): ${passKWord2 ? 'PASS' : 'FAIL'}`, kWord2);
        tc3.checks.push({ name: 'Korean Sequential Syllable Progression', passed: passKWord2, state: kWord2 });

        const ss3Path = path.join(screenshotsDir, 'audit_korean_iu.png');
        await page.screenshot({ path: ss3Path });
        tc3.screenshot = ss3Path;
        report.testCases.push(tc3);

        const resultJsonPath = path.join(__dirname, 'audit_multilingual_results.json');
        fs.writeFileSync(resultJsonPath, JSON.stringify(report, null, 2));
        console.log(`\n[*] SUCCESS: Complete Multilingual E2E Audit Results written to ${resultJsonPath}`);

    } catch (err) {
        console.error("[-] Multilingual Audit Failed with Exception:", err);
    } finally {
        await browser.close();
    }
}

runMultilingualDomAudit();
