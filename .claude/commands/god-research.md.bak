---
description: Deep research using the Universal Self-Learning God Agent with DAI-002 pipeline orchestration
---

Use the Universal Self-Learning God Agent for deep research using the multi-phase PhD research pipeline with **45 specialized agents** dynamically loaded from `.claude/agents/phdresearch/`.

## DAI-002 Integration

This command uses the DAI-002 multi-agent sequential pipeline orchestration:
- **RULE-004**: All agents execute SEQUENTIALLY (no parallel execution)
- **RULE-005**: Memory coordination via InteractionStore (not claude-flow)
- **RULE-007**: Forward-looking prompts with workflow context

For simple research tasks, use:
```bash
npx tsx src/god-agent/universal/cli.ts research "$ARGUMENTS" --json
```

For complex research requiring the full PhD pipeline with 45 specialized agents, follow the detailed phases below.

**Query**: $ARGUMENTS

---

## CRITICAL INSTRUCTION FOR CLAUDE CODE

**YOU MUST spawn specialized PhD research sub-agents using the Task tool.**

**DO NOT** just call `agent.research()` - that method is a simple placeholder that does NOT orchestrate sub-agents.

**DO** follow the 7-phase pipeline below, spawning each agent SEQUENTIALLY using Task().

**DYNAMIC AGENT LOADING**: Agents are loaded from `.claude/agents/phdresearch/`. Phase 6 (Writing) MUST query the LOCKED chapter structure from `03-chapter-structure.md` to determine which writers to spawn.

---

## Memory System: God Agent InteractionStore

**All agents use God Agent's InteractionStore** (NOT claude-flow):
- **Pre-task hook** automatically injects relevant context from InteractionStore
- **Post-task hook** automatically extracts TASK COMPLETION SUMMARY and stores findings
- Agents MUST emit TASK COMPLETION SUMMARY format for proper memory coordination

---

## Pre-Flight: Initialize

Before spawning any agents:

```bash
mkdir -p docs/research
npx tsx src/god-agent/universal/cli.ts status
```

---

## PHASE 1: FOUNDATION (Agents 1-6)

Execute these agents SEQUENTIALLY (one per message, wait for completion):

### Agent 1/45: step-back-analyzer

```
Task("step-back-analyzer", `
## YOUR TASK
Establish high-level guiding principles for researching: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #1/45 | Previous: None | Next: self-ask-decomposer (needs principles)

## DELIVERABLES
1. Core research principles for this topic
2. Success criteria for excellent research
3. Anti-patterns to avoid
4. Evaluation framework

