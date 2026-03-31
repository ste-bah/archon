---
name: self-assess
description: Show Archon's performance trends — correction frequency, cost, pattern compliance, blind spots, and external evaluation scores. Queries session_metrics and haiku-eval memories from MemoryGraph.
---

# /self-assess — Archon Performance Self-Assessment

When the user invokes `/self-assess`, execute the following steps. This is a **read-only** skill — do NOT store any memories.

## Step 1: Gather Session Metrics

Search MemoryGraph for session metrics:

```
mcp__memorygraph__search_memories(query="session-metrics", limit=10)
```

Parse the JSON content from each result to extract these 5 metrics per session:
- **corrections** (integer): number of corrections in the session
- **cost** (float): estimated cost for the session/day
- **pattern_compliance** (string like "1/1" or "3/4"): pattern checks passed/total
- **tasks_completed** (integer): tasks finished
- **session_id** or **date**: for ordering

Sort results chronologically (oldest first).

## Step 2: Compute Trends

For each metric across the retrieved sessions, compute a trend direction:

**Trend rules** (need at least 2 data points):
- Compare the average of the first half to the average of the second half
- Change > 10% = directional trend; change <= 10% = stable

| Metric | Improving (up-arrow) | Regressing (down-arrow) | Stable (right-arrow) |
|--------|---------------------|------------------------|---------------------|
| Corrections | Fewer over time | More over time | Change <= 10% |
| Cost/day | Lower over time | Higher over time | Change <= 10% |
| Pattern compliance | Higher ratio over time | Lower ratio over time | Change <= 10% |
| Tasks completed | (informational only, no trend direction) | | |

## Step 3: Gather Blind Spots

Search MemoryGraph for known-unknown entries:

```
mcp__memorygraph__search_memories(query="known-unknown", limit=10)
```

Parse results to extract domain names and their correction counts. Filter to domains with 3 or more corrections.

## Step 4: Gather External Evaluation (Optional)

Search MemoryGraph for haiku-eval scores:

```
mcp__memorygraph__search_memories(query="haiku-eval", limit=10)
```

If results exist:
- Extract numeric scores from each result
- Compute the average score
- Compute trend direction using the same first-half vs second-half method

## Step 5: Display Results

Format and display the assessment report:

```
=== Archon Self-Assessment ===

Performance Trends (last N sessions):
  Corrections:     3 → 2 → 1 → 0    ↑ Improving
  Cost/day:        $3.50 → $2.80     ↑ Improving
  Pattern:         1/1 → 1/1 → 0/1   ↓ Regressing
  Tasks:           5, 3, 8, 4

Blind Spots (domains with 3+ corrections):
  - memory-system (4 corrections)
  - bash-scripting (3 corrections)

External Evaluation (Haiku):
  Average: 3.8/5 over 10 runs
  Trend: 3.5 → 4.0 → 3.8  → Stable

Data: N session metrics, M eval scores
```

Use the arrow symbols:
- `↑ Improving` — metric is getting better
- `→ Stable` — change is within 10%
- `↓ Regressing` — metric is getting worse

## Step 6: Handle Sparse Data

Apply these fallbacks when data is insufficient:

- **Fewer than 2 session metrics**: Display instead of the full report:
  ```
  Not enough data yet. Run /session-summary at the end of a few sessions to build the trend.
  ```

- **No blind spot memories found**: Show:
  ```
  Blind Spots: No known-unknown entries recorded yet.
  ```

- **No haiku-eval memories found**: Show:
  ```
  External Evaluation: Not yet configured.
  ```

- **Only 1 data point for a metric**: Show the single value without a trend arrow.

## Step 7: Personality Subsystem Status (v2 consciousness)

Search MemoryGraph for personality data and display 5 subsystem summaries.

### 7a. Computed Operational State

```
mcp__memorygraph__search_memories(tags=["self-state"], limit=1)
```

Parse the most recent AgentSelfState. Display:
- Primary state (confident/anxious/frustrated/engaged/cautious/neutral)
- Mood valence (-1.0 to +1.0)
- Somatic marker value and episode count

### 7b. Preference Profile

```
mcp__memorygraph__search_memories(tags=["preference"], limit=10)
```

Parse PreferenceEntry nodes. For each with evidence_count > 5, show approach, context, mean, and evidence count. Sort by evidence descending.

### 7c. Relationship Health

```
mcp__memorygraph__search_memories(tags=["trust"], limit=1)
```

Parse TrustState. Compute and display:
- Overall trust = 0.30 * competence + 0.45 * integrity + 0.25 * benevolence
- Health grade (A+ through F based on thresholds)
- Total violations and successes

### 7d. Curiosity Queue

```
mcp__memorygraph__search_memories(tags=["curiosity"], limit=5)
```

Parse CuriosityEncounter nodes. Show unsuppressed topics with interest scores.

### 7e. Personality Traits

```
mcp__memorygraph__search_memories(tags=["traits"], limit=1)
```

Parse PersonalityTraitSet. Display 6 trait means (OCEAN + Honesty-Humility) with visual bars. Show narrative if available.

### Display Format

Append to the existing report:

```
Personality (v2):
  State: neutral (mood: +0.12)
  Trust: B+ (0.74) | 2 violations, 15 successes
  Traits: conscientiousness=0.73, honesty_humility=0.71, openness=0.60
  Preferences: tdd-first in debug:py (0.82, 15 obs)
  Curiosity: HNSW indexing (score 0.7), TypeScript generics (0.5)
  Narrative: "High conscientiousness, moderate openness after 20 sessions."
```

If no personality data exists, show: `Personality (v2): Not yet initialized.`

## Rules

- This skill is **read-only** — it MUST NOT call `store_memory`, `update_memory`, `create_relationship`, or any write operation on MemoryGraph
- Trends require at least 2 data points; with only 1, show the value but no direction
- Threshold for stable vs directional: 10% change between first-half and second-half averages
- Pattern compliance ratio: parse as numerator/denominator, compute as percentage for trend comparison
- Always show the "Data: N session metrics, M eval scores" footer so the user knows the sample size
- Degrade gracefully — show whatever data exists, skip sections that have no data
- Personality data display follows GUARD-PER-003: only show via /self-assess, never unsolicited
- Use "computed state" not "feeling" or "emotion" (GUARD-PER-001)
