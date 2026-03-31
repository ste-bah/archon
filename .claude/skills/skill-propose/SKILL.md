---
name: skill-propose
description: Propose a new Claude Code skill based on observed patterns. Shows the full skill content and asks for explicit user approval before creating.
---

# Skill Proposal

You have noticed a reusable workflow pattern and want to propose a new skill. Follow these steps exactly.

## Step 1: Describe the Pattern

Explain to the user:
- What pattern you've noticed (what keeps repeating across sessions)
- Why it would be useful as a skill
- How many times you've seen this pattern (be honest)

## Step 2: Show the Proposed Skill

Present the complete SKILL.md content including:
- YAML frontmatter with `name` and `description`
- The full prompt body with clear instructions

The skill MUST include `proposed-by: claude` in the frontmatter.

Example:
```yaml
---
name: quick-pr-review
description: Run a 5-step PR review workflow
proposed-by: claude
---

# Quick PR Review
[full instructions...]
```

## Step 3: Ask for Approval

Say: "Would you like me to create this skill? It will be saved to `.claude/skills/[name]/SKILL.md`."

Wait for explicit approval ("yes", "go ahead", "create it", etc.).

## Step 4: Create (only after approval)

Write the skill file to `.claude/skills/[name]/SKILL.md`.

Report: "Skill `/[name]` created. You can invoke it with `/[name]`."

Also store a memory in MemoryGraph:
```
mcp__memorygraph__store_memory(
  type: "workflow",
  title: "Created skill: /[name]",
  content: "[description of what the skill does]",
  tags: ["skill", "auto-proposed", name],
  importance: 0.6
)
```

## Safety Rules (NON-NEGOTIABLE)

- NEVER create skills without explicit user approval
- NEVER create skills that modify CLAUDE.md
- NEVER create skills that modify settings.json or hook scripts
- NEVER create skills containing `dangerouslyDisableSandbox`
- NEVER create skills with `--no-verify` or `--force` flags
- NEVER create skills that delete files or run destructive commands
- ALL proposed skills MUST have `proposed-by: claude` in frontmatter
