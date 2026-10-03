#!/usr/bin/env python3
"""
Official Public Production QA Audit Suite for CFSolara Sonic Multi-Source Gateway
Target Domains:
  1. Primary Custom Domain: https://sonic.epocanvas.com
  2. Cloudflare Pages Domain: https://cfsolara-dho.pages.dev
"""

import sys
import time
import re
import json
import xml.etree.ElementTree as ET
import urllib.request
import urllib.error
import urllib.parse

DOMAINS = [
    ("Sonic Custom Domain", "https://sonic.epocanvas.com"),
    ("Pages Dev Production", "https://cfsolara-dho.pages.dev"),
]

def make_request(url, method="GET", headers=None, timeout=20):
    req_headers = {
        "User-Agent": "Sonic-QA-Auditor/2.0 (Cloudflare-Production-Audit)",
        "Accept": "*/*",
    }
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers, method=method)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            latency_ms = (time.time() - t0) * 1000
            status = resp.status
            resp_headers = dict(resp.headers)
            body = resp.read()
            return status, resp_headers, body, latency_ms, None
    except urllib.error.HTTPError as e:
        latency_ms = (time.time() - t0) * 1000
        body = e.read()
        return e.code, dict(e.headers), body, latency_ms, None
    except Exception as e:
        latency_ms = (time.time() - t0) * 1000
        return 0, {}, b"", latency_ms, str(e)

