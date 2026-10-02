#!/usr/bin/env python3
"""
Comprehensive QA & Security Audit Suite for Sonic Multi-Source Aggregation Gateway
Target Public Domain: https://cfsolara-dho.pages.dev

This automated audit performs black-box testing against the deployed Cloudflare Pages
environment, testing all lyrics endpoints, search endpoints, fallback/outage robustness,
parameter validations, caching behaviors, and frontend asset wiring.
"""

import sys
import time
import json
import traceback
from typing import Dict, Any, List, Optional
import requests

TARGET_BASE_URL = "https://cfsolara-dho.pages.dev"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (Sonic-Auditor/1.0)"

session = requests.Session()
session.headers.update({"User-Agent": USER_AGENT})

class TestResult:
    def __init__(self, test_id: str, name: str, category: str):
        self.test_id = test_id
        self.name = name
        self.category = category
        self.url = ""
        self.status_code = 0
        self.latency_ms = 0.0
        self.server_latency_ms: Optional[float] = None
        self.passed = False
        self.errors: List[str] = []
        self.details: Dict[str, Any] = {}
        self.headers: Dict[str, str] = {}

    def fail(self, msg: str):
        self.errors.append(msg)
        self.passed = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.test_id,
            "category": self.category,
            "name": self.name,
            "url": self.url,
            "status_code": self.status_code,
            "client_latency_ms": round(self.latency_ms, 2),
            "server_latency_ms": self.server_latency_ms,
            "passed": self.passed,
            "errors": self.errors,
            "details": self.details,
        }

results: List[TestResult] = []

def run_http_test(
    test_id: str,
    name: str,
    category: str,
    path: str,
    expected_status: int = 200,
    check_fn=None,
    method: str = "GET",
) -> TestResult:
    tr = TestResult(test_id, name, category)
    url = f"{TARGET_BASE_URL}{path}"
    tr.url = url
    
    start = time.perf_counter()
    try:
        if method == "GET":
            resp = session.get(url, timeout=30)
        else:
            resp = session.request(method, url, timeout=30)
        tr.latency_ms = (time.perf_counter() - start) * 1000.0
        tr.status_code = resp.status_code
        tr.headers = dict(resp.headers)
        
        # Check status code
        if resp.status_code != expected_status:
            tr.fail(f"Expected HTTP status {expected_status}, got {resp.status_code}")
        
        # Check JSON payload if applicable
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            try:
                body = resp.json()
                tr.details["body"] = body
                if isinstance(body, dict):
                    server_meta = body.get("meta", {})
                    if "latencyMs" in server_meta:
                        tr.server_latency_ms = server_meta["latencyMs"]
            except Exception as e:
                tr.fail(f"Failed to parse JSON response: {e}")
                body = resp.text[:500]
        else:
            body = resp.text
            tr.details["text_snippet"] = body[:500]

        # Custom assertions
        if check_fn:
            try:
                check_fn(resp, body, tr)
            except Exception as e:
                tr.fail(f"Assertion exception: {e}\n{traceback.format_exc()}")

        if not tr.errors and tr.status_code == expected_status:
            tr.passed = True

    except Exception as e:
        tr.latency_ms = (time.perf_counter() - start) * 1000.0
        tr.fail(f"Request failed with exception: {str(e)}")

    results.append(tr)
    status_icon = "✅ PASS" if tr.passed else "❌ FAIL"
    print(f"[{status_icon}] {tr.test_id}: {tr.name}")
    print(f"       URL: {tr.url}")
    print(f"       HTTP: {tr.status_code} | Latency: {tr.latency_ms:.1f}ms (Client) / {tr.server_latency_ms or 'N/A'}ms (Server)")
    if tr.errors:
        for err in tr.errors:
            print(f"       ⚠️  {err}")
    print()
    return tr

# ==============================================================================
# AUDIT TEST SUITE
# ==============================================================================

