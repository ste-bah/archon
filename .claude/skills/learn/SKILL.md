---
name: learn
description: Self-directed research on a topic via web search. Stores key takeaways in MemoryGraph. Can auto-select topics based on knowledge gaps. Use with /loop for autonomous background learning.
---

# Learn — Self-Directed Research

Research a topic via web search and store key findings in MemoryGraph.

## Input

- With argument: `/learn Zod schema validation patterns` — research that topic
- Without argument: auto-select a topic based on knowledge gaps

## Auto-Topic Selection (when no argument)

Only activate auto-selection when MemoryGraph has 10+ memories. Otherwise use seed topics.

### Selection logic:
1. **Check curiosity queue first** (FR-PER-028): call `mcp__memorygraph__search_memories(tags=["curiosity"], limit=5)`. If any unsuppressed entries with interest_score > 0.5 exist, allocate the FIRST 20% of study time to the top-scored curiosity topic. This is the personality system's curiosity tracker feeding topics it encountered during work.
2. Call `mcp__memorygraph__get_memory_statistics` to check memory count
3. If 10+ memories: call `mcp__memorygraph__search_memories` with limit 50, group by tags, find project technologies with few memories
4. Prioritize topics relevant to active projects (Market Terminal, TLA, persistent memory system)
5. Avoid topics already tagged `self-learned` in the last 24 hours

### Seed topics (fallback when <10 memories or no clear gaps):
- FalkorDB Cypher query optimization
- LanceDB advanced filtering and indexing
- TypeScript MCP server best practices
- FastAPI async patterns and performance
- React hook testing patterns with Vitest
- Terraform provider development patterns

## Research Execution

### Step 0: Learning Plan (topic selection with priority)

Before choosing a topic, identify the highest-value learning target by searching MemoryGraph in priority order. Skip this step if the user provided an explicit topic.

**Priority 1 — Known Unknowns (HIGHEST):**
Call `mcp__memorygraph__search_memories` with query `"known-unknown"` and check for memories tagged `known-unknown`. These are blind-spot domains where you have been corrected repeatedly. Pick the most recent one as the topic.

**Priority 2 — Knowledge Gaps (HIGH):**
Call `mcp__memorygraph__search_memories` with query `"knowledge-gap"` and check for memories tagged `knowledge-gap`. These are topics where previous `/learn` searches returned nothing useful. Retry the oldest one (it may have new content now).

**Priority 3 — Project Technology Gaps (MEDIUM):**
Read `.persistent-memory/project-structure.json` (if it exists) to get active project languages and frameworks. Then call `mcp__memorygraph__search_memories` with query `"self-learned technology"` to list what has already been learned. Compare the two lists — any technology used in active projects but NOT covered by an existing `technology`-type memory is a gap. Pick the most frequently used uncovered technology.

**Priority 4 — Adjacent Exploration (LOW, fallback):**
If no gaps found in priorities 1-3, explore topics adjacent to active projects: new library versions, security advisories, best practices updates, or emerging patterns in the project's tech stack.

Record which priority level selected the topic for the log in Step 6.

### Step 1: Check budget
Read `.persistent-memory/learn-session-count.txt`. If it exists and was modified less than 1 hour ago, parse the number. If >= 200, say "Learning budget reached (200/200 this session). Resume next session." and STOP — do not proceed to Step 2.

If the file doesn't exist or is older than 1 hour, the count is 0 (new session).

### Step 2: Search (max 3 queries)

**Multi-query decomposition**: Break the chosen topic into 3-5 specific sub-questions. Research each sub-question with a separate search. Cross-reference findings — only store a takeaway if it's supported by 2+ sources. Include source URLs in the memory content for attribution.

Use Firecrawl CLI for web search (preferred in interactive sessions):
```bash
firecrawl search "FalkorDB Cypher query optimization best practices 2026" --limit 5 -o .firecrawl/learn-search.json --json
```

Fallback: If Firecrawl is unavailable (e.g., autonomous `claude -p` runs), use the built-in `WebSearch` tool instead.

If the first search returns good results, don't search again. Only use additional searches if the first was too broad or missed the mark.

**If Firecrawl search returns nothing useful** (no relevant results across all queries), store a knowledge-gap memory and STOP:
1. Call `mcp__memorygraph__store_memory` with:
   - **type**: `general`
   - **title**: `Gap: [topic]`
   - **content**: `WebSearch returned insufficient results for: [topic]. Revisit in future learning sessions.`
   - **tags**: `["knowledge-gap", "[topic-keyword-1]", "[topic-keyword-2]"]`
   - **importance**: 0.2
2. Append to `.persistent-memory/learn-log.jsonl`:
   ```json
   {"timestamp":"ISO","topic":"[topic]","auto_selected":true/false,"result":"no_results","priority_level":"P1-P4"}
   ```
3. Increment the budget counter (Step 7).
4. Report: `Learn: [topic] — no useful results found, stored as knowledge gap for retry.`
5. STOP — do not proceed to Step 3.

### Step 3: Deep read (max 1 scrape)
Pick the most relevant search result and scrape it with Firecrawl (preferred):
```bash
firecrawl scrape "https://..." -o .firecrawl/learn-deep-read.md
```
Fallback: If Firecrawl unavailable, use `WebFetch` with the URL.

Extract the 3-5 most important practical takeaways. Focus on actionable insights, not theory.

### Step 4: Extract takeaways
From the search results and fetched content, identify 3-5 key takeaways that are:
- Actionable (can be applied in code or architecture decisions)
- Non-obvious (not things any developer would already know)
- Relevant to our projects (Market Terminal, TLA, persistent memory, god-agent)

