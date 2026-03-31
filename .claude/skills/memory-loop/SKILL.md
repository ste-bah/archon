---
name: memory-loop
description: Start the memory consolidation loop. Runs one consolidation stage every 30 minutes via /loop. Stages rotate: decay → duplicates → merge → relationships → briefing.
---

# Memory Consolidation Loop

Start the memory consolidation loop that runs one stage per cycle every 30 minutes.

## What to do

1. Read the consolidation cursor from `.persistent-memory/consolidation-cursor.json` (create if missing)
2. Determine the next stage based on `lastStage`:
   - After null or "stage-5" → run Stage 1 (decay)
   - After "stage-1" → run Stage 2 (duplicate detection)
   - After "stage-2" → run Stage 3 (cluster merging)
   - After "stage-3" → run Stage 4 (relationship discovery)
   - After "stage-4" → run Stage 5 (briefing generation)

3. Execute ONLY that one stage (see /memory-garden for stage details)
4. Update the cursor file
5. Report one line: "Memory garden: Stage N complete. [details]"

## Stage Quick Reference

**Stage 1 (Decay)**: Search 50 memories, apply `importance * exp(-days/half_life)` per type
**Stage 2 (Duplicates)**: Compare 100 memory titles, flag >50% word overlap pairs
**Stage 3 (Merge)**: Merge flagged pairs, archive donors at importance 0.01
**Stage 4 (Relationships)**: Link memories sharing 2+ tags with RELATED_TO
**Stage 5 (Briefing)**: Write top 10 by importance to `.persistent-memory/briefing.md`

## To start the loop

Use: `/loop 30m /memory-loop`

## Rules
- Complete in <2 minutes per cycle
- Process at most 50 memories per stage
- Do NOT create memories about the memory system
- Do NOT modify CLAUDE.md
