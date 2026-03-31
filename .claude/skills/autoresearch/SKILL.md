---
name: autoresearch
description: "Autonomous self-improvement loop for Claude Code skills. Applies Karpathy's autoresearch pattern: edit, run, score, keep/discard, repeat. Improves any skill by running N experiments with binary eval scoring."
user-invocable: true
arguments: "<skill-name> [--iterations N] [--dry-run]"
---

# Autoresearch: Autonomous Skill Improvement

Applies the Karpathy autoresearch loop to improve any Claude Code skill autonomously.
The pattern: edit the skill, run it on test cases, score the output, keep or discard, repeat.

## Quick Reference

```
/autoresearch <skill-name>                  # Full 3-phase run (default 10 iterations)
/autoresearch <skill-name> --iterations 20  # More experiments
/autoresearch <skill-name> --dry-run        # Phase 1 only (setup + baseline, no mutations)
```

## Overview

Three phases:
1. **Setup** (human approves) -- analyze skill, generate test cases, build eval rubric, run baseline
2. **Loop** (autonomous) -- mutate SKILL.md, run tests, score, keep/discard, repeat N times
3. **Debrief** (human reviews) -- before/after comparison, learnings stored to memory

---

## Phase 1: Setup

### Step 1.1: Identify the Target Skill

Parse the argument to find the skill:
- Search `.claude/skills/*/SKILL.md` for a directory matching `<skill-name>`
- If not found, search skill names in YAML frontmatter
- If still not found, list available skills and ask the user to pick

