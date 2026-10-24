// @ts-check
import fs from "fs";

const HOST = "https://sonic.epocanvas.tech";

const SONGS = [
  // 1. 中文流行
  { category: "中文流行", title: "起风了", artist: "买辣椒也用券" },
  { category: "中文流行", title: "晴天", artist: "周杰伦" },
  { category: "中文流行", title: "年少有为", artist: "李荣浩" },
  { category: "中文流行", title: "稻香", artist: "周杰伦" },

  // 2. 粤语经典
  { category: "粤语经典", title: "海阔天空", artist: "Beyond" },
  { category: "粤语经典", title: "红日", artist: "李克勤" },
  { category: "粤语经典", title: "富士山下", artist: "陈奕迅" },
  { category: "粤语经典", title: "喜帖街", artist: "谢安琪" },

  // 3. 日语曲目
  { category: "日语曲目", title: "Lemon", artist: "米津玄師" },
  { category: "日语曲目", title: "打上花火", artist: "DAOKO" },
  { category: "日语曲目", title: "残酷な天使のテーゼ", artist: "高桥洋子" },
  { category: "日语曲目", title: "夜に駆ける", artist: "YOASOBI" },

  // 4. 英文流行
  { category: "英文流行", title: "Shape of You", artist: "Ed Sheeran" },
  { category: "英文流行", title: "Rolling in the Deep", artist: "Adele" },
  { category: "英文流行", title: "Blinding Lights", artist: "The Weeknd" },
  { category: "英文流行", title: "Someone Like You", artist: "Adele" },

  // 5. 小众独立/民谣
  { category: "小众民谣", title: "南山南", artist: "马頔" },
  { category: "小众民谣", title: "安和桥", artist: "宋冬野" },
  { category: "小众民谣", title: "理想三旬", artist: "陈鸿宇" },
  { category: "小众民谣", title: "漠河舞厅", artist: "柳爽" },
];

const SOURCES = ["netease", "qq", "kugou", "kuwo"];

