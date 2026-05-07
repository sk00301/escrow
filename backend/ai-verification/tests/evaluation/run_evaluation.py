#!/usr/bin/env python3
"""
tests/evaluation/run_evaluation.py

Evaluation harness for the LLM verification pipeline.

For cases with requires_test_generation=True, the harness first calls
POST /generate-tests to create test_submission.py from the SRS, then
submits to POST /llm-verify as normal.

Usage
─────
    python tests/evaluation/run_evaluation.py --timeout 1000

    # Only SRS cases
    python tests/evaluation/run_evaluation.py --cases 16 17 18 --timeout 1000

    # Original 15 cases only
    python tests/evaluation/run_evaluation.py --cases $(seq 1 15 | tr '\n' ' ') --timeout 1000

Exit codes:  0 = accuracy >= target,  1 = accuracy < target,  2 = fatal error
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: pip install requests")
    sys.exit(2)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class CaseResult:
    case_id: int
    folder: str
    expected: str
    actual: str
    score: float
    correct: bool
    status: str
    error_code: str
    error_message: str
    duration_seconds: float
    job_id: str
    reasoning: str = ""
    confidence: float = 0.0
    tests_generated: int = 0
    test_gen_warnings: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------

def load_dataset(path: Path) -> dict:
    if not path.exists():
        print(f"ERROR: dataset not found: {path}")
        sys.exit(2)
    return json.loads(path.read_text())


def check_server(base_url: str, session: requests.Session) -> None:
    try:
        r = session.get(f"{base_url}/health", timeout=5)
        print(f"Server: {base_url}  status={r.status_code}\n")
    except requests.RequestException as e:
        print(f"ERROR: cannot reach {base_url} — {e}")
        sys.exit(2)


def generate_tests_for_case(
    base_url: str,
    case: dict,
    dataset_dir: Path,
    session: requests.Session,
) -> tuple[int, list[str]]:
    """
    Call POST /generate-tests for a case that has requires_test_generation=True.

    Returns (tests_generated, warnings).
    Returns (0, [error]) on failure — the evaluation continues anyway.
    """
    srs_rel = case.get("srs_path", "")
    if not srs_rel:
        return 0, ["No srs_path in dataset entry"]

    project_path = str((dataset_dir / case["folder"]).resolve())
    srs_path     = str((dataset_dir / srs_rel).resolve())

    try:
        r = session.post(
            f"{base_url}/generate-tests",
            data={
                "project_dir":      project_path,
                "srs_path":         srs_path,
                "output_filename":  "test_submission.py",
            },
            timeout=600,   # test generation can take a while
        )
        if r.status_code == 200:
            data = r.json()
            return (
                data.get("tests_generated", 0),
                data.get("warnings", []),
            )
        return 0, [f"generate-tests returned HTTP {r.status_code}: {r.text[:200]}"]
    except requests.RequestException as exc:
        return 0, [f"generate-tests request failed: {exc}"]


def submit(
    base_url: str,
    endpoint: str,
    case: dict,
    submission_path: str,
    session: requests.Session,
) -> tuple[str, str]:
    if endpoint == "/llm-verify":
        body = {
            "milestone_id":       f"eval-{case['id']:02d}",
            "submission_type":    "local_path",
            "submission_value":   submission_path,
            "test_commands":      case["test_commands"],
            "acceptance_criteria": case["acceptance_criteria"],
        }
    else:
        body = {
            "milestone_id":    f"eval-{case['id']:02d}",
            "submission_type": "local_path",
            "submission_value": submission_path,
            "test_commands":   case["test_commands"],
        }

    # Attach milestone scope when present in the dataset case
    if "milestone_scope" in case and case["milestone_scope"]:
        body["milestone_scope"] = case["milestone_scope"]

    try:
        r = session.post(f"{base_url}{endpoint}", json=body, timeout=30)
        if r.status_code == 202:
            return r.json()["job_id"], ""
        return "", f"HTTP {r.status_code}: {r.text[:200]}"
    except requests.RequestException as exc:
        return "", str(exc)


def poll(
    base_url: str,
    job_id: str,
    timeout: int,
    poll_interval: int,
    session: requests.Session,
) -> tuple[dict, bool]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = session.get(f"{base_url}/result/{job_id}", timeout=10)
            if r.status_code == 200:
                data = r.json()
                if data.get("status") not in ("PENDING", "RUNNING"):
                    return data, False
        except requests.RequestException:
            pass
        time.sleep(poll_interval)
    return {}, True


def run_case(
    base_url: str,
    endpoint: str,
    case: dict,
    dataset_dir: Path,
    timeout: int,
    poll_interval: int,
    session: requests.Session,
) -> CaseResult:
    start = time.time()
    tests_generated = 0
    test_gen_warnings: list[str] = []
    submission_path = str((dataset_dir / case["folder"]).resolve())

    # ── Step 0: Generate tests from SRS if needed ─────────────────────
    if case.get("requires_test_generation"):
        print(f"  [SRS] generating tests...", end=" ", flush=True)
        tests_generated, test_gen_warnings = generate_tests_for_case(
            base_url, case, dataset_dir, session
        )
        if test_gen_warnings and not tests_generated:
            print(f"WARN: {test_gen_warnings[0][:60]}")
        else:
            print(f"OK ({tests_generated} tests)", end=" ", flush=True)

    # ── Step 1: Submit to verification endpoint ────────────────────────
    job_id, err = submit(base_url, endpoint, case, submission_path, session)
    if err:
        return CaseResult(
            case_id=case["id"], folder=case["folder"],
            expected=case["expected_verdict"], actual="ERROR",
            score=0.0, correct=False, status="ERROR",
            error_code="SUBMIT_FAILED", error_message=err,
            duration_seconds=time.time() - start, job_id="",
            tests_generated=tests_generated, test_gen_warnings=test_gen_warnings,
        )

    print(f"  job={job_id[:8]}...", end=" ", flush=True)

    # ── Step 2: Poll for result ────────────────────────────────────────
    data, timed_out = poll(base_url, job_id, timeout, poll_interval, session)
    duration = time.time() - start

    if timed_out:
        return CaseResult(
            case_id=case["id"], folder=case["folder"],
            expected=case["expected_verdict"], actual="TIMEOUT",
            score=0.0, correct=False, status="TIMEOUT",
            error_code="TIMEOUT", error_message=f">{timeout}s",
            duration_seconds=duration, job_id=job_id,
            tests_generated=tests_generated, test_gen_warnings=test_gen_warnings,
        )

    if data.get("status") == "FAILED":
        return CaseResult(
            case_id=case["id"], folder=case["folder"],
            expected=case["expected_verdict"], actual="FAILED",
            score=0.0, correct=False, status="FAILED",
            error_code=data.get("error_code", ""),
            error_message=data.get("error_message", ""),
            duration_seconds=duration, job_id=job_id,
            tests_generated=tests_generated, test_gen_warnings=test_gen_warnings,
        )

    actual    = data.get("verdict", "UNKNOWN")
    score     = float(data.get("score") or 0.0)
    details   = data.get("details") or {}
    reasoning = details.get("reasoning", "")
    confidence = float(details.get("confidence", 0.0))

    return CaseResult(
        case_id=case["id"], folder=case["folder"],
        expected=case["expected_verdict"], actual=actual,
        score=score, correct=(actual == case["expected_verdict"]),
        status=data.get("status", ""), error_code="", error_message="",
        duration_seconds=duration, job_id=job_id,
        reasoning=reasoning, confidence=confidence,
        tests_generated=tests_generated, test_gen_warnings=test_gen_warnings,
    )


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def print_results(results: list[CaseResult], target: float) -> None:
    verdicts = ["APPROVED", "DISPUTED", "REJECTED"]
    correct  = sum(1 for r in results if r.correct)
    accuracy = correct / len(results) if results else 0.0
    passed   = accuracy >= target

    print(f"\n{'='*72}")
    print(f"  RESULTS   accuracy={accuracy:.1%} ({correct}/{len(results)})  "
          f"target={target:.0%}  {'✓ PASS' if passed else '✗ FAIL'}")
    print(f"{'='*72}")
    print(f"  {'Case':<5} {'Folder':<32} {'Exp':<11} {'Actual':<11} "
          f"{'Score':<7} {'OK':<4} {'Time':>6}")
    print(f"  {'-'*74}")

    for r in results:
        ok = "✓" if r.correct else "✗"
        actual_str = r.actual if r.status not in ("TIMEOUT","FAILED","ERROR") \
                     else f"[{r.status}]"
        srs_tag = " [SRS]" if r.tests_generated > 0 else ""
        folder_display = f"{r.folder}{srs_tag}"
        print(f"  {r.case_id:<5} {folder_display:<32} {r.expected:<11} "
              f"{actual_str:<11} {r.score:<7.3f} {ok:<4} {r.duration_seconds:>5.0f}s")
        if r.tests_generated:
            print(f"  {'':5} Tests generated from SRS: {r.tests_generated}")
        if not r.correct and r.reasoning:
            print(f"  {'':5} reasoning: {r.reasoning[:120]}...")
        if r.test_gen_warnings:
            for w in r.test_gen_warnings:
                print(f"  {'':5} ⚠ {w}")

    # By category
    print(f"\n  By category:")
    categories: dict = {}
    for r in results:
        cat = r.expected.lower()
        categories.setdefault(cat, {"total": 0, "correct": 0})
        categories[cat]["total"] += 1
        if r.correct:
            categories[cat]["correct"] += 1
    for cat, d in sorted(categories.items()):
        pct = d["correct"] / d["total"] if d["total"] else 0
        bar = "█" * d["correct"] + "░" * (d["total"] - d["correct"])
        print(f"    {cat:<12} {d['correct']}/{d['total']}  {pct:.0%}  [{bar}]")

    # Confusion matrix
    print(f"\n  Confusion matrix (row=expected, col=actual):")
    col_labels = verdicts + ["OTHER"]
    print(f"  {'':16}" + "".join(f"{v:>12}" for v in col_labels))
    for exp in verdicts:
        row = f"  {exp:<16}"
        for act in col_labels:
            count = sum(
                1 for r in results
                if r.expected == exp and (
                    r.actual == act if act != "OTHER"
                    else r.actual not in verdicts
                )
            )
            marker = " *" if exp == act else "  "
            row += f"{count:>10}{marker}"
        print(row)

    print(f"{'='*72}\n")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--endpoint", default="/llm-verify",
                        choices=["/llm-verify", "/verify"])
    parser.add_argument("--dataset-dir",
                        default="tests/fixtures/sample_submissions",
                        type=Path)
    parser.add_argument("--dataset-json",
                        default="tests/evaluation/dataset.json",
                        type=Path)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--poll-interval", type=int, default=5)
    parser.add_argument("--json-out", default="evaluation_results.json")
    parser.add_argument("--csv-out",  default="evaluation_results.csv")
    parser.add_argument("--cases", type=int, nargs="*",
                        help="Run specific case IDs, e.g. --cases 1 6 16 17 18")
    parser.add_argument("--srs-only", action="store_true",
                        help="Run only the SRS test-generation cases (16, 17, 18)")
    args = parser.parse_args()

    dataset = load_dataset(args.dataset_json)
    cases   = dataset["cases"]

    if args.srs_only:
        cases = [c for c in cases if c.get("requires_test_generation")]
    elif args.cases:
        cases = [c for c in cases if c["id"] in args.cases]

    target  = dataset.get("accuracy_target", 0.80)
    session = requests.Session()
    check_server(args.base_url, session)

    # SRS cases use their own dataset_dir (fixtures root, not sample_submissions)
    srs_dataset_dir     = Path("tests/fixtures")
    normal_dataset_dir  = args.dataset_dir

    print(f"Endpoint : {args.base_url}{args.endpoint}")
    print(f"Cases    : {len(cases)}")
    srs_count = sum(1 for c in cases if c.get("requires_test_generation"))
    if srs_count:
        print(f"  {srs_count} case(s) will generate tests from SRS first")
    print(f"Target   : {target:.0%}")
    print(f"Timeout  : {args.timeout}s per job")
    print(f"{'─'*72}")

    results: list[CaseResult] = []
    eval_start = time.time()

    for i, case in enumerate(cases, 1):
        is_srs = case.get("requires_test_generation", False)
        d_dir  = srs_dataset_dir if is_srs else normal_dataset_dir
        tag    = "[SRS]" if is_srs else "     "

        print(f"[{i:2d}/{len(cases)}] {tag} {case['folder']:<35} "
              f"expected={case['expected_verdict']:<10}", end=" ", flush=True)

        result = run_case(
            args.base_url, args.endpoint, case,
            d_dir, args.timeout, args.poll_interval, session,
        )
        results.append(result)

        ok = "✓" if result.correct else "✗"
        print(f"→ {result.actual:<10} {ok}  ({result.duration_seconds:.0f}s)")

    print_results(results, target)

    # Save JSON
    total_correct = sum(1 for r in results if r.correct)
    accuracy = total_correct / len(results) if results else 0.0
    output = {
        "endpoint":               args.endpoint,
        "timestamp":              datetime.now(timezone.utc).isoformat(),
        "total_cases":            len(results),
        "correct":                total_correct,
        "accuracy":               accuracy,
        "target_accuracy":        target,
        "passed":                 accuracy >= target,
        "total_duration_seconds": round(time.time() - eval_start, 1),
        "results":                [asdict(r) for r in results],
    }
    Path(args.json_out).write_text(json.dumps(output, indent=2))
    print(f"JSON saved to: {args.json_out}")

    with open(args.csv_out, "w", newline="") as f:
        if results:
            writer = csv.DictWriter(f, fieldnames=asdict(results[0]).keys())
            writer.writeheader()
            writer.writerows(asdict(r) for r in results)
    print(f"CSV  saved to: {args.csv_out}")

    sys.exit(0 if accuracy >= target else 1)


if __name__ == "__main__":
    main()
