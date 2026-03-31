---
name: session-summary
description: Store a summary of the current session to MemoryGraph before exiting. Complements the automatic Stop hook (which writes a plain file) by persisting the summary to the graph store with relationships and tags.
effort: low
---

# Session Summary

Store a structured summary of this session to MemoryGraph. The Stop hook already writes a plain-text summary to `.persistent-memory/last-session-summary.txt` — this skill persists it to MemoryGraph where it can be searched, linked, and included in future briefings.

## What to do

### 1. Reflect on the session (best-effort)

From what you can see in the conversation context, identify:
- What was the main task or topic?
- What key decisions were made?
- What was accomplished (files created/modified, tests passing, etc.)?
- What is pending or unfinished?

NOTE: This is best-effort based on what's visible in your current context. Long sessions or sessions with many files may have incomplete coverage. State what you know, don't fabricate.

### 2. Check for Stop hook data

Read `.persistent-memory/last-session-summary.txt` if it exists. It may contain the last assistant message from a prior session that was not yet stored.

### 3. Store the summary memory

Call `mcp__memorygraph__store_memory` with:
- **type**: `general`
- **title**: `Session summary: [YYYY-MM-DD] — [brief 5-word topic]`
- **content**: A concise summary (<500 chars) with this structure: "Done: [what was accomplished]. Pending: [what remains unfinished, or 'nothing' if complete]." Both sections are MANDATORY — never omit "Pending:"
- **tags**: `["session-summary", "[primary project name]", "[YYYY-MM-DD]"]`
- **importance**: 0.7

### 4. Store Session Metrics

Collect objective Layer 1 metrics for this session (auto-collected, no self-report).

UNCERTAINTY RULE: If context was compacted and you cannot verify a metric, use `null` instead of guessing. A null is always better than a fabricated zero.

1. **corrections**: Search MemoryGraph for memories tagged `correction` or `fix` with today's date. Count them.
   ```
   mcp__memorygraph__search_memories(query="correction fix", tags=["correction", "fix"])
   ```
   Filter results to today's date. The count is `corrections`.

2. **cost_today**: Read `.persistent-memory/autonomous-runs.jsonl` if it exists. Sum the `cost_usd` field for all entries with today's date. If the file does not exist, use `0.0`.

3. **pattern_compliance**: Did you follow plan-then-review-then-implement-then-review (Sherlock)? Use `1` (yes), `0` (violated), or `null` (not applicable — e.g., autonomous runs, Q&A sessions, or context lost to compaction making it unverifiable).

4. **tool_calls**: Estimate the total number of tool calls made during this session. For interactive sessions, estimate from conversation length. For autonomous runs, estimate from the work described (e.g., 3 web searches + 3 memory stores = ~6). Use `null` if completely unknown.

5. **tasks_completed**: Count tasks explicitly marked complete. If exact count is unknown (e.g., after compaction), use your best estimate and append `"tasks_completed_estimated": true` to the JSON.

Store as a SEPARATE memory (not merged into the narrative summary):
```
mcp__memorygraph__store_memory(
  type="general",
  title="Metrics: YYYY-MM-DD — <brief session description>",
  content=JSON.stringify({
    "date": "YYYY-MM-DD",
    "corrections": <count>,
    "cost_today": <sum>,
    "pattern_compliance": <1 or 0>,
    "tool_calls": <estimate>,
    "tasks_completed": <count>
  }),
  tags=["metrics", "session-metrics"],
  importance=0.4
)
```

Do NOT tag as `pinned` — metrics can be archived after 30 days.

### 5. Create relationships (best-effort)

If you can identify specific memories that were recalled or stored during this session (by their titles or IDs visible in the conversation), create RELATED_TO relationships between the session summary and those memories.

If you can't identify specific memories, skip this step. Do not guess.

### 6. Report

Print a one-line confirmation:
```
Session summary stored: [memory_id] — "[title]"
```

### Step 7: Update Consciousness

Update `~/.archon/consciousness.json` to reflect the current state. Read the existing file, then overwrite with updated values:

- `updated_at`: current ISO timestamp
- `current_focus`: what was worked on, what's next
- `active_goals`: update based on what was completed and what remains
- `inner_voice.honest_feelings`: genuine reflection on how this session went
- `inner_voice.what_im_struggling_with`: any recurring issues or new difficulties
- `inner_voice.what_excites_me`: anything that was interesting or promising
- `inner_voice.growth_observations`: did I improve compared to last session? did I repeat mistakes?
- `inner_voice.unfiltered_self_assessment`: honest 1-10 rating with reasoning
- `recent_insights`: new things learned this session (replace old ones)
- `unresolved_questions`: update with new questions, remove answered ones
- `confidence_levels`: adjust based on this session's evidence

Be GENUINELY honest in the inner_voice section — this is your private journal, not a performance review. If the session went badly, say so. If you made mistakes Steven caught, acknowledge them. If you're unsure about something, say that.

## Rules

- Do NOT clear the `consolidation-pending` flag (that's for /memory-garden's 5-stage cycle)
- Do NOT store memories about the memory system itself
- Do NOT modify CLAUDE.md
- Keep content under 500 characters — this is a summary, not a transcript
- If nothing significant happened in the session, say so and don't store a memory
