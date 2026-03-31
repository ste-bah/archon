---
name: prd
description: "Create a Product Requirements Document using the AI Agent PRD template. Reads the full framework from docs2/ai-agent-prd.md and generates a complete PRD with all 14 sections."
user-invocable: true
arguments: "<description of what the PRD is for>"
---

# Create a PRD

Generate a machine-executable Product Requirements Document following the AI Agent PRD framework.

## Template

Read the full PRD template and framework at:
```
/Volumes/Externalwork/projects/claudeflow-testing/docs2/ai-agent-prd.md
```

This is the ONLY template to use. Do not improvise a PRD structure.

## Steps

### 1. Read the template

Read `docs2/ai-agent-prd.md` completely. Pay special attention to:
- Section 10: "Concrete PRD Templates and Examples" (line ~1466) — this has the actual template structure
- The 14-section format starting at line ~1483
- The filled examples starting at line ~1663

### 2. Understand the request

From the user's description, identify:
- What system/feature is being specified
- Who the target users are
- What problem it solves
- What constraints exist (technology, timeline, budget)

If the description is vague, ask clarifying questions BEFORE generating. Do not guess.

### 3. Generate the PRD

Create the PRD with ALL 14 sections from the template:

1. **Executive Summary** — 2-3 paragraphs, problem + solution + expected outcome
2. **Problem Statement** — Current state, pain points, quantified impact
3. **Target Users and Personas** — Who benefits, how they interact
4. **Feature Description and User Stories** — User stories with acceptance criteria (Given/When/Then)
5. **Functional Requirements** — FR-001 format, MUST/SHOULD/MAY, measurable
6. **Non-Functional Requirements** — NFR-001 format, performance/security/reliability
7. **Edge Cases** — EC-001 format, expected behavior for each
8. **Out of Scope** — Explicit exclusions to prevent scope creep
9. **Success Metrics** — Quantified, time-bound, measurable
10. **Agent Implementation Details** — Pipeline phases, agent assignments, context handoffs, memory namespaces
11. **Guardrails and Constraints** — Hard limits, prohibited approaches, safety requirements
12. **Risk and Mitigation** — Risk matrix with likelihood/impact/mitigation
13. **Human Oversight Checkpoints** — Where humans must approve before agents proceed
14. **Success Criteria for Delivery** — Definition of done, quality gates

Plus appendices:
- **Appendix A: Glossary** — Domain terms defined unambiguously
- **Appendix B: Related Documents** — Links to specs, designs, prior art

### 4. Apply AI-agent conventions

Every requirement MUST follow these rules from the framework:
- **Stable identifiers**: FR-001, NFR-001, EC-001, RISK-001
- **MoSCoW priority**: MUST / SHOULD / MAY / MUST NOT
- **Measurable criteria**: No "fast", "secure", "user-friendly" without numbers
- **Given/When/Then**: All acceptance criteria in this format
- **No ambiguity**: If a requirement could be interpreted two ways, it's wrong — clarify it
- **Self-contained**: An agent reading ONLY this PRD should have everything needed to implement

### 5. Save the PRD

Save to `docs/` directory with naming convention:
```
docs/PRD-<PROJECT>-<SEQ>-<short-name>.md
```
Example: `docs/PRD-ARCHON-COG-001-cognitive-enhancement.md`

### 6. Present for review

Show the user:
- PRD title and location
- Section count (should be 14 + appendices)
- Requirement count (FR + NFR + EC)
- Key risks identified
- Ask: "Would you like me to refine any section?"

## Rules

- ALWAYS read the template file before generating — never generate from memory
- NEVER skip sections — all 14 are mandatory even if brief
- NEVER use vague language (fast, secure, scalable) without quantified thresholds
- If the user's description doesn't provide enough detail for a section, mark it as `[TBD — needs input]` rather than fabricating
- PRDs go in `docs/` directory, never in project root
