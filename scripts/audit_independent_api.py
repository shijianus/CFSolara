#!/usr/bin/env python3
"""
Comprehensive Independent API QA Verification Suite for CFSolara Production
Target: https://sonic.epocanvas.com/api/sonic/lyrics/nexus
"""

import urllib.request
import urllib.parse
import json
import time
import re
import sys

TARGET_URL = "https://sonic.epocanvas.com/api/sonic/lyrics/nexus"

SONGS_TO_AUDIT = [
    {"title": "Lemon", "artist": "米津玄師", "lang": "ja", "type": "Japanese Rapid Mora"},
    {"title": "First Love", "artist": "宇多田ヒカル", "lang": "ja", "type": "Japanese Ballad / Long Vowels"},
    {"title": "夜に駆ける", "artist": "YOASOBI", "lang": "ja", "type": "Japanese Modern J-Pop"},
    {"title": "前前前世", "artist": "RADWIMPS", "lang": "ja", "type": "Japanese Rock / Fast Tempo"},
    {"title": "晴天", "artist": "周杰伦", "lang": "zh", "type": "Mandarin Pop / Benchmark"}
]

STAFF_PATTERNS = [
    re.compile(r'^\s*(作\s*词|作\s*曲|编\s*曲|词\s*曲|监\s*制|制\s*作|混\s*音|母\s*带|录\s*音|吉\s*他|贝\s*斯|鼓|弦\s*乐|和\s*声|企\s*划|统\s*筹|出\s*品|发\s*行|O\s*P|S\s*P)', re.IGNORECASE),
    re.compile(r'^\s*(Lyrics\s*by|Music\s*by|Arranged\s*by|Produced\s*by|Mixed\s*by|Mastered\s*by|Vocals|Composer|Arrangement|Synthesizer|Strings|Guitar|Bass|Drums)', re.IGNORECASE),
    re.compile(r'^\s*作詞\s*[:：]|^\s*作曲\s*[:：]|^\s*編曲\s*[:：]|^\s*唄\s*[:：]|^\s*歌\s*[:：]', re.IGNORECASE),
    re.compile(r'(Arranged by|Produced by|Sound Produced by)', re.IGNORECASE)
]

def is_staff_line(text):
    if not text:
        return False
    for pat in STAFF_PATTERNS:
        if pat.search(text):
            return True
    return False