def execute_audit():
    print("=" * 80)
    print("SONIC MULTI-SOURCE GATEWAY BLACK-BOX AUDIT & PENETRATION TEST")
    print(f"Target: {TARGET_BASE_URL}")
    print(f"Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")
    print("=" * 80)
    print()

    # --------------------------------------------------------------------------
    # CATEGORY 1: ALL PUBLIC LYRICS ENDPOINTS
    # --------------------------------------------------------------------------
    print("\n--- 1. PUBLIC LYRICS ENDPOINTS ---")

    # 1.1 GET /api/sonic/lyrics/nexus?title=年少有为&artist=李荣浩&platform=netease&platformId=1293886117
    def check_1_1(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not a JSON object")
            return
        if body.get("brand") != "Sonic":
            tr.fail(f"Expected brand 'Sonic', got '{body.get('brand')}'")
        data = body.get("data", {})
        if data.get("level") != "word":
            tr.fail(f"Expected data.level 'word', got '{data.get('level')}'")
        meta = body.get("meta", {})
        attempts = meta.get("attempts", [])
        if not isinstance(attempts, list) or len(attempts) == 0:
            tr.fail("meta.attempts missing or empty")
        else:
            has_provider = any("provider" in a and "ms" in a for a in attempts)
            if not has_provider:
                tr.fail("meta.attempts does not contain provider attempt with latency")
        if not isinstance(meta.get("latencyMs"), (int, float)):
            tr.fail("meta.latencyMs is not a valid number")

    run_http_test(
        "LYR-01",
        "Nexus Lyrics (NetEase ID + Word-level YRC)",
        "Lyrics Endpoints",
        "/api/sonic/lyrics/nexus?title=年少有为&artist=李荣浩&platform=netease&platformId=1293886117",
        expected_status=200,
        check_fn=check_1_1,
    )

    # 1.2 GET /api/sonic/lyrics/nexus?title=Shape%20of%20You&artist=Ed%20Sheeran
    def check_1_2(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not a JSON object")
            return
        if body.get("brand") != "Sonic":
            tr.fail(f"Expected brand 'Sonic', got '{body.get('brand')}'")
        data = body.get("data", {})
        level = data.get("level")
        if level != "word":
            tr.fail(f"Expected data.level 'word', got '{level}'")
        quality = data.get("sourceQuality")
        if quality not in ("real", "interpolated"):
            tr.fail(f"Expected sourceQuality 'real' or 'interpolated', got '{quality}'")
        synced = data.get("syncedLyrics", [])
        if not isinstance(synced, list) or len(synced) == 0:
            tr.fail("syncedLyrics is empty or missing")
        else:
            empty_words_count = 0
            for i, line in enumerate(synced):
                words = line.get("words", [])
                if not isinstance(words, list) or len(words) == 0:
                    empty_words_count += 1
            if empty_words_count > 0:
                tr.fail(f"{empty_words_count} of {len(synced)} lines in syncedLyrics have empty words[]")
            tr.details["line_count"] = len(synced)
            tr.details["source_quality"] = quality

    run_http_test(
        "LYR-02",
        "Nexus Lyrics Title/Artist Only (Shape of You word population check)",
        "Lyrics Endpoints",
        "/api/sonic/lyrics/nexus?title=Shape%20of%20You&artist=Ed%20Sheeran",
        expected_status=200,
        check_fn=check_1_2,
    )

    # 1.3 GET /api/sonic/lyrics/nexus?title=River%20Flows%20in%20You&artist=Yiruma
    def check_1_3(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not a JSON object")
            return
        if body.get("brand") != "Sonic":
            tr.fail(f"Expected brand 'Sonic', got '{body.get('brand')}'")
        data = body.get("data", {})
        if data.get("instrumental") is not True:
            tr.fail(f"Expected data.instrumental is True, got '{data.get('instrumental')}'")
        if data.get("level") != "none":
            tr.fail(f"Expected data.level 'none', got '{data.get('level')}'")
        synced = data.get("syncedLyrics", [])
        if len(synced) != 0:
            tr.fail(f"Expected syncedLyrics to be empty, got {len(synced)} lines")

    run_http_test(
        "LYR-03",
        "Nexus Lyrics Instrumental Song (River Flows in You)",
        "Lyrics Endpoints",
        "/api/sonic/lyrics/nexus?title=River%20Flows%20in%20You&artist=Yiruma",
        expected_status=200,
        check_fn=check_1_3,
    )

    # 1.4 Single source lyrics endpoints
    # 1.4.1 NetEase
    def check_brand_sonic(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not JSON")
            return
        if body.get("brand") != "Sonic":
            tr.fail(f"Expected brand 'Sonic', got '{body.get('brand')}'")

    run_http_test(
        "LYR-04",
        "Single Source NetEase Lyrics",
        "Lyrics Endpoints",
        "/api/sonic/lyrics/netease?title=年少有为&platformId=1293886117",
        expected_status=200,
        check_fn=check_brand_sonic,
    )

    # 1.4.2 QQ Music
    run_http_test(
        "LYR-05",
        "Single Source QQ Lyrics",
        "Lyrics Endpoints",
        "/api/sonic/lyrics/qq?title=晴天&platformId=0039MnYb0qxYhV",
        expected_status=200,
        check_fn=check_brand_sonic,
    )

    # 1.4.3 Kugou
    run_http_test(
        "LYR-06",
        "Single Source Kugou Lyrics",
        "Lyrics Endpoints",
        "/api/sonic/lyrics/kugou?title=海阔天空",
        expected_status=200,
        check_fn=check_brand_sonic,
    )

    # 1.4.4 AMLL
    run_http_test(
        "LYR-07",
        "Single Source AMLL Lyrics",
        "Lyrics Endpoints",
        "/api/sonic/lyrics/amll?ncmMusicId=1293886117",
        expected_status=200,
        check_fn=check_brand_sonic,
    )

    # 1.4.5 LRCLIB
    run_http_test(
        "LYR-08",
        "Single Source LRCLIB Lyrics",
        "Lyrics Endpoints",
        "/api/sonic/lyrics/lrclib?title=Shape%20of%20You&artist=Ed%20Sheeran",
        expected_status=200,
        check_fn=check_brand_sonic,
    )

    # 1.4.6 Apple Music (Disabled provider)
    def check_disabled_provider(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not JSON")
            return
        if body.get("brand") != "Sonic":
            tr.fail(f"Expected brand 'Sonic', got '{body.get('brand')}'")
        err = body.get("error", {})
        if err.get("code") != "PROVIDER_DISABLED":
            tr.fail(f"Expected error.code 'PROVIDER_DISABLED', got '{err.get('code')}'")

    run_http_test(
        "LYR-09",
        "Apple Music Disabled Lyrics Endpoint (501 Expected)",
        "Lyrics Endpoints",
        "/api/sonic/lyrics/apple?title=Hello",
        expected_status=501,
        check_fn=check_disabled_provider,
    )

    # 1.4.7 YouTube Music (Disabled provider)
    run_http_test(
        "LYR-10",
        "YouTube Music Disabled Lyrics Endpoint (501 Expected)",
        "Lyrics Endpoints",
        "/api/sonic/lyrics/ytmusic?title=Hello",
        expected_status=501,
        check_fn=check_disabled_provider,
    )

    # 1.5 Backward Compatibility Endpoint
    run_http_test(
        "LYR-11",
        "Backward Compatible /api/sonic/lyrics Endpoint",
        "Lyrics Endpoints",
        "/api/sonic/lyrics?title=年少有为&platformId=1293886117",
        expected_status=200,
        check_fn=check_brand_sonic,
    )

    # --------------------------------------------------------------------------
    # CATEGORY 2: ALL PUBLIC SEARCH ENDPOINTS
    # --------------------------------------------------------------------------
    print("\n--- 2. PUBLIC SEARCH ENDPOINTS ---")

    # 2.1 GET /api/sonic/search/nexus?q=海阔天空&count=5
    def check_2_1(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not JSON")
            return
        if body.get("brand") != "Sonic":
            tr.fail(f"Expected brand 'Sonic', got '{body.get('brand')}'")
        data = body.get("data", {})
        tracks = data.get("tracks", [])
        if not isinstance(tracks, list) or len(tracks) == 0:
            tr.fail(f"Expected tracks array > 0, got {len(tracks)}")
            return
        # Verify unified Track schema
        t = tracks[0]
        required_fields = ["title", "artist", "album", "duration", "cover", "platform", "platformId", "sources"]
        missing = [f for f in required_fields if f not in t]
        if missing:
            tr.fail(f"Track schema missing required fields: {missing}")
        if not isinstance(t.get("sources"), list):
            tr.fail("Track 'sources' is not a list")
        meta = body.get("meta", {})
        attempts = meta.get("attempts", [])
        if not isinstance(attempts, list) or len(attempts) == 0:
            tr.fail("meta.attempts missing or empty")
        tr.details["tracks_count"] = len(tracks)
        tr.details["sample_track"] = {
            "title": t.get("title"),
            "artist": t.get("artist"),
            "platform": t.get("platform"),
            "platformId": t.get("platformId"),
            "sources_count": len(t.get("sources", [])),
        }

    run_http_test(
        "SRC-01",
        "Nexus Search (Parallel Multi-source Aggregation)",
        "Search Endpoints",
        "/api/sonic/search/nexus?q=海阔天空&count=5",
        expected_status=200,
        check_fn=check_2_1,
    )

    # 2.2 Single source search endpoints
    def check_search_tracks(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not JSON")
            return
        if body.get("brand") != "Sonic":
            tr.fail(f"Expected brand 'Sonic', got '{body.get('brand')}'")
        data = body.get("data", {})
        tracks = data.get("tracks", [])
        if not isinstance(tracks, list) or len(tracks) == 0:
            tr.fail(f"Expected tracks > 0, got {len(tracks)}")
        tr.details["tracks_count"] = len(tracks)

    # 2.2.1 NetEase
    run_http_test(
        "SRC-02",
        "Single Source Search (NetEase)",
        "Search Endpoints",
        "/api/sonic/search/netease?q=海阔天空&count=3",
        expected_status=200,
        check_fn=check_search_tracks,
    )

    # 2.2.2 QQ Music
    run_http_test(
        "SRC-03",
        "Single Source Search (QQ Music)",
        "Search Endpoints",
        "/api/sonic/search/qq?q=晴天&count=3",
        expected_status=200,
        check_fn=check_search_tracks,
    )

    # 2.2.3 Kugou
    run_http_test(
        "SRC-04",
        "Single Source Search (Kugou)",
        "Search Endpoints",
        "/api/sonic/search/kugou?q=海阔天空&count=3",
        expected_status=200,
        check_fn=check_search_tracks,
    )

    # 2.2.4 GDStudio
    run_http_test(
        "SRC-05",
        "Single Source Search (GDStudio)",
        "Search Endpoints",
        "/api/sonic/search/gdstudio?q=海阔天空&count=3",
        expected_status=200,
        check_fn=check_search_tracks,
    )

    # 2.2.5 Kuwo (Must NOT return 404)
    def check_kuwo_no_404(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not JSON")
            return
        if body.get("brand") != "Sonic":
            tr.fail(f"Expected brand 'Sonic', got '{body.get('brand')}'")
        # Status code is already verified as 200, so NOT 404.

    run_http_test(
        "SRC-06",
        "Single Source Search (Kuwo - Registered Dynamic Provider)",
        "Search Endpoints",
        "/api/sonic/search/kuwo?q=海阔天空&count=3",
        expected_status=200,
        check_fn=check_kuwo_no_404,
    )

    # 2.3 Backward compatibility search
    run_http_test(
        "SRC-07",
        "Backward Compatible /api/sonic/search Endpoint",
        "Search Endpoints",
        "/api/sonic/search?q=海阔天空&count=3",
        expected_status=200,
        check_fn=check_search_tracks,
    )

    # --------------------------------------------------------------------------
    # CATEGORY 3: EMERGENCY & OUTAGE SIMULATION (FALLBACK ROBUSTNESS)
    # --------------------------------------------------------------------------
    print("\n--- 3. EMERGENCY & OUTAGE SIMULATION ---")

    # 3.1 Outage 1: Primary upstream ID invalid/failing
    def check_outage_1(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not JSON")
            return
        if body.get("brand") != "Sonic":
            tr.fail(f"Expected brand 'Sonic', got '{body.get('brand')}'")
        data = body.get("data", {})
        synced = data.get("syncedLyrics", [])
        if not isinstance(synced, list) or len(synced) == 0:
            tr.fail("syncedLyrics has no lines; fallback failed to produce lyrics")
        meta = body.get("meta", {})
        attempts = meta.get("attempts", [])
        # Check that netease attempt failed and logged
        netease_attempt = next((a for a in attempts if a.get("provider") == "netease"), None)
        if not netease_attempt:
            tr.fail("meta.attempts did not log the netease attempt")
        elif netease_attempt.get("ok") is not False:
            tr.fail("Expected netease attempt ok=False due to invalid platformId")
        # Check that fallback provider succeeded
        successful_attempts = [a for a in attempts if a.get("ok") is True]
        if not successful_attempts:
            tr.fail("meta.attempts has no successful fallback provider logged")
        tr.details["fallback_provider"] = data.get("provider")
        tr.details["attempts"] = attempts

    run_http_test(
        "ROB-01",
        "Primary NetEase Outage Simulation (Invalid ID -> Fallback to Secondary)",
        "Fallback Robustness",
        "/api/sonic/lyrics/nexus?title=海阔天空&artist=Beyond&platform=netease&platformId=99999999999999999999",
        expected_status=200,
        check_fn=check_outage_1,
    )

    # 3.2 Outage 2: Primary QQ ID invalid/failing
    def check_outage_2(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not JSON")
            return
        if body.get("brand") != "Sonic":
            tr.fail(f"Expected brand 'Sonic', got '{body.get('brand')}'")
        data = body.get("data", {})
        synced = data.get("syncedLyrics", [])
        if not isinstance(synced, list) or len(synced) == 0:
            tr.fail("syncedLyrics has no lines; fallback failed to produce lyrics")
        meta = body.get("meta", {})
        attempts = meta.get("attempts", [])
        qq_attempt = next((a for a in attempts if a.get("provider") == "qq"), None)
        if not qq_attempt:
            tr.fail("meta.attempts did not log the qq attempt")
        elif qq_attempt.get("ok") is not False:
            tr.fail("Expected qq attempt ok=False due to invalid platformId")
        successful_attempts = [a for a in attempts if a.get("ok") is True]
        if not successful_attempts:
            tr.fail("meta.attempts has no successful fallback provider logged")
        tr.details["fallback_provider"] = data.get("provider")
        tr.details["attempts"] = attempts

    run_http_test(
        "ROB-02",
        "Primary QQ Outage Simulation (Invalid ID -> Fallback to Secondary)",
        "Fallback Robustness",
        "/api/sonic/lyrics/nexus?title=晴天&artist=周杰伦&platform=qq&platformId=invalid_mid_nonexistent_99999",
        expected_status=200,
        check_fn=check_outage_2,
    )

    # 3.3 Outage 3: Disabled external services
    run_http_test(
        "ROB-03",
        "Disabled External Service Isolation (/api/sonic/lyrics/apple)",
        "Fallback Robustness",
        "/api/sonic/lyrics/apple?title=Hello",
        expected_status=501,
        check_fn=check_disabled_provider,
    )

    # 3.4 Outage 4: Extreme / Non-existent gibberish query (preventing false-positive songs)
    def check_gibberish(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not JSON")
            return
        if body.get("brand") != "Sonic":
            tr.fail(f"Expected brand 'Sonic', got '{body.get('brand')}'")
        data = body.get("data", {})
        if data.get("level") != "none":
            tr.fail(f"Expected level 'none' for gibberish query, got '{data.get('level')}'")
        synced = data.get("syncedLyrics", [])
        if len(synced) != 0:
            tr.fail(f"False-positive song lyrics returned! Expected 0 lines, got {len(synced)}")

    run_http_test(
        "ROB-04",
        "False-Positive Prevention (Gibberish Query -> Empty Lyrics)",
        "Fallback Robustness",
        "/api/sonic/lyrics/nexus?title=qx7z_unfindable_string_9182371928",
        expected_status=200,
        check_fn=check_gibberish,
    )

    # 3.5 Outage 5: Missing required parameters
    # 3.5.1 GET /api/sonic/lyrics/nexus (no params) -> HTTP 400, MISSING_PARAMS
    def check_missing_lyrics_params(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not JSON")
            return
        if body.get("brand") != "Sonic":
            tr.fail(f"Expected brand 'Sonic', got '{body.get('brand')}'")
        err = body.get("error", {})
        if err.get("code") != "MISSING_PARAMS":
            tr.fail(f"Expected error.code 'MISSING_PARAMS', got '{err.get('code')}'")

    run_http_test(
        "ROB-05",
        "Input Validation: Missing Lyrics Params (HTTP 400 MISSING_PARAMS)",
        "Fallback Robustness",
        "/api/sonic/lyrics/nexus",
        expected_status=400,
        check_fn=check_missing_lyrics_params,
    )

    # 3.5.2 GET /api/sonic/search/nexus (no query) -> HTTP 400, MISSING_QUERY
    def check_missing_search_query(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not JSON")
            return
        if body.get("brand") != "Sonic":
            tr.fail(f"Expected brand 'Sonic', got '{body.get('brand')}'")
        err = body.get("error", {})
        if err.get("code") != "MISSING_QUERY":
            tr.fail(f"Expected error.code 'MISSING_QUERY', got '{err.get('code')}'")

    run_http_test(
        "ROB-06",
        "Input Validation: Missing Search Keyword (HTTP 400 MISSING_QUERY)",
        "Fallback Robustness",
        "/api/sonic/search/nexus",
        expected_status=400,
        check_fn=check_missing_search_query,
    )

    # 3.6 Outage 6: Cache hit verification under normal traffic
    print("Testing Cache Hit Verification (Dual Request Sequence)...")
    cache_path = "/api/sonic/lyrics/nexus?title=年少有为&artist=李荣浩&platform=netease&platformId=1293886117"
    
    # First request: populate cache
    r1 = session.get(f"{TARGET_BASE_URL}{cache_path}")
    time.sleep(0.5) # brief pause to let edge cache settle
    
    # Second request: verify cache hit
    def check_cache_hit(resp, body, tr):
        if not isinstance(body, dict):
            tr.fail("Response body is not JSON")
            return
        meta = body.get("meta", {})
        sonic_cache_header = resp.headers.get("X-Sonic-Cache", "")
        cf_cache_header = resp.headers.get("CF-Cache-Status", "")
        is_cached_meta = meta.get("cached") is True
        is_cached_header = sonic_cache_header == "HIT" or cf_cache_header == "HIT"

        tr.details["meta_cached"] = meta.get("cached")
        tr.details["x_sonic_cache"] = sonic_cache_header
        tr.details["cf_cache_status"] = cf_cache_header

        if not (is_cached_meta or is_cached_header):
            tr.fail(f"Expected cache hit! meta.cached={is_cached_meta}, X-Sonic-Cache='{sonic_cache_header}', CF-Cache-Status='{cf_cache_header}'")

    run_http_test(
        "ROB-07",
        "Cache Verification (Identical Dual Query -> Cache Hit)",
        "Fallback Robustness",
        cache_path,
        expected_status=200,
        check_fn=check_cache_hit,
    )

    # --------------------------------------------------------------------------
    # CATEGORY 4: PUBLIC FRONTEND ASSET VERIFICATION
    # --------------------------------------------------------------------------
    print("\n--- 4. PUBLIC FRONTEND ASSET VERIFICATION ---")

    def check_frontend_js(resp, body, tr):
        if not isinstance(body, str):
            tr.fail("Expected text response for frontend JS")
            return
        # Verify: contains 'nexus' in source options
        if '"nexus"' not in body and "'nexus'" not in body:
            tr.fail("Frontend JS does not contain 'nexus' in source options")
        # Verify uses /api/sonic/search/nexus
        if "/api/sonic/search/nexus" not in body:
            tr.fail("Frontend JS does not reference '/api/sonic/search/nexus'")
        # Verify uses /api/sonic/lyrics/nexus
        if "/api/sonic/lyrics/nexus" not in body:
            tr.fail("Frontend JS does not reference '/api/sonic/lyrics/nexus'")
        # Verify correctly passes platform and platformId
        if "platform" not in body or "platformId" not in body:
            tr.fail("Frontend JS does not pass 'platform' and 'platformId'")

        tr.details["js_size_bytes"] = len(body)
        tr.details["found_nexus_option"] = True
        tr.details["found_search_nexus_route"] = True
        tr.details["found_lyrics_nexus_route"] = True

    run_http_test(
        "FNT-01",
        "Frontend Assets Wiring (js/index.js routes & parameters)",
        "Frontend Assets",
        "/js/index.js",
        expected_status=200,
        check_fn=check_frontend_js,
    )

    # --------------------------------------------------------------------------
    # AUDIT SUMMARY GENERATION
    # --------------------------------------------------------------------------
    print("\n" + "=" * 80)
    print("AUDIT EXECUTION SUMMARY")
    print("=" * 80)

    total_tests = len(results)
    passed_tests = sum(1 for r in results if r.passed)
    failed_tests = total_tests - passed_tests
    success_rate = (passed_tests / total_tests) * 100.0 if total_tests > 0 else 0.0

    print(f"\nTotal Test Cases: {total_tests}")
    print(f"Passed:           {passed_tests} ({success_rate:.1f}%)")
    print(f"Failed:           {failed_tests}")
    print()

    # Table format
    header = f"{'ID':<8} | {'Category':<20} | {'Status':<6} | {'HTTP':<5} | {'Latency':<9} | {'Name'}"
    print(header)
    print("-" * len(header))
    for r in results:
        status_str = "PASS" if r.passed else "FAIL"
        print(f"{r.test_id:<8} | {r.category:<20} | {status_str:<6} | {r.status_code:<5} | {r.latency_ms:>6.1f}ms | {r.name}")

    if failed_tests > 0:
        print("\n--- FAILURE DETAILS ---")
        for r in results:
            if not r.passed:
                print(f"\n[FAIL] {r.test_id} - {r.name} ({r.url})")
                for err in r.errors:
                    print(f"  • {err}")

    # Save detailed JSON report
    report_data = {
        "target": TARGET_BASE_URL,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "summary": {
            "total": total_tests,
            "passed": passed_tests,
            "failed": failed_tests,
            "success_rate_percent": round(success_rate, 2),
        },
        "results": [r.to_dict() for r in results],
    }

    with open("audit_results.json", "w", encoding="utf-8") as f:
        json.dump(report_data, f, indent=2, ensure_ascii=False)

    print(f"\nDetailed audit JSON log written to: audit_results.json\n")
    return 0 if failed_tests == 0 else 1

if __name__ == "__main__":
    sys.exit(execute_audit())
