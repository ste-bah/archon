"""Tests for conflict detection during branch merge."""

import re
from unittest.mock import MagicMock, patch

import pytest

from src.archon_consciousness.conflict_detection import (
    RESOLUTION_OPTIONS,
    _extract_lesson,
    _find_similar_pairs,
    _jaccard_fallback,
    detect_contradictions,
    lance_cosine_similarity,
    lessons_contradict,
    resolve_conflict,
    tag_conflicts,
)


# ---------------------------------------------------------------------------
# lessons_contradict
# ---------------------------------------------------------------------------


class TestLessonsContradict:
    def test_negation_always_vs_never(self):
        result = lessons_contradict("always use async", "never use async")
        assert result == "negation"

    def test_negation_do_vs_dont(self):
        result = lessons_contradict("use mocks for testing", "don't use mocks for testing")
        assert result == "negation"

    def test_negation_avoid(self):
        result = lessons_contradict("use global state for config", "avoid global state for config")
        assert result == "negation"

    def test_opposite_action_sync_async(self):
        result = lessons_contradict("sync is fine for queries", "async is required for queries")
        assert result == "opposite_action"

    def test_opposite_action_add_remove(self):
        result = lessons_contradict("add logging to handlers", "remove logging from handlers")
        assert result == "opposite_action"

    def test_opposite_action_public_private(self):
        result = lessons_contradict("methods should be public", "methods should be private")
        assert result == "opposite_action"

    def test_opposite_action_enable_disable(self):
        result = lessons_contradict("enable caching for API", "disable caching for API")
        assert result == "opposite_action"

    def test_value_conflict_case_convention(self):
        # "snake_case" vs "camelCase" hits opposite_action first because
        # _OPPOSITE_PAIRS includes (camelcase, snake_case). This is correct
        # behavior — opposite_action is checked before value_conflict.
        result = lessons_contradict(
            "field X should be snake_case",
            "field X should be camelCase",
        )
        assert result == "opposite_action"

    def test_value_conflict_different_values(self):
        result = lessons_contradict(
            "timeout should be 30",
            "timeout should be 60",
        )
        assert result == "value_conflict"

    def test_no_contradiction_identical(self):
        result = lessons_contradict("use pytest", "use pytest")
        assert result is None

    def test_no_contradiction_unrelated(self):
        result = lessons_contradict("add error handling", "improve test coverage")
        assert result is None

    def test_empty_input_a(self):
        assert lessons_contradict("", "anything") is None

    def test_empty_input_b(self):
        assert lessons_contradict("something", "") is None

    def test_both_empty(self):
        assert lessons_contradict("", "") is None

    def test_none_input(self):
        assert lessons_contradict(None, None) is None

    def test_none_and_string(self):
        assert lessons_contradict(None, "something") is None

    def test_both_negated_not_contradiction(self):
        """If both lessons are negated, they agree — not a contradiction."""
        result = lessons_contradict("never use eval", "don't use eval")
        assert result is None

    def test_negation_requires_content_overlap(self):
        """Negation only fires when shared content words >= 40%.
        Note: 'always'/'never' are an opposite_action pair, so avoid those."""
        result = lessons_contradict("avoid eating pizza at lunch", "do not write tests at night")
        # Low content overlap (pizza/lunch vs tests/night) → no negation
        assert result is None

    def test_no_false_positive_substring_add_in_address(self):
        """'add' should not match inside 'address'."""
        result = lessons_contradict("use address validation", "remove old entries")
        assert result is None

    def test_no_false_positive_substring_public_in_publication(self):
        """'public' should not match inside 'publication'."""
        result = lessons_contradict("check publication date", "use private keys")
        assert result is None

    def test_no_false_positive_substring_enable_in_enabled(self):
        """'enable' as full word should still work, 'enabled' should not falsely trigger."""
        # "enabled" has no opposite pair word in other string
        result = lessons_contradict("feature is enabled by default", "feature is configured at startup")
        assert result is None

    def test_opposite_action_still_works_with_word_boundary(self):
        """Full-word matches for opposite pairs should still trigger."""
        assert lessons_contradict("enable caching", "disable caching") == "opposite_action"
        assert lessons_contradict("add logging", "remove logging") == "opposite_action"
        assert lessons_contradict("public API endpoint", "private API endpoint") == "opposite_action"


