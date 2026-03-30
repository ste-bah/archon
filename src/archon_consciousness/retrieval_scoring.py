"""Pure scoring functions for episodic memory retrieval.

No I/O — these are mathematical functions operating on pre-computed values.
Used by EpisodicMemory.retrieve_top3 to rank candidate episodes.

Implements:
- FR-CON-003: importance-modulated exponential decay
- FR-CON-002: composite scoring (relevance + recency_with_importance)
- FR-CON-002: MMR reranking for diversity
"""

import math
from typing import Callable

# ─── Decay (FR-CON-003) ───────────────────────────────────────────

# Base lambda for decay computation
_BASE_LAMBDA = 0.023
# Importance scaling factor (importance=1.0 reduces lambda by 80%)
_IMPORTANCE_SCALE = 0.8


def decay_factor(
    age_days: float,
    importance: float,
    pinned: bool = False,
) -> float:
    """Compute importance-modulated exponential decay factor.

    Formula: min(1.0, e^(-lambda_eff * age_days))
    where lambda_eff = 0.023 * (1 - importance * 0.8)

    Args:
        age_days: Days since episode creation. Negative clamped to 0.
        importance: Episode importance [0.0, 1.0].
        pinned: If True, always returns 1.0.

    Returns:
        Decay factor in [0.0, 1.0].
    """
    if pinned:
        return 1.0
    age_days = max(0.0, age_days)
    lambda_eff = _BASE_LAMBDA * (1.0 - importance * _IMPORTANCE_SCALE)
    return min(1.0, math.exp(-lambda_eff * age_days))


# ─── Composite Score (FR-CON-002) ─────────────────────────────────

_RELEVANCE_WEIGHT = 0.6
_RECENCY_WEIGHT = 0.4


def composite_score(relevance: float, recency_with_importance: float) -> float:
    """Compute composite retrieval score.

    Formula: 0.6 * relevance + 0.4 * recency_with_importance

    Both inputs should be in [0.0, 1.0].
    Output is guaranteed in [0.0, 1.0].
    """
    # Clamp inputs to [0, 1] to guarantee output range
    relevance = max(0.0, min(1.0, relevance))
    recency_with_importance = max(0.0, min(1.0, recency_with_importance))
    return _RELEVANCE_WEIGHT * relevance + _RECENCY_WEIGHT * recency_with_importance


# ─── Threshold Check ──────────────────────────────────────────────


def should_retrieve(score: float, threshold: float = 0.3) -> bool:
    """Check if a composite score meets the minimum threshold."""
    return score >= threshold


# ─── Tiebreak by recall_count ─────────────────────────────────────


def tiebreak_by_recall_count(
    candidates: list[dict],
    tolerance: float = 0.05,
) -> list[dict]:
    """Apply recall_count tiebreaker within score tolerance band.

    Within the tolerance band, higher recall_count wins.
    Outside the band, original score order is preserved.

    Args:
        candidates: List of dicts with 'composite_score' and 'recall_count'.
        tolerance: Maximum score difference for tiebreaking.

    Returns:
        Reordered list.
    """
    if len(candidates) <= 1:
        return list(candidates)

    # Sort by score descending first
    sorted_cands = sorted(candidates, key=lambda c: c["composite_score"], reverse=True)

    # Group into tolerance bands and sort within bands by recall_count
    result = []
    i = 0
    while i < len(sorted_cands):
        band_start_score = sorted_cands[i]["composite_score"]
        band = [sorted_cands[i]]
        j = i + 1
        while j < len(sorted_cands) and (band_start_score - sorted_cands[j]["composite_score"]) <= tolerance:
            band.append(sorted_cands[j])
            j += 1
        # Sort band by recall_count descending
        band.sort(key=lambda c: c.get("recall_count", 0), reverse=True)
        result.extend(band)
        i = j

    return result


# ─── MMR Reranking (FR-CON-002) ───────────────────────────────────


def _cosine_sim(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two vectors."""
    if len(a) != len(b) or len(a) == 0:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    return max(0.0, min(1.0, dot / (mag_a * mag_b)))


def mmr_rerank(
    candidates: list[dict],
    lambda_val: float = 0.7,
    top_k: int = 3,
) -> list[dict]:
    """Maximal Marginal Relevance reranking for diversity.

    Each candidate dict must have 'composite_score' and 'embedding'.
    Returns top-k candidates balancing relevance and diversity.
    """
    if not candidates:
        return []
    remaining = list(range(len(candidates)))
    selected: list[int] = []
    while len(selected) < top_k and remaining:
        best_idx = _best_mmr_candidate(candidates, remaining, selected, lambda_val)
        if best_idx >= 0:
            selected.append(best_idx)
            remaining.remove(best_idx)
        else:
            break
    return [candidates[i] for i in selected]


def _best_mmr_candidate(
    candidates: list[dict],
    remaining: list[int],
    selected: list[int],
    lambda_val: float,
) -> int:
    """Find the candidate with highest MMR score among remaining."""
    best_idx = -1
    best_mmr = float("-inf")
    for idx in remaining:
        score = candidates[idx]["composite_score"]
        max_sim = (
            max(_cosine_sim(candidates[idx]["embedding"], candidates[s]["embedding"])
                for s in selected)
            if selected else 0.0
        )
        mmr = lambda_val * score - (1.0 - lambda_val) * max_sim
        if mmr > best_mmr:
            best_mmr = mmr
            best_idx = idx
    return best_idx
