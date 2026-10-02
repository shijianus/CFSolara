#!/usr/bin/env python3
import json
import urllib.parse
import urllib.request
import urllib.error
import time
import sys

BASE_URL = "https://sonic.epocanvas.com"

tests_passed = 0
tests_failed = 0
failures = []

def log(msg):
    print(msg, flush=True)

def record_result(name, ok, detail=""):
    global tests_passed, tests_failed
    if ok:
        tests_passed += 1
        log(f"  [PASS] {name} {f'({detail})' if detail else ''}")
    else:
        tests_failed += 1
        failures.append((name, detail))
        log(f"  [FAIL] {name} => {detail}")

def http_get(path, headers=None, parse_json=True, timeout=18):
    url = BASE_URL + path if path.startswith("/") else path
    req = urllib.request.Request(url, headers=headers or {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SonicGatewayAuditor/1.0",
        "Accept": "application/json, text/javascript, */*"
    })
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            elapsed = int((time.time() - start) * 1000)
            data = resp.read()
            if parse_json:
                try:
                    return resp.status, json.loads(data.decode("utf-8")), elapsed
                except Exception:
                    return resp.status, data.decode("utf-8", errors="replace"), elapsed
            return resp.status, data.decode("utf-8", errors="replace"), elapsed
    except urllib.error.HTTPError as e:
        elapsed = int((time.time() - start) * 1000)
        data = e.read().decode("utf-8", errors="replace")
        if parse_json:
            try:
                return e.code, json.loads(data), elapsed
            except Exception:
                return e.code, data, elapsed
        return e.code, data, elapsed
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return 0, str(e), elapsed

def test_frontend_assets():
    log("\n=== 1. Verifying Live Frontend Assets (https://sonic.epocanvas.com) ===")
    status, body, elapsed = http_get("/js/index.js", parse_json=False)
    record_result("GET /js/index.js Status 200", status == 200, f"{elapsed}ms")

    # Verify search input is NOT wiped
    has_wiped_search = 'dom.searchInput.value = "";' in body or "dom.searchInput.value = ''" in body
    record_result("Search input wipe bug resolved (no dom.searchInput.value='')", not has_wiped_search)

    # Verify playableId clean ID logic
    has_playable_id = "playableId" in body
    record_result("Clean playableId mapping present in JS", has_playable_id)

    # Verify 5s safeguard timeout in waitForAudioReady
    has_timeout_safeguard = "5000" in body and "waitForAudioReady" in body
    record_result("waitForAudioReady 5-second timeout safeguard present", has_timeout_safeguard)

    # Verify direct album cover loading
    has_direct_cover = "directCover" in body
    record_result("Direct album cover loading present", has_direct_cover)

def test_search_and_playback():
    log("\n=== 2. Verifying Multi-Page Search and Audio Stream Playability ===")
    queries = [
        ("海阔天空", 1),
        ("海阔天空", 2),
        ("晴天", 1),
        ("Taylor Swift", 1),
    ]

    for q, page in queries:
        encoded_q = urllib.parse.quote(q)
        path = f"/api/sonic/search/nexus?q={encoded_q}&page={page}&count=5"
        status, data, elapsed = http_get(path)

        ok_search = (
            status == 200 and
            isinstance(data, dict) and
            data.get("brand") == "Sonic" and
            isinstance(data.get("data", {}).get("tracks"), list) and
            len(data["data"]["tracks"]) > 0
        )
        record_result(f"Search '{q}' (page {page}) returns tracks", ok_search, f"{elapsed}ms, {len(data.get('data', {}).get('tracks', [])) if ok_search else 0} tracks")

        if not ok_search:
            continue

        # Test first 2 tracks for playability
        tracks = data["data"]["tracks"][:2]
        for idx, track in enumerate(tracks):
            track_id = track.get("id") or track.get("platformId")
            track_source = track.get("source") or track.get("platform") or "netease"
            track_title = track.get("title")

            # Check track ID does not contain raw prefix
            has_no_prefix = not (":" in str(track_id) and any(str(track_id).startswith(p + ":") for p in ["netease", "qq", "kugou"]))
            record_result(f"Track '{track_title}' has clean ID: '{track_id}'", has_no_prefix)

            # Query proxy for audio URL
            proxy_path = f"/proxy?types=url&id={urllib.parse.quote(str(track_id))}&source={urllib.parse.quote(track_source)}&br=320"
            p_status, p_data, p_elapsed = http_get(proxy_path)

            audio_url = ""
            if p_status == 200 and isinstance(p_data, dict):
                audio_url = p_data.get("url", "")

            can_resolve = p_status == 200 and bool(audio_url)
            record_result(f"Audio URL resolved for '{track_title}' ({track_source})", can_resolve, f"{p_elapsed}ms, url={audio_url[:50]}...")

            # If audio_url is an external or relative URL, test that audio headers can be obtained
            if can_resolve:
                full_audio_url = audio_url if audio_url.startswith("http") else (BASE_URL + audio_url)
                audio_headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    "Range": "bytes=0-100",
                    "Referer": "https://music.163.com/",
                }
                a_status, a_body, a_elapsed = http_get(full_audio_url, headers=audio_headers, parse_json=False, timeout=10)
                is_audio_ok = a_status in (200, 206, 302, 301)
                is_vip_fallback = (a_status in (502, 404)) and bool(p_data.get("fallback"))
                record_result(f"Audio stream accessible for '{track_title}'", is_audio_ok or is_vip_fallback, f"HTTP {a_status}, {a_elapsed}ms{' (VIP fallback handled)' if is_vip_fallback and not is_audio_ok else ''}")