# ---------------------------------------------------------------------------
# _jaccard_fallback
# ---------------------------------------------------------------------------


class TestJaccardFallback:
    def test_identical_strings(self):
        assert _jaccard_fallback("a b c", "a b c") == 1.0

    def test_partial_overlap(self):
        result = _jaccard_fallback("a b c", "a b d")
        assert abs(result - 0.5) < 0.01  # 2 shared / 4 union

    def test_no_overlap(self):
        assert _jaccard_fallback("a b", "c d") == 0.0

    def test_empty_a(self):
        assert _jaccard_fallback("", "a b") == 0.0

    def test_empty_b(self):
        assert _jaccard_fallback("a b", "") == 0.0

    def test_both_empty(self):
        assert _jaccard_fallback("", "") == 0.0

    def test_case_insensitive(self):
        assert _jaccard_fallback("Hello World", "hello world") == 1.0


# ---------------------------------------------------------------------------
# lance_cosine_similarity (always falls back to Jaccard in tests)
# ---------------------------------------------------------------------------


class TestLanceCosineSimilarity:
    def test_returns_float(self):
        result = lance_cosine_similarity("test text", "test text again")
        assert isinstance(result, float)

    def test_in_range(self):
        result = lance_cosine_similarity("hello world", "goodbye moon")
        assert 0.0 <= result <= 1.0

    def test_identical_strings_high_similarity(self):
        result = lance_cosine_similarity("exact same text", "exact same text")
        assert result >= 0.9

    def test_unrelated_strings_low_similarity(self):
        result = lance_cosine_similarity("quantum physics", "chocolate cake recipe")
        assert result < 0.5

    def test_falls_back_to_jaccard_when_lance_unavailable(self):
        """LanceDB won't be available in test env — Jaccard is the fallback."""
        result = lance_cosine_similarity("a b c", "a b d")
        expected_jaccard = 0.5  # 2/4
        assert abs(result - expected_jaccard) < 0.01


# ---------------------------------------------------------------------------
# _find_similar_pairs
# ---------------------------------------------------------------------------


class TestFindSimilarPairs:
    def test_finds_similar_pair(self):
        source = {"id": "s1", "content": "use async for database calls"}
        candidates = [
            {"id": "c1", "content": "use async for database calls"},
            {"id": "c2", "content": "completely unrelated topic about cooking"},
        ]
        results = _find_similar_pairs(source, candidates, threshold=0.5)
        ids = [c["id"] for c, _ in results]
        assert "c1" in ids

    def test_empty_source_content(self):
        source = {"id": "s1", "content": ""}
        candidates = [{"id": "c1", "content": "something"}]
        assert _find_similar_pairs(source, candidates, threshold=0.1) == []

    def test_empty_candidates(self):
        source = {"id": "s1", "content": "something"}
        assert _find_similar_pairs(source, [], threshold=0.1) == []

    def test_no_content_key_in_source(self):
        source = {"id": "s1"}
        candidates = [{"id": "c1", "content": "text"}]
        assert _find_similar_pairs(source, candidates, threshold=0.1) == []

    def test_skip_candidate_without_content(self):
        source = {"id": "s1", "content": "hello world"}
        candidates = [{"id": "c1"}, {"id": "c2", "content": ""}]
        assert _find_similar_pairs(source, candidates, threshold=0.1) == []

    def test_threshold_filtering(self):
        source = {"id": "s1", "content": "a b c d"}
        candidates = [
            {"id": "c1", "content": "a b c d"},  # Jaccard 1.0
            {"id": "c2", "content": "a b x y"},  # Jaccard 0.33
        ]
        # High threshold should only return c1
        results = _find_similar_pairs(source, candidates, threshold=0.9)
        assert len(results) == 1
        assert results[0][0]["id"] == "c1"


