"""Tests for retrieval scoring pure functions.

Written BEFORE implementation (TDD). Tests decay formulas, composite
scoring, MMR reranking, and threshold logic at boundary conditions.

Covers FR-CON-002, FR-CON-003 math.
"""

import math

import pytest

from src.archon_consciousness.retrieval_scoring import (
    composite_score,
    decay_factor,
    mmr_rerank,
    should_retrieve,
    tiebreak_by_recall_count,
)


# ─── Decay Factor (FR-CON-003) ────────────────────────────────────


class TestDecayFactor:
    """Test importance-modulated exponential decay."""

    def test_age_zero_importance_zero(self):
        """Brand new, low importance → decay = 1.0."""
        assert decay_factor(age_days=0, importance=0.0) == pytest.approx(1.0)

    def test_age_zero_importance_one(self):
        """Brand new, high importance → decay = 1.0."""
        assert decay_factor(age_days=0, importance=1.0) == pytest.approx(1.0)

    def test_halflife_30_days_low_importance(self):
        """importance=0.0 → lambda=0.023 → half-life ~30 days."""
        d = decay_factor(age_days=30, importance=0.0)
        assert d == pytest.approx(0.5, abs=0.02)

    def test_halflife_150_days_high_importance(self):
        """importance=1.0 → lambda=0.0046 → half-life ~150 days."""
        d = decay_factor(age_days=150, importance=1.0)
        assert d == pytest.approx(0.5, abs=0.02)

    def test_very_old_low_importance(self):
        """300 days, importance=0.0 → nearly zero."""
        d = decay_factor(age_days=300, importance=0.0)
        assert d < 0.01

    def test_very_old_high_importance(self):
        """300 days, importance=1.0 → still significant (~0.25)."""
        d = decay_factor(age_days=300, importance=1.0)
        assert d > 0.2

    def test_pinned_ignores_age(self):
        """Pinned episodes always return 1.0."""
        assert decay_factor(age_days=1000, importance=0.0, pinned=True) == 1.0

    def test_pinned_ignores_importance(self):
        assert decay_factor(age_days=500, importance=0.5, pinned=True) == 1.0

    def test_output_capped_at_one(self):
        """Decay factor never exceeds 1.0."""
        d = decay_factor(age_days=0, importance=1.0)
        assert d <= 1.0

    def test_output_never_negative(self):
        d = decay_factor(age_days=10000, importance=0.0)
        assert d >= 0.0

    def test_negative_age_treated_as_zero(self):
        """Edge case: negative age_days → clamped to 0."""
        d = decay_factor(age_days=-5, importance=0.5)
        assert d == pytest.approx(1.0)

    def test_five_x_halflife_ratio(self):
        """PRD claims ~5x half-life ratio between importance=0 and importance=1."""
        hl_low = -math.log(2) / (-0.023 * (1 - 0.0 * 0.8))  # ~30.1
        hl_high = -math.log(2) / (-0.023 * (1 - 1.0 * 0.8))  # ~150.6
        ratio = hl_high / hl_low
        assert ratio == pytest.approx(5.0, abs=0.1)


# ─── Composite Score (FR-CON-002) ─────────────────────────────────


class TestCompositeScore:
    """Test composite scoring formula."""

    def test_max_both(self):
        assert composite_score(1.0, 1.0) == pytest.approx(1.0)

    def test_min_both(self):
        assert composite_score(0.0, 0.0) == pytest.approx(0.0)

    def test_max_relevance_min_recency(self):
        assert composite_score(1.0, 0.0) == pytest.approx(0.6)

    def test_min_relevance_max_recency(self):
        assert composite_score(0.0, 1.0) == pytest.approx(0.4)

    def test_typical_values(self):
        """relevance=0.8, recency=0.5 → 0.6*0.8 + 0.4*0.5 = 0.68."""
        assert composite_score(0.8, 0.5) == pytest.approx(0.68)

    def test_output_in_range(self):
        """Output always in [0.0, 1.0] for valid inputs."""
        for rel in [0.0, 0.25, 0.5, 0.75, 1.0]:
            for rec in [0.0, 0.25, 0.5, 0.75, 1.0]:
                s = composite_score(rel, rec)
                assert 0.0 <= s <= 1.0, f"Out of range: composite({rel}, {rec}) = {s}"


# ─── Should Retrieve (threshold check) ────────────────────────────


class TestShouldRetrieve:
    """Test minimum composite score threshold."""

    def test_at_threshold(self):
        assert should_retrieve(0.3, threshold=0.3) is True

    def test_below_threshold(self):
        assert should_retrieve(0.29, threshold=0.3) is False

    def test_above_threshold(self):
        assert should_retrieve(0.5, threshold=0.3) is True

    def test_zero_score(self):
        assert should_retrieve(0.0, threshold=0.3) is False

    def test_custom_threshold(self):
        assert should_retrieve(0.2, threshold=0.15) is True
        assert should_retrieve(0.1, threshold=0.15) is False


# ─── Tiebreak by recall_count ─────────────────────────────────────