def test_lyrics_gateway():
    log("\n=== 3. Verifying Lyrics Gateway Endpoints & Fallback ===")

    # 1. NetEase Native / Word-level YRC
    path = "/api/sonic/lyrics/nexus?title=" + urllib.parse.quote("年少有为") + "&artist=" + urllib.parse.quote("李荣浩") + "&platform=netease&platformId=1293886117"
    status, data, elapsed = http_get(path)
    ok_word = (
        status == 200 and
        data.get("brand") == "Sonic" and
        data.get("data", {}).get("level") == "word" and
        len(data.get("data", {}).get("syncedLyrics", [])) > 0
    )
    record_result("Lyrics Nexus: NetEase YRC word-level lyrics", ok_word, f"{elapsed}ms, lines={len(data.get('data', {}).get('syncedLyrics', [])) if ok_word else 0}")

    # 2. English song with word-level interpolation or AMLL TTML
    path = "/api/sonic/lyrics/nexus?title=" + urllib.parse.quote("Shape of You") + "&artist=" + urllib.parse.quote("Ed Sheeran")
    status, data, elapsed = http_get(path)
    ok_en = (
        status == 200 and
        data.get("brand") == "Sonic" and
        data.get("data", {}).get("level") in ("word", "line") and
        len(data.get("data", {}).get("syncedLyrics", [])) > 0
    )
    record_result("Lyrics Nexus: Western song lyrics", ok_en, f"{elapsed}ms")

    # 3. Instrumental song
    path = "/api/sonic/lyrics/nexus?title=" + urllib.parse.quote("River Flows in You") + "&artist=" + urllib.parse.quote("Yiruma")
    status, data, elapsed = http_get(path)
    ok_inst = (
        status == 200 and
        data.get("brand") == "Sonic" and
        data.get("data", {}).get("instrumental") is True and
        data.get("data", {}).get("level") == "none"
    )
    record_result("Lyrics Nexus: Instrumental recognition", ok_inst, f"{elapsed}ms")

    # 4. Outage Simulation: Invalid platformId fallback
    path = "/api/sonic/lyrics/nexus?title=" + urllib.parse.quote("海阔天空") + "&artist=" + urllib.parse.quote("Beyond") + "&platform=netease&platformId=99999999999999999999"
    status, data, elapsed = http_get(path)
    ok_fallback = (
        status == 200 and
        data.get("brand") == "Sonic" and
        len(data.get("data", {}).get("syncedLyrics", [])) > 0
    )
    record_result("Lyrics Nexus: Outage fallback on invalid platformId", ok_fallback, f"{elapsed}ms")

    # 5. Outage Simulation: Invalid QQ mid fallback
    path = "/api/sonic/lyrics/nexus?title=" + urllib.parse.quote("晴天") + "&artist=" + urllib.parse.quote("周杰伦") + "&platform=qq&platformId=invalid_mid_9999999"
    status, data, elapsed = http_get(path)
    ok_qq_fallback = (
        status == 200 and
        data.get("brand") == "Sonic" and
        len(data.get("data", {}).get("syncedLyrics", [])) > 0
    )
    record_result("Lyrics Nexus: Outage fallback on invalid QQ ID", ok_qq_fallback, f"{elapsed}ms")

    # 6. Single-source netease
    path = "/api/sonic/lyrics/netease?title=" + urllib.parse.quote("年少有为") + "&platformId=1293886117"
    status, data, elapsed = http_get(path)
    record_result("Single-source lyrics netease", status == 200 and data.get("brand") == "Sonic", f"{elapsed}ms")

    # 7. Single-source kugou
    path = "/api/sonic/lyrics/kugou?title=" + urllib.parse.quote("海阔天空")
    status, data, elapsed = http_get(path)
    record_result("Single-source lyrics kugou", status == 200 and data.get("brand") == "Sonic", f"{elapsed}ms")

    # 8. Single-source qq
    path = "/api/sonic/lyrics/qq?title=" + urllib.parse.quote("晴天") + "&platformId=0039MnYb0qxYhV"
    status, data, elapsed = http_get(path)
    record_result("Single-source lyrics qq", status == 200 and data.get("brand") == "Sonic", f"{elapsed}ms")

    # 9. Disabled provider: apple
    status, data, elapsed = http_get("/api/sonic/lyrics/apple?title=Hello")
    record_result("Disabled provider: apple returns 501", status == 501 and data.get("brand") == "Sonic", f"status={status}, {elapsed}ms")

    # 10. Disabled provider: ytmusic
    status, data, elapsed = http_get("/api/sonic/lyrics/ytmusic?title=Hello")
    record_result("Disabled provider: ytmusic returns 501", status == 501 and data.get("brand") == "Sonic", f"status={status}, {elapsed}ms")

    # 11. Backward compatibility: /api/sonic/lyrics
    path = "/api/sonic/lyrics?title=" + urllib.parse.quote("年少有为") + "&platformId=1293886117"
    status, data, elapsed = http_get(path)
    record_result("Backward compatible /api/sonic/lyrics", status == 200 and data.get("brand") == "Sonic", f"{elapsed}ms")

def main():
    log("================================================================")
    log(f"      STARTING LIVE VERIFICATION AGAINST {BASE_URL}")
    log("================================================================")
    test_frontend_assets()
    test_search_and_playback()
    test_lyrics_gateway()

    log("\n================================================================")
    log(f"AUDIT SUMMARY: {tests_passed} PASSED, {tests_failed} FAILED")
    log("================================================================")
    if failures:
        log("\nFAILURES:")
        for name, detail in failures:
            log(f" - {name}: {detail}")
        sys.exit(1)
    else:
        log("ALL TESTS COMPLETED WITH 100% PASS RATE!")
        sys.exit(0)

if __name__ == "__main__":
    main()
