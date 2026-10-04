#!/usr/bin/env python3
import json
import os
import sys
import time
import requests

def test_endpoint(test_id, name, url, method="GET", expected_status=200, headers=None, validator=None):
    print(f"\n{'='*75}\n[TEST {test_id}] {name}\nURL: {url} ({method})")
    try:
        t0 = time.time()
        if method == "OPTIONS":
            resp = requests.options(url, headers=headers or {}, timeout=20)
        else:
            sep = "&" if "?" in url else "?"
            # Add cache buster to test live production behavior fresh
            bust_url = f"{url}{sep}_bust={int(time.time()*1000)}"
            resp = requests.get(bust_url, headers=headers or {}, timeout=20)
        elapsed_ms = int((time.time() - t0) * 1000)
        
        if isinstance(expected_status, (list, tuple)):
            status_ok = resp.status_code in expected_status
        else:
            status_ok = (resp.status_code == expected_status)
            
        print(f"HTTP Status: {resp.status_code} (Expected: {expected_status}) [Latency: {elapsed_ms}ms] -> {'PASS' if status_ok else 'FAIL'}")
        
        v_passed = True
        v_details = []
        if validator:
            v_passed, v_details = validator(resp)
            for v in v_details:
                print(f"  * {v}")
        
        overall = status_ok and v_passed
        print(f"==> VERDICT: {'PASS' if overall else 'FAIL'}")
        return {
            "test_id": test_id,
            "name": name,
            "url": url,
            "method": method,
            "status_code": resp.status_code,
            "latency_ms": elapsed_ms,
            "passed": overall,
            "details": v_details
        }
    except Exception as e:
        print(f"EXCEPTION: {e}")
        return {
            "test_id": test_id,
            "name": name,
            "url": url,
            "method": method,
            "status_code": "ERROR",
            "latency_ms": -1,
            "passed": False,
            "details": [str(e)]
        }

