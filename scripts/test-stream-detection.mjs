// Pure unit tests for duration-based stream quality detection (no external network).
// Covers the audit counter-examples: short complete 128kbps tracks, lossless
// request served as 320k MP3, 48kbps full-length streams, 30~45s trials,
// missing/zero expected duration, missing Content-Range, fake prompt clips.
import {
  evaluateStreamQuality,
  evaluateStreamTypeByRelativeBytes,
  parseMp3FrameHeader,
  probeStreamPhysicalQuality,
} from '../functions/_lib/sonic/native-protocols.ts';
import http from 'node:http';

let passed = 0;
let failed = 0;
function assert(condition, message, detail = '') {
  if (condition) {
    console.log(`  ✓ ${message}${detail ? '  [' + detail + ']' : ''}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}${detail ? '  [' + detail + ']' : ''}`);
    failed++;
  }
}

// MPEG-1 Layer III, 44.1kHz frame header for a given bitrate
function mp3Head(bitrateKbps) {
  const brIdx = { 32: 1, 48: 3, 64: 5, 96: 7, 128: 9, 160: 10, 192: 11, 256: 13, 320: 14 }[bitrateKbps];
  if (!brIdx) throw new Error(`unsupported test bitrate ${bitrateKbps}`);
  return new Uint8Array([0xff, 0xfb, brIdx << 4, 0xc0, 0x00, 0x01, 0x02, 0x03]);
}

function withId3(head) {
  const pad = 1000;
  const out = new Uint8Array(10 + pad + head.length);
  out[0] = 0x49; out[1] = 0x44; out[2] = 0x33; // "ID3"
  out[3] = 0x04; out[4] = 0x00; out[5] = 0x00;
  out[6] = 0x00; out[7] = 0x00; out[8] = 0x07; out[9] = 0x68; // syncsafe 1000
  out.set(head, 10 + pad);
  return out;
}