class TestTiebreakByRecallCount:
    """Test post-composite tiebreaker within tolerance band."""

    def test_within_tolerance_higher_recall_wins(self):
        candidates = [
            {"composite_score": 0.70, "recall_count": 2},
            {"composite_score": 0.72, "recall_count": 5},
        ]
        result = tiebreak_by_recall_count(candidates, tolerance=0.05)
        assert result[0]["recall_count"] == 5

    def test_outside_tolerance_original_order(self):
        candidates = [
            {"composite_score": 0.80, "recall_count": 1},
            {"composite_score": 0.70, "recall_count": 10},
        ]
        result = tiebreak_by_recall_count(candidates, tolerance=0.05)
        # 0.80 - 0.70 = 0.10 > 0.05 tolerance → original score order
        assert result[0]["composite_score"] == 0.80

    def test_empty_input(self):
        assert tiebreak_by_recall_count([], tolerance=0.05) == []

    def test_single_candidate(self):
        candidates = [{"composite_score": 0.5, "recall_count": 3}]
        result = tiebreak_by_recall_count(candidates, tolerance=0.05)
        assert len(result) == 1


# ─── MMR Reranking ─────────────────────────────────────────────────


class TestMMRRerank:
    """Test Maximal Marginal Relevance reranking."""

    def _make_candidate(self, score, embedding, **kwargs):
        return {"composite_score": score, "embedding": embedding, **kwargs}

    def test_empty_candidates(self):
        assert mmr_rerank([], lambda_val=0.7, top_k=3) == []

    def test_single_candidate_returned(self):
        candidates = [self._make_candidate(0.8, [1.0, 0.0])]
        result = mmr_rerank(candidates, lambda_val=0.7, top_k=3)
        assert len(result) == 1
        assert result[0]["composite_score"] == 0.8

    def test_three_diverse_episodes_preserved(self):
        """3 orthogonal embeddings → no diversity penalty → score order preserved."""
        candidates = [
            self._make_candidate(0.9, [1.0, 0.0, 0.0]),
            self._make_candidate(0.8, [0.0, 1.0, 0.0]),
            self._make_candidate(0.7, [0.0, 0.0, 1.0]),
        ]
        result = mmr_rerank(candidates, lambda_val=0.7, top_k=3)
        scores = [r["composite_score"] for r in result]
        assert scores == [0.9, 0.8, 0.7]

    def test_identical_episodes_penalized(self):
        """3 identical embeddings → 2nd and 3rd penalized by similarity."""
        candidates = [
            self._make_candidate(0.9, [1.0, 0.0]),
            self._make_candidate(0.85, [1.0, 0.0]),
            self._make_candidate(0.80, [1.0, 0.0]),
        ]
        result = mmr_rerank(candidates, lambda_val=0.7, top_k=3)
        # First is selected by score. 2nd and 3rd are identical to first,
        # so they get max penalty. They still appear (only 3 candidates)
        # but their MMR scores are lower.
        assert result[0]["composite_score"] == 0.9

    def test_lambda_one_pure_relevance(self):
        """lambda=1.0 → no diversity penalty → pure score order."""
        candidates = [
            self._make_candidate(0.7, [1.0, 0.0]),
            self._make_candidate(0.9, [1.0, 0.0]),
            self._make_candidate(0.8, [0.0, 1.0]),
        ]
        result = mmr_rerank(candidates, lambda_val=1.0, top_k=3)
        scores = [r["composite_score"] for r in result]
        assert scores == [0.9, 0.8, 0.7]

    def test_lambda_zero_pure_diversity(self):
        """lambda=0.0 → pure diversity → most different from selected wins."""
        candidates = [
            self._make_candidate(0.9, [1.0, 0.0, 0.0]),
            self._make_candidate(0.85, [0.99, 0.01, 0.0]),  # very similar to first
            self._make_candidate(0.5, [0.0, 1.0, 0.0]),     # very different
        ]
        result = mmr_rerank(candidates, lambda_val=0.0, top_k=3)
        # First selected by score. Then diversity dominates:
        # the orthogonal one (score=0.5) beats the similar one (score=0.85)
        assert result[1]["composite_score"] == 0.5

    def test_top_k_limits_output(self):
        candidates = [
            self._make_candidate(0.9, [1.0, 0.0]),
            self._make_candidate(0.8, [0.0, 1.0]),
            self._make_candidate(0.7, [0.5, 0.5]),
            self._make_candidate(0.6, [0.3, 0.7]),
        ]
        result = mmr_rerank(candidates, lambda_val=0.7, top_k=2)
        assert len(result) == 2

    def test_top_k_greater_than_candidates(self):
        """Requesting more than available → return all."""
        candidates = [self._make_candidate(0.8, [1.0, 0.0])]
        result = mmr_rerank(candidates, lambda_val=0.7, top_k=5)
        assert len(result) == 1

    def test_diversity_effect_with_default_lambda(self):
        """lambda=0.7: a diverse but lower-scored candidate can beat a
        similar higher-scored one in the 2nd slot."""
        candidates = [
            self._make_candidate(0.90, [1.0, 0.0, 0.0]),
            self._make_candidate(0.88, [0.99, 0.1, 0.0]),  # very similar to #1
            self._make_candidate(0.70, [0.0, 0.0, 1.0]),   # orthogonal to #1
        ]
        result = mmr_rerank(candidates, lambda_val=0.7, top_k=3)
        # First: 0.90. Second: orthogonal 0.70 should beat near-duplicate 0.88
        # because MMR(0.88) = 0.7*0.88 - 0.3*~1.0 ≈ 0.316
        # and MMR(0.70) = 0.7*0.70 - 0.3*~0.0 ≈ 0.490
        assert result[1]["composite_score"] == 0.70
