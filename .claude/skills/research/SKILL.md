---
name: research
description: "Deep research using the USACF (Universal Search Algorithm for Claude Flow) framework. Reads docs2/usacfsearches.md and docs2/usacfsearches2.md, generates super-prompts tailored to the topic, then executes them as a multi-phase research pipeline with parallel agents, adversarial reviews, and progressive synthesis."
user-invocable: true
arguments: "<research topic or question> [--depth quick|standard|deep] [--focus <area>]"
---

# USACF Research

Execute deep, structured research using the Universal Search Algorithm for Claude Flow framework.

## Templates

Read BOTH framework documents before generating any research prompts:
```
/Volumes/Externalwork/projects/claudeflow-testing/docs2/usacfsearches.md
/Volumes/Externalwork/projects/claudeflow-testing/docs2/usacfsearches2.md
```

The first doc defines the multi-phase search framework (Sections 0-8).
The second doc defines algorithm selection, combination patterns, and advanced techniques (Sections 1-14).

## Depth Levels

| Level | Phases | Agents | Time | Use When |
|-------|--------|--------|------|----------|
| `quick` | 0 + 1 only | 3-5 | 5 min | Quick fact-finding, single question |
| `standard` | 0-3 | 8-12 | 15 min | Typical research task (DEFAULT) |
| `deep` | 0-6 (full) | 15-25 | 30+ min | Comprehensive analysis, strategy decisions |

## Execution Flow

### Phase 0: Pre-Search Meta-Analysis

**Always runs, all depths.** From Section 0 of usacfsearches.md:

1. **Step-Back Analysis** — establish 5-7 core principles for the domain
2. **Ambiguity Clarification** — identify and resolve ambiguous terms in the research question
3. **Self-Ask Decomposition** — break the question into 5-10 sub-questions
4. **Research Planning (ReWOO)** — plan the full research upfront before executing

Generate a super-prompt for each step by filling in the USACF templates with the user's topic. The templates use `{SUBJECT_NAME}` and `{SUBJECT_TYPE}` placeholders — replace them.

Execute each as a foreground Agent:

```
Agent(subagent_type="step-back-analyzer", prompt=<filled template from Section 0.1>)
Agent(subagent_type="ambiguity-clarifier", prompt=<filled template from Section 0.2>)
Agent(subagent_type="self-ask-decomposer", prompt=<filled template from Section 0.3>)
Agent(subagent_type="research-planner", prompt=<filled template from Section 0.4>)
```

Store results in memory for subsequent phases.

### Phase 1: Discovery

**Runs at standard+ depth.** From Section 3 of usacfsearches.md:

1. **Structural Mapping** — 4 parallel subagents: component identifier, hierarchy analyzer, interface mapper, pattern explorer
2. **Flow Analysis** — trace data flows, process flows, information flows
3. **Dependency Analysis** — map dependencies, find critical paths

Use web search (Firecrawl) for external research. Use LEANN/codebase search for code-related research.

Generate super-prompts from the Section 3 templates. Launch structural mapping agents in parallel where possible.

### Phase 2: Gap & Risk Analysis

**Runs at standard+ depth.** From Section 4 of usacfsearches.md:

1. **Multi-Dimensional Gap Hunting** — 7 parallel gap-finding agents (quality, performance, structural, resource, capability, security, UX)
2. **Risk Analysis** — FMEA-style failure mode analysis with probability scoring
3. **Adversarial Review** — red-team the findings, challenge assumptions

### Phase 3: Synthesis

**Runs at deep depth only.** From Sections 5-6 of usacfsearches.md:

1. **Opportunity Generation** — transform gaps into actionable improvements
2. **Priority Matrix** — score opportunities by (Value + Debt + UX) / (Complexity x Risk)
3. **Roadmap Planning** — phased implementation plan
4. **Final Synthesis** — executive summary + detailed report

### Algorithm Selection

From usacfsearches2.md Section 10 (Algorithm Selection Matrix), choose algorithms based on the research type:

| Research Type | Primary Algorithm | Supporting |
|---|---|---|
| Factual/current events | RAG + Web Search | Chain-of-Thought |
| Code analysis | Tree-of-Thought + Structural Mapping | LEANN semantic search |
| Strategic/business | Step-Back + Multi-Persona | Adversarial review |
| Comparative analysis | Self-Ask + Parallel teams | Pareto optimization |
| Troubleshooting | ReAct + Backtracking | Constraint propagation |

## Super-Prompt Generation Rules

When generating super-prompts from the USACF templates:

1. **Replace all placeholders**: `{SUBJECT_NAME}`, `{SUBJECT_TYPE}`, `{DOMAIN}` with actual values from the user's question
2. **Include memory instructions**: Each agent must store its output to a namespaced key
3. **Include retrieval instructions**: Each agent must retrieve relevant prior agent outputs
4. **Include success criteria**: Each agent knows what "done" looks like
5. **Include tool permissions**: Web search agents get Firecrawl, code agents get LEANN/Grep/Glob
6. **Keep prompts self-contained**: An agent should be able to execute with ONLY its super-prompt

## Output Structure

All research output goes to `docs/research/` directory:

```
docs/research/<topic-slug>/
  00-meta-analysis.md       # Phase 0: principles, sub-questions, research plan
  01-discovery.md           # Phase 1: structural map, flows, dependencies
  02-gap-analysis.md        # Phase 2: gaps, risks, adversarial findings
  03-synthesis.md           # Phase 3: opportunities, priorities, roadmap
  summary.md                # Executive summary (always generated)
```

## Execution Protocol

1. Read BOTH USACF documents
2. Determine depth level (default: standard)
3. Generate all super-prompts for the selected phases
4. Present the research plan to the user: phases, agent count, estimated time
5. **Wait for approval** (unless depth is `quick`)
6. Execute phases sequentially, agents within phases can be parallel
7. After each phase, log progress
8. Generate final summary
9. Store key findings in MemoryGraph

## Rules

- ALWAYS read both USACF docs before generating prompts — never from memory
- NEVER skip Phase 0 (meta-analysis) — it prevents wasted effort
- ALWAYS use adversarial review at standard+ depth — unchallenged findings are unreliable
- Use Firecrawl for web research, not WebSearch/WebFetch
- Use LEANN for codebase research when the topic is about this project's code
- Store all intermediate findings — don't rely on context surviving compaction
- If a phase produces low-confidence results (<60%), increase depth for that area before proceeding
