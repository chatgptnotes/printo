"""
Extraction accuracy benchmark.

Runs the extraction pipeline over the sample drawings and scores each result
against test_drawings/ground_truth.json, printing per-field and overall accuracy.
This makes improvements measurable: run it before and after a change, or compare
providers (mock vs sidecar) — set AI_PROVIDER / SIDECAR_URL in the environment.

Usage (from the backend/ directory):
    python benchmark.py
    AI_PROVIDER=sidecar python benchmark.py     # against a running sidecar
"""

import json
import re
from pathlib import Path

from ai_provider import provider_status
from extractor import extract_drawing_with_prepass

DRAWINGS_DIR = Path(__file__).parent.parent / "test_drawings"
GROUND_TRUTH = DRAWINGS_DIR / "ground_truth.json"


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s).strip().lower())


def _match(expected, actual) -> bool:
    """Field-level match: bools by equality, lists by overlap, strings by
    normalised equality or substring containment."""
    if isinstance(expected, bool):
        return bool(actual) == expected
    if isinstance(expected, list):
        if not isinstance(actual, list):
            return False
        exp = {_norm(x) for x in expected}
        act = {_norm(x) for x in actual}
        # count as match if every expected item appears (substring-tolerant)
        return all(any(e in a or a in e for a in act) for e in exp) if exp else True
    if actual is None:
        return False
    e, a = _norm(expected), _norm(actual)
    return e == a or e in a or a in e


def run() -> float:
    truth = json.loads(GROUND_TRUTH.read_text(encoding="utf-8"))
    truth = {k: v for k, v in truth.items() if not k.startswith("_")}

    status = provider_status()
    print("=" * 66)
    print(f"  PRINTO EXTRACTION BENCHMARK")
    print(f"  provider={status.get('ai_provider')} mode={status.get('mode')} "
          f"model={status.get('model')}")
    print("=" * 66)

    total_fields = total_hits = 0
    for fname, expected in truth.items():
        path = DRAWINGS_DIR / fname
        if not path.exists():
            print(f"\n  ⚠  {fname}: file not found — skipped")
            continue
        # original_name lets the mock provider infer the floor from the filename;
        # floor_category left None so we measure extraction, not the UI passthrough.
        extracted, _hints = extract_drawing_with_prepass(
            str(path), floor_category=None, original_name=fname)

        hits = 0
        misses = []
        for field, exp in expected.items():
            ok = _match(exp, extracted.get(field))
            hits += ok
            if not ok:
                misses.append(f"{field}: got {extracted.get(field)!r} != expected {exp!r}")
        n = len(expected)
        total_fields += n
        total_hits += hits
        pct = hits / n * 100 if n else 0
        print(f"\n  {fname}: {hits}/{n} fields  ({pct:.0f}%)")
        for m in misses:
            print(f"      x {m}")

    overall = total_hits / total_fields * 100 if total_fields else 0
    print("\n" + "-" * 66)
    print(f"  OVERALL: {total_hits}/{total_fields} fields correct  ->  {overall:.1f}%")
    print("-" * 66)
    return overall


if __name__ == "__main__":
    run()