def run_part1_suite(base_url):
    print(f"\n{'#'*80}\n### EXECUTING PART 1 API AUDIT SUITE FOR: {base_url}\n{'#'*80}")
    results = []

    # 1.1 Lyriva & Word-Level: Shape of You
    def val_1_1(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parsing failed: {e}"]
        
        checks = []
        brand = data.get("brand")
        brand_ok = (brand == "Sonic")
        checks.append(f"Brand check: '{brand}' (Expected: 'Sonic') -> {brand_ok}")
        
        meta = data.get("meta", {})
        inner = data.get("data", {})
        provider = meta.get("provider") or inner.get("provider")
        provider_ok = (provider == "lyriva")
        checks.append(f"Meta Provider check: '{provider}' (Expected: 'lyriva') -> {provider_ok}")
        
        level = inner.get("level")
        level_ok = (level == "word")
        checks.append(f"Level check: '{level}' (Expected: 'word') -> {level_ok}")
        
        synced = inner.get("syncedLyrics", [])
        has_synced = isinstance(synced, list) and len(synced) > 0
        checks.append(f"Synced lyrics count: {len(synced)} -> {has_synced}")
        
        timestamps_ok = False
        if has_synced:
            l0 = synced[0]
            words = l0.get("words", [])
            w0 = words[0] if words else {}
            
            line_ts_keys = ["start", "startSec", "end", "endSec", "duration", "durationSec"]
            word_ts_keys = ["start", "startSec", "end", "endSec", "duration", "durationSec"]
            
            l0_has = all(k in l0 and l0[k] is not None for k in line_ts_keys)
            w0_has = all(k in w0 and w0[k] is not None for k in word_ts_keys) if words else False
            
            checks.append(f"Line 0 timestamps ({l0_has}): start={l0.get('start')}, startSec={l0.get('startSec')}, end={l0.get('end')}, endSec={l0.get('endSec')}, dur={l0.get('duration')}, durSec={l0.get('durationSec')}")
            if words:
                checks.append(f"Word 0 ('{w0.get('text')}') timestamps ({w0_has}): start={w0.get('start')}, startSec={w0.get('startSec')}, end={w0.get('end')}, endSec={w0.get('endSec')}, dur={w0.get('duration')}, durSec={w0.get('durationSec')}")
            else:
                checks.append("Word 0 check: No words array found on line 0")
            timestamps_ok = l0_has and w0_has
        
        all_passed = brand_ok and provider_ok and level_ok and has_synced and timestamps_ok
        return all_passed, checks

    results.append(test_endpoint(
        "1.1",
        "Nexus Word-Level Lyriva (Shape of You - Ed Sheeran)",
        f"{base_url}/api/sonic/lyrics/nexus?title=Shape%20of%20You&artist=Ed%20Sheeran",
        validator=val_1_1
    ))

    # 1.2 Direct Lyriva Endpoint: Shape of You
    def val_1_2(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parsing failed: {e}"]
        checks = []
        brand = data.get("brand")
        brand_ok = (brand == "Sonic")
        checks.append(f"Brand check: '{brand}' (Expected: 'Sonic') -> {brand_ok}")
        
        meta = data.get("meta", {})
        inner = data.get("data", {})
        provider = data.get("provider") or meta.get("provider") or inner.get("provider")
        provider_ok = (provider == "lyriva")
        checks.append(f"Provider check: '{provider}' (Expected: 'lyriva') -> {provider_ok}")
        
        synced = data.get("syncedLyrics") or inner.get("syncedLyrics", [])
        has_synced = isinstance(synced, list) and len(synced) > 0
        checks.append(f"Synced lyrics count: {len(synced)} -> {has_synced}")
        
        return brand_ok and provider_ok and has_synced, checks

    results.append(test_endpoint(
        "1.2",
        "Lyriva Direct Endpoint (Shape of You - Ed Sheeran)",
        f"{base_url}/api/sonic/lyrics/lyriva?title=Shape%20of%20You&artist=Ed%20Sheeran",
        validator=val_1_2
    ))

    # 1.3 Sync LRC format
    def val_1_3(resp):
        ct = resp.headers.get("content-type", "")
        body = resp.text
        checks = []
        is_text = "text/plain" in ct or "text/" in ct
        checks.append(f"Content-Type: '{ct}' (Expected: text/plain) -> {is_text}")
        import re
        has_ts = bool(re.search(r"\[\d{2}:\d{2}\.\d{2,3}\]", body))
        checks.append(f"LRC format [mm:ss.xx] timestamp check (Body length: {len(body)}) -> {has_ts}")
        return is_text and has_ts, checks

    results.append(test_endpoint(
        "1.3",
        "Sync Lyrics LRC Format (Shape of You - Ed Sheeran)",
        f"{base_url}/api/sonic/lyrics/sync?title=Shape%20of%20You&artist=Ed%20Sheeran&format=lrc",
        validator=val_1_3
    ))

    # 1.4 Sync JSON format
    def val_1_4(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parsing failed: {e}"]
        checks = []
        lyrics = data.get("lyrics") or data.get("syncedLyrics") or data.get("lines") or data.get("data", {}).get("syncedLyrics")
        has_lyrics = isinstance(lyrics, list) and len(lyrics) > 0
        checks.append(f"JSON lyrics array check (Count: {len(lyrics) if isinstance(lyrics, list) else 0}) -> {has_lyrics}")
        return has_lyrics, checks

    results.append(test_endpoint(
        "1.4",
        "Sync Lyrics JSON Format (Shape of You - Ed Sheeran)",
        f"{base_url}/api/sonic/lyrics/sync?title=Shape%20of%20You&artist=Ed%20Sheeran&format=json",
        validator=val_1_4
    ))

    # 1.5 Chinese word-level tracks: 海阔天空
    def val_1_5(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parsing failed: {e}"]
        checks = []
        brand = data.get("brand")
        brand_ok = (brand == "Sonic")
        checks.append(f"Brand check: '{brand}' (Expected: 'Sonic') -> {brand_ok}")
        synced = data.get("data", {}).get("syncedLyrics", [])
        count = len(synced)
        checks.append(f"syncedLyrics count: {count} -> {count > 0}")
        level = data.get("data", {}).get("level")
        checks.append(f"Level: {level}")
        return brand_ok and (count > 0), checks

    results.append(test_endpoint(
        "1.5",
        "Chinese Track (海阔天空 - Beyond)",
        f"{base_url}/api/sonic/lyrics/nexus?title=%E6%B5%B7%E9%98%94%E5%A4%A9%E7%A9%BA&artist=Beyond",
        validator=val_1_5
    ))

    # 1.6 Chinese word-level tracks: 晴天
    def val_1_6(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parsing failed: {e}"]
        checks = []
        brand = data.get("brand")
        brand_ok = (brand == "Sonic")
        checks.append(f"Brand check: '{brand}' (Expected: 'Sonic') -> {brand_ok}")
        synced = data.get("data", {}).get("syncedLyrics", [])
        count = len(synced)
        checks.append(f"syncedLyrics count: {count} -> {count > 0}")
        level = data.get("data", {}).get("level")
        checks.append(f"Level: {level}")
        return brand_ok and (count > 0), checks

    results.append(test_endpoint(
        "1.6",
        "Chinese Track (晴天 - 周杰伦)",
        f"{base_url}/api/sonic/lyrics/nexus?title=%E6%99%B4%E5%A4%A9&artist=%E5%91%A8%E6%9D%B0%E4%BC%A6",
        validator=val_1_6
    ))

    # 1.7 Instrumental track: River Flows in You - Yiruma
    def val_1_7(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parsing failed: {e}"]
        checks = []
        brand = data.get("brand")
        brand_ok = (brand == "Sonic")
        checks.append(f"Brand check: '{brand}' (Expected: 'Sonic') -> {brand_ok}")
        
        inner = data.get("data", {})
        instrumental = inner.get("instrumental")
        inst_ok = (instrumental is True)
        checks.append(f"Instrumental flag: {instrumental} (Expected: True) -> {inst_ok}")
        
        level = inner.get("level")
        level_ok = (level == "none")
        checks.append(f"Level: '{level}' (Expected: 'none') -> {level_ok}")
        
        synced = inner.get("syncedLyrics")
        synced_empty = (synced == [])
        checks.append(f"syncedLyrics is empty array: {synced_empty} ({synced}) -> {synced_empty}")
        
        return brand_ok and inst_ok and level_ok and synced_empty, checks

    results.append(test_endpoint(
        "1.7",
        "Instrumental Track (River Flows in You - Yiruma)",
        f"{base_url}/api/sonic/lyrics/nexus?title=River%20Flows%20in%20You&artist=Yiruma",
        validator=val_1_7
    ))

    # 2.1 Sudden Outage & Fallback: Primary upstream bogus ID
    def val_2_1(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parsing failed: {e}"]
        checks = []
        brand = data.get("brand")
        brand_ok = (brand == "Sonic")
        checks.append(f"Brand check: '{brand}' (Expected: 'Sonic') -> {brand_ok}")
        
        inner = data.get("data", {})
        synced = inner.get("syncedLyrics", [])
        count = len(synced)
        synced_ok = (count > 0)
        checks.append(f"Fallback recovered syncedLyrics count: {count} -> {synced_ok}")
        
        meta = data.get("meta", {})
        resolved_provider = meta.get("provider") or inner.get("provider")
        checks.append(f"Resolved fallback provider: '{resolved_provider}'")
        
        return brand_ok and synced_ok, checks

    results.append(test_endpoint(
        "2.1",
        "Fallback Degradation (Bogus Upstream ID: 99999999999999999999)",
        f"{base_url}/api/sonic/lyrics/nexus?title=%E6%99%B4%E5%A4%A9&artist=%E5%91%A8%E6%9D%B0%E4%BC%A6&platform=netease&platformId=99999999999999999999",
        validator=val_2_1
    ))

    # 2.2 Gibberish track: No crash, level: 'none', syncedLyrics: []
    def val_2_2(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parsing failed: {e}"]
        checks = []
        brand = data.get("brand")
        brand_ok = (brand == "Sonic")
        checks.append(f"Brand check: '{brand}' (Expected: 'Sonic') -> {brand_ok}")
        
        inner = data.get("data", {})
        level = inner.get("level")
        level_ok = (level == "none")
        checks.append(f"Level: '{level}' (Expected: 'none') -> {level_ok}")
        
        synced = inner.get("syncedLyrics")
        synced_empty = (synced == [])
        checks.append(f"syncedLyrics is empty array: {synced_empty} -> {synced_empty}")
        
        return brand_ok and level_ok and synced_empty, checks

    results.append(test_endpoint(
        "2.2",
        "Gibberish Track Graceful Degradation (No crash)",
        f"{base_url}/api/sonic/lyrics/nexus?title=qx7z_unfindable_string_9182371928",
        validator=val_2_2
    ))

    # 2.3 Aggregation Forwarding: LRC
    def val_2_3(resp):
        ct = resp.headers.get("content-type", "")
        body = resp.text
        checks = []
        import re
        has_ts = bool(re.search(r"\[\d{2}:\d{2}\.\d{2,3}\]", body))
        checks.append(f"Content-type: '{ct}', has [mm:ss.xx] timestamp: {has_ts} (Length: {len(body)})")
        return (resp.status_code == 200) and has_ts, checks

    results.append(test_endpoint(
        "2.3",
        "Aggregation Forwarding (LRC format - 海阔天空 Beyond)",
        f"{base_url}/api/sonic/forward?title=%E6%B5%B7%E9%98%94%E5%A4%A9%E7%A9%BA&artist=Beyond&format=lrc",
        validator=val_2_3
    ))

    # 2.4 Aggregation Forwarding: Search
    def val_2_4(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parsing failed: {e}"]
        checks = []
        tracks = data.get("tracks") or data.get("data", {}).get("tracks") or data.get("data")
        count = len(tracks) if isinstance(tracks, list) else 0
        checks.append(f"Search results track count: {count} (Expected: >0) -> {count > 0}")
        return (resp.status_code == 200) and (count > 0), checks

    results.append(test_endpoint(
        "2.4",
        "Aggregation Forwarding (Search - 周杰伦 count=3)",
        f"{base_url}/api/sonic/forward?type=search&q=%E5%91%A8%E6%9D%B0%E4%BC%A6&count=3",
        validator=val_2_4
    ))

    # 2.5 CORS Header Check on OPTIONS
    def val_2_5(resp):
        checks = []
        allow_origin = resp.headers.get("Access-Control-Allow-Origin")
        origin_ok = bool(allow_origin)
        checks.append(f"Access-Control-Allow-Origin: '{allow_origin}' -> {origin_ok}")
        allow_methods = resp.headers.get("Access-Control-Allow-Methods")
        checks.append(f"Access-Control-Allow-Methods: '{allow_methods}'")
        return origin_ok, checks

    results.append(test_endpoint(
        "2.5",
        "Aggregation Forwarding (OPTIONS CORS check)",
        f"{base_url}/api/sonic/forward",
        method="OPTIONS",
        expected_status=(200, 204),
        validator=val_2_5
    ))

    # Summary
    passed_count = sum(1 for r in results if r["passed"])
    total_count = len(results)
    print(f"\n{'='*75}\n### SUMMARY FOR {base_url}: {passed_count}/{total_count} PASSED\n{'='*75}")
    return results

if __name__ == "__main__":
    targets = ["https://sonic.epocanvas.com", "https://cfsolara-dho.pages.dev"]
    summary = {}
    for target in targets:
        summary[target] = run_part1_suite(target)
    
    artifact_dir = "/root/.gemini/antigravity-cli/brain/ceaeb05d-2ca0-4ff9-b70e-81d90f9b4313"
    os.makedirs(artifact_dir, exist_ok=True)
    out_file = os.path.join(artifact_dir, "part1_api_audit_results.json")
    with open(out_file, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\nSuccessfully wrote Part 1 audit report to {out_file}")
