"""Episode merge algorithm for Archon Consciousness.

Extracted from episodic_memory.py to maintain the 500-line file limit.
Implements EC-CON-012: merge near-identical episodes.

Rules:
1. Pinned episode always survives
2. More non-null fields survives; tie → more recent
3. Union lesson_extracted (deduplicated)
4. Sum occurrence_counts
5. Transfer EVIDENCED_BY edges to survivor
6. Delete loser from both stores
"""

from src.archon_consciousness.schemas import Episode


def pick_survivor(
    name_a: str, ep_a: Episode, a_pinned: bool,
    name_b: str, ep_b: Episode, b_pinned: bool,
) -> tuple[str, str]:
    """Determine which episode survives a merge.

    Returns:
        (survivor_name, loser_name)
    """
    # Pinned always survives
    if a_pinned and not b_pinned:
        return name_a, name_b
    if b_pinned and not a_pinned:
        return name_b, name_a

    # Compare non-null field counts
    a_count = nonnull_count(ep_a)
    b_count = nonnull_count(ep_b)
    if a_count > b_count:
        return name_a, name_b
    if b_count > a_count:
        return name_b, name_a

    # Tie: more recent wins
    if ep_a.timestamp >= ep_b.timestamp:
        return name_a, name_b
    return name_b, name_a


def nonnull_count(ep: Episode) -> int:
    """Count non-empty/non-default fields for merge comparison."""
    count = 0
    if ep.trigger:
        count += 1
    if ep.context:
        count += 1
    if ep.action_taken:
        count += 1
    if ep.outcome:
        count += 1
    if ep.emotional_valence:
        count += 1
    if ep.lesson_extracted:
        count += 1
    if ep.keywords:
        count += 1
    if ep.tags:
        count += 1
    return count


def union_lessons(lesson_a: str, lesson_b: str) -> str:
    """Union two lesson_extracted strings, deduplicated by exact match."""
    if lesson_a == lesson_b:
        return lesson_a
    parts_a = [p.strip() for p in lesson_a.split(";") if p.strip()]
    parts_b = [p.strip() for p in lesson_b.split(";") if p.strip()]
    if len(parts_a) <= 1 and ";" not in lesson_a:
        parts_a = [lesson_a]
    if len(parts_b) <= 1 and ";" not in lesson_b:
        parts_b = [lesson_b]
    seen = set()
    combined = []
    for part in parts_a + parts_b:
        if part not in seen:
            seen.add(part)
            combined.append(part)
    return "; ".join(combined)