async function run() {
  // ── A. Frame header parser ──
  console.log('\nA. MP3 frame header parser');
  {
    const h320 = parseMp3FrameHeader(mp3Head(320));
    assert(h320?.bitrateKbps === 320 && h320?.sampleRateHz === 44100, '320kbps/44.1kHz parsed', JSON.stringify(h320));
    const h128 = parseMp3FrameHeader(mp3Head(128));
    assert(h128?.bitrateKbps === 128, '128kbps parsed');
    const h48 = parseMp3FrameHeader(mp3Head(48));
    assert(h48?.bitrateKbps === 48, '48kbps parsed');
    const hId3 = parseMp3FrameHeader(withId3(mp3Head(128)));
    assert(hId3?.bitrateKbps === 128 && hId3.frameOffset >= 1010, 'Frame found after 1KB ID3v2 tag');
    assert(parseMp3FrameHeader(new Uint8Array([0x00, 0x01, 0x02])) === null, 'Garbage returns null');
    assert(parseMp3FrameHeader(new Uint8Array(0)) === null, 'Empty returns null');
  }

  // ── B. Audit counter-examples via evaluateStreamQuality ──
  console.log('\nB. Audit counter-examples (duration-based, real bitrate)');
  {
    const r90 = evaluateStreamQuality(90 * 16_000, 90, mp3Head(128), 320);
    assert(r90.streamType === 'full' && r90.confidence === 'high', '90s complete 128kbps (nominal req 320k) -> full', `ratio=${r90.ratio.toFixed(3)} br=${r90.realBitrateKbps}`);
    const r60 = evaluateStreamQuality(60 * 16_000, 60, mp3Head(128), 320);
    assert(r60.streamType === 'full', '60s complete 128kbps -> full', `ratio=${r60.ratio.toFixed(3)}`);
    const rFlacReq = evaluateStreamQuality(9_600_000, 240, mp3Head(320), 800);
    assert(rFlacReq.streamType === 'full', 'flac request but 320k complete MP3 -> full', `ratio=${rFlacReq.ratio.toFixed(3)}`);
    const r48 = evaluateStreamQuality(270 * 6_000, 270, mp3Head(48), 320);
    assert(r48.streamType === 'full', '48kbps full-length (270s) -> full', `est=${r48.estimatedDurationSec?.toFixed(0)}s`);
    const t30 = evaluateStreamQuality(481_115, 240, mp3Head(128), 320);
    assert(t30.streamType === 'trial', '30s 128k trial (481KB) -> trial', `est=${t30.estimatedDurationSec?.toFixed(1)}s`);
    const t45a = evaluateStreamQuality(1_800_000, 240, mp3Head(320), 320);
    const t45b = evaluateStreamQuality(1_800_000, 150, mp3Head(320), 320);
    assert(t45a.streamType === 'trial' && t45b.streamType === 'trial', '45s 320k trials (1.8MB) on 240s/150s songs -> trial', `${t45a.ratio.toFixed(2)}/${t45b.ratio.toFixed(2)}`);
    const t128 = evaluateStreamQuality(721_023, 240, mp3Head(128), 128);
    assert(t128.streamType === 'trial', '45s 128k trial (721KB) -> trial');
  }

  // ── C. Missing / zero expected duration ──
  console.log('\nC. Expected duration missing or zero');
  {
    const full = evaluateStreamQuality(9_600_000, undefined, mp3Head(320), 320);
    assert(full.streamType === 'full' && full.confidence === 'medium', 'No expected duration: 320k/240s-equivalent bytes -> full @ medium confidence', `est=${full.estimatedDurationSec?.toFixed(0)}s`);
    const trial = evaluateStreamQuality(1_800_000, 0, mp3Head(320), 320);
    assert(trial.streamType === 'trial' && trial.confidence === 'medium', 'Zero expected duration: 45s of 320k -> trial @ medium confidence');
    const tiny = evaluateStreamQuality(481_115, undefined, mp3Head(128), 320);
    assert(tiny.streamType === 'trial', 'No expected duration: 30s of 128k -> trial');
  }

  // ── D. Fake prompt clips (range + implausibly short duration) ──
  console.log('\nD. Fake prompt clip rejection');
  {
    const exact = evaluateStreamQuality(181_521, 240, mp3Head(128), 320);
    assert(exact.streamType === 'unavailable' && exact.method === 'fake-clip-signature', 'Exact 181,521 bytes -> unavailable (fast path)');
    const offByOne = evaluateStreamQuality(181_522, 240, mp3Head(128), 320);
    assert(offByOne.streamType === 'unavailable' && offByOne.confidence === 'high', '181,522 bytes @128k (≈11.3s) -> unavailable via range+duration rule', `est=${offByOne.estimatedDurationSec?.toFixed(1)}s`);
    const short320 = evaluateStreamQuality(200_000, 240, mp3Head(320), 320);
    assert(short320.streamType === 'unavailable', '200,000 bytes @320k (5s) -> unavailable');
    const notShort = evaluateStreamQuality(250_000, 240, mp3Head(128), 320);
    assert(notShort.streamType === 'trial', '250,000 bytes @128k (15.6s) escapes the fake rule -> trial');
    const outsideRange = evaluateStreamQuality(481_115, 240, mp3Head(128), 320);
    assert(outsideRange.streamType === 'trial', '481,115 bytes outside fake byte range stays trial');
  }

  // ── E. Fallback when header unparseable (e.g. FLAC) ──
  console.log('\nE. Conservative fallback without parseable header');
  {
    const flac = evaluateStreamQuality(3_840_000, 240, new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00]), 128);
    assert(flac.streamType === 'full' && flac.method === 'byte-ratio-fallback' && flac.confidence === 'low', 'fLaC magic + 3.84MB/240s@128k -> full via fallback, confidence low', `conf=${flac.confidence}`);
    const small = evaluateStreamQuality(721_023, 240, null, 128);
    assert(small.streamType === 'trial' && small.confidence === 'low', 'No head bytes at all -> fallback, confidence low');
    const zero = evaluateStreamQuality(0, 240, mp3Head(320), 320);
    assert(zero.streamType === 'unavailable', '0 bytes -> unavailable');
    // Legacy heuristic still available for compatibility
    assert(evaluateStreamTypeByRelativeBytes(181_521, 240, 320).streamType === 'unavailable', 'Legacy relative-bytes helper keeps its contract');
  }

  // ── F. probeStreamPhysicalQuality against a controlled local server ──
  console.log('\nF. probeStreamPhysicalQuality (local controlled server)');
  const server = http.createServer((req, res) => {
    const mode = new URL(req.url, 'http://x').searchParams.get('mode') || '';
    if (mode === 'mp3_full') {
      const head = mp3Head(320);
      res.writeHead(206, { 'Content-Range': 'bytes 0-65534/9600000', 'Content-Type': 'audio/mpeg' });
      res.end(Buffer.concat([Buffer.from(head), Buffer.alloc(2048, 7)]));
    } else if (mode === 'mp3_trial') {
      const head = mp3Head(128);
      res.writeHead(206, { 'Content-Range': `bytes 0-65534/${90 * 16_000}`, 'Content-Type': 'audio/mpeg' });
      res.end(Buffer.concat([Buffer.from(head), Buffer.alloc(2048, 7)]));
    } else if (mode === 'plain200') {
      const head = mp3Head(128);
      res.writeHead(200, { 'Content-Length': String(3_840_000), 'Content-Type': 'audio/mpeg' });
      res.end(Buffer.concat([Buffer.from(head), Buffer.alloc(2048, 7)]));
    } else if (mode === 'cl_only_1') {
      res.writeHead(206, { 'Content-Length': '1', 'Content-Type': 'audio/mpeg' });
      res.end('A');
    } else if (mode === 'no_body') {
      res.writeHead(206, { 'Content-Range': 'bytes 0-65534/9600000', 'Content-Type': 'audio/mpeg' });
      res.end();
    } else if (mode === 'slow') {
      setTimeout(() => { res.writeHead(206, { 'Content-Range': 'bytes 0-65534/9600000' }); res.end('A'); }, 5000);
    } else if (mode === 'fake') {
      const head = mp3Head(128);
      res.writeHead(206, { 'Content-Range': 'bytes 0-65534/181522', 'Content-Type': 'audio/mpeg' });
      res.end(Buffer.concat([Buffer.from(head), Buffer.alloc(512, 7)]));
    } else {
      res.writeHead(404); res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  {
    const r = await probeStreamPhysicalQuality(`${base}/?mode=mp3_full`, undefined, 2000, 240, 320);
    assert(r.streamType === 'full' && r.realBitrateKbps === 320 && r.method === 'mp3-frame-header', '206 + MP3 header: full 320k detected', `est=${r.estimatedDurationSec?.toFixed(0)}s conf=${r.confidence}`);
    const t = await probeStreamPhysicalQuality(`${base}/?mode=mp3_trial`, undefined, 2000, 240, 320);
    assert(t.streamType === 'trial' && t.realBitrateKbps === 128, '206 + MP3 header: 128k/90s vs expected 240s -> trial');
    const p = await probeStreamPhysicalQuality(`${base}/?mode=plain200`, undefined, 2000, 240, 128);
    assert(p.streamType === 'full' && p.totalBytes === 3_840_000, '200 + Content-Length works without Content-Range');
    const c1 = await probeStreamPhysicalQuality(`${base}/?mode=cl_only_1`, undefined, 2000, 240, 320);
    assert(c1.streamType === 'unavailable', '206 without Content-Range (CL:1) -> unavailable (was misjudged trial)', `total=${c1.totalBytes}`);
    const nb = await probeStreamPhysicalQuality(`${base}/?mode=no_body`, undefined, 2000, 240, 320);
    assert(nb.streamType === 'full' && nb.confidence === 'low', '206 with total but empty body -> byte-ratio fallback, confidence low');
    const fake = await probeStreamPhysicalQuality(`${base}/?mode=fake`, undefined, 2000, 240, 320);
    assert(fake.streamType === 'unavailable', '181,522-byte fake clip served with header -> unavailable');
    const slow = await probeStreamPhysicalQuality(`${base}/?mode=slow`, undefined, 1500, 240, 320);
    assert(slow.streamType === 'unavailable', 'Slow response -> unavailable via timeout');
    const nf = await probeStreamPhysicalQuality(`${base}/?mode=404`, undefined, 2000, 240, 320);
    assert(nf.streamType === 'unavailable', '404 -> unavailable');
    const refused = await probeStreamPhysicalQuality('http://127.0.0.1:1/nope', undefined, 1200, 240, 320);
    assert(refused.streamType === 'unavailable', 'Connection refused -> unavailable (no throw)');
  }

  server.close();
  console.log(`\n==== stream detection tests: ${passed} passed, ${failed} failed ====`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