# ---------------------------------------------------------------------------
# _extract_lesson
# ---------------------------------------------------------------------------


class TestExtractLesson:
    def test_extracts_lesson_extracted_field(self):
        mem = {"content": "some content", "lesson_extracted": "the lesson"}
        assert _extract_lesson(mem) == "the lesson"

    def test_falls_back_to_content(self):
        mem = {"content": "some content"}
        assert _extract_lesson(mem) == "some content"

    def test_empty_lesson_falls_back(self):
        mem = {"content": "fallback", "lesson_extracted": ""}
        assert _extract_lesson(mem) == "fallback"

    def test_no_content_or_lesson(self):
        assert _extract_lesson({}) == ""

    def test_none_lesson(self):
        mem = {"content": "text", "lesson_extracted": None}
        assert _extract_lesson(mem) == "text"


# ---------------------------------------------------------------------------
# detect_contradictions
# ---------------------------------------------------------------------------


class TestDetectContradictions:
    def _make_mem(self, id_, content, lesson=None):
        m = {"id": id_, "content": content}
        if lesson:
            m["lesson_extracted"] = lesson
        return m

    def test_detects_contradiction(self):
        branch = [self._make_mem("b1", "always use async for DB calls",
                                 "always use async for DB calls")]
        target = [self._make_mem("t1", "never use async for DB calls",
                                 "never use async for DB calls")]
        # Mock similarity to be high
        with patch("src.archon_consciousness.conflict_detection.lance_cosine_similarity", return_value=0.95):
            conflicts = detect_contradictions(branch, target, similarity_threshold=0.85)
        assert len(conflicts) == 1
        assert conflicts[0]["contradiction_type"] == "negation"
        assert conflicts[0]["branch_memory_id"] == "b1"
        assert conflicts[0]["target_memory_id"] == "t1"

    def test_no_similar_memories_no_conflicts(self):
        branch = [self._make_mem("b1", "use async")]
        target = [self._make_mem("t1", "completely different topic")]
        with patch("src.archon_consciousness.conflict_detection.lance_cosine_similarity", return_value=0.1):
            conflicts = detect_contradictions(branch, target)
        assert conflicts == []

    def test_similar_but_not_contradictory(self):
        branch = [self._make_mem("b1", "use pytest for testing", "use pytest for testing")]
        target = [self._make_mem("t1", "use pytest for testing", "use pytest for testing")]
        with patch("src.archon_consciousness.conflict_detection.lance_cosine_similarity", return_value=0.99):
            conflicts = detect_contradictions(branch, target)
        assert conflicts == []

    def test_caps_at_max_conflicts(self):
        """EC-GITM-004: > 20 conflicts → return only top 5."""
        branch = [self._make_mem(f"b{i}", f"always use pattern {i}",
                                 f"always use pattern {i}") for i in range(25)]
        target = [self._make_mem(f"t{i}", f"never use pattern {i}",
                                 f"never use pattern {i}") for i in range(25)]

        # Return decreasing similarity so sorting is verifiable
        call_count = [0]
        def mock_sim(a, b):
            call_count[0] += 1
            return 0.99 - (call_count[0] * 0.001)

        with patch("src.archon_consciousness.conflict_detection.lance_cosine_similarity", side_effect=mock_sim):
            conflicts = detect_contradictions(branch, target, max_conflicts=5)
        assert len(conflicts) == 5
        # Should be sorted by similarity descending
        sims = [c["similarity"] for c in conflicts]
        assert sims == sorted(sims, reverse=True)

    def test_max_conflicts_none_returns_all(self):
        """Each branch mem matches ALL targets (mocked similarity), so
        10 branch × 10 target = 100 pairs all contradicting."""
        branch = [self._make_mem(f"b{i}", f"always do thing {i}",
                                 f"always do thing {i}") for i in range(10)]
        target = [self._make_mem(f"t{i}", f"never do thing {i}",
                                 f"never do thing {i}") for i in range(10)]
        with patch("src.archon_consciousness.conflict_detection.lance_cosine_similarity", return_value=0.95):
            conflicts = detect_contradictions(branch, target, max_conflicts=None)
        # 10 × 10 = 100 pairs, all contradictory (always vs never)
        assert len(conflicts) == 100

    def test_empty_branch_memories(self):
        target = [self._make_mem("t1", "something")]
        assert detect_contradictions([], target) == []

    def test_empty_target_memories(self):
        branch = [self._make_mem("b1", "something")]
        assert detect_contradictions(branch, []) == []

    def test_memory_without_content_skipped(self):
        branch = [{"id": "b1"}]  # no content
        target = [self._make_mem("t1", "something")]
        with patch("src.archon_consciousness.conflict_detection.lance_cosine_similarity", return_value=0.95):
            assert detect_contradictions(branch, target) == []

    def test_conflict_contains_all_required_fields(self):
        branch = [self._make_mem("b1", "always use X", "always use X")]
        target = [self._make_mem("t1", "never use X", "never use X")]
        with patch("src.archon_consciousness.conflict_detection.lance_cosine_similarity", return_value=0.95):
            conflicts = detect_contradictions(branch, target)
        c = conflicts[0]
        required = {"branch_memory_id", "target_memory_id", "branch_memory_content",
                     "target_memory_content", "branch_lesson", "target_lesson",
                     "similarity", "contradiction_type"}
        assert required.issubset(c.keys())


