// Generate the single source of truth for 20-song probe statistics.
// Usage: node scripts/summarize-20-songs.mjs
// Reads reports/raw_20_songs_probe_results.json, writes reports/raw_20_songs_summary.json.
import fs from 'fs';
import path from 'path';

const inPath = path.resolve(process.cwd(), 'reports/raw_20_songs_probe_results.json');
const outPath = path.resolve(process.cwd(), 'reports/raw_20_songs_summary.json');

const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));
if (!Array.isArray(raw) || raw.length === 0) {
  console.error('raw_20_songs_probe_results.json is missing or empty');
  process.exit(1);
}

const SOURCES = ['netease', 'qq', 'kugou', 'kuwo'];
const verdictOf = (s) => {
  if (!s) return 'missing';
  const j = String(s.judgment || '');
  const r = String(s.failReason || '');
  if (j.includes('完整')) return 'full';
  if (j.includes('试听')) return 'trial';
  if (j.includes('not_found') || r.startsWith('not_found')) return 'not_found';
  if (j.includes('假流')) return 'fake_clip_blocked';
  return 'fail';
};

const summary = {
  generatedAt: new Date().toISOString(),
  source: 'reports/raw_20_songs_probe_results.json',
  measuredAgainst: 'https://sonic.epocanvas.tech (production)',
  totalSongs: raw.length,
  perSource: {},
  neteasePerSong: [],
  crossSourceUpgrades: [],
  notes: [],
};

for (const src of SOURCES) {
  summary.perSource[src] = { full: 0, trial: 0, not_found: 0, fake_clip_blocked: 0, fail: 0, missing: 0 };
}

for (const song of raw) {
  const ne = song.sources?.netease;
  const neVerdict = verdictOf(ne);
  summary.neteasePerSong.push({
    index: song.songIndex,
    title: song.title,
    artist: song.artist,
    verdict: neVerdict,
    totalBytes: ne?.totalBytes ?? 0,
    matchedTrack: ne?.matchedTrack ?? null,
    failReason: ne?.failReason ?? null,
  });
  for (const src of SOURCES) {
    summary.perSource[src][verdictOf(song.sources?.[src])] += 1;
  }
  // Cross-source upgrade: nexus multi-source returned a stream whose type differs
  // from the primary-source verdict (e.g. netease trial but nexus delivered full).
  const nx = song.nexusMultiSource || {};
  const nxType = nx.streamTypeHeader || null;
  if (nxType && neVerdict !== 'missing') {
    summary.crossSourceUpgrades.push({
      index: song.songIndex,
      title: song.title,
      primaryVerdict: neVerdict,
      nexusProvider: nx.provider || null,
      nexusVia: nx.via || null,
      nexusStreamType: nxType,
      upgraded: neVerdict === 'trial' && nxType === 'full',
    });
  }
}

summary.notes.push('判定口径: full=完整流, trial=试听流, not_found=严格标题+歌手匹配无结果, fake_clip_blocked=假流拦截, fail=取流/检索失败。');
summary.notes.push('统计由 scripts/summarize-20-songs.mjs 从原始 JSON 生成,请勿手改数字;重跑 measure-20-sample-songs-raw.mjs 后重新生成本表。');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
console.log(`summary written: ${outPath}`);
for (const src of SOURCES) {
  const s = summary.perSource[src];
  console.log(`${src}: full=${s.full} trial=${s.trial} not_found=${s.not_found} fake=${s.fake_clip_blocked} fail=${s.fail}`);
}
