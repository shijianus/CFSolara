// @ts-check
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

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

// 审计修复 #4:标题与歌手都必须匹配(归一化后),无匹配一律记为 not_found,
// 绝不回退 tracks[0]。归一化:小写 + 去空白 + 去 &nbsp;。
function normalizeText(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/&nbsp;/g, "")
    .replace(/\s+/g, "");
}

function evaluateRelativeBytes(totalBytes, expectedDurationSec = 240, nominalBitrateKbps = 320) {
  if (!totalBytes || totalBytes <= 0) {
    return { streamType: "unavailable", ratio: 0, baselineBytes: 0, isFull: false };
  }
  if (totalBytes === 181521) {
    return { streamType: "unavailable", ratio: 0, baselineBytes: 0, isFull: false, reason: "kuwo_181kb_fake_prompt" };
  }
  const duration = expectedDurationSec && expectedDurationSec > 30 ? expectedDurationSec : 200;
  const effBitrateKbps = Math.max(96, nominalBitrateKbps * 0.55); // 176 kbps for 320k
  const baselineBytes = Math.round(duration * ((effBitrateKbps * 1000) / 8));
  const ratio = totalBytes / baselineBytes;
  const isFull = ratio >= 0.85;
  return {
    streamType: isFull ? "full" : "trial",
    ratio: Number(ratio.toFixed(3)),
    baselineBytes,
    isFull,
  };
}

