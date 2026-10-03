#!/usr/bin/env python3
import json
import sys
import requests

def test_endpoint(name, url, method="GET", expected_status=200, headers=None, validator=None):
    print(f"\n{'='*70}\n[TEST] {name}\nURL: {url} ({method})")
    try:
        if method == "OPTIONS":
            resp = requests.options(url, headers=headers or {}, timeout=15)
        else:
            sep = "&" if "?" in url else "?"
            import time
            bust_url = f"{url}{sep}_bust={int(time.time()*1000)}"
            resp = requests.get(bust_url, headers=headers or {}, timeout=15)
        
        if isinstance(expected_status, (list, tuple)):
            status_ok = resp.status_code in expected_status
        else:
            status_ok = (resp.status_code == expected_status)
        print(f"Status: {resp.status_code} (Expected: {expected_status}) -> {'PASS' if status_ok else 'FAIL'}")
        
        v_passed = True
        v_details = []
        if validator:
            v_passed, v_details = validator(resp)
            for v in v_details:
                print(f"  - {v}")
        
        overall = status_ok and v_passed
        print(f"Result: {'PASS' if overall else 'FAIL'}")
        return {
            "name": name,
            "url": url,
            "method": method,
            "status": resp.status_code,
            "passed": overall,
            "details": v_details
        }
    except Exception as e:
        print(f"EXCEPTION: {e}")
        return {
            "name": name,
            "url": url,
            "method": method,
            "status": "ERROR",
            "passed": False,
            "details": [str(e)]
        }

