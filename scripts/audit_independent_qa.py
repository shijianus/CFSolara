#!/usr/bin/env python3
"""
CFSolara Independent QA & Codebase Audit Suite
Strict adversarial verification of lyrics synchronization, data pipeline, and Lyriva integration.
"""

import sys
import json
import time
import math
import requests

BASE_GATEWAY = "https://cfsolara-dho.pages.dev"
BASE_LYRIVA = "https://api.lyriva.xyz"

def banner(title):
    print("\n" + "=" * 80)
    print(f"  {title}")
    print("=" * 80)

def std_dev(lst):
    if len(lst) <= 1:
        return 0.0
    mean = sum(lst) / len(lst)
    variance = sum((x - mean) ** 2 for x in lst) / (len(lst) - 1)
    return math.sqrt(variance)

def run_audit():
    audit_data = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "gateway": BASE_GATEWAY,
        "lyriva_upstream": BASE_LYRIVA,
        "sections": {}
    }

    # =========================================================================
    # SECTION 1: Direct Network Connectivity & Lyriva Upstream Health
    # =========================================================================
    banner("SECTION 1: Direct Network & Lyriva Upstream Audit")
    sec1 = {}

    # 1.1 Lyriva Health
    t0 = time.time()
    try:
        r_health = requests.get(f"{BASE_LYRIVA}/health", headers={"User-Agent": "Sonic/2.0"}, timeout=10)
        lat_health = int((time.time() - t0) * 1000)
        sec1["health"] = {
            "url": f"{BASE_LYRIVA}/health",
            "status": r_health.status_code,
            "latency_ms": lat_health,
            "body": r_health.json() if r_health.status_code == 200 else r_health.text[:200]
        }
        print(f"[*] 1.1 Lyriva Health: Status {r_health.status_code} ({lat_health}ms)")
        print(f"    Body: {sec1['health']['body']}")
    except Exception as e:
        sec1["health"] = {"error": str(e)}
        print(f"[!] 1.1 Lyriva Health Failed: {e}")

    # 1.2 Direct Lyriva Lyrics Query (晴天 - 周杰伦)
    t0 = time.time()
    try:
        r_lyr = requests.get(f"{BASE_LYRIVA}/lyriva/lyrics?title=晴天&artist=周杰伦", headers={"User-Agent": "Sonic/2.0"}, timeout=12)
        lat_lyr = int((time.time() - t0) * 1000)
        lyr_json = r_lyr.json() if r_lyr.status_code == 200 else {}
        sec1["direct_query"] = {
            "url": f"{BASE_LYRIVA}/lyriva/lyrics?title=晴天&artist=周杰伦",
            "status": r_lyr.status_code,
            "latency_ms": lat_lyr,
            "provider_upstream": lyr_json.get("data", {}).get("provider") or lyr_json.get("provider"),
            "has_synced_lyrics": len(lyr_json.get("data", {}).get("syncedLyrics", [])) > 0,
            "synced_lines_count": len(lyr_json.get("data", {}).get("syncedLyrics", [])),
            "sample_first_line": lyr_json.get("data", {}).get("syncedLyrics", [])[0] if lyr_json.get("data", {}).get("syncedLyrics") else None
        }
        print(f"[*] 1.2 Direct Lyriva Query: Status {r_lyr.status_code} ({lat_lyr}ms)")
        print(f"    Upstream Provider: {sec1['direct_query']['provider_upstream']}")
        print(f"    Synced Lines Count: {sec1['direct_query']['synced_lines_count']}")
        if sec1['direct_query']['sample_first_line']:
            l0 = sec1['direct_query']['sample_first_line']
            print(f"    Sample Line 0 Text: '{l0.get('text')}' (Words: {len(l0.get('words', []))})")
    except Exception as e:
        sec1["direct_query"] = {"error": str(e)}
        print(f"[!] 1.2 Direct Lyriva Query Failed: {e}")

    audit_data["sections"]["section_1_lyriva_upstream"] = sec1

    # =========================================================================
    # SECTION 2: Sonic Gateway Endpoints & Lyriva Integration
    # =========================================================================
    banner("SECTION 2: Gateway Endpoints & Routing Audit")
    sec2 = {}

    test_routes = [
        ("dedicated_lyriva", f"{BASE_GATEWAY}/api/sonic/lyrics/lyriva?title=晴天&artist=周杰伦&_nocache=1"),
        ("nexus_aggregation", f"{BASE_GATEWAY}/api/sonic/lyrics/nexus?title=晴天&artist=周杰伦&_nocache=1"),
        ("sync_format_lrc", f"{BASE_GATEWAY}/api/sonic/lyrics/sync?title=晴天&artist=周杰伦&format=lrc&_nocache=1"),
        ("sync_format_json", f"{BASE_GATEWAY}/api/sonic/lyrics/sync?title=晴天&artist=周杰伦&format=json&_nocache=1"),
    ]

    for name, url in test_routes:
        t0 = time.time()
        try:
            r = requests.get(url, timeout=12)
            lat = int((time.time() - t0) * 1000)
            hdrs = {k: v for k, v in r.headers.items() if k.lower().startswith("x-sonic-") or k.lower() in ("content-type", "cf-ray")}
            body = r.json() if "application/json" in r.headers.get("content-type", "") else r.text[:300]
            sec2[name] = {
                "url": url,
                "status": r.status_code,
                "latency_ms": lat,
                "headers": hdrs,
                "brand": body.get("brand") if isinstance(body, dict) else None,
                "meta": body.get("meta") if isinstance(body, dict) else None,
                "data_summary": {
                    "provider": body.get("data", {}).get("provider"),
                    "level": body.get("data", {}).get("level"),
                    "sourceQuality": body.get("data", {}).get("sourceQuality"),
                    "synced_count": len(body.get("data", {}).get("syncedLyrics", [])) if isinstance(body, dict) and "data" in body else None
                } if isinstance(body, dict) and "data" in body else ("text_sample: " + str(body)[:150])
            }
            print(f"[*] Route [{name}]: {r.status_code} ({lat}ms)")
            print(f"    Headers: {hdrs}")
            if isinstance(body, dict):
                meta = body.get("meta", {})
                print(f"    Meta Provider: {meta.get('provider')}, Attempts: {meta.get('attempts')}")
                data = body.get("data", {})
                print(f"    Data Level: {data.get('level')}, SourceQuality: {data.get('sourceQuality')}, Lines: {len(data.get('syncedLyrics', []))}")
        except Exception as e:
            sec2[name] = {"url": url, "error": str(e)}
            print(f"[!] Route [{name}] Failed: {e}")

    audit_data["sections"]["section_2_gateway_endpoints"] = sec2

    # =========================================================================
    # SECTION 3: Multi-Track Linguistic & Genre Diversity Test Suite
    # Proving Dynamic Real vs Synthetic/Hardcoded Timestamps
    # =========================================================================
    banner("SECTION 3: Multi-Track Diversity & Dynamic Timestamp Variance Audit")
    sec3 = {}

    tracks = [
        {"id": "mandarin_pop", "title": "晴天", "artist": "周杰伦", "desc": "Mandarin Pop"},
        {"id": "cantonese_classic", "title": "海阔天空", "artist": "Beyond", "desc": "Cantonese Rock Classic"},
        {"id": "english_pop", "title": "Shape of You", "artist": "Ed Sheeran", "desc": "English Pop Master"},
        {"id": "japanese_pop", "title": "Lemon", "artist": "米津玄师", "desc": "Japanese J-Pop Hit"},
        {"id": "indie_rock", "title": "杀死那个石家庄人", "artist": "万能青年旅店", "desc": "Chinese Indie Rock"},
        {"id": "instrumental_classic", "title": "River Flows in You", "artist": "Yiruma", "desc": "Pure Piano Instrumental"},
        {"id": "non_existent", "title": "__NON_EXISTENT_SONG_QAZ_98765__", "artist": "Ghost_Artist_000", "desc": "Non-existent Track (Negative Test)"},
    ]

    for track in tracks:
        tid = track["id"]
        t_title = track["title"]
        t_artist = track["artist"]
        desc = track["desc"]
        url = f"{BASE_GATEWAY}/api/sonic/lyrics/nexus?title={requests.utils.quote(t_title)}&artist={requests.utils.quote(t_artist)}&_nocache=1"
        
        t0 = time.time()
        try:
            r = requests.get(url, timeout=12)
            lat = int((time.time() - t0) * 1000)
            data = r.json()
            inner = data.get("data", {})
            meta = data.get("meta", {})
            provider = inner.get("provider") or meta.get("provider")
            level = inner.get("level")
            sq = inner.get("sourceQuality")
            is_inst = inner.get("instrumental", False)
            synced = inner.get("syncedLyrics", [])

            # Analyze word duration variance on first 3 lines
            line_analyses = []
            if synced and not is_inst:
                for l_idx, line in enumerate(synced[:3]):
                    words = line.get("words", [])
                    if words:
                        durations = [w.get("durationMs", 0) for w in words]
                        sd = std_dev(durations)
                        is_uniform = sd < 1.0  # Synthetic split would have identical word lengths
                        line_analyses.append({
                            "line_index": l_idx,
                            "line_text": line.get("text"),
                            "line_start_ms": line.get("startMs"),
                            "line_duration_ms": line.get("durationMs"),
                            "words_count": len(words),
                            "word_durations_ms": durations,
                            "word_duration_std_dev": round(sd, 2),
                            "is_synthetic_uniform": is_uniform,
                            "words_dump": [
                                {
                                    "text": w.get("text"),
                                    "startMs": w.get("startMs"),
                                    "durMs": w.get("durationMs"),
                                    "endMs": w.get("endMs")
                                } for w in words
                            ]
                        })

            sec3[tid] = {
                "title": t_title,
                "artist": t_artist,
                "description": desc,
                "http_status": r.status_code,
                "latency_ms": lat,
                "resolved_provider": provider,
                "level": level,
                "source_quality": sq,
                "instrumental": is_inst,
                "synced_lines_count": len(synced),
                "meta_attempts": meta.get("attempts", []),
                "line_analyses": line_analyses
            }

            print(f"[*] Track [{tid} - {t_title} ({desc})]:")
            print(f"    Status: {r.status_code} ({lat}ms) | Provider: {provider} | Level: {level} | SourceQuality: {sq} | Instrumental: {is_inst}")
            print(f"    Attempts: {meta.get('attempts')}")
            if is_inst:
                print(f"    Instrumental detected: plainLyrics='{inner.get('plainLyrics')}'")
            elif synced:
                print(f"    Synced Lines Count: {len(synced)}")
                for la in line_analyses:
                    print(f"    -> Line {la['line_index']}: '{la['line_text']}' | Words: {la['words_count']} | Durations: {la['word_durations_ms']} | StdDev: {la['word_duration_std_dev']}ms (Synthetic: {la['is_synthetic_uniform']})")
            else:
                print(f"    No synced lyrics returned (expected for non-existent: {tid == 'non_existent'})")

        except Exception as e:
            sec3[tid] = {"title": t_title, "artist": t_artist, "error": str(e)}
            print(f"[!] Track [{tid}] Failed: {e}")

    audit_data["sections"]["section_3_diversity_suite"] = sec3

    # =========================================================================
    # SECTION 4: Fallback Chain & Priority Verification
    # Testing hit/miss behavior and provider order
    # =========================================================================
    banner("SECTION 4: Multi-Source Priority & Fallback Mechanism Audit")
    sec4 = {}

    # Test query with platform=netease explicitly
    url_netease = f"{BASE_GATEWAY}/api/sonic/lyrics/nexus?title=晴天&artist=周杰伦&platform=netease&platformId=186016&_nocache=1"
    try:
        t0 = time.time()
        r_net = requests.get(url_netease, timeout=12)
        sec4["platform_targeted_query"] = {
            "url": url_netease,
            "status": r_net.status_code,
            "latency_ms": int((time.time() - t0) * 1000),
            "data": r_net.json()
        }
        meta = sec4["platform_targeted_query"]["data"].get("meta", {})
        print(f"[*] Targeted Platform Query (platform=netease, platformId=186016):")
        print(f"    Provider Resolved: {meta.get('provider')}, Attempts: {meta.get('attempts')}")
    except Exception as e:
        sec4["platform_targeted_query"] = {"error": str(e)}
        print(f"[!] Targeted Platform Query Failed: {e}")

    audit_data["sections"]["section_4_priority_chain"] = sec4

    # Save output to audit artifact JSON
    out_path = "/home/shijian/projects/CFSolara/scripts/audit_independent_qa_results.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(audit_data, f, ensure_ascii=False, indent=2)
    print(f"\n[+] Raw Audit Results successfully saved to: {out_path}")
    return audit_data

if __name__ == "__main__":
    run_audit()
