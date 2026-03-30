"""Per-task-type scoring functions for the benchmark harness."""

import re
import subprocess
from pathlib import Path


def score_task(task, agent_output: str) -> tuple[float, dict]:
    """Route to the appropriate scorer based on task.scoring_method."""
    scorers = {
        "test_pass": score_bug_fix,
        "precision_recall": score_code_review,
        "exact_match": score_memory_recall,
        "bleu": score_doc_gen,
        "fact_extraction": score_sec_analysis,
    }
    scorer = scorers.get(task.scoring_method)
    if scorer is None:
        return 0.0, {"error": f"Unknown scoring method: {task.scoring_method}"}
    return scorer(task, agent_output)


def score_bug_fix(task, agent_output: str) -> tuple[float, dict]:
    """Score a bug-fix task by applying patch and running tests.

    REQ-BENCH-003: Binary pass/fail + partial credit (tests_passed / tests_total).
    """
    work_dir = Path(f"/tmp/archon-benchmark/{task.instance_id}")
    details = {"tests_passed": 0, "tests_total": 0, "patch_applied": False}

    patch_text = _extract_patch(agent_output)
    if not patch_text:
        return 0.0, {**details, "error": "No patch found in agent output"}

    apply_result = subprocess.run(
        ["git", "apply", "--check", "-"],
        input=patch_text, capture_output=True, text=True, cwd=work_dir, timeout=10,
    )
    if apply_result.returncode != 0:
        return 0.0, {**details, "error": f"Patch does not apply: {apply_result.stderr}"}

    subprocess.run(
        ["git", "apply", "-"],
        input=patch_text, capture_output=True, text=True, cwd=work_dir, timeout=10,
    )
    details["patch_applied"] = True

    if task.test_patch:
        subprocess.run(
            ["git", "apply", "-"],
            input=task.test_patch, capture_output=True, text=True, cwd=work_dir, timeout=10,
        )

    test_result = subprocess.run(
        ["python", "-m", "pytest", "--tb=short", "-q"],
        capture_output=True, text=True, cwd=work_dir, timeout=task.timeout_seconds,
    )
    passed, total = _parse_pytest_summary(test_result.stdout)
    details["tests_passed"] = passed
    details["tests_total"] = total

    score = passed / total if total > 0 else 0.0
    return score, details


def score_code_review(task, agent_output: str) -> tuple[float, dict]:
    """Score a code-review task by comparing findings to known bug list.

    REQ-BENCH-003: F1 = 2 * precision * recall / (precision + recall).
    """
    injected_bugs = task.metadata.get("injected_bugs", [])
    if not injected_bugs:
        return 0.0, {"error": "No injected_bugs in metadata"}

    agent_findings = _extract_findings(agent_output)
    reported_count = len(agent_findings)

    found_bugs = 0
    for bug in injected_bugs:
        bug_keywords = set(bug.get("keywords", []))
        for finding in agent_findings:
            finding_lower = finding.lower()
            if sum(1 for kw in bug_keywords if kw.lower() in finding_lower) >= len(bug_keywords) * 0.5:
                found_bugs += 1
                break

    precision = found_bugs / reported_count if reported_count > 0 else 0.0
    recall = found_bugs / len(injected_bugs)
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    return f1, {
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "f1": round(f1, 3),
        "found_bugs": found_bugs,
        "reported_bugs": reported_count,
        "injected_bugs": len(injected_bugs),
    }


def score_memory_recall(task, agent_output: str) -> tuple[float, dict]:
    """Score a memory-recall task by exact substring match (case-insensitive)."""
    gold = task.gold_answer.strip().lower()
    output = agent_output.strip().lower()

    is_correct = gold in output

    return (1.0 if is_correct else 0.0), {
        "correct": is_correct,
        "gold_answer": task.gold_answer,
        "agent_answer_snippet": agent_output[:200],
    }


def score_doc_gen(task, agent_output: str) -> tuple[float, dict]:
    """Score a doc-generation task with unigram BLEU."""
    reference = task.gold_answer
    bleu = _simple_bleu(reference, agent_output)

    return bleu, {
        "bleu_score": round(bleu, 3),
        "human_review": True,
        "reference_length": len(reference.split()),
        "output_length": len(agent_output.split()),
    }


def score_sec_analysis(task, agent_output: str) -> tuple[float, dict]:
    """Score a SEC analysis task by fact extraction accuracy."""
    known_facts = task.metadata.get("known_facts", [])
    known_metrics = task.metadata.get("known_metrics", [])
    all_facts = known_facts + known_metrics
    if not all_facts:
        return 0.0, {"error": "No known facts in metadata"}

    output_lower = agent_output.lower()
    found = sum(1 for fact in all_facts if fact.lower() in output_lower)

    score = found / len(all_facts) if all_facts else 0.0
    return score, {
        "facts_found": found,
        "facts_total": len(all_facts),
        "human_review": True,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_patch(text: str) -> str:
    """Extract a unified diff from agent output text."""
    lines = text.split("\n")
    in_diff = False
    diff_lines = []
    for line in lines:
        if line.startswith("--- ") or line.startswith("diff --git"):
            in_diff = True
        if in_diff:
            diff_lines.append(line)
    return "\n".join(diff_lines) if diff_lines else ""


def _parse_pytest_summary(output: str) -> tuple[int, int]:
    """Parse pytest -q output for passed/total counts."""
    match = re.search(r"(\d+) passed", output)
    passed = int(match.group(1)) if match else 0
    match_failed = re.search(r"(\d+) failed", output)
    failed = int(match_failed.group(1)) if match_failed else 0
    total = passed + failed
    return passed, total


def _extract_findings(text: str) -> list[str]:
    """Extract individual findings from a code review output."""
    findings = re.split(r'\n\s*(?:\d+[\.\)]\s+|\-\s+|\*\s+)', text)
    return [f.strip() for f in findings if f.strip() and len(f.strip()) > 10]


def _simple_bleu(reference: str, hypothesis: str) -> float:
    """Compute unigram BLEU score (simplified, no external deps)."""
    ref_tokens = reference.lower().split()
    hyp_tokens = hypothesis.lower().split()
    if not hyp_tokens or not ref_tokens:
        return 0.0
    ref_counts: dict[str, int] = {}
    for t in ref_tokens:
        ref_counts[t] = ref_counts.get(t, 0) + 1
    matches = 0
    hyp_counts: dict[str, int] = {}
    for t in hyp_tokens:
        hyp_counts[t] = hyp_counts.get(t, 0) + 1
    for t, count in hyp_counts.items():
        matches += min(count, ref_counts.get(t, 0))
    precision = matches / len(hyp_tokens)
    bp = min(1.0, len(hyp_tokens) / len(ref_tokens)) if ref_tokens else 0.0
    return bp * precision