def audit_song(song_info):
    title = song_info["title"]
    artist = song_info["artist"]
    url = f"{TARGET_URL}?title={urllib.parse.quote(title)}&artist={urllib.parse.quote(artist)}"
    
    headers = {
        "User-Agent": "Sonic-Independent-QA-Auditor/2.0 (Automated-Validation)",
        "Accept": "application/json"
    }
    
    print(f"\n================================================================================")
    print(f"  AUDITING: 《{title}》 - {artist} ({song_info['type']})")
    print(f"  URL: {url}")
    print(f"================================================================================")

    req = urllib.request.Request(url, headers=headers)
    t0 = time.time()
    
    # Retry logic up to 2 times
    max_retries = 2
    resp_data = None
    latency = 0
    
    for attempt in range(max_retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                latency = (time.time() - t0) * 1000
                resp_data = json.loads(resp.read().decode('utf-8'))
                break
        except Exception as e:
            if attempt < max_retries:
                print(f"[!] Attempt {attempt+1} failed ({e}), retrying in 2s...")
                time.sleep(2)
            else:
                return {
                    "song": f"{title} - {artist}",
                    "passed": False,
                    "error": str(e),
                    "latency_ms": (time.time() - t0) * 1000
                }

    data = resp_data.get("data", {})
    meta = resp_data.get("meta", {})
    provider = data.get("provider") or meta.get("provider")
    source_quality = data.get("sourceQuality")
    level = data.get("level")
    synced_lyrics = data.get("syncedLyrics", [])

    print(f"[*] Response Latency: {latency:.1f}ms")
    print(f"[*] Provider: {provider} | sourceQuality: '{source_quality}' | level: '{level}'")
    print(f"[*] Total Synced Lines: {len(synced_lyrics)}")

    # Check 1: Real Word-by-Word Quality (sourceQuality == 'real')
    check_source_quality = (source_quality == "real")
    
    # Check 2: Synced lines presence
    check_has_lines = len(synced_lyrics) > 0
    
    # Check 3: Staff credit filtering
    staff_lines_found = []
    line_start_alignment_errors = []
    word_progression_errors = []
    word_duration_errors = []
    total_words_count = 0
    lines_with_words = 0

    for idx, line in enumerate(synced_lyrics):
        line_text = line.get("text", "")
        line_start = line.get("start")
        words = line.get("words", [])
        
        # Check for staff info in line
        if is_staff_line(line_text):
            staff_lines_found.append({"index": idx, "text": line_text})

        if words:
            lines_with_words += 1
            total_words_count += len(words)
            
            # Check line start alignment with first word
            first_word_start = words[0].get("start")
            if abs(line_start - first_word_start) > 2: # allowing 2ms margin for rounding
                line_start_alignment_errors.append({
                    "lineIndex": idx,
                    "lineText": line_text,
                    "lineStart": line_start,
                    "firstWordStart": first_word_start,
                    "diff": abs(line_start - first_word_start)
                })

            # Check words timestamp progression & duration
            prev_end = None
            for w_idx, w in enumerate(words):
                w_start = w.get("start")
                w_end = w.get("end")
                w_dur = w.get("duration") or w.get("durationMs")
                
                # Check valid durations
                if w_end is not None and w_start is not None:
                    if w_end < w_start:
                        word_progression_errors.append({
                            "lineIndex": idx,
                            "wordIndex": w_idx,
                            "wordText": w.get("text"),
                            "error": f"End ({w_end}) < Start ({w_start})"
                        })
                    if w_dur is not None and abs(w_dur - (w_end - w_start)) > 2:
                        word_duration_errors.append({
                            "lineIndex": idx,
                            "wordIndex": w_idx,
                            "wordText": w.get("text"),
                            "calcDiff": abs(w_dur - (w_end - w_start))
                        })

                # Check sequential progression
                if prev_end is not None and w_start < prev_end - 5: # allow 5ms minor cross-fade
                    word_progression_errors.append({
                        "lineIndex": idx,
                        "wordIndex": w_idx,
                        "wordText": w.get("text"),
                        "error": f"Start ({w_start}) regressed before previous End ({prev_end})"
                    })
                prev_end = w_end

    # Check 4: First line must not be staff
    first_line_clean = len(synced_lyrics) > 0 and not is_staff_line(synced_lyrics[0].get("text", ""))

    # Summarize results for this song
    has_words_coverage = (lines_with_words / len(synced_lyrics) > 0.8) if synced_lyrics else False
    alignment_ok = len(line_start_alignment_errors) == 0
    progression_ok = len(word_progression_errors) == 0
    staff_clean_ok = len(staff_lines_found) == 0 and first_line_clean

    all_passed = (
        check_source_quality and 
        check_has_lines and 
        has_words_coverage and 
        alignment_ok and 
        progression_ok and 
        staff_clean_ok
    )

    print(f"  [CHECK] sourceQuality == 'real': {'✅ PASS' if check_source_quality else '❌ FAIL'} ({source_quality})")
    print(f"  [CHECK] Syllable words count: {total_words_count} across {lines_with_words}/{len(synced_lyrics)} lines ({'✅ PASS' if has_words_coverage else '❌ FAIL'})")
    print(f"  [CHECK] Line start vs first word alignment: {'✅ PASS (0 errors)' if alignment_ok else f'❌ FAIL ({len(line_start_alignment_errors)} errors)'}")
    print(f"  [CHECK] Word timestamp monotonicity & progression: {'✅ PASS (0 errors)' if progression_ok else f'❌ FAIL ({len(word_progression_errors)} errors)'}")
    print(f"  [CHECK] Staff credit filtering: {'✅ PASS (0 staff lines)' if staff_clean_ok else f'❌ FAIL ({len(staff_lines_found)} staff lines found)'}")
    if synced_lyrics:
        print(f"  [SAMPLE] Line 0: \"{synced_lyrics[0].get('text')}\" (Start: {synced_lyrics[0].get('start')}ms, Words: {len(synced_lyrics[0].get('words', []))})")
        if len(synced_lyrics) > 1:
            print(f"  [SAMPLE] Line 1: \"{synced_lyrics[1].get('text')}\" (Start: {synced_lyrics[1].get('start')}ms, Words: {len(synced_lyrics[1].get('words', []))})")

    return {
        "song": f"{title} - {artist}",
        "language": song_info["lang"],
        "category": song_info["type"],
        "passed": all_passed,
        "latency_ms": round(latency, 1),
        "provider": provider,
        "sourceQuality": source_quality,
        "level": level,
        "totalLines": len(synced_lyrics),
        "linesWithWords": lines_with_words,
        "totalWords": total_words_count,
        "checks": {
            "sourceQualityReal": check_source_quality,
            "hasLines": check_has_lines,
            "wordsCoverage": has_words_coverage,
            "alignmentOk": alignment_ok,
            "progressionOk": progression_ok,
            "staffCleanOk": staff_clean_ok
        },
        "sampleLines": [
            {
                "lineIndex": i,
                "text": line.get("text"),
                "start": line.get("start"),
                "wordsCount": len(line.get("words", [])),
                "words": line.get("words", [])[:4]
            }
            for i, line in enumerate(synced_lyrics[:2])
        ],
        "staffLinesFound": staff_lines_found,
        "alignmentErrors": line_start_alignment_errors[:5],
        "progressionErrors": word_progression_errors[:5]
    }

def main():
    print("=" * 80)
    print("  CFSOLARA PRODUCTION API INDEPENDENT QA AUDIT")
    print(f"  Time: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")
    print("=" * 80)

    results = []
    for song in SONGS_TO_AUDIT:
        res = audit_song(song)
        results.append(res)
        time.sleep(1) # Gentle throttling between calls

    all_passed = all(r.get("passed", False) for r in results)
    
    summary = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "targetUrl": TARGET_URL,
        "overallPassed": all_passed,
        "totalTested": len(results),
        "totalPassed": sum(1 for r in results if r.get("passed", False)),
        "songs": results
    }

    out_file = "/home/shijian/projects/CFSolara/scripts/audit_independent_api_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 80)
    print("  FINAL API AUDIT SUMMARY")
    print("=" * 80)
    for r in results:
        status_icon = "✅ PASS" if r.get("passed") else "❌ FAIL"
        print(f"  {status_icon} | {r['song']:<28} | Prov: {r.get('provider'):<7} | Quality: {r.get('sourceQuality'):<5} | Lines: {r.get('totalLines', 0):<3} | Words: {r.get('totalWords', 0):<4} | Latency: {r.get('latency_ms', 0)}ms")
    print("=" * 80)
    print(f"Overall Result: {'✅ ALL TESTS PASSED' if all_passed else '❌ SOME TESTS FAILED'}")
    print(f"Detailed JSON report written to: {out_file}\n")

    return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(main())