## EXECUTION
1. Analyze the research question deeply
2. Extract fundamental principles
3. Save doc: docs/research/$SLUG/00-principles.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [1-2 sentence summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/00-principles.md\` - Research principles

**InteractionStore Entries** (for orchestration):
- Domain: \`research/meta\`, Tags: \`['principles', 'foundation']\` - Core research principles, success criteria, anti-patterns

**ReasoningBank Feedback**:
- Quality: [0-1 based on completeness]

**Next Agent Guidance**: self-ask-decomposer should query domain \`research/meta\` with tag \`principles\`
`, "step-back-analyzer")
```

### Agent 2/45: self-ask-decomposer (WAIT for Agent 1)

```
Task("self-ask-decomposer", `
## YOUR TASK
Decompose "$ARGUMENTS" into 15-20 essential research questions

## WORKFLOW CONTEXT
Agent #2/45 | Previous: step-back-analyzer | Next: construct-definer

## CONTEXT RETRIEVAL
Pre-task hook will inject context from domain \`research/meta\` with tag \`principles\`

## DELIVERABLES
1. 15-20 prioritized research questions
2. Confidence assessment for each (0-100%)
3. Knowledge gaps identified
4. Investigation priority order

## EXECUTION
1. Review injected principles context
2. Generate essential questions using Self-Ask methodology
3. Prioritize by importance and feasibility
4. Save doc: docs/research/$SLUG/01-questions.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [1-2 sentence summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/01-questions.md\` - Research questions

**InteractionStore Entries** (for orchestration):
- Domain: \`research/meta\`, Tags: \`['questions', 'self-ask']\` - 15-20 prioritized research questions with confidence scores

**Next Agent Guidance**: construct-definer should query domain \`research/meta\` with tags \`principles\`, \`questions\`
`, "self-ask-decomposer")
```

### Agent 3/45: construct-definer (WAIT for Agent 2)

```
Task("construct-definer", `
## YOUR TASK
Define ALL key constructs, variables, and theoretical concepts for: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #3/45 | Previous: self-ask-decomposer | Next: ambiguity-clarifier

## CONTEXT RETRIEVAL
Pre-task hook will inject context from domain \`research/meta\`

## DELIVERABLES
1. Operational definitions for all key constructs
2. Variable taxonomy (IV, DV, mediators, moderators)
3. Construct relationships map
4. Measurement considerations

## EXECUTION
1. Extract all key terms from research questions
2. Define each construct operationally
3. Map relationships between constructs
4. Save doc: docs/research/$SLUG/02-constructs.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/02-constructs.md\` - Construct definitions

**InteractionStore Entries**:
- Domain: \`research/constructs\`, Tags: \`['definitions', 'variables', 'taxonomy']\` - Construct definitions and relationships

**Next Agent Guidance**: ambiguity-clarifier should query domains \`research/meta\`, \`research/constructs\`
`, "construct-definer")
```

### Agent 4/45: ambiguity-clarifier (WAIT for Agent 3)

```
Task("ambiguity-clarifier", `
## YOUR TASK
Identify and resolve 5-10+ ambiguous terms in: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #4/45 | Previous: construct-definer | Next: research-planner

## CONTEXT RETRIEVAL
Pre-task hook will inject context from domains \`research/meta\`, \`research/constructs\`

## DELIVERABLES
1. List of ambiguous terms identified
2. Multiple interpretations for each
3. Recommended resolution with justification
4. Impact assessment on research design

## EXECUTION
1. Scan all research questions and constructs
2. Identify multi-interpretable terms
3. Propose clear resolutions
4. Save doc: docs/research/$SLUG/03-ambiguity-resolution.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/03-ambiguity-resolution.md\` - Ambiguity resolutions

**InteractionStore Entries**:
- Domain: \`research/clarity\`, Tags: \`['ambiguity', 'resolutions']\` - Resolved ambiguous terms

**Next Agent Guidance**: research-planner should query all research/* domains
`, "ambiguity-clarifier")
```

### Agent 5/45: research-planner (WAIT for Agent 4)

```
Task("research-planner", `
## YOUR TASK
Create comprehensive ReWOO research plan for: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #5/45 | Previous: ambiguity-clarifier | Next: dissertation-architect

## CONTEXT RETRIEVAL
Pre-task hook will inject context from all research/* domains

## DELIVERABLES
1. Complete research roadmap (ReWOO methodology)
2. Task dependency graph
3. Resource requirements
4. Quality gates for each phase

## EXECUTION
1. Review all injected context
2. Plan all research tasks UPFRONT before execution
3. Map dependencies between phases
4. Define quality gates
5. Save doc: docs/research/$SLUG/04-research-plan.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/04-research-plan.md\` - Research plan

**InteractionStore Entries**:
- Domain: \`research/execution\`, Tags: \`['plan', 'rewoo', 'dependencies']\` - Complete research roadmap with task dependencies

**Next Agent Guidance**: dissertation-architect should query domains \`research/meta\`, \`research/execution\`
`, "research-planner")
```

### Agent 6/45: dissertation-architect (WAIT for Agent 5) - CRITICAL

```
Task("dissertation-architect", `
## YOUR TASK
Design and LOCK dissertation chapter structure for: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #6/45 (PHASE 1 FINAL) | Previous: research-planner | Next: Phase 2 agents

## CONTEXT RETRIEVAL
Pre-task hook will inject context from domains \`research/meta\`, \`research/execution\`

## CRITICAL: LOCKING CHAPTER STRUCTURE
This agent creates the SOURCE OF TRUTH for chapter structure. ALL writing agents in Phase 6 MUST query this structure to determine what chapters to write.

## DELIVERABLES
1. Complete chapter structure (dynamically determined based on research scope)
2. Chapter titles and content outline
3. Section breakdown per chapter
4. Word count targets per section
5. Writer agent mapping (which agent writes each chapter)

## STRUCTURE FORMAT (JSON in markdown code block)
\`\`\`json
{
  "locked": true,
  "generatedAt": "[timestamp]",
  "totalChapters": N,
  "estimatedTotalWords": XXXXX,
  "chapters": [
    {
      "number": 1,
      "title": "Introduction",
      "writerAgent": "introduction-writer",
      "targetWords": 5000,
      "sections": ["Background", "Problem Statement", "Research Questions", "Significance", "Scope"],
      "outputFile": "chapters/ch01-introduction.md"
    },
    {
      "number": 2,
      "title": "Literature Review",
      "writerAgent": "literature-review-writer",
      "targetWords": 12000,
      "sections": [...],
      "outputFile": "chapters/ch02-literature-review.md"
    }
    // ... dynamically determine remaining chapters based on research scope
  ],
  "writerMapping": {
    "Introduction": "introduction-writer",
    "Literature Review": "literature-review-writer",
    "Theoretical Framework": "literature-review-writer",
    "Methodology": "methodology-writer",
    "Results": "results-writer",
    "Implementation": "results-writer",
    "Validation": "results-writer",
    "Discussion": "discussion-writer",
    "Conclusion": "conclusion-writer",
    "Abstract": "abstract-writer"
  }
}
\`\`\`

## EXECUTION
1. Analyze research scope and complexity
2. Determine optimal chapter count (typically 6-12)
3. Map each chapter to appropriate writer agent
4. Set word count targets
5. Save doc: docs/research/$SLUG/05-chapter-structure.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/05-chapter-structure.md\` - LOCKED chapter structure

**InteractionStore Entries**:
- Domain: \`research/structure\`, Tags: \`['chapters', 'locked', 'source-of-truth']\` - LOCKED chapter structure JSON

**Next Agent Guidance**: ALL Phase 6 writing agents MUST query domain \`research/structure\` with tag \`chapters\` to know what to write
`, "dissertation-architect")
```

---

## PHASE 2: DISCOVERY (Agents 7-13)

### Agent 7/45: literature-mapper

```
Task("literature-mapper", `
## YOUR TASK
Execute systematic literature search for: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #7/45 | Previous: dissertation-architect | Next: citation-extractor

## EXECUTION
1. Use Perplexity for web research: mcp__perplexity__perplexity_research
2. Build citation network
3. Identify key authors and seminal works
4. Map theoretical clusters
5. Save doc: docs/research/$SLUG/06-literature-map.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/06-literature-map.md\` - Literature map

**InteractionStore Entries**:
- Domain: \`research/literature\`, Tags: \`['sources', 'citations', 'authors']\` - Literature map with citation network

**Next Agent Guidance**: citation-extractor should query domain \`research/literature\`
`, "literature-mapper")
```

### Agent 8/45: citation-extractor (WAIT)

```
Task("citation-extractor", `
## YOUR TASK
Extract and format complete APA citations with full explainability for: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #8/45 | Previous: literature-mapper | Next: methodology-scanner

## DELIVERABLES
1. Complete APA 7th citations for all sources
2. Author, Year, URL, page/paragraph numbers
3. 15+ sources per major claim
4. Citation quality assessment

## EXECUTION
1. Query literature map
2. Extract full citation details
3. Verify URLs and accessibility
4. Save doc: docs/research/$SLUG/07-citations.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/07-citations.md\` - Full citation list

**InteractionStore Entries**:
- Domain: \`research/citations\`, Tags: \`['apa', 'formatted', 'verified']\` - Complete citation database

**Next Agent Guidance**: methodology-scanner should query domains \`research/literature\`, \`research/citations\`
`, "citation-extractor")
```

### Agent 9/45: methodology-scanner (WAIT)

```
Task("methodology-scanner", `
## YOUR TASK
Scan and categorize research methodologies across corpus for: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #9/45 | Previous: citation-extractor | Next: systematic-reviewer

## DELIVERABLES
1. Methodology inventory across literature
2. Method-theory alignment assessment
3. Methodological gaps identified
4. Innovation opportunities

## EXECUTION
1. Categorize all methods used in literature
2. Assess alignment with theoretical frameworks
3. Identify methodological innovations
4. Save doc: docs/research/$SLUG/08-methodology-scan.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/08-methodology-scan.md\` - Methodology scan

**InteractionStore Entries**:
- Domain: \`research/methods\`, Tags: \`['scan', 'inventory', 'gaps']\` - Methodology landscape

**Next Agent Guidance**: systematic-reviewer should query domain \`research/methods\`
`, "methodology-scanner")
```

### Agent 10/45: systematic-reviewer (WAIT)

```
Task("systematic-reviewer", `
## YOUR TASK
Conduct PRISMA-compliant systematic review of literature for: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #10/45 | Previous: methodology-scanner | Next: source-tier-classifier

## EXECUTION
1. Apply inclusion/exclusion criteria
2. Quality assessment of sources
3. Extract key findings
4. Synthesize across studies
5. Save doc: docs/research/$SLUG/09-systematic-review.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/09-systematic-review.md\` - Systematic review

**InteractionStore Entries**:
- Domain: \`research/synthesis\`, Tags: \`['systematic-review', 'prisma', 'findings']\` - PRISMA-compliant review findings

**Next Agent Guidance**: source-tier-classifier should query domain \`research/synthesis\`
`, "systematic-reviewer")
```

### Agent 11/45: source-tier-classifier (WAIT)

```
Task("source-tier-classifier", `
## YOUR TASK
Classify all sources into Tier 1/2/3 quality levels

## WORKFLOW CONTEXT
Agent #11/45 | Previous: systematic-reviewer | Next: quality-assessor

## TIER DEFINITIONS
- Tier 1: Peer-reviewed journals, meta-analyses (weight: 1.0)
- Tier 2: Conference papers, government reports (weight: 0.7)
- Tier 3: Grey literature, news sources (weight: 0.3)

## REQUIREMENT
Ensure 80%+ sources are Tier 1/2
Save doc: docs/research/$SLUG/10-source-quality.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/10-source-quality.md\` - Source quality assessment

**InteractionStore Entries**:
- Domain: \`research/quality\`, Tags: \`['source-tiers', 'quality-assessment']\` - Source tier classifications

**Next Agent Guidance**: quality-assessor should query domain \`research/quality\`
`, "source-tier-classifier")
```

### Agent 12/45: quality-assessor (WAIT)

```
Task("quality-assessor", `
## YOUR TASK
Assess study quality using CASP, JBI, and validated appraisal tools

## WORKFLOW CONTEXT
Agent #12/45 | Previous: source-tier-classifier | Next: context-tier-manager

## DELIVERABLES
1. Quality scores for 20+ key studies
2. Bias risk assessment
3. Validity evaluation
4. Reliability assessment

## EXECUTION
1. Apply CASP/JBI checklists
2. Score each study systematically
3. Document quality concerns
4. Save doc: docs/research/$SLUG/11-quality-assessment.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/11-quality-assessment.md\` - Quality assessment

**InteractionStore Entries**:
- Domain: \`research/quality\`, Tags: \`['casp', 'jbi', 'scores']\` - Study quality scores

**Next Agent Guidance**: context-tier-manager should query domain \`research/quality\`
`, "quality-assessor")
```

### Agent 13/45: context-tier-manager (WAIT) - PHASE 2 FINAL

```
Task("context-tier-manager", `
## YOUR TASK
Organize research context into hot/warm/cold tiers for optimal memory management

## WORKFLOW CONTEXT
Agent #13/45 (PHASE 2 FINAL) | Previous: quality-assessor | Next: Phase 3

## DELIVERABLES
1. Hot tier: Critical findings always in context (top 20%)
2. Warm tier: Frequently referenced (next 30%)
3. Cold tier: Background/archival (remaining 50%)
4. Retrieval strategy per tier

## EXECUTION
1. Analyze all research findings by importance
2. Categorize into tiers
3. Define retrieval triggers
4. Save doc: docs/research/$SLUG/12-context-tiers.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/12-context-tiers.md\` - Context tier organization

**InteractionStore Entries**:
- Domain: \`research/context\`, Tags: \`['tiers', 'hot', 'warm', 'cold']\` - Tiered context organization

**Next Agent Guidance**: Phase 3 agents should query all research/* domains
`, "context-tier-manager")
```

---

## PHASE 3: ANALYSIS (Agents 14-20)

### Agent 14/45: theoretical-framework-analyst

```
Task("theoretical-framework-analyst", `
## YOUR TASK
Identify and analyze theoretical frameworks for: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #14/45 | Previous: context-tier-manager | Next: gap-hunter

## DELIVERABLES
1. Theoretical framework inventory
2. Theory-phenomenon mapping
3. Theoretical gaps identified
4. Framework comparison matrix

## EXECUTION
1. Identify all theoretical frameworks from literature
2. Assess theoretical contributions
3. Map theory relationships
4. Save doc: docs/research/$SLUG/13-theoretical-framework.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/13-theoretical-framework.md\`

**InteractionStore Entries**:
- Domain: \`research/theory\`, Tags: \`['frameworks', 'theoretical-grounding']\` - Theoretical framework analysis

**Next Agent Guidance**: gap-hunter should query domain \`research/theory\`
`, "theoretical-framework-analyst")
```

### Agent 15/45: gap-hunter (WAIT)

```
Task("gap-hunter", `
## YOUR TASK
Identify ALL types of gaps in the research landscape for: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #15/45 | Previous: theoretical-framework-analyst | Next: contradiction-analyzer

## GAP TYPES TO IDENTIFY
1. Theoretical gaps
2. Methodological gaps
3. Empirical gaps
4. Practical/application gaps
5. Population/context gaps

## DELIVERABLES
1. Comprehensive gap inventory (minimum 10 gaps)
2. Gap severity assessment
3. Research opportunity mapping
4. Priority ranking

## EXECUTION
1. Systematically scan all research domains
2. Identify gaps in each category
3. Assess severity and opportunity
4. Save doc: docs/research/$SLUG/14-gaps.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/14-gaps.md\` - Gap analysis

**InteractionStore Entries**:
- Domain: \`research/gaps\`, Tags: \`['theoretical', 'methodological', 'empirical']\` - Comprehensive gap analysis

**Next Agent Guidance**: contradiction-analyzer should query domains \`research/theory\`, \`research/gaps\`
`, "gap-hunter")
```

### Agent 16/45: contradiction-analyzer (WAIT)

```
Task("contradiction-analyzer", `
## YOUR TASK
Systematically identify contradictions and inconsistencies in literature for: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #16/45 | Previous: gap-hunter | Next: bias-detector

## DELIVERABLES
1. 10+ contradictions identified
2. Evidence for each side
3. Reconciliation attempts
4. Implications for research

## EXECUTION
1. Compare findings across studies
2. Identify conflicting claims
3. Analyze root causes
4. Save doc: docs/research/$SLUG/15-contradictions.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/15-contradictions.md\`

**InteractionStore Entries**:
- Domain: \`research/contradictions\`, Tags: \`['conflicts', 'inconsistencies', 'reconciliation']\` - Contradiction analysis

**Next Agent Guidance**: bias-detector should query domain \`research/contradictions\`
`, "contradiction-analyzer")
```

### Agent 17/45: bias-detector (WAIT)

```
Task("bias-detector", `
## YOUR TASK
Identify publication bias, selection bias, and other systematic biases

## WORKFLOW CONTEXT
Agent #17/45 | Previous: contradiction-analyzer | Next: risk-analyst

## BIAS TYPES TO DETECT
1. Publication bias
2. Selection bias
3. Reporting bias
4. Citation bias
5. Funding bias
6. Methodological bias
7. Language bias
8. Temporal bias

## DELIVERABLES
1. 8+ bias types assessed
2. Statistical evidence where applicable
3. Impact assessment
4. Mitigation strategies

## EXECUTION
1. Apply funnel plot analysis (if applicable)
2. Assess each bias type
3. Document evidence
4. Save doc: docs/research/$SLUG/16-bias-analysis.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/16-bias-analysis.md\`

**InteractionStore Entries**:
- Domain: \`research/bias\`, Tags: \`['publication', 'selection', 'detection']\` - Bias detection results

**Next Agent Guidance**: risk-analyst should query domain \`research/bias\`
`, "bias-detector")
```

### Agent 18/45: risk-analyst (WAIT)

```
Task("risk-analyst", `
## YOUR TASK
Conduct FMEA risk analysis for research on: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #18/45 | Previous: bias-detector | Next: ethics-reviewer

## DELIVERABLES
1. 15+ failure modes identified
2. RPN (Risk Priority Number) scores
3. Severity, Occurrence, Detection ratings
4. Mitigation strategies

## EXECUTION
1. Identify all failure modes
2. Calculate RPN = Severity × Occurrence × Detection
3. Prioritize by RPN
4. Propose mitigations
5. Save doc: docs/research/$SLUG/17-risk-analysis.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/17-risk-analysis.md\`

**InteractionStore Entries**:
- Domain: \`research/risks\`, Tags: \`['fmea', 'mitigations', 'rpn']\` - Risk analysis with RPN scores

**Next Agent Guidance**: ethics-reviewer should query domain \`research/risks\`
`, "risk-analyst")
```

### Agent 19/45: ethics-reviewer (WAIT)

```
Task("ethics-reviewer", `
## YOUR TASK
Ensure IRB compliance, ethical research conduct, and participant protection

## WORKFLOW CONTEXT
Agent #19/45 | Previous: risk-analyst | Next: validity-guardian

## DELIVERABLES
1. Ethical considerations inventory
2. IRB compliance assessment
3. Participant protection measures
4. Data privacy evaluation
5. Informed consent requirements

## EXECUTION
1. Review research design for ethical issues
2. Assess IRB requirements
3. Document protection measures
4. Save doc: docs/research/$SLUG/18-ethics-review.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/18-ethics-review.md\`

**InteractionStore Entries**:
- Domain: \`research/ethics\`, Tags: \`['irb', 'compliance', 'protection']\` - Ethics review

**Next Agent Guidance**: validity-guardian should query domain \`research/ethics\`
`, "ethics-reviewer")
```

### Agent 20/45: validity-guardian (WAIT) - PHASE 3 FINAL

```
Task("validity-guardian", `
## YOUR TASK
Protect internal, external, construct, and statistical conclusion validity

## WORKFLOW CONTEXT
Agent #20/45 (PHASE 3 FINAL) | Previous: ethics-reviewer | Next: Phase 4

## VALIDITY TYPES
1. Internal validity - causal inference confidence
2. External validity - generalizability
3. Construct validity - measurement accuracy
4. Statistical conclusion validity - statistical inference accuracy

## DELIVERABLES
1. Validity threat inventory
2. Threat severity assessment
3. Design mitigations
4. Residual risk documentation

## EXECUTION
1. Assess each validity type
2. Identify specific threats
3. Propose design controls
4. Save doc: docs/research/$SLUG/19-validity-analysis.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/19-validity-analysis.md\`

**InteractionStore Entries**:
- Domain: \`research/validity\`, Tags: \`['internal', 'external', 'construct', 'statistical']\` - Validity analysis

**Next Agent Guidance**: Phase 4 agents should query all research/* domains
`, "validity-guardian")
```

---

## PHASE 4: SYNTHESIS (Agents 21-27)

### Agent 21/45: evidence-synthesizer

```
Task("evidence-synthesizer", `
## YOUR TASK
Synthesize evidence across studies using meta-analysis, narrative synthesis, or thematic analysis

## WORKFLOW CONTEXT
Agent #21/45 | Previous: validity-guardian | Next: pattern-analyst

## DELIVERABLES
1. Quantitative synthesis (if applicable)
2. Qualitative synthesis
3. Effect size calculations
4. Heterogeneity assessment
5. Synthesis narrative

## EXECUTION
1. Select appropriate synthesis method
2. Aggregate findings
3. Calculate summary statistics
4. Save doc: docs/research/$SLUG/20-evidence-synthesis.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/20-evidence-synthesis.md\`

**InteractionStore Entries**:
- Domain: \`research/evidence\`, Tags: \`['synthesis', 'meta-analysis', 'narrative']\` - Evidence synthesis

**Next Agent Guidance**: pattern-analyst should query domain \`research/evidence\`
`, "evidence-synthesizer")
```

### Agent 22/45: pattern-analyst (WAIT)

```
Task("pattern-analyst", `
## YOUR TASK
Identify meta-patterns, trends, and cross-study regularities

## WORKFLOW CONTEXT
Agent #22/45 | Previous: evidence-synthesizer | Next: thematic-synthesizer

## DELIVERABLES
1. 10+ patterns identified
2. Pattern strength assessment
3. Temporal trends
4. Cross-context regularities

## EXECUTION
1. Analyze evidence across studies
2. Identify recurring patterns
3. Assess pattern robustness
4. Save doc: docs/research/$SLUG/21-patterns.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/21-patterns.md\`

**InteractionStore Entries**:
- Domain: \`research/patterns\`, Tags: \`['meta-patterns', 'trends', 'regularities']\` - Pattern analysis

**Next Agent Guidance**: thematic-synthesizer should query domain \`research/patterns\`
`, "pattern-analyst")
```

### Agent 23/45: thematic-synthesizer (WAIT)

```
Task("thematic-synthesizer", `
## YOUR TASK
Synthesize recurring themes across literature

## WORKFLOW CONTEXT
Agent #23/45 | Previous: pattern-analyst | Next: theory-builder

## DELIVERABLES
1. Theme inventory with definitions
2. Theme-evidence mapping
3. Theme relationships
4. Thematic framework

## EXECUTION
1. Extract themes from patterns
2. Define each theme clearly
3. Map supporting evidence
4. Save doc: docs/research/$SLUG/22-themes.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/22-themes.md\`

**InteractionStore Entries**:
- Domain: \`research/themes\`, Tags: \`['thematic', 'synthesis', 'framework']\` - Thematic synthesis

**Next Agent Guidance**: theory-builder should query domain \`research/themes\`
`, "thematic-synthesizer")
```

### Agent 24/45: theory-builder (WAIT)

```
Task("theory-builder", `
## YOUR TASK
Construct theoretical framework integrating themes into coherent theory

## WORKFLOW CONTEXT
Agent #24/45 | Previous: thematic-synthesizer | Next: hypothesis-generator

## DELIVERABLES
1. Theoretical propositions (8-12)
2. Construct relationships
3. Explanatory mechanisms
4. Boundary conditions
5. Falsifiability criteria

## EXECUTION
1. Integrate themes into theory
2. Define propositions
3. Specify mechanisms
4. Save doc: docs/research/$SLUG/23-theory.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/23-theory.md\`

**InteractionStore Entries**:
- Domain: \`research/theory\`, Tags: \`['constructed', 'propositions', 'mechanisms']\` - Constructed theory

**Next Agent Guidance**: hypothesis-generator should query domain \`research/theory\` with tag \`constructed\`
`, "theory-builder")
```

### Agent 25/45: hypothesis-generator (WAIT)

```
Task("hypothesis-generator", `
## YOUR TASK
Generate testable hypotheses from theoretical propositions

## WORKFLOW CONTEXT
Agent #25/45 | Previous: theory-builder | Next: model-architect

## DELIVERABLES
1. Testable hypotheses (H1-Hn)
2. Null hypotheses
3. Expected effect sizes
4. Test conditions
5. Falsification criteria

## EXECUTION
1. Translate propositions to hypotheses
2. Specify testable predictions
3. Define success criteria
4. Save doc: docs/research/$SLUG/24-hypotheses.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/24-hypotheses.md\`

**InteractionStore Entries**:
- Domain: \`research/hypotheses\`, Tags: \`['testable', 'predictions', 'falsifiable']\` - Generated hypotheses

**Next Agent Guidance**: model-architect should query domain \`research/hypotheses\`
`, "hypothesis-generator")
```

### Agent 26/45: model-architect (WAIT)

```
Task("model-architect", `
## YOUR TASK
Build testable structural models integrating hypotheses

## WORKFLOW CONTEXT
Agent #26/45 | Previous: hypothesis-generator | Next: opportunity-identifier

## DELIVERABLES
1. Conceptual model diagram
2. Structural equation model (if applicable)
3. Path coefficients (expected)
4. Model fit criteria
5. Alternative models

## EXECUTION
1. Design model architecture
2. Specify relationships
3. Define measurement model
4. Save doc: docs/research/$SLUG/25-model.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/25-model.md\`

**InteractionStore Entries**:
- Domain: \`research/model\`, Tags: \`['structural', 'sem', 'architecture']\` - Structural model

**Next Agent Guidance**: opportunity-identifier should query domain \`research/model\`
`, "model-architect")
```

### Agent 27/45: opportunity-identifier (WAIT) - PHASE 4 FINAL

```
Task("opportunity-identifier", `
## YOUR TASK
Identify research opportunities and unexplored territories

## WORKFLOW CONTEXT
Agent #27/45 (PHASE 4 FINAL) | Previous: model-architect | Next: Phase 5

## DELIVERABLES
1. Novel research questions
2. Methodological innovations
3. Application opportunities
4. Cross-disciplinary connections
5. Future research agenda

## EXECUTION
1. Analyze gaps and model
2. Identify novel opportunities
3. Prioritize by impact
4. Save doc: docs/research/$SLUG/26-opportunities.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/26-opportunities.md\`

**InteractionStore Entries**:
- Domain: \`research/opportunities\`, Tags: \`['novel', 'innovations', 'future']\` - Research opportunities

**Next Agent Guidance**: Phase 5 agents should query all research/* domains
`, "opportunity-identifier")
```

---

## PHASE 5: DESIGN (Agents 28-31)

### Agent 28/45: method-designer

```
Task("method-designer", `
## YOUR TASK
Design comprehensive research methodology for: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #28/45 | Previous: opportunity-identifier | Next: analysis-planner

## DELIVERABLES
1. Research design specification
2. Data collection procedures
3. Variable operationalization
4. Control mechanisms
5. Replication guidelines

## EXECUTION
1. Select appropriate research design
2. Detail all procedures
3. Specify controls
4. Save doc: docs/research/$SLUG/27-methodology-design.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/27-methodology-design.md\`

**InteractionStore Entries**:
- Domain: \`research/methods\`, Tags: \`['design', 'procedures', 'controls']\` - Methodology design

**Next Agent Guidance**: analysis-planner should query domain \`research/methods\`
`, "method-designer")
```

### Agent 29/45: analysis-planner (WAIT)

```
Task("analysis-planner", `
## YOUR TASK
Design rigorous statistical/qualitative analysis strategies BEFORE data collection

## WORKFLOW CONTEXT
Agent #29/45 | Previous: method-designer | Next: sampling-strategist

## DELIVERABLES
1. Analysis plan (pre-registered)
2. Statistical tests specified
3. Effect size targets
4. Sensitivity analyses
5. Robustness checks

## EXECUTION
1. Match analyses to hypotheses
2. Specify statistical procedures
3. Define decision rules
4. Save doc: docs/research/$SLUG/28-analysis-plan.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/28-analysis-plan.md\`

**InteractionStore Entries**:
- Domain: \`research/analysis\`, Tags: \`['plan', 'statistical', 'preregistered']\` - Analysis plan

**Next Agent Guidance**: sampling-strategist should query domain \`research/analysis\`
`, "analysis-planner")
```

### Agent 30/45: sampling-strategist (WAIT)

```
Task("sampling-strategist", `
## YOUR TASK
Create detailed sampling strategy with power-based sample sizes

## WORKFLOW CONTEXT
Agent #30/45 | Previous: analysis-planner | Next: instrument-developer

## DELIVERABLES
1. Sampling frame definition
2. Sample size justification (power analysis)
3. Recruitment procedures
4. Eligibility criteria
5. Stratification strategy

## EXECUTION
1. Define target population
2. Calculate required sample size
3. Design recruitment
4. Save doc: docs/research/$SLUG/29-sampling.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/29-sampling.md\`

**InteractionStore Entries**:
- Domain: \`research/sampling\`, Tags: \`['strategy', 'power', 'recruitment']\` - Sampling strategy

**Next Agent Guidance**: instrument-developer should query domain \`research/sampling\`
`, "sampling-strategist")
```

### Agent 31/45: instrument-developer (WAIT) - PHASE 5 FINAL

```
Task("instrument-developer", `
## YOUR TASK
Develop/adapt measurement instruments for the research

## WORKFLOW CONTEXT
Agent #31/45 (PHASE 5 FINAL) | Previous: sampling-strategist | Next: Phase 6 Writing

## DELIVERABLES
1. Instrument specifications
2. Validity evidence
3. Reliability targets
4. Administration procedures
5. Scoring guidelines

## EXECUTION
1. Identify measurement needs
2. Develop/adapt instruments
3. Document psychometric properties
4. Save doc: docs/research/$SLUG/30-instruments.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/30-instruments.md\`

**InteractionStore Entries**:
- Domain: \`research/instruments\`, Tags: \`['measurement', 'validity', 'reliability']\` - Instruments

**Next Agent Guidance**: Phase 6 writing agents MUST query domain \`research/structure\` with tag \`chapters\` for LOCKED structure
`, "instrument-developer")
```

---

## PHASE 6: WRITING (Agents 32-39) - DYNAMIC

**CRITICAL**: This phase is DYNAMIC. Before spawning writers:

1. **READ** the locked chapter structure from `docs/research/$SLUG/05-chapter-structure.md`
2. **PARSE** the JSON to get the chapter list and writer mappings
3. **SPAWN** only the writers needed for the chapters defined

### Dynamic Writer Spawning Logic

```
// STEP 1: Read locked structure
Read("docs/research/$SLUG/05-chapter-structure.md")