function probeWithFfprobe(filePath) {
  try {
    const cmd = `ffprobe -v error -show_entries format=duration,bit_rate,format_name:stream=codec_name,sample_rate,channels,bit_rate -of json "${filePath}"`;
    const stdout = execSync(cmd, { timeout: 5000 }).toString();
    const json = JSON.parse(stdout);
    const stream = json.streams?.[0] || {};
    const format = json.format || {};
    return {
      ok: true,
      codec_name: stream.codec_name || null,
      sample_rate: stream.sample_rate ? parseInt(stream.sample_rate, 10) : null,
      channels: stream.channels || null,
      stream_bit_rate: stream.bit_rate ? parseInt(stream.bit_rate, 10) : null,
      format_name: format.format_name || null,
      format_duration: format.duration ? parseFloat(format.duration) : null,
      format_bit_rate: format.bit_rate ? parseInt(format.bit_rate, 10) : null,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function runProbe() {
  console.log("=== 启动 20 首歌 4 音源真实生产网关原始探测 ===");
  console.log(`网关目标: ${HOST}`);
  console.log(`时间戳: ${new Date().toISOString()}`);

  const rawResults = [];

  for (let idx = 0; idx < SONGS.length; idx++) {
    const song = SONGS[idx];
    const songNum = idx + 1;
    console.log(`\n[${songNum}/20] 测试曲目: ${song.title} - ${song.artist} (${song.category})`);

    const songEntry = {
      songIndex: songNum,
      category: song.category,
      title: song.title,
      artist: song.artist,
      sources: {},
      nexusMultiSource: {},
    };

    for (const src of SOURCES) {
      process.stdout.write(`  - 探测 [${src.padEnd(8)}]: `);
      const query = `${song.title} ${song.artist}`;
      const searchUrl = `${HOST}/api/sonic/search/${src}?q=${encodeURIComponent(query)}&count=5&nocache=1`;

      const srcResult = {
        source: src,
        searchQuery: query,
        searchUrl,
        searchHttpStatus: null,
        matchedTrack: null,
        streamRequestUrl: null,
        streamHttpStatus: null,
        streamHeaders: {},
        totalBytes: 0,
        ffprobe: null,
        evaluation: null,
        judgment: "失败",
        failReason: null,
      };

      try {
        // 1. 检索
        const sRes = await fetch(searchUrl, { signal: AbortSignal.timeout(10000) });
        srcResult.searchHttpStatus = sRes.status;
        if (!sRes.ok) {
          srcResult.failReason = `检索 HTTP ${sRes.status}`;
          console.log(`搜索失败 (HTTP ${sRes.status})`);
          songEntry.sources[src] = srcResult;
          continue;
        }

        const sData = await sRes.json();
        const tracks = sData.data?.tracks || sData.tracks || [];
        if (!tracks || tracks.length === 0) {
          srcResult.failReason = "无匹配搜索结果";
          console.log(`无搜索结果`);
          songEntry.sources[src] = srcResult;
          continue;
        }

        // 审计修复 #4:严格匹配 —— 标题(归一化后)完全相等 且 歌手(归一化后)包含查询歌手
        // 或存在完全相等的歌手分片;无匹配 → matchedTrack=null / judgment='not_found',不回退 Top1。
        const qTitle = normalizeText(song.title);
        const qArtist = normalizeText(song.artist);
        const strictMatch = tracks.find((t) => {
          const tTitle = normalizeText(t.title || t.name);
          if (tTitle !== qTitle) return false;
          const tArtist = normalizeText(t.artist || "");
          if (!tArtist) return false;
          if (tArtist.includes(qArtist)) return true;
          return tArtist
            .split(/[/、,，&]/)
            .some((p) => p.trim() && (p.trim() === qArtist || qArtist.includes(p.trim())));
        });
        const chosenTrack = strictMatch || null;

        if (!chosenTrack) {
          srcResult.judgment = "not_found";
          srcResult.failReason = "not_found: no track matching strict title+artist criteria";
          console.log("无严格匹配结果 (not_found)");
          songEntry.sources[src] = srcResult;
          continue;
        }

        srcResult.matchedTrack = {
          id: String(chosenTrack.platformId || chosenTrack.id),
          title: chosenTrack.title || chosenTrack.name,
          artist: chosenTrack.artist,
          duration: chosenTrack.duration,
          isVip: Boolean(chosenTrack.isVip),
        };

        const cleanTrackId = srcResult.matchedTrack.id.replace(/^[a-z]+:/i, "");
        const streamUrl = `${HOST}/api/music/stream?id=${encodeURIComponent(cleanTrackId)}&source=${src}&quality=320`;
        srcResult.streamRequestUrl = streamUrl;

        // 2. 取流 Range 请求
        const streamRes = await fetch(streamUrl, {
          headers: { Range: "bytes=0-1023" },
          signal: AbortSignal.timeout(12000),
        });

        srcResult.streamHttpStatus = streamRes.status;
        streamRes.headers.forEach((val, key) => {
          if (
            key.startsWith("content-") ||
            key.startsWith("x-sonic-") ||
            key === "accept-ranges"
          ) {
            srcResult.streamHeaders[key] = val;
          }
        });

        if (streamRes.status === 200 || streamRes.status === 206) {
          const cr = streamRes.headers.get("content-range") || "";
          const cl = streamRes.headers.get("content-length") || "";
          const total = cr.includes("/") ? parseInt(cr.split("/")[1], 10) : parseInt(cl, 10);
          srcResult.totalBytes = isNaN(total) ? 0 : total;

          // 3. 用 curl 下载前 500KB 音频样本进行真实 ffprobe 校验
          const tmpAudioPath = `/tmp/probe_${songNum}_${src}.mp3`;
          try {
            execSync(`curl -s -L -r 0-500000 "${streamUrl}" -o "${tmpAudioPath}"`, { timeout: 10000 });
            srcResult.ffprobe = probeWithFfprobe(tmpAudioPath);
          } catch (ffErr) {
            srcResult.ffprobe = { ok: false, error: ffErr.message };
          } finally {
            try { fs.unlinkSync(tmpAudioPath); } catch {}
          }

          // 4. 相对阈值评估
          const expDur = srcResult.matchedTrack.duration || 240;
          srcResult.evaluation = evaluateRelativeBytes(srcResult.totalBytes, expDur, 320);

          if (srcResult.totalBytes === 181521) {
            srcResult.judgment = "假流拦截 (181KB)";
            srcResult.failReason = "酷我版权语音提示音频已拦截";
          } else if (srcResult.evaluation.isFull) {
            srcResult.judgment = "完整流";
          } else {
            srcResult.judgment = `试听流 (${Math.round(srcResult.totalBytes / 16000)}s)`;
          }

          const brDesc = srcResult.ffprobe?.stream_bit_rate
            ? `${Math.round(srcResult.ffprobe.stream_bit_rate / 1000)}kbps`
            : "未知码率";
          console.log(`HTTP ${streamRes.status} | 字节: ${srcResult.totalBytes} | 判定: ${srcResult.judgment} | 真实流参数: ${brDesc}`);
        } else {
          srcResult.judgment = "失败";
          srcResult.failReason = `取流 HTTP ${streamRes.status}`;
          console.log(`取流失败 (HTTP ${streamRes.status})`);
        }
      } catch (err) {
        srcResult.judgment = "失败";
        srcResult.failReason = `异常: ${err.message}`;
        console.log(`异常 (${err.message})`);
      }

      songEntry.sources[src] = srcResult;
      // 避免并发过快触发上游速率限制
      await new Promise(r => setTimeout(r, 250));
    }

    // 5. 测试多源聚合接口的实际自动降级/升格结果
    try {
      const nexusStreamUrl = `${HOST}/api/music/stream?title=${encodeURIComponent(song.title)}&artist=${encodeURIComponent(song.artist)}&source=netease&quality=320`;
      const nRes = await fetch(nexusStreamUrl, {
        headers: { Range: "bytes=0-1023" },
        signal: AbortSignal.timeout(12000),
      });
      const cr = nRes.headers.get("content-range") || "";
      const cl = nRes.headers.get("content-length") || "";
      const total = cr.includes("/") ? parseInt(cr.split("/")[1], 10) : parseInt(cl, 10);
      songEntry.nexusMultiSource = {
        httpStatus: nRes.status,
        provider: nRes.headers.get("x-sonic-provider"),
        via: nRes.headers.get("x-sonic-via"),
        streamTypeHeader: nRes.headers.get("x-sonic-stream-type"),
        isTrialHeader: nRes.headers.get("x-sonic-stream-trial"),
        trialDurationHeader: nRes.headers.get("x-sonic-trial-duration"),
        totalBytes: isNaN(total) ? 0 : total,
      };
    } catch (nErr) {
      songEntry.nexusMultiSource = { error: nErr.message };
    }

    rawResults.push(songEntry);
  }

  // 确保 reports 目录存在并写入原始 JSON
  const outPath = path.resolve(process.cwd(), "reports/raw_20_songs_probe_results.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(rawResults, null, 2), "utf8");
  console.log(`\n=== 真实探测完毕！原始数据已完整保存至: ${outPath} ===`);
}

runProbe().catch(console.error);