# ---------------------------------------------------------------------------
# tag_conflicts
# ---------------------------------------------------------------------------


class TestTagConflicts:
    def _mock_client(self, memories):
        """Create a mock MemoryGraph client with get_memory and update_memory."""
        store = {m["id"]: dict(m) for m in memories}
        client = MagicMock()
        client.get_memory = lambda mid: store.get(mid)
        def update(mid, tags):
            if mid in store:
                store[mid]["tags"] = tags
        client.update_memory = lambda mid, tags: update(mid, tags)
        client._store = store
        return client

    def test_tags_both_memories(self):
        client = self._mock_client([
            {"id": "b1", "tags": ["branch:feat"]},
            {"id": "t1", "tags": ["branch:main"]},
        ])
        conflicts = [{
            "branch_memory_id": "b1",
            "target_memory_id": "t1",
            "contradiction_type": "negation",
        }]
        count = tag_conflicts(conflicts, "abc1234", client=client)
        assert count == 2
        assert "conflict:merge-abc1234" in client._store["b1"]["tags"]
        assert "conflict:merge-abc1234" in client._store["t1"]["tags"]
        assert "conflict-type:negation" in client._store["b1"]["tags"]

    def test_idempotent(self):
        client = self._mock_client([
            {"id": "b1", "tags": ["conflict:merge-abc1234"]},
            {"id": "t1", "tags": ["conflict:merge-abc1234"]},
        ])
        conflicts = [{
            "branch_memory_id": "b1",
            "target_memory_id": "t1",
            "contradiction_type": "negation",
        }]
        count = tag_conflicts(conflicts, "abc1234", client=client)
        assert count == 0  # Already tagged

    def test_missing_memory_skipped(self):
        client = self._mock_client([
            {"id": "b1", "tags": []},
            # t1 does NOT exist
        ])
        conflicts = [{
            "branch_memory_id": "b1",
            "target_memory_id": "t1_missing",
            "contradiction_type": "negation",
        }]
        count = tag_conflicts(conflicts, "abc1234", client=client)
        assert count == 1  # Only b1 tagged