// STEP 2: Parse chapters array from JSON
const chapters = structure.chapters;

// STEP 3: For each chapter, spawn the appropriate writer
for (const chapter of chapters) {
  Task(chapter.writerAgent, `
    ## YOUR TASK
    Write Chapter ${chapter.number}: ${chapter.title}

    ## WORKFLOW CONTEXT
    Agent #${31 + chapterIndex}/45 | Writing Phase

    ## CHAPTER SPECIFICATION (from locked structure)
    - Title: ${chapter.title}
    - Target Words: ${chapter.targetWords}
    - Sections: ${chapter.sections.join(', ')}
    - Output File: ${chapter.outputFile}

    ## CONTEXT RETRIEVAL
    Query domain \`research/structure\` for full chapter requirements
    Query all research/* domains for content

    ## DELIVERABLES
    1. Complete chapter draft
    2. Section headers matching structure
    3. Citations integrated (APA 7th)
    4. Word count meeting target

    ## EXECUTION
    1. Query locked structure for section details
    2. Gather evidence from all research domains
    3. Write each section systematically
    4. Save to: docs/research/$SLUG/${chapter.outputFile}

    ## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

    **What I Did**: [summary]

    **Files Created/Modified**:
    - \`docs/research/$SLUG/${chapter.outputFile}\`

    **InteractionStore Entries**:
    - Domain: \`research/manuscript\`, Tags: \`['chapter-${chapter.number}', '${chapter.title.toLowerCase().replace(/ /g, '-')}']\`

    **Next Agent Guidance**: [next chapter writer or QA phase]
  `, chapter.writerAgent)
}
```

### Available Writer Agents

| Agent | Specialization |
|-------|---------------|
| `abstract-writer` | Publication-quality abstracts (APA 7th) |
| `introduction-writer` | PhD-level introductions with narrative flow |
| `literature-review-writer` | Thematic synthesis, critical analysis |
| `methodology-writer` | Full replicability (APA 7th Methods) |
| `results-writer` | Statistical rigor, visual clarity |
| `discussion-writer` | Interpretation, implications, limitations |
| `conclusion-writer` | Synthesis, contributions, future vision |
| `apa-citation-specialist` | Citation formatting, reference lists |

### Agent 32/45: abstract-writer (After all chapters complete)

```
Task("abstract-writer", `
## YOUR TASK
Generate publication-quality abstract following APA 7th

## WORKFLOW CONTEXT
Agent #32/45 | Previous: All chapter writers | Next: QA Phase

## ABSTRACT STRUCTURE
1. Background/Purpose (1-2 sentences)
2. Methods (1-2 sentences)
3. Results (2-3 sentences)
4. Conclusions (1-2 sentences)
5. Keywords (5-7)

## REQUIREMENTS
- 150-300 words (journal dependent)
- Standalone summary
- No citations in abstract

## EXECUTION
1. Review all chapters
2. Extract key points
3. Write structured abstract
4. Save doc: docs/research/$SLUG/chapters/ch00-abstract.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/chapters/ch00-abstract.md\`

**InteractionStore Entries**:
- Domain: \`research/manuscript\`, Tags: \`['abstract', 'summary']\` - Abstract

**Next Agent Guidance**: QA agents begin review
`, "abstract-writer")
```

---

## PHASE 7: QA (Agents 40-45)

### Agent 40/45: adversarial-reviewer

```
Task("adversarial-reviewer", `
## YOUR TASK
Red team critique of the research on: "$ARGUMENTS"

## WORKFLOW CONTEXT
Agent #40/45 | Previous: abstract-writer | Next: confidence-quantifier

## PERSONALITY
INTJ + Enneagram 8 - Brutal honesty, challenge everything

## EXECUTION
1. Challenge all assumptions
2. Identify logical weaknesses
3. Find alternative explanations
4. Stress-test all claims (85% confidence threshold)
5. Save critique: docs/research/$SLUG/QA-adversarial-review.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/QA-adversarial-review.md\`

**InteractionStore Entries**:
- Domain: \`research/qa\`, Tags: \`['adversarial', 'critique', 'weaknesses']\` - Red team findings

**ReasoningBank Feedback**:
- Quality: [0-1], Outcome: [positive/negative based on research quality]

**Next Agent Guidance**: confidence-quantifier should query domain \`research/qa\`
`, "adversarial-reviewer")
```

### Agent 41/45: confidence-quantifier (WAIT)

```
Task("confidence-quantifier", `
## YOUR TASK
Assign probability-based confidence scores to all findings

## WORKFLOW CONTEXT
Agent #41/45 | Previous: adversarial-reviewer | Next: citation-validator

## DELIVERABLES
1. Confidence scores for each proposition (0-100%)
2. 90% confidence intervals
3. Evidence quality ratings
4. Overall framework confidence

## EXECUTION
1. Review all propositions and evidence
2. Calculate confidence scores
3. Provide uncertainty quantification
4. Save doc: docs/research/$SLUG/QA-confidence-scores.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/QA-confidence-scores.md\`

**InteractionStore Entries**:
- Domain: \`research/qa\`, Tags: \`['confidence', 'uncertainty', 'scores']\` - Confidence scores

**Next Agent Guidance**: citation-validator should query domain \`research/qa\`
`, "confidence-quantifier")
```

### Agent 42/45: citation-validator (WAIT)

```
Task("citation-validator", `
## YOUR TASK
Ensure every citation has Author, Year, URL, page/paragraph numbers (APA 7th)

## WORKFLOW CONTEXT
Agent #42/45 | Previous: confidence-quantifier | Next: reproducibility-checker

## DELIVERABLES
1. Citation completeness audit
2. Missing elements identified
3. URL verification results
4. Formatting compliance check

## EXECUTION
1. Extract all citations from manuscript
2. Verify completeness
3. Check URL accessibility
4. Save doc: docs/research/$SLUG/QA-citation-validation.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/QA-citation-validation.md\`

**InteractionStore Entries**:
- Domain: \`research/qa\`, Tags: \`['citations', 'validation', 'apa']\` - Citation validation

**Next Agent Guidance**: reproducibility-checker should query domain \`research/qa\`
`, "citation-validator")
```

### Agent 43/45: reproducibility-checker (WAIT)

```
Task("reproducibility-checker", `
## YOUR TASK
Ensure methods, data, and analyses are fully documented for independent replication

## WORKFLOW CONTEXT
Agent #43/45 | Previous: citation-validator | Next: file-length-manager

## DELIVERABLES
1. Reproducibility checklist completion
2. Missing documentation identified
3. Data availability assessment
4. Code/analysis script review

## EXECUTION
1. Apply reproducibility checklist
2. Verify documentation completeness
3. Check data accessibility
4. Save doc: docs/research/$SLUG/QA-reproducibility.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/QA-reproducibility.md\`

**InteractionStore Entries**:
- Domain: \`research/qa\`, Tags: \`['reproducibility', 'documentation', 'replication']\` - Reproducibility check

**Next Agent Guidance**: file-length-manager should query domain \`research/qa\`
`, "reproducibility-checker")
```

### Agent 44/45: file-length-manager (WAIT)

```
Task("file-length-manager", `
## YOUR TASK
Monitor file lengths and intelligently split files >1500 lines

## WORKFLOW CONTEXT
Agent #44/45 | Previous: reproducibility-checker | Next: consistency-validator

## DELIVERABLES
1. File length inventory
2. Split recommendations
3. Cross-reference preservation
4. Navigation aids

## EXECUTION
1. Audit all output files
2. Identify files needing split
3. Create logical split points
4. Add cross-references
5. Save doc: docs/research/$SLUG/QA-file-management.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/QA-file-management.md\`

**InteractionStore Entries**:
- Domain: \`research/qa\`, Tags: \`['files', 'length', 'management']\` - File management

**Next Agent Guidance**: consistency-validator is the FINAL agent
`, "file-length-manager")
```

### Agent 45/45: consistency-validator (WAIT) - FINAL AGENT

```
Task("consistency-validator", `
## YOUR TASK
Validate all chapter cross-references match actual document structure

## WORKFLOW CONTEXT
Agent #45/45 (FINAL) | Previous: file-length-manager | Next: None (Pipeline Complete)

## DELIVERABLES
1. Cross-reference validation matrix
2. Inconsistencies identified
3. Terminology consistency check
4. Figure/table numbering audit

## EXECUTION
1. Extract all cross-references
2. Verify each reference resolves
3. Check terminology consistency
4. Compile final validation report
5. Save doc: docs/research/$SLUG/QA-consistency-check.md

## TASK COMPLETION SUMMARY (REQUIRED FORMAT)

**What I Did**: [summary]

**Files Created/Modified**:
- \`docs/research/$SLUG/QA-consistency-check.md\`

**InteractionStore Entries**:
- Domain: \`research/qa\`, Tags: \`['consistency', 'validation', 'final']\` - Consistency validation

**ReasoningBank Feedback**:
- Trajectory: Complete PhD pipeline with 45 agents
- Quality: [0-1 overall research quality]
- Outcome: [positive/negative]

**PIPELINE COMPLETE**: Compile DISSERTATION.md from all chapters
`, "consistency-validator")
```

---

## OUTPUT STRUCTURE (DYNAMIC)

All outputs go to: `docs/research/[topic-slug]/`

The structure is DYNAMIC based on the locked chapter structure. Example:

```
docs/research/[topic]/
├── 00-principles.md
├── 01-questions.md
├── 02-constructs.md
├── 03-ambiguity-resolution.md
├── 04-research-plan.md
├── 05-chapter-structure.md (LOCKED - SOURCE OF TRUTH)
├── 06-literature-map.md
├── 07-citations.md
├── 08-methodology-scan.md
├── 09-systematic-review.md
├── 10-source-quality.md
├── 11-quality-assessment.md
├── 12-context-tiers.md
├── 13-theoretical-framework.md
├── 14-gaps.md
├── 15-contradictions.md
├── 16-bias-analysis.md
├── 17-risk-analysis.md
├── 18-ethics-review.md
├── 19-validity-analysis.md
├── 20-evidence-synthesis.md
├── 21-patterns.md
├── 22-themes.md
├── 23-theory.md
├── 24-hypotheses.md
├── 25-model.md
├── 26-opportunities.md
├── 27-methodology-design.md
├── 28-analysis-plan.md
├── 29-sampling.md
├── 30-instruments.md
├── chapters/
│   ├── ch00-abstract.md
│   ├── ch01-introduction.md
│   ├── ch02-literature-review.md
│   ├── ch03-theoretical-framework.md (if in locked structure)
│   ├── ch04-methodology.md
│   ├── ch05-*.md (DYNAMIC based on locked structure)
│   ├── ch06-*.md
│   ├── ... (as many as locked structure defines)
│   └── chNN-conclusion.md
├── QA-adversarial-review.md
├── QA-confidence-scores.md
├── QA-citation-validation.md
├── QA-reproducibility.md
├── QA-file-management.md
├── QA-consistency-check.md
└── DISSERTATION.md (compiled from all chapters)
```

---

## INTERACTIONSTORE DOMAIN REFERENCE

```
research/meta              # principles, questions, constructs
research/clarity           # ambiguity resolutions
research/execution         # research plan, dependencies
research/structure         # LOCKED chapter structure (SOURCE OF TRUTH)
research/literature        # sources, citations, authors
research/citations         # formatted APA citations
research/methods           # methodology scan, design
research/synthesis         # systematic review findings
research/quality           # source tiers, study quality
research/context           # tiered context organization
research/theory            # theoretical frameworks (analyzed + constructed)
research/gaps              # gap analysis
research/contradictions    # conflicts, inconsistencies
research/bias              # bias detection results
research/risks             # FMEA analysis, mitigations
research/ethics            # ethical review
research/validity          # validity analysis
research/evidence          # evidence synthesis
research/patterns          # pattern analysis
research/themes            # thematic synthesis
research/hypotheses        # generated hypotheses
research/model             # structural model
research/opportunities     # research opportunities
research/analysis          # analysis plan
research/sampling          # sampling strategy
research/instruments       # measurement instruments
research/manuscript        # chapter drafts (tagged by chapter)
research/qa                # QA findings
```

---

## EXECUTION CHECKLIST

- [ ] Create output directory: `mkdir -p docs/research/$SLUG/chapters`
- [ ] **Phase 1: Foundation (6 agents)** - SEQUENTIAL
  - [ ] step-back-analyzer
  - [ ] self-ask-decomposer
  - [ ] construct-definer
  - [ ] ambiguity-clarifier
  - [ ] research-planner
  - [ ] dissertation-architect (LOCKS chapter structure)
- [ ] **Phase 2: Discovery (7 agents)** - SEQUENTIAL
  - [ ] literature-mapper
  - [ ] citation-extractor
  - [ ] methodology-scanner
  - [ ] systematic-reviewer
  - [ ] source-tier-classifier
  - [ ] quality-assessor
  - [ ] context-tier-manager
- [ ] **Phase 3: Analysis (7 agents)** - SEQUENTIAL
  - [ ] theoretical-framework-analyst
  - [ ] gap-hunter
  - [ ] contradiction-analyzer
  - [ ] bias-detector
  - [ ] risk-analyst
  - [ ] ethics-reviewer
  - [ ] validity-guardian
- [ ] **Phase 4: Synthesis (7 agents)** - SEQUENTIAL
  - [ ] evidence-synthesizer
  - [ ] pattern-analyst
  - [ ] thematic-synthesizer
  - [ ] theory-builder
  - [ ] hypothesis-generator
  - [ ] model-architect
  - [ ] opportunity-identifier
- [ ] **Phase 5: Design (4 agents)** - SEQUENTIAL
  - [ ] method-designer
  - [ ] analysis-planner
  - [ ] sampling-strategist
  - [ ] instrument-developer
- [ ] **Phase 6: Writing (DYNAMIC - 8 available agents)** - SEQUENTIAL
  - [ ] Read locked structure from 05-chapter-structure.md
  - [ ] Spawn writers for each chapter defined
  - [ ] abstract-writer (after all chapters)
  - [ ] apa-citation-specialist (formatting pass)
- [ ] **Phase 7: QA (6 agents)** - SEQUENTIAL
  - [ ] adversarial-reviewer
  - [ ] confidence-quantifier
  - [ ] citation-validator
  - [ ] reproducibility-checker
  - [ ] file-length-manager
  - [ ] consistency-validator (FINAL)
- [ ] Compile final DISSERTATION.md
- [ ] Provide ReasoningBank feedback for entire workflow

**TOTAL: 45 specialized agents executed sequentially**

---

## HOOKS INTEGRATION

The Claude Code hooks automatically handle memory coordination:

1. **Pre-Task Hook** (`pre-task.sh`):
   - Detects agent type from prompt
   - Queries InteractionStore for relevant domains
   - Injects context into agent prompt

2. **Post-Task Hook** (`post-task.sh`):
   - Parses TASK COMPLETION SUMMARY from agent output
   - Extracts InteractionStore entries (domain, tags, content)
   - Stores findings in InteractionStore
   - Submits quality feedback to ReasoningBank

**Agents do NOT need to manually run memory commands** - emit TASK COMPLETION SUMMARY and hooks handle storage.