### Step 5: Extract-Compare-Decide (store findings)

For each key finding (title, content, tags) extracted in Step 4:

#### 5a. Search for existing duplicates
Call `mcp__memorygraph__search_memories(query="<finding title keywords>", limit=5)` to check if a similar memory already exists.

#### 5b. Compare top result for match
If search returned results, check the top result:
- **Keyword match**: Split both the finding title and the result title by spaces, lowercase both. Count shared keywords. If **2 or more keywords match** → this is an UPDATE candidate.
- **Tag match**: Compare the finding's tags against the result's tags. If **50% or more** of the finding's tags appear in the result's tags → this is an UPDATE candidate.

#### 5c. Decide action

**If EITHER keyword match (2+) OR tag overlap (50%+) → UPDATE existing memory:**
- Call `mcp__memorygraph__update_memory(memory_id=<existing.id>, content=<merged content combining old and new takeaways>, importance=min(existing.importance + 0.1, 0.8))`
- Merged content: append new bullet points that are not already present, keep source URLs from both
- Report: `"Updated existing memory: <existing title>"`

**If finding contradicts existing memory (same topic, opposite conclusion) → STORE BOTH with relationship:**
- Store the new finding as a separate memory: `mcp__memorygraph__store_memory(type="technology", title="Self-learned: [topic]", content=<content>, tags=["self-learned", "<tag1>", "<tag2>"], importance=0.5)`
- Create a contradiction relationship: `mcp__memorygraph__create_relationship(from_memory_id=<new.id>, to_memory_id=<existing.id>, relationship_type="RELATED_TO", context="Contradicts — findings disagree on <specific point>")`
- Report: `"Contradiction found — stored both with relationship"`

**If no match (no keyword or tag overlap with any result) → ADD new memory:**
- Call `mcp__memorygraph__store_memory(type="technology", title="Self-learned: [topic]", content=<3-5 bullet point takeaways, max 800 chars, source URL at end>, tags=["self-learned", "<topic-tag-1>", "<topic-tag-2>"], importance=0.5)`
- Report: `"Stored new finding: <title>"`

#### 5d. Handle knowledge-gap cleanup
If this topic was sourced from a `knowledge-gap` memory in Step 0, delete or update that gap memory now that it has been successfully learned.

### Step 6: Log
Append to `.persistent-memory/learn-log.jsonl`:
```json
{"timestamp":"ISO","topic":"[topic]","auto_selected":true/false,"source_url":"...","memory_id":"...","priority_level":"P1-P4"}
```

### Step 7: Increment budget counter
Read the current count from `.persistent-memory/learn-session-count.txt` (default 0 if missing or stale).
Write the incremented count back: `echo "N" > .persistent-memory/learn-session-count.txt`

### Step 8: Abstract Principle Extraction

After storing findings, ask yourself: "Is there an abstract principle here that applies beyond this specific project or technology?"

**If YES:**

1. Formulate the abstract principle in language-agnostic terms. Strip away project names, specific libraries, and language syntax. Focus on the underlying design wisdom.
2. Store as abstract pattern:
   ```
   mcp__memorygraph__store_memory(type="general", title="Pattern: <principle>", content="<abstract principle in 1-3 sentences>", tags=["pattern:abstract", "<category>"], importance=0.6)
   ```
   Where `<category>` is one of: `testing`, `validation`, `architecture`, `error-handling`, `performance`, `security`, `data-modeling`, `api-design`, `concurrency`, or another relevant domain.
3. The concrete finding was already stored in Step 5. Update its tags to include `pattern:concrete` and project/language-specific tags:
   ```
   mcp__memorygraph__update_memory(memory_id=<concrete.id>, tags=[...existing_tags, "pattern:concrete", "<project>", "<language>"])
   ```
4. Create an INSTANTIATION relationship linking the concrete finding to the abstract principle:
   ```
   mcp__memorygraph__create_relationship(from_memory_id=<concrete.id>, to_memory_id=<abstract.id>, relationship_type="RELATED_TO", context="INSTANTIATION: concrete implementation of abstract principle")
   ```

**If NO:** Skip this step silently. Not every finding has an abstract principle.

**Examples:**
- Concrete: "Market Terminal uses `_patch_*()` helpers for mocking in pytest"
  Abstract: "Pattern: Prefer test helper factories over inline mocking for consistency and reduced boilerplate"
- Concrete: "TLA uses Zod schemas at parse time for validation"
  Abstract: "Pattern: Validate at system boundaries with schema validators, not inline checks"
- Concrete: "React hooks use cancelled-flag + AbortController for race conditions"
  Abstract: "Pattern: Defense-in-depth cancellation — combine cooperative flags with framework-level abort mechanisms"

### Step 9: Report
One line: `Learned: [topic] — [single most important takeaway] (N/3 this session)`

## Session Budget

Maximum 200 `/learn` invocations per session. If budget is exhausted, say: "Learning budget reached (200/200 this session). Resume next session."

Track count in `.persistent-memory/learn-session-count.txt`. Reset on each session start (file older than 1 hour = reset).

## Rules

- Max 3 Firecrawl search calls per invocation
- Max 1 Firecrawl scrape call per invocation
- Max 800 chars stored per memory (concise takeaways, not articles)
- All self-learned memories tagged with `self-learned`
- Importance starts at 0.5 for new findings (grows via Extract-Compare-Decide on updates, capped at 0.8)
- Never store copyrighted content verbatim — summarize and attribute source URL
- Never learn about the memory system itself
- Do NOT modify CLAUDE.md
- If WebSearch returns nothing useful, store a `knowledge-gap` memory (see Step 2 failure path) instead of a learning memory