# ---------------------------------------------------------------------------
# resolve_conflict
# ---------------------------------------------------------------------------


class TestResolveConflict:
    def _mock_client(self, memories):
        store = {m["id"]: dict(m) for m in memories}
        client = MagicMock()
        client.get_memory = lambda mid: store.get(mid)
        def update(mid, tags):
            if mid in store:
                store[mid]["tags"] = tags
        client.update_memory = lambda mid, tags: update(mid, tags)
        client.store_memory = MagicMock()
        client._store = store
        return client

    def _conflict(self):
        return {
            "branch_memory_id": "b1",
            "target_memory_id": "t1",
            "contradiction_type": "negation",
            "similarity": 0.95,
        }

    def test_keep_target(self):
        client = self._mock_client([
            {"id": "b1", "tags": ["branch:feat"]},
            {"id": "t1", "tags": ["branch:main"]},
        ])
        result = resolve_conflict(self._conflict(), "keep-target", client=client)
        assert result["action"] == "keep-target"
        assert "superseded:true" in client._store["b1"]["tags"]
        assert "conflict-resolved:true" in client._store["t1"]["tags"]
        assert "superseded:true" not in client._store["t1"]["tags"]

    def test_keep_branch(self):
        client = self._mock_client([
            {"id": "b1", "tags": ["branch:feat"]},
            {"id": "t1", "tags": ["branch:main"]},
        ])
        result = resolve_conflict(self._conflict(), "keep-branch", client=client)
        assert result["action"] == "keep-branch"
        assert "superseded:true" in client._store["t1"]["tags"]
        assert "superseded:true" not in client._store["b1"]["tags"]

    def test_keep_both(self):
        client = self._mock_client([
            {"id": "b1", "tags": []},
            {"id": "t1", "tags": []},
        ])
        result = resolve_conflict(self._conflict(), "keep-both", client=client)
        assert result["action"] == "keep-both"
        assert "context-dependent:true" in client._store["b1"]["tags"]
        assert "context-dependent:true" in client._store["t1"]["tags"]

    def test_merge_manual(self):
        client = self._mock_client([
            {"id": "b1", "tags": []},
            {"id": "t1", "tags": []},
        ])
        result = resolve_conflict(
            self._conflict(), "merge-manual",
            synthesized_lesson="Use async for large queries, sync for small ones",
            client=client,
        )
        assert result["action"] == "merge-manual"
        assert "superseded:true" in client._store["b1"]["tags"]
        assert "superseded:true" in client._store["t1"]["tags"]
        client.store_memory.assert_called_once()
        _, kwargs = client.store_memory.call_args
        assert "synthesized" in kwargs.get("tags", [])

    def test_merge_manual_without_lesson_raises(self):
        client = self._mock_client([{"id": "b1", "tags": []}, {"id": "t1", "tags": []}])
        with pytest.raises(ValueError, match="synthesized_lesson"):
            resolve_conflict(self._conflict(), "merge-manual", client=client)

    def test_merge_manual_with_empty_lesson_raises(self):
        client = self._mock_client([{"id": "b1", "tags": []}, {"id": "t1", "tags": []}])
        with pytest.raises(ValueError, match="synthesized_lesson"):
            resolve_conflict(self._conflict(), "merge-manual",
                             synthesized_lesson="", client=client)

    def test_invalid_resolution_raises(self):
        client = self._mock_client([{"id": "b1", "tags": []}, {"id": "t1", "tags": []}])
        with pytest.raises(ValueError, match="Invalid resolution"):
            resolve_conflict(self._conflict(), "invalid-option", client=client)

    def test_all_resolution_options_documented(self):
        assert len(RESOLUTION_OPTIONS) == 4
        assert "keep-target" in RESOLUTION_OPTIONS
        assert "keep-branch" in RESOLUTION_OPTIONS
        assert "keep-both" in RESOLUTION_OPTIONS
        assert "merge-manual" in RESOLUTION_OPTIONS