def run_suite(base_url):
    print(f"\n>>> RUNNING AUDIT SUITE AGAINST: {base_url} <<<")
    results = []

    # 1.1 Nexus Shape of You (Lyriva word-level)
    def val_nexus_shape_of_you(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parse error: {e}"]
        
        checks = []
        brand = data.get("brand")
        checks.append(f"brand is '{brand}' (expected: 'Sonic') -> {brand == 'Sonic'}")
        
        meta = data.get("meta", {})
        provider = meta.get("provider") or data.get("data", {}).get("provider")
        checks.append(f"meta.provider is '{provider}' (expected: 'lyriva') -> {provider == 'lyriva'}")
        
        inner_data = data.get("data", {})
        level = inner_data.get("level")
        checks.append(f"level is '{level}' (expected: 'word') -> {level == 'word'}")
        
        synced = inner_data.get("syncedLyrics", [])
        has_lines = len(synced) > 0
        checks.append(f"syncedLyrics count: {len(synced)} -> {has_lines}")
        
        timestamp_ok = False
        if has_lines:
            l0 = synced[0]
            words = l0.get("words", [])
            w0 = words[0] if len(words) > 0 else {}
            
            # Check timestamps on line0 and word0
            # start, startSec, end, endSec, duration, durationSec
            l0_keys = ["start", "startSec", "end", "endSec", "duration", "durationSec"]
            w0_keys = ["start", "startSec", "end", "endSec", "duration", "durationSec"]
            
            l0_has = all(k in l0 for k in l0_keys)
            w0_has = all(k in w0 for k in w0_keys) if words else False
            checks.append(f"Line 0 timestamps: { {k: l0.get(k) for k in l0_keys} } -> {l0_has}")
            checks.append(f"Word 0 timestamps: { {k: w0.get(k) for k in w0_keys} } -> {w0_has}")
            timestamp_ok = l0_has and w0_has
        
        all_ok = (brand == 'Sonic') and (provider == 'lyriva') and (level == 'word') and has_lines and timestamp_ok
        return all_ok, checks

    results.append(test_endpoint(
        "1.1 Nexus Shape of You (Lyriva word-level)",
        f"{base_url}/api/sonic/lyrics/nexus?title=Shape%20of%20You&artist=Ed%20Sheeran",
        validator=val_nexus_shape_of_you
    ))

    # 1.2 Lyriva Endpoint directly
    def val_lyriva(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parse error: {e}"]
        checks = []
        brand = data.get("brand")
        checks.append(f"brand is '{brand}' (expected: 'Sonic') -> {brand == 'Sonic'}")
        provider = data.get("provider") or data.get("meta", {}).get("provider")
        checks.append(f"provider is '{provider}' (expected: 'lyriva') -> {provider == 'lyriva'}")
        synced = data.get("syncedLyrics") or data.get("data", {}).get("syncedLyrics", [])
        has_synced = len(synced) > 0
        checks.append(f"syncedLyrics length: {len(synced)} -> {has_synced}")
        return (brand == 'Sonic') and (provider == 'lyriva') and has_synced, checks

    results.append(test_endpoint(
        "1.2 Lyriva Endpoint Shape of You",
        f"{base_url}/api/sonic/lyrics/lyriva?title=Shape%20of%20You&artist=Ed%20Sheeran",
        validator=val_lyriva
    ))

    # 1.3 Sync LRC format
    def val_sync_lrc(resp):
        ct = resp.headers.get("content-type", "")
        body = resp.text
        checks = []
        is_text = "text/plain" in ct or "text/" in ct
        checks.append(f"Content-Type: '{ct}' (expected text/plain) -> {is_text}")
        import re
        has_ts = bool(re.search(r"\[\d{2}:\d{2}\.\d{2,3}\]", body))
        checks.append(f"Has [mm:ss.xx] timestamps in body (len {len(body)}) -> {has_ts}")
        return is_text and has_ts, checks

    results.append(test_endpoint(
        "1.3 Sync Lyrics (LRC format)",
        f"{base_url}/api/sonic/lyrics/sync?title=Shape%20of%20You&artist=Ed%20Sheeran&format=lrc",
        validator=val_sync_lrc
    ))

    # 1.4 Sync JSON format
    def val_sync_json(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parse error: {e}"]
        checks = []
        # should have lyrics array or syncedLyrics
        lyrics = data.get("lyrics") or data.get("syncedLyrics") or data.get("lines") or (data.get("data", {}).get("syncedLyrics"))
        has_lyrics = isinstance(lyrics, list) and len(lyrics) > 0
        checks.append(f"Found lyrics array with count {len(lyrics) if isinstance(lyrics, list) else 'N/A'} -> {has_lyrics}")
        return has_lyrics, checks

    results.append(test_endpoint(
        "1.4 Sync Lyrics (JSON format)",
        f"{base_url}/api/sonic/lyrics/sync?title=Shape%20of%20You&artist=Ed%20Sheeran&format=json",
        validator=val_sync_json
    ))

    # 1.5 Chinese tracks: 海阔天空
    def val_nexus_chinese(title):
        def _val(resp):
            try:
                data = resp.json()
            except Exception as e:
                return False, [f"JSON parse error: {e}"]
            checks = []
            brand = data.get("brand")
            checks.append(f"brand is '{brand}' (expected: 'Sonic') -> {brand == 'Sonic'}")
            synced = data.get("data", {}).get("syncedLyrics", [])
            count = len(synced)
            checks.append(f"syncedLyrics count: {count} -> {count > 0}")
            level = data.get("data", {}).get("level")
            checks.append(f"level: {level}")
            return (brand == 'Sonic') and (count > 0), checks
        return _val

    results.append(test_endpoint(
        "1.5 Chinese Track (海阔天空 - Beyond)",
        f"{base_url}/api/sonic/lyrics/nexus?title=%E6%B5%B7%E9%98%94%E5%A4%A9%E7%A9%BA&artist=Beyond",
        validator=val_nexus_chinese("海阔天空")
    ))

    results.append(test_endpoint(
        "1.6 Chinese Track (晴天 - 周杰伦)",
        f"{base_url}/api/sonic/lyrics/nexus?title=%E6%99%B4%E5%A4%A9&artist=%E5%91%A8%E6%9D%B0%E4%BC%A6",
        validator=val_nexus_chinese("晴天")
    ))

    # 1.7 Instrumental: River Flows in You - Yiruma
    def val_instrumental(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parse error: {e}"]
        checks = []
        brand = data.get("brand")
        checks.append(f"brand is '{brand}' (expected: 'Sonic') -> {brand == 'Sonic'}")
        inner = data.get("data", {})
        instrumental = inner.get("instrumental")
        checks.append(f"instrumental: {instrumental} (expected True) -> {instrumental is True}")
        level = inner.get("level")
        checks.append(f"level: '{level}' (expected 'none') -> {level == 'none'}")
        synced = inner.get("syncedLyrics", None)
        checks.append(f"syncedLyrics is empty list: {synced == []} ({synced}) -> {synced == []}")
        return (brand == 'Sonic') and (instrumental is True) and (level == 'none') and (synced == []), checks

    results.append(test_endpoint(
        "1.7 Instrumental (River Flows in You - Yiruma)",
        f"{base_url}/api/sonic/lyrics/nexus?title=River%20Flows%20in%20You&artist=Yiruma",
        validator=val_instrumental
    ))

    # 2.1 Sudden Outage & Fallback: Primary bogus ID
    def val_fallback_bogus_id(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parse error: {e}"]
        checks = []
        brand = data.get("brand")
        checks.append(f"brand is '{brand}' (expected: 'Sonic') -> {brand == 'Sonic'}")
        inner = data.get("data", {})
        synced = inner.get("syncedLyrics", [])
        checks.append(f"Fallback recovered syncedLyrics count: {len(synced)} -> {len(synced) > 0}")
        meta = data.get("meta", {})
        checks.append(f"Provider resolved: {meta.get('provider') or inner.get('provider')}")
        return (resp.status_code == 200) and (brand == 'Sonic') and (len(synced) > 0), checks

    results.append(test_endpoint(
        "2.1 Fallback Recovery (Bogus Upstream ID: 99999999999999999999)",
        f"{base_url}/api/sonic/lyrics/nexus?title=%E6%99%B4%E5%A4%A9&artist=%E5%91%A8%E6%9D%B0%E4%BC%A6&platform=netease&platformId=99999999999999999999",
        validator=val_fallback_bogus_id
    ))

    # 2.2 Gibberish track: No crash, level: 'none', syncedLyrics: []
    def val_gibberish(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parse error: {e}"]
        checks = []
        brand = data.get("brand")
        checks.append(f"brand is '{brand}' (expected: 'Sonic') -> {brand == 'Sonic'}")
        inner = data.get("data", {})
        level = inner.get("level")
        checks.append(f"level: '{level}' (expected 'none') -> {level == 'none'}")
        synced = inner.get("syncedLyrics")
        checks.append(f"syncedLyrics is empty list: {synced == []} -> {synced == []}")
        return (resp.status_code == 200) and (level == 'none') and (synced == []), checks

    results.append(test_endpoint(
        "2.2 Gibberish Track Graceful Degradation",
        f"{base_url}/api/sonic/lyrics/nexus?title=qx7z_unfindable_string_9182371928",
        validator=val_gibberish
    ))

    # 2.3 Aggregation Forwarding: LRC
    def val_fwd_lrc(resp):
        ct = resp.headers.get("content-type", "")
        body = resp.text
        checks = []
        import re
        has_ts = bool(re.search(r"\[\d{2}:\d{2}\.\d{2,3}\]", body))
        checks.append(f"Content-type: {ct}, has [mm:ss.xx] timestamp: {has_ts}")
        return resp.status_code == 200 and has_ts, checks

    results.append(test_endpoint(
        "2.3 Aggregation Forwarding (LRC format)",
        f"{base_url}/api/sonic/forward?title=%E6%B5%B7%E9%98%94%E5%A4%A9%E7%A9%BA&artist=Beyond&format=lrc",
        validator=val_fwd_lrc
    ))

    # 2.4 Aggregation Forwarding: Search
    def val_fwd_search(resp):
        try:
            data = resp.json()
        except Exception as e:
            return False, [f"JSON parse error: {e}"]
        checks = []
        tracks = data.get("tracks") or data.get("data", {}).get("tracks") or data.get("data")
        count = len(tracks) if isinstance(tracks, list) else 0
        checks.append(f"Search results track count: {count} -> {count > 0}")
        return resp.status_code == 200 and count > 0, checks

    results.append(test_endpoint(
        "2.4 Aggregation Forwarding (Search Zhou Jielun)",
        f"{base_url}/api/sonic/forward?type=search&q=%E5%91%A8%E6%9D%B0%E4%BC%A6&count=3",
        validator=val_fwd_search
    ))

    # 2.5 CORS Header Check on OPTIONS
    def val_cors(resp):
        checks = []
        allow_origin = resp.headers.get("Access-Control-Allow-Origin")
        checks.append(f"Access-Control-Allow-Origin: {allow_origin} -> {bool(allow_origin)}")
        allow_methods = resp.headers.get("Access-Control-Allow-Methods")
        checks.append(f"Access-Control-Allow-Methods: {allow_methods}")
        return bool(allow_origin), checks

    results.append(test_endpoint(
        "2.5 Aggregation Forwarding (OPTIONS CORS check)",
        f"{base_url}/api/sonic/forward",
        method="OPTIONS",
        expected_status=(200, 204),
        validator=val_cors
    ))

    # Summary
    passed_count = sum(1 for r in results if r["passed"])
    total_count = len(results)
    print(f"\n================ SUMMARY FOR {base_url} ================")
    print(f"Passed: {passed_count}/{total_count}")
    return results

if __name__ == "__main__":
    targets = ["https://sonic.epocanvas.com", "https://cfsolara-dho.pages.dev"]
    all_summary = {}
    for t in targets:
        all_summary[t] = run_suite(t)
    
    with open("/root/.gemini/antigravity-cli/brain/344f44db-d511-415c-a72d-b7f4ab2b6ebc/part1_results.json", "w") as f:
        json.dump(all_summary, f, indent=2)
    print("\nSaved PART 1 results to brain directory.")