async function testSongSource(song, source) {
  const query = `${song.title} ${song.artist}`.trim();
  const res = {
    category: song.category,
    song: `${song.title} - ${song.artist}`,
    source,
    searchOk: false,
    trackId: "",
    streamStatus: "失败",
    isTrial: false,
    trialDuration: 0,
    totalBytes: 0,
    lyricsStatus: "无",
    coverStatus: "失败",
    failReason: "",
  };

  try {
    // 1. Search
    const searchUrl = `${HOST}/api/sonic/search/${source}?q=${encodeURIComponent(query)}&count=1&nocache=1`;
    const rSearch = await fetch(searchUrl, { signal: AbortSignal.timeout(10000) });
    if (!rSearch.ok) {
      res.failReason = `搜索HTTP ${rSearch.status}`;
      return res;
    }
    const dSearch = await rSearch.json();
    const track = dSearch.data?.tracks?.[0] || dSearch.tracks?.[0];
    if (!track || !track.id) {
      res.failReason = "无匹配搜索结果";
      return res;
    }

    res.searchOk = true;
    res.trackId = String(track.id);

    // 2. Stream test
    try {
      const streamUrl = `${HOST}/api/music/stream?id=${encodeURIComponent(res.trackId)}&source=${source}&quality=320`;
      const rStream = await fetch(streamUrl, {
        headers: { Range: "bytes=0-1023" },
        signal: AbortSignal.timeout(12000),
      });

      if (rStream.status === 206 || rStream.status === 200) {
        const cr = rStream.headers.get("content-range") || "";
        const cl = rStream.headers.get("content-length") || "";
        const total = cr.includes("/") ? parseInt(cr.split("/")[1], 10) : parseInt(cl, 10);
        res.totalBytes = isNaN(total) ? 0 : total;

        // Check if it is a trial or fake stream
        // Kuwo fake 11s prompt audio is 181,521 bytes
        if (source === "kuwo" && res.totalBytes === 181521) {
          res.streamStatus = "失败";
          res.failReason = "酷我版权语音假流(181KB/11s已拦截)";
        } else if (res.totalBytes > 0 && res.totalBytes < 1200000) {
          // Less than 1.2MB for 320k implies < 30 seconds preview
          const estSeconds = Math.round((res.totalBytes * 8) / (320 * 1000));
          res.streamStatus = `试听流 (${estSeconds}s)`;
          res.isTrial = true;
          res.trialDuration = estSeconds;
        } else {
          res.streamStatus = "完整流 (320k)";
        }
      } else if (rStream.status === 302) {
        res.streamStatus = "302直链";
      } else {
        res.streamStatus = "失败";
        res.failReason = `取流HTTP ${rStream.status}`;
      }
    } catch (e) {
      res.streamStatus = "失败";
      res.failReason = `取流超时/网络错误 (${e.message})`;
    }

    // 3. Lyrics test
    try {
      const lyricUrl = `${HOST}/api/sonic/lyrics/${source}?title=${encodeURIComponent(song.title)}&artist=${encodeURIComponent(song.artist)}&platformId=${encodeURIComponent(res.trackId)}&nocache=1`;
      const rLyric = await fetch(lyricUrl, { signal: AbortSignal.timeout(10000) });
      if (rLyric.ok) {
        const dLyric = await rLyric.json();
        const level = dLyric.data?.level || "none";
        const lines = dLyric.data?.syncedLyrics?.length || 0;
        if (level === "word" && lines > 0) {
          res.lyricsStatus = `逐字 (${lines}行)`;
        } else if (lines > 0) {
          res.lyricsStatus = `行级 (${lines}行)`;
        } else {
          res.lyricsStatus = "无歌词";
        }
      } else {
        res.lyricsStatus = `失败 (${rLyric.status})`;
      }
    } catch {
      res.lyricsStatus = "超时";
    }

    // 4. Cover test
    try {
      const coverUrl = `${HOST}/api/music/cover?id=${encodeURIComponent(res.trackId)}&source=${source}`;
      const rCover = await fetch(coverUrl, { signal: AbortSignal.timeout(8000) });
      if (rCover.ok) {
        const ct = rCover.headers.get("content-type") || "";
        const buf = await rCover.arrayBuffer();
        if (ct.includes("svg")) {
          res.coverStatus = "SVG占位";
        } else if (buf.byteLength > 2000) {
          res.coverStatus = `高清原图 (${Math.round(buf.byteLength / 1024)}KB)`;
        } else {
          res.coverStatus = "小图";
        }
      } else {
        res.coverStatus = `失败 (${rCover.status})`;
      }
    } catch {
      res.coverStatus = "超时";
    }

  } catch (err) {
    res.failReason = `未预期异常: ${err.message}`;
  }

  return res;
}

async function main() {
  console.log("=== 开始 20 首歌 4 音源抽样全量实测 ===");
  const results = [];

  for (let i = 0; i < SONGS.length; i++) {
    const song = SONGS[i];
    console.log(`\n[${i + 1}/20] 正在测试: ${song.title} - ${song.artist} (${song.category})...`);
    for (const source of SOURCES) {
      process.stdout.write(`  - 音源 ${source.padEnd(8)}: `);
      const r = await testSongSource(song, source);
      results.push(r);
      console.log(`搜索:${r.searchOk ? "✓" : "✗"} | 取流:${r.streamStatus} | 歌词:${r.lyricsStatus} | 封面:${r.coverStatus} ${r.failReason ? "(" + r.failReason + ")" : ""}`);
      // Small pause to be gentle on upstreams
      await new Promise(res => setTimeout(res, 200));
    }
  }

  fs.writeFileSync("/tmp/song-acceptance-results.json", JSON.stringify(results, null, 2));
  console.log("\n=== 实测完成，已保存结果至 /tmp/song-acceptance-results.json ===");
}

main().catch(console.error);
