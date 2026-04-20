#!/usr/bin/env python3
"""
tests/evaluation/run_evaluation.py

Submits all 15 sample projects to POST /llm-verify, waits for the LLM
verdict, compares against expected, and reports accuracy.

Usage
─────
    # Start the server first:
    uvicorn main:app --reload --port 8000

    # Run evaluation (uses Ollama by default via server config):
    python tests/evaluation/run_evaluation.py

    # Run a single project quickly:
    python tests/evaluation/run_evaluation.py --cases 1 6 11

    # Compare old /verify vs new /llm-verify:
    python tests/evaluation/run_evaluation.py --endpoint /verify --timeout 60

Exit codes:  0 = accuracy >= target,  1 = accuracy < target,  2 = fatal error
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: pip install requests")
    sys.exit(2)


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


def submit(base_url: str, endpoint: str, case: dict,
           submission_path: str, session: requests.Session) -> tuple[str, str]:
    """Return (job_id, error). job_id is empty string on failure."""
    if endpoint == "/llm-verify":
        body = {
            "milestone_id": f"eval-{case['id']:02d}",
            "submission_type": "local_path",
            "submission_value": submission_path,
            "test_commands": case["test_commands"],
            "acceptance_criteria": case["acceptance_criteria"],
        }
    else:
        body = {
            "milestone_id": f"eval-{case['id']:02d}",
            "submission_type": "local_path",
            "submission_value": submission_path,
            "test_commands": case["test_commands"],
        }
    try:
        r = session.post(f"{base_url}{endpoint}", json=body, timeout=30)
        if r.status_code == 202:
            return r.json()["job_id"], ""
        return "", f"HTTP {r.status_code}: {r.text[:200]}"
    except requests.RequestException as e:
        return "", str(e)


def poll(base_url: str, job_id: str, timeout: int,
         poll_interval: int, session: requests.Session) -> tuple[dict, bool]:
    """Poll until terminal state. Returns (result_dict, timed_out)."""
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


def run_case(base_url: str, endpoint: str, case: dict,
             dataset_dir: Path, timeout: int, poll_interval: int,
             session: requests.Session) -> CaseResult:
    start = time.time()
    submission_path = str((dataset_dir / case["folder"]).resolve())

    job_id, err = submit(base_url, endpoint, case, submission_path, session)
    if err:
        return CaseResult(
            case_id=case["id"], folder=case["folder"],
            expected=case["expected_verdict"], actual="ERROR",
            score=0.0, correct=False, status="ERROR",
            error_code="SUBMIT_FAILED", error_message=err,
            duration_seconds=time.time() - start, job_id="",
        )

    print(f"  submitted job_id={job_id[:8]}...", end=" ", flush=True)
    data, timed_out = poll(base_url, job_id, timeout, poll_interval, session)
    duration = time.time() - start

    if timed_out:
        return CaseResult(
            case_id=case["id"], folder=case["folder"],
            expected=case["expected_verdict"], actual="TIMEOUT",
            score=0.0, correct=False, status="TIMEOUT",
            error_code="TIMEOUT", error_message=f">{timeout}s",
            duration_seconds=duration, job_id=job_id,
        )

    if data.get("status") == "FAILED":
        return CaseResult(
            case_id=case["id"], folder=case["folder"],
            expected=case["expected_verdict"], actual="FAILED",
            score=0.0, correct=False, status="FAILED",
            error_code=data.get("error_code", ""),
            error_message=data.get("error_message", ""),
            duration_seconds=duration, job_id=job_id,
        )

    actual = data.get("verdict", "UNKNOWN")
    score = float(data.get("score") or 0.0)
    details = data.get("details") or {}
    reasoning = details.get("reasoning", "")
    confidence = float(details.get("confidence", 0.0))

    return CaseResult(
        case_id=case["id"], folder=case["folder"],
        expected=case["expected_verdict"], actual=actual,
        score=score, correct=(actual == case["expected_verdict"]),
        status=data.get("status", ""), error_code="", error_message="",
        duration_seconds=duration, job_id=job_id,
        reasoning=reasoning, confidence=confidence,
    )


def print_results(results: list[CaseResult], target: float) -> None:
    verdicts = ["APPROVED", "DISPUTED", "REJECTED"]
    correct = sum(1 for r in results if r.correct)
    accuracy = correct / len(results) if results else 0.0
    passed = accuracy >= target

    print(f"\n{'='*72}")
    print(f"  RESULTS   accuracy={accuracy:.1%} ({correct}/{len(results)})  "
          f"target={target:.0%}  {'✓ PASS' if passed else '✗ FAIL'}")
    print(f"{'='*72}")
    print(f"  {'Project':<12} {'Expected':<12} {'Actual':<12} "
          f"{'Score':<8} {'OK':<5} {'Time':>6}")
    print(f"  {'-'*60}")

    for r in results:
        ok = "✓" if r.correct else "✗"
        actual_display = r.actual if r.status not in ("TIMEOUT","FAILED","ERROR") else f"[{r.status}]"
        print(f"  {r.folder:<12} {r.expected:<12} {actual_display:<12} "
              f"{r.score:<8.3f} {ok:<5} {r.duration_seconds:>5.0f}s")
        if not r.correct and r.reasoning:
            print(f"  {'':12} reasoning: {r.reasoning[:80]}...")

    # By category
    print(f"\n  By category:")
    categories = {}
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
    header = f"  {'':14}" + "".join(f"{v:>12}" for v in col_labels)
    print(header)
    for exp in verdicts:
        row = f"  {exp:<14}"
        for act in col_labels:
            if act == "OTHER":
                count = sum(1 for r in results
                            if r.expected == exp and r.actual not in verdicts)
            else:
                count = sum(1 for r in results
                            if r.expected == exp and r.actual == act)
            marker = " *" if exp == act else "  "
            row += f"{count:>10}{marker}"
        print(row)

    print(f"{'='*72}\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate LLM verification accuracy across 15 projects.",
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
    parser.add_argument("--timeout", type=int, default=600,
                        help="Max seconds to wait per job (LLM calls are slow)")
    parser.add_argument("--poll-interval", type=int, default=5)
    parser.add_argument("--json-out", default="evaluation_results.json")
    parser.add_argument("--csv-out", default="evaluation_results.csv")
    parser.add_argument("--cases", type=int, nargs="*",
                        help="Run only these case IDs e.g. --cases 1 6 11")
    args = parser.parse_args()

    dataset = load_dataset(args.dataset_json)
    cases = dataset["cases"]
    if args.cases:
        cases = [c for c in cases if c["id"] in args.cases]
    target = dataset.get("accuracy_target", 0.80)

    session = requests.Session()
    check_server(args.base_url, session)

    print(f"Endpoint : {args.base_url}{args.endpoint}")
    print(f"Cases    : {len(cases)}")
    print(f"Target   : {target:.0%} ({int(target * len(cases))}/{len(cases)} correct)")
    print(f"Timeout  : {args.timeout}s per job")
    print(f"{'─'*72}")

    results: list[CaseResult] = []
    eval_start = time.time()

    for i, case in enumerate(cases, 1):
        print(f"[{i:2d}/{len(cases)}] {case['folder']:<14} expected={case['expected_verdict']:<10}",
              end=" ", flush=True)
        result = run_case(
            args.base_url, args.endpoint, case,
            args.dataset_dir, args.timeout, args.poll_interval, session,
        )
        results.append(result)
        ok = "✓" if result.correct else "✗"
        print(f"→ {result.actual:<10} {ok}  ({result.duration_seconds:.0f}s)")

    print_results(results, target)

    # Save JSON
    output = {
        "endpoint": args.endpoint,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "total_cases": len(results),
        "correct": sum(1 for r in results if r.correct),
        "accuracy": sum(1 for r in results if r.correct) / len(results) if results else 0,
        "target_accuracy": target,
        "passed": sum(1 for r in results if r.correct) / len(results) >= target if results else False,
        "total_duration_seconds": round(time.time() - eval_start, 1),
        "results": [asdict(r) for r in results],
    }
    Path(args.json_out).write_text(json.dumps(output, indent=2))
    print(f"JSON saved to: {args.json_out}")

    with open(args.csv_out, "w", newline="") as f:
        if results:
            writer = csv.DictWriter(f, fieldnames=asdict(results[0]).keys())
            writer.writeheader()
            writer.writerows(asdict(r) for r in results)
    print(f"CSV  saved to: {args.csv_out}")

    accuracy = output["accuracy"]
    sys.exit(0 if accuracy >= target else 1)


if __name__ == "__main__":
    main()