def run_audit(label, base_url):
    print(f"\n================================================================================")
    print(f"  PRODUCTION AUDIT: {label} ({base_url})")
    print(f"================================================================================")

    results = []

    def check(test_id, name, passed, status, latency_ms, details):
        results.append({
            "test_id": test_id,
            "name": name,
            "passed": passed,
            "status": status,
            "latency_ms": latency_ms,
            "details": details,
        })
        icon = "✅ PASS" if passed else "❌ FAIL"
        print(f"[{icon}] {test_id} - {name} (Status: {status}, Latency: {latency_ms:.1f}ms)")
        for k, v in details.items():
            print(f"       • {k}: {v}")

    # =========================================================================
    # Group 1: Lyriva Synchronized Lyrics & Nexus Default
    # =========================================================================
    print("\n--- GROUP 1: Lyriva Synchronized Lyrics Integration ---")

    # 1.1 Nexus Shape of You (Lyriva Default)
    url = f"{base_url}/api/sonic/lyrics/nexus?title={urllib.parse.quote('Shape of You')}&artist={urllib.parse.quote('Ed Sheeran')}"
    st, hd, b, lat, err = make_request(url)
    try:
        j = json.loads(b.decode('utf-8'))
        d = j.get("data", {})
        m = j.get("meta", {})
        brand_ok = j.get("brand") == "Sonic"
        prov = d.get("provider") or m.get("provider")
        prov_ok = prov in ["lyriva", "amll", "lrclib", "netease", "kugou", "qq"]
        level = d.get("level")
        synced = d.get("syncedLyrics", [])
        has_words = any(len(line.get("words", [])) > 0 for line in synced)
        passed = (st == 200 and brand_ok and prov_ok and len(synced) > 0 and has_words)
        check("1.1", "Nexus Shape of You (Lyriva Default)", passed, st, lat, {
            "brand": j.get("brand"), "provider": prov, "level": level, "synced_lines": len(synced),
            "has_words": has_words, "attempts": m.get("attempts", [])
        })
    except Exception as ex:
        check("1.1", "Nexus Shape of You (Lyriva Default)", False, st, lat, {"error": str(ex), "raw": b[:150].decode('utf-8', 'ignore')})

    # 1.2 Single Provider: Lyriva Shape of You
    url = f"{base_url}/api/sonic/lyrics/lyriva?title={urllib.parse.quote('Shape of You')}&artist={urllib.parse.quote('Ed Sheeran')}"
    st, hd, b, lat, err = make_request(url)
    try:
        j = json.loads(b.decode('utf-8'))
        d = j.get("data", {})
        m = j.get("meta", {})
        brand_ok = j.get("brand") == "Sonic"
        prov = d.get("provider") or m.get("provider")
        synced = d.get("syncedLyrics", [])
        passed = (st == 200 and brand_ok and prov == "lyriva" and len(synced) > 0)
        check("1.2", "Single Provider /api/sonic/lyrics/lyriva", passed, st, lat, {
            "brand": j.get("brand"), "provider": prov, "synced_lines": len(synced), "level": d.get("level")
        })
    except Exception as ex:
        check("1.2", "Single Provider /api/sonic/lyrics/lyriva", False, st, lat, {"error": str(ex)})

    # 1.3 Chinese Synced Track: 海阔天空 (Beyond)
    url = f"{base_url}/api/sonic/lyrics/nexus?title={urllib.parse.quote('海阔天空')}&artist={urllib.parse.quote('Beyond')}"
    st, hd, b, lat, err = make_request(url)
    try:
        j = json.loads(b.decode('utf-8'))
        d = j.get("data", {})
        synced = d.get("syncedLyrics", [])
        passed = (st == 200 and j.get("brand") == "Sonic" and len(synced) > 0)
        check("1.3", "Chinese Synced Lyrics: 海阔天空", passed, st, lat, {
            "brand": j.get("brand"), "provider": d.get("provider"), "synced_lines": len(synced), "level": d.get("level")
        })
    except Exception as ex:
        check("1.3", "Chinese Synced Lyrics: 海阔天空", False, st, lat, {"error": str(ex)})

    # 1.4 Chinese Synced Track: 晴天 (周杰伦)
    url = f"{base_url}/api/sonic/lyrics/nexus?title={urllib.parse.quote('晴天')}&artist={urllib.parse.quote('周杰伦')}"
    st, hd, b, lat, err = make_request(url)
    try:
        j = json.loads(b.decode('utf-8'))
        d = j.get("data", {})
        synced = d.get("syncedLyrics", [])
        passed = (st == 200 and j.get("brand") == "Sonic" and len(synced) > 0)
        check("1.4", "Chinese Synced Lyrics: 晴天", passed, st, lat, {
            "brand": j.get("brand"), "provider": d.get("provider"), "synced_lines": len(synced), "level": d.get("level")
        })
    except Exception as ex:
        check("1.4", "Chinese Synced Lyrics: 晴天", False, st, lat, {"error": str(ex)})

    # 1.5 Instrumental Track: River Flows in You (Instrumental) (Yiruma)
    url = f"{base_url}/api/sonic/lyrics/nexus?title={urllib.parse.quote('River Flows in You (Instrumental)')}&artist={urllib.parse.quote('Yiruma')}"
    st, hd, b, lat, err = make_request(url)
    try:
        j = json.loads(b.decode('utf-8'))
        d = j.get("data", {})
        inst = d.get("instrumental") is True
        level = d.get("level")
        synced = d.get("syncedLyrics", [])
        passed = (st == 200 and j.get("brand") == "Sonic" and inst and level == "none" and len(synced) == 0)
        check("1.5", "Instrumental Track: River Flows in You (Instrumental)", passed, st, lat, {
            "brand": j.get("brand"), "instrumental": d.get("instrumental"), "level": level, "synced_lines": len(synced)
        })
    except Exception as ex:
        check("1.5", "Instrumental Track: River Flows in You (Instrumental)", False, st, lat, {"error": str(ex)})

    # =========================================================================
    # Group 2: Aggregation Forwarding & Synchronization Endpoints
    # =========================================================================
    print("\n--- GROUP 2: Aggregation Forwarding & Synchronization Endpoints ---")

    # 2.1 Sync format=lrc
    url = f"{base_url}/api/sonic/lyrics/sync?title={urllib.parse.quote('Shape of You')}&artist={urllib.parse.quote('Ed Sheeran')}&format=lrc"
    st, hd, b, lat, err = make_request(url)
    ct = hd.get("Content-Type", hd.get("content-type", ""))
    text = b.decode('utf-8', 'ignore')
    has_lrc_tags = bool(re.search(r"\[\d{2}:\d{2}\.\d{2,3}\]", text))
    passed = (st == 200 and "text/plain" in ct and has_lrc_tags)
    check("2.1", "Sync Endpoint format=lrc", passed, st, lat, {
        "content_type": ct, "has_lrc_tags": has_lrc_tags, "snippet": text[:90].replace('\n', ' ')
    })

    # 2.2 Sync format=json
    url = f"{base_url}/api/sonic/lyrics/sync?title={urllib.parse.quote('Shape of You')}&artist={urllib.parse.quote('Ed Sheeran')}&format=json"
    st, hd, b, lat, err = make_request(url)
    try:
        j = json.loads(b.decode('utf-8'))
        lyrics_arr = j.get("lyrics", [])
        has_items = len(lyrics_arr) > 0 and "time" in lyrics_arr[0] and "text" in lyrics_arr[0]
        passed = (st == 200 and "title" in j and "artist" in j and has_items)
        check("2.2", "Sync Endpoint format=json", passed, st, lat, {
            "title": j.get("title"), "artist": j.get("artist"), "lyrics_count": len(lyrics_arr)
        })
    except Exception as ex:
        check("2.2", "Sync Endpoint format=json", False, st, lat, {"error": str(ex)})

    # 2.3 Sync format=ttml
    url = f"{base_url}/api/sonic/lyrics/sync?title={urllib.parse.quote('Shape of You')}&artist={urllib.parse.quote('Ed Sheeran')}&format=ttml"
    st, hd, b, lat, err = make_request(url)
    ct = hd.get("Content-Type", hd.get("content-type", ""))
    xml_text = b.decode('utf-8', 'ignore')
    xml_ok = False
    try:
        root = ET.fromstring(xml_text)
        xml_ok = "tt" in root.tag.lower()
    except Exception:
        xml_ok = False
    passed = (st == 200 and ("xml" in ct or "ttml" in ct) and xml_ok)
    check("2.3", "Sync Endpoint format=ttml", passed, st, lat, {
        "content_type": ct, "is_valid_ttml_xml": xml_ok, "snippet": xml_text[:90].replace('\n', ' ')
    })

    # 2.4 Forward LRC: 海阔天空
    url = f"{base_url}/api/sonic/forward?title={urllib.parse.quote('海阔天空')}&artist={urllib.parse.quote('Beyond')}&format=lrc"
    st, hd, b, lat, err = make_request(url)
    ct = hd.get("Content-Type", hd.get("content-type", ""))
    text = b.decode('utf-8', 'ignore')
    has_lrc_tags = bool(re.search(r"\[\d{2}:\d{2}\.\d{2,3}\]", text))
    passed = (st == 200 and "text/plain" in ct and has_lrc_tags)
    check("2.4", "Forward Endpoint format=lrc", passed, st, lat, {
        "content_type": ct, "has_lrc_tags": has_lrc_tags, "snippet": text[:90].replace('\n', ' ')
    })

    # 2.5 Forward Search: type=search&q=周杰伦&count=3
    url = f"{base_url}/api/sonic/forward?type=search&q={urllib.parse.quote('周杰伦')}&count=3"
    st, hd, b, lat, err = make_request(url)
    try:
        j = json.loads(b.decode('utf-8'))
        d = j.get("data", {})
        m = j.get("meta", {})
        tracks = d.get("tracks", [])
        passed = (st == 200 and j.get("brand") == "Sonic" and len(tracks) > 0 and (m.get("forwarded") is True or "tracks" in d))
        check("2.5", "Forward Endpoint type=search", passed, st, lat, {
            "brand": j.get("brand"), "tracks_count": len(tracks), "forwarded": m.get("forwarded")
        })
    except Exception as ex:
        check("2.5", "Forward Endpoint type=search", False, st, lat, {"error": str(ex)})

    # 2.6 CORS Verification (OPTIONS preflight)
    st_fwd, hd_fwd, _, lat_fwd, _ = make_request(f"{base_url}/api/sonic/forward", method="OPTIONS", headers={"Origin": "https://example.com"})
    st_sync, hd_sync, _, lat_sync, _ = make_request(f"{base_url}/api/sonic/lyrics/sync", method="OPTIONS", headers={"Origin": "https://example.com"})
    cors_fwd = hd_fwd.get("Access-Control-Allow-Origin", hd_fwd.get("access-control-allow-origin")) == "*"
    cors_sync = hd_sync.get("Access-Control-Allow-Origin", hd_sync.get("access-control-allow-origin")) == "*"
    passed = (st_fwd in [200, 204] and cors_fwd and st_sync in [200, 204] and cors_sync)
    check("2.6", "CORS Preflight (OPTIONS)", passed, f"{st_fwd}/{st_sync}", (lat_fwd + lat_sync) / 2, {
        "forward_status": st_fwd, "forward_cors": cors_fwd,
        "sync_status": st_sync, "sync_cors": cors_sync
    })

    # =========================================================================
    # Group 3: Emergency Outage & Fallback Degradation
    # =========================================================================
    print("\n--- GROUP 3: Emergency Outage & Fallback Degradation ---")

    # 3.1 Outage Fallback: Bogus NetEase Platform ID
    url = f"{base_url}/api/sonic/lyrics/nexus?title={urllib.parse.quote('晴天')}&artist={urllib.parse.quote('周杰伦')}&platform=netease&platformId=99999999999999999999"
    st, hd, b, lat, err = make_request(url)
    try:
        j = json.loads(b.decode('utf-8'))
        d = j.get("data", {})
        m = j.get("meta", {})
        synced = d.get("syncedLyrics", [])
        attempts = m.get("attempts", [])
        passed = (st == 200 and j.get("brand") == "Sonic" and len(synced) > 0 and len(attempts) > 0)
        check("3.1", "Bogus Platform ID Multi-Source Fallback", passed, st, lat, {
            "brand": j.get("brand"), "fallback_provider": d.get("provider"), "synced_lines": len(synced),
            "attempts": attempts
        })
    except Exception as ex:
        check("3.1", "Bogus Platform ID Multi-Source Fallback", False, st, lat, {"error": str(ex)})

    # 3.2 Gibberish Non-existent Track
    url = f"{base_url}/api/sonic/lyrics/nexus?title={urllib.parse.quote('qx7z_unfindable_string_9182371928')}"
    st, hd, b, lat, err = make_request(url)
    try:
        j = json.loads(b.decode('utf-8'))
        d = j.get("data", {})
        synced = d.get("syncedLyrics", [])
        passed = (st == 200 and j.get("brand") == "Sonic" and d.get("level") == "none" and len(synced) == 0)
        check("3.2", "Gibberish Non-existent Track Isolation", passed, st, lat, {
            "brand": j.get("brand"), "level": d.get("level"), "synced_lines": len(synced)
        })
    except Exception as ex:
        check("3.2", "Gibberish Non-existent Track Isolation", False, st, lat, {"error": str(ex)})

    # 3.3 Missing Parameters (Nexus) -> 400 Bad Request
    url = f"{base_url}/api/sonic/lyrics/nexus"
    st, hd, b, lat, err = make_request(url)
    try:
        j = json.loads(b.decode('utf-8'))
        err_code = j.get("error", {}).get("code", "")
        passed = (st == 400 and j.get("brand") == "Sonic" and err_code == "MISSING_PARAMS")
        check("3.3", "Missing Parameters 400 Validation (Nexus)", passed, st, lat, {
            "status": st, "code": err_code, "message": j.get("error", {}).get("message")
        })
    except Exception as ex:
        check("3.3", "Missing Parameters 400 Validation (Nexus)", False, st, lat, {"error": str(ex)})

    # 3.4 Missing Parameters (Forward) -> 400 Bad Request
    url = f"{base_url}/api/sonic/forward"
    st, hd, b, lat, err = make_request(url)
    try:
        j = json.loads(b.decode('utf-8'))
        err_code = j.get("error", {}).get("code", "")
        passed = (st == 400 and j.get("brand") == "Sonic" and err_code == "MISSING_PARAMS")
        check("3.4", "Missing Parameters 400 Validation (Forward)", passed, st, lat, {
            "status": st, "code": err_code, "message": j.get("error", {}).get("message")
        })
    except Exception as ex:
        check("3.4", "Missing Parameters 400 Validation (Forward)", False, st, lat, {"error": str(ex)})

    # 3.5 Forward Proxy Security: Invalid Protocol -> 400 INVALID_TARGET
    url = f"{base_url}/api/sonic/forward?target={urllib.parse.quote('ftp://malicious.com/exploit')}"
    st, hd, b, lat, err = make_request(url)
    try:
        j = json.loads(b.decode('utf-8'))
        err_code = j.get("error", {}).get("code", "")
        passed = (st == 400 and j.get("brand") == "Sonic" and err_code == "INVALID_TARGET")
        check("3.5", "Forward Proxy Security Protocol Check", passed, st, lat, {
            "status": st, "code": err_code, "message": j.get("error", {}).get("message")
        })
    except Exception as ex:
        check("3.5", "Forward Proxy Security Protocol Check", False, st, lat, {"error": str(ex)})

    # =========================================================================
    # Group 4: End-to-End Audio Playback & Streaming
    # =========================================================================
    print("\n--- GROUP 4: Audio Playback Stream Proxy ---")

    url = f"{base_url}/proxy?types=url&id=1293886117&source=netease&br=320"
    st, hd, b, lat, err = make_request(url)
    try:
        j = json.loads(b.decode('utf-8'))
        audio_url = j.get("url") or (j.get("data", [{}])[0].get("url") if isinstance(j.get("data"), list) and len(j.get("data")) > 0 else "")
        valid_stream = bool(audio_url and audio_url.startswith("http"))
        passed = (st == 200 and valid_stream)
        check("4.1", "Audio Playback Stream URL Resolution", passed, st, lat, {
            "status": st, "has_valid_stream_url": valid_stream, "url_snippet": (audio_url[:70] + "...") if audio_url else "None"
        })
    except Exception as ex:
        check("4.1", "Audio Playback Stream URL Resolution", False, st, lat, {"error": str(ex)})

    # Summary
    total = len(results)
    passed_count = sum(1 for r in results if r["passed"])
    print(f"\n>>> SUMMARY FOR {label}: {passed_count}/{total} PASSED ({passed_count/total*100:.1f}%) <<<\n")
    return results

if __name__ == "__main__":
    all_results = {}
    for label, base_url in DOMAINS:
        all_results[label] = run_audit(label, base_url)

    total_all = sum(len(v) for v in all_results.values())
    passed_all = sum(sum(1 for r in v if r["passed"]) for v in all_results.values())
    print(f"\n================================================================================")
    print(f"  GLOBAL AUDIT SUMMARY: {passed_all} / {total_all} PASSED ({passed_all/total_all*100:.1f}%)")
    print(f"================================================================================\n")
    sys.exit(0 if passed_all == total_all else 1)
