"""Conflict detection for branch merge memory reconciliation.

REQ-GITM-006: Detect semantically similar but opposing memories when
merging branch memories into a target branch. Uses LanceDB embeddings
with Jaccard fallback, plus heuristic polarity analysis.
"""

import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Single-token only — multi-word phrases ("do not") can't match via set intersection
_NEGATION_WORDS = frozenset([
    "never", "not", "don't", "dont", "avoid", "stop",
    "shouldn't", "mustn't", "no",
])

_STOP_WORDS = frozenset([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall",
    "should", "may", "might", "must", "can", "could", "to", "of", "in",
    "for", "on", "with", "at", "by", "from", "as", "into", "through",
    "during", "before", "after", "above", "below", "between", "this",
    "that", "these", "those", "it", "its", "and", "or", "but", "if",
])

_OPPOSITE_PAIRS = [
    ("always", "never"),
    ("sync", "async"),
    ("synchronous", "asynchronous"),
    ("mutable", "immutable"),
    ("allow", "deny"),
    ("enable", "disable"),
    ("include", "exclude"),
    ("add", "remove"),
    ("camelcase", "snake_case"),
    ("camelcase", "snakecase"),
    ("uppercase", "lowercase"),
    ("public", "private"),
    ("dynamic", "static"),
]

RESOLUTION_OPTIONS = {
    "keep-target": "Discard branch memory (branch experiment failed)",
    "keep-branch": "Replace target memory (branch discovered better approach)",
    "keep-both": "Tag both as context-dependent (valid in different situations)",
    "merge-manual": "User writes a synthesized lesson that supersedes both",
}

# ---------------------------------------------------------------------------
# Similarity
# ---------------------------------------------------------------------------


def _jaccard_fallback(text_a: str, text_b: str) -> float:
    """Word-overlap Jaccard similarity as fallback when LanceDB unavailable."""
    words_a = set(text_a.lower().split())
    words_b = set(text_b.lower().split())
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union)


def lance_cosine_similarity(text_a: str, text_b: str) -> float:
    """Compute cosine similarity between two texts using LanceDB embeddings.

    Falls back to Jaccard word-overlap if LanceDB is unavailable.
    Returns float in [0.0, 1.0].
    """
    try:
        from archon_consciousness.episodic_memory import get_episodic_memory
        em = get_episodic_memory()
        embedding_fn = em._embedding_fn
        vec_a = embedding_fn([text_a])[0]
        vec_b = embedding_fn([text_b])[0]
        dot = sum(a * b for a, b in zip(vec_a, vec_b))
        norm_a = sum(a * a for a in vec_a) ** 0.5
        norm_b = sum(b * b for b in vec_b) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return max(0.0, min(1.0, dot / (norm_a * norm_b)))
    except Exception as e:
        logger.debug(f"LanceDB unavailable, using Jaccard fallback: {e}")
        return _jaccard_fallback(text_a, text_b)


# ---------------------------------------------------------------------------
# Heuristic contradiction detection
# ---------------------------------------------------------------------------


def lessons_contradict(lesson_a: Optional[str], lesson_b: Optional[str]) -> Optional[str]:
    """Check if two lessons express opposing guidance.

    Returns contradiction type ("negation", "opposite_action", "value_conflict")
    or None if no contradiction detected.
    """
    if not lesson_a or not lesson_b:
        return None

    a_lower = lesson_a.lower()
    b_lower = lesson_b.lower()

    # Strategy 1: Negation detection
    a_words = set(a_lower.split())
    b_words = set(b_lower.split())

    a_has_negation = bool(a_words & _NEGATION_WORDS)
    b_has_negation = bool(b_words & _NEGATION_WORDS)

    if a_has_negation != b_has_negation:
        content_a = a_words - _NEGATION_WORDS - _STOP_WORDS
        content_b = b_words - _NEGATION_WORDS - _STOP_WORDS
        if content_a and content_b:
            overlap = len(content_a & content_b) / min(len(content_a), len(content_b))
            if overlap >= 0.4:
                return "negation"

    # Strategy 2: Opposite action pairs (word-boundary match, not substring)
    for word_a, word_b in _OPPOSITE_PAIRS:
        a_has_wa = re.search(r'\b' + re.escape(word_a) + r'\b', a_lower)
        a_has_wb = re.search(r'\b' + re.escape(word_b) + r'\b', a_lower)
        b_has_wa = re.search(r'\b' + re.escape(word_a) + r'\b', b_lower)
        b_has_wb = re.search(r'\b' + re.escape(word_b) + r'\b', b_lower)
        if (a_has_wa and b_has_wb) or (a_has_wb and b_has_wa):
            return "opposite_action"

    # Strategy 3: Value conflict — "X should be/use Y" vs "X should be/use Z"
    pattern = r"should (?:be|use) (\S+)"
    match_a = re.search(pattern, a_lower)
    match_b = re.search(pattern, b_lower)
    if match_a and match_b:
        value_a = match_a.group(1)
        value_b = match_b.group(1)
        if value_a != value_b:
            subject_a = a_lower[:match_a.start()].strip().split()[-1:] if match_a.start() > 0 else []
            subject_b = b_lower[:match_b.start()].strip().split()[-1:] if match_b.start() > 0 else []
            if subject_a and subject_b and subject_a == subject_b:
                return "value_conflict"

    return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_lesson(memory: dict) -> str:
    """Extract the lesson from a memory dict, falling back to content."""
    lesson = memory.get("lesson_extracted")
    if lesson:
        return lesson
    return memory.get("content", "")