Read the target skill's full directory:
- `SKILL.md` (the file we'll mutate)
- Any reference files, templates, examples in the same directory
- Note which files are editable (only SKILL.md) vs fixed (everything else)

### Step 1.2: Generate Test Cases

Create 3-5 diverse test inputs that exercise different aspects of the skill.
Store in `.autoresearch/<skill-name>/test-cases.json`:

```json
{
  "skillName": "example-skill",
  "testCases": [
    {
      "id": "tc1",
      "description": "Standard use case",
      "input": "the prompt/args you'd give the skill",
      "notes": "Why this tests the core functionality"
    },
    {
      "id": "tc2",
      "description": "Edge case - minimal input",
      "input": "...",
      "notes": "Tests graceful handling of sparse input"
    }
  ]
}
```

**IMPORTANT**: Test cases must be diverse. Don't just test the happy path.
Include: standard use, edge cases, long input, short input, ambiguous input.

### Step 1.3: Build Eval Rubric

Create a scoring rubric with 6-8 dimensions relevant to the skill.
Store in `.autoresearch/<skill-name>/rubric.json`:

```json
{
  "dimensions": [
    {
      "name": "structure_compliance",
      "description": "Output follows the expected structure/format",
      "weight": 2,
      "scale": "1-5",
      "binaryCheck": "Does the output contain all required sections? (yes/no)"
    },
    {
      "name": "accuracy",
      "description": "Content is factually correct and relevant",
      "weight": 3,
      "scale": "1-5",
      "binaryCheck": "Are all claims verifiable against the input? (yes/no)"
    }
  ]
}
```

Each dimension has:
- `name`: short identifier
- `description`: what it measures
- `weight`: importance (1-3, higher = more important)
- `scale`: always "1-5" for human rubric
- `binaryCheck`: yes/no version for autonomous scoring (NO gray area)

**Binary checks are critical.** The autonomous loop uses ONLY binary checks.
They must be objective enough that two independent scoring agents would agree.

### Step 1.4: Run Baseline

For each test case:
1. Execute the skill using an Agent subagent (foreground, not background)
2. Capture the output
3. Score with the full 1-5 rubric AND binary checks
4. Store results in `.autoresearch/<skill-name>/baseline.json`

Calculate aggregate baseline score:
```
baselineScore = sum(binaryPass * weight) / sum(weight) * 100
```

### Step 1.5: Present Plan and Wait for Approval

Show the user:
- Target skill and what it does
- Test cases (summarized)
- Eval dimensions with binary checks
- Baseline scores per test case and aggregate
- Which dimensions are weakest (improvement targets)
- Number of iterations planned

**STOP HERE. Wait for explicit "proceed", "go ahead", etc.**

If `--dry-run` was specified, stop after presenting the baseline. Do not proceed to Phase 2.

---

## Phase 2: Autonomous Loop

**This phase runs WITHOUT human intervention. Do not stop to ask questions.**

### The Loop

For each iteration (1 to N):

#### 2.1: Pick a Mutation Target

Choose the weakest binary check dimension that has room for improvement.
Rotate through dimensions to avoid over-optimizing one at the expense of others.

#### 2.2: Generate a Mutation

Read the current SKILL.md and make ONE targeted change to improve the chosen dimension.
Mutations should be specific and small:
- Clarify an instruction that's ambiguous
- Add a constraint that prevents a failure mode
- Restructure a section for clarity
- Add an example for a confusing pattern
- Tighten wording to reduce misinterpretation
- Add a quality checkpoint or self-check instruction

**Rules:**
- ONE change per iteration (atomic mutations only)
- Never remove core functionality
- Never change the skill's fundamental purpose
- Changes must be in SKILL.md only (no other files)
- Before mutating, create a git stash point: `git stash push -m "autoresearch-pre-iter-N" -- <SKILL.md path>`

#### 2.3: Run All Test Cases

For each test case, spawn an Agent subagent to execute the skill:

```
Agent(subagent_type="general-purpose", prompt=`
  You are testing a Claude Code skill. Execute it with the following input
  and return ONLY the raw output. Do not add commentary.

  Skill: <skill-name>
  Input: <test case input>

  Read the skill at <SKILL.md path> and follow its instructions exactly.
`)
```

Capture each output.

#### 2.4: Score with Binary Evals

For each test case output, spawn a SEPARATE scoring agent:

```
Agent(subagent_type="reviewer", prompt=`
  Score this output against binary evaluation criteria.
  Return ONLY a JSON object with pass/fail for each dimension.
  Do NOT be lenient. If in doubt, mark as FAIL.

  Output to score:
  <captured output>

  Binary criteria:
  <list of binaryCheck questions from rubric>

  Return format:
  { "structure_compliance": true, "accuracy": false, ... }
`)
```

**CRITICAL**: The scoring agent must be DIFFERENT from the execution agent.
Never let the agent that produced the output also score it.

#### 2.5: Compare and Decide

Calculate new aggregate score using same formula as baseline.

If `newScore >= currentBestScore`:
  - **KEEP**: commit the change with message `autoresearch: iter N - improved <dimension> (+X%)`
  - Update `currentBestScore = newScore`
  - Log: `KEEP | iter N | score: X -> Y | dimension: Z | change: <one-line summary>`

If `newScore < currentBestScore`:
  - **DISCARD**: `git stash pop` to restore previous SKILL.md
  - Log: `DISCARD | iter N | score: X (no improvement) | dimension: Z | change: <summary>`

#### 2.6: Log Results

Append to `.autoresearch/<skill-name>/results.tsv`:
```
iteration	timestamp	dimension	mutation_summary	old_score	new_score	decision
1	2026-03-27T20:00:00Z	accuracy	Added requirement to cite sources	72.5	78.3	KEEP
2	2026-03-27T20:05:00Z	structure	Restructured output template	78.3	76.1	DISCARD
```

#### 2.7: Repeat

Go to step 2.1. Continue until:
- All N iterations are complete, OR
- Score reaches 100% (perfect), OR
- 5 consecutive DISCARDs with no improvement (plateau detected)

On plateau: log `PLATEAU | stopped after 5 consecutive discards at score X` and proceed to Phase 3.

---

## Phase 3: Debrief

### Step 3.1: Final Scoring

Run all test cases one more time with the final SKILL.md.
Score with the FULL 1-5 rubric (not just binary).
Store in `.autoresearch/<skill-name>/final.json`.

### Step 3.2: Generate Report

Create `.autoresearch/<skill-name>/report.md`:

```markdown
# Autoresearch Report: <skill-name>
Date: <timestamp>
Iterations: N (K kept, M discarded)

## Score Summary
| Dimension | Baseline | Final | Change |
|-----------|----------|-------|--------|
| structure | 3.2      | 4.1   | +0.9   |
| accuracy  | 2.8      | 4.0   | +1.2   |

Aggregate binary score: X% -> Y% (+Z%)

## Mutations Applied
1. [KEEP] Added citation requirement (accuracy +12%)
2. [DISCARD] Restructured intro section (regression)
3. [KEEP] Added self-check step (structure +8%)

## Key Findings
- Biggest improvement: <dimension> from X to Y
- Unexpected regression: <what happened>
- Plateau reached at: <if applicable>

## Recommendations
- Dimensions still below 4.0: <list>
- Suggested next run focus: <dimension>
```

### Step 3.3: Store Learnings

Store a memory in MemoryGraph:
```
type: solution
title: "Autoresearch: <skill-name> improved from X% to Y%"
tags: ["autoresearch", "skill-improvement", "<skill-name>"]
content: <key findings and what mutations worked>
```

### Step 3.4: Present to User

Show:
- Before/after scores
- Number of experiments run
- Which mutations were kept
- The report path
- Suggest running again if score is below 90%

---

## File Structure

```
.autoresearch/
  <skill-name>/
    test-cases.json    # Generated test inputs
    rubric.json        # Eval dimensions + binary checks
    baseline.json      # Pre-improvement scores
    results.tsv        # Per-iteration log
    final.json         # Post-improvement scores
    report.md          # Human-readable summary
```

---

## Design Principles

1. **Atomic mutations**: One change per iteration. If it helps, we know exactly why.
2. **Blind scoring**: The scorer never sees the mutation, only the output.
3. **Binary evals**: No subjectivity in the autonomous loop. Save nuance for human review.
4. **Git-based rollback**: Every mutation is reversible. No risk of corruption.
5. **Diverse test cases**: Don't optimize for one input at the expense of others.
6. **Separation of concerns**: Execute and score are always different agents.
7. **Plateau detection**: Stop wasting iterations when no progress is possible.