def _find_similar_pairs(
    source_memory: dict,
    candidates: list[dict],
    threshold: float,
) -> list[tuple[dict, float]]:
    """Find candidate memories with cosine similarity above threshold."""
    source_content = source_memory.get("content", "")
    if not source_content:
        return []

    results = []
    for candidate in candidates:
        candidate_content = candidate.get("content", "")
        if not candidate_content:
            continue
        sim = lance_cosine_similarity(source_content, candidate_content)
        if sim >= threshold:
            results.append((candidate, sim))

    return results


# ---------------------------------------------------------------------------
# Core detection
# ---------------------------------------------------------------------------


def detect_contradictions(
    branch_memories: list[dict],
    target_memories: list[dict],
    similarity_threshold: float = 0.85,
    max_conflicts: int = 5,
) -> list[dict]:
    """Find memories that are semantically similar but have opposing lessons.

    EC-GITM-004: If > 20 raw conflicts, returns only top max_conflicts by similarity.
    Pass max_conflicts=None for unlimited.
    """
    conflicts = []
    for bm in branch_memories:
        similar_targets = _find_similar_pairs(bm, target_memories, similarity_threshold)
        for tm, similarity in similar_targets:
            contradiction = lessons_contradict(
                _extract_lesson(bm),
                _extract_lesson(tm),
            )
            if contradiction is not None:
                conflicts.append({
                    "branch_memory_id": bm["id"],
                    "target_memory_id": tm["id"],
                    "branch_memory_content": bm.get("content", ""),
                    "target_memory_content": tm.get("content", ""),
                    "branch_lesson": _extract_lesson(bm),
                    "target_lesson": _extract_lesson(tm),
                    "similarity": similarity,
                    "contradiction_type": contradiction,
                })

    conflicts.sort(key=lambda c: c["similarity"], reverse=True)

    if max_conflicts is not None and len(conflicts) > max_conflicts:
        conflicts = conflicts[:max_conflicts]

    return conflicts


# ---------------------------------------------------------------------------
# Conflict tagging
# ---------------------------------------------------------------------------


def tag_conflicts(
    conflicts: list[dict],
    merge_sha: str,
    client=None,
) -> int:
    """Tag conflicting memory pairs in MemoryGraph.

    Both memories get conflict:merge-{SHA} and conflict-type:{type} tags.
    Idempotent: skips already-tagged memories.
    Returns number of memories tagged.
    """
    if client is None:
        from archon_consciousness.mcp_client import get_memorygraph_client
        client = get_memorygraph_client()

    tagged = 0
    for conflict in conflicts:
        conflict_tag = f"conflict:merge-{merge_sha}"
        type_tag = f"conflict-type:{conflict['contradiction_type']}"

        for mem_id_key in ("branch_memory_id", "target_memory_id"):
            mem_id = conflict[mem_id_key]
            mem = client.get_memory(mem_id)
            if mem is None:
                continue
            existing_tags = mem.get("tags", [])
            if conflict_tag in existing_tags:
                continue
            new_tags = list(dict.fromkeys(existing_tags + [conflict_tag, type_tag]))
            client.update_memory(mem_id, tags=new_tags)
            tagged += 1

    return tagged


# ---------------------------------------------------------------------------
# Conflict resolution
# ---------------------------------------------------------------------------


def _add_tags(client, memory_id: str, new_tags: list[str]) -> None:
    """Add tags to a memory without removing existing tags."""
    mem = client.get_memory(memory_id)
    if mem is None:
        return
    existing = mem.get("tags", [])
    combined = list(dict.fromkeys(existing + new_tags))
    client.update_memory(memory_id, tags=combined)


def resolve_conflict(
    conflict: dict,
    resolution: str,
    synthesized_lesson: Optional[str] = None,
    client=None,
) -> dict:
    """Apply user-chosen resolution to a conflict pair.

    Raises ValueError for invalid resolution or missing synthesized_lesson.
    """
    if resolution not in RESOLUTION_OPTIONS:
        raise ValueError(
            f"Invalid resolution: {resolution}. "
            f"Must be one of: {list(RESOLUTION_OPTIONS.keys())}"
        )
    if resolution == "merge-manual" and not synthesized_lesson:
        raise ValueError("synthesized_lesson is required for 'merge-manual' resolution")

    if client is None:
        from archon_consciousness.mcp_client import get_memorygraph_client
        client = get_memorygraph_client()

    branch_id = conflict["branch_memory_id"]
    target_id = conflict["target_memory_id"]
    resolved_tag = "conflict-resolved:true"

    if resolution == "keep-target":
        _add_tags(client, branch_id, [resolved_tag, "superseded:true"])
        _add_tags(client, target_id, [resolved_tag])
        return {
            "action": "keep-target",
            "details": f"Branch memory {branch_id} superseded by target {target_id}",
        }

    elif resolution == "keep-branch":
        _add_tags(client, target_id, [resolved_tag, "superseded:true"])
        _add_tags(client, branch_id, [resolved_tag])
        return {
            "action": "keep-branch",
            "details": f"Target memory {target_id} superseded by branch {branch_id}",
        }

    elif resolution == "keep-both":
        _add_tags(client, branch_id, [resolved_tag, "context-dependent:true"])
        _add_tags(client, target_id, [resolved_tag, "context-dependent:true"])
        return {
            "action": "keep-both",
            "details": "Both memories marked context-dependent",
        }

    elif resolution == "merge-manual":
        _add_tags(client, branch_id, [resolved_tag, "superseded:true"])
        _add_tags(client, target_id, [resolved_tag, "superseded:true"])
        client.store_memory(
            name=f"synthesized-{branch_id[:8]}-{target_id[:8]}",
            memory_type="general",
            content=synthesized_lesson,
            importance=0.7,
            tags=["synthesized", resolved_tag,
                  f"source:{branch_id}", f"source:{target_id}"],
        )
        return {
            "action": "merge-manual",
            "details": "New synthesized memory created, both originals superseded",
        }
