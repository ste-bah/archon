---
name: intent
description: Manage Archon inferred user goals — list, inspect evidence, confirm, correct, promote session goals to persistent.
---

# /intent — User Goal Management

Manage Archon's inferred model of the user's underlying goals and motivations.

## Operations

Parse the first word after `/intent` as the operation. Everything after is args.

### `/intent list`

Show all active persistent goals with confidence and evidence count.

1. Call `mcp__memorygraph__search_memories` with query "goal_id", memory_type "Intent", limit 50
2. Filter to status "active"
3. For each goal, count EVIDENCED_BY relationships (evidence count)
4. Format as table:
```
Goal ID              | Description                          | Tier       | Evidence | Confidence
---------------------|--------------------------------------|------------|----------|----------
high-test-coverage   | Steven wants high test coverage...   | persistent | 5        | 0.83
```
If no active goals: "No active goals found."

### `/intent show-evidence <goal_id>`

Show all EVIDENCED_BY and CONTRADICTED_BY edges for a goal.

1. Look up `intent-{goal_id}` — if not found, output "Goal not found: {goal_id}"
2. Call `mcp__memorygraph__get_related_memories` for intent-{goal_id} with direction "incoming"
3. Separate into EVIDENCED_BY and CONTRADICTED_BY groups
4. Format:
```
Goal: {goal_id} — {description}

Evidence (N items):
  1. [timestamp] correction-xyz — "User corrected: always write tests first"
  2. ...

Contradictions (M items):
  1. [timestamp] "User said speed matters more here"
  2. ...
```

### `/intent confirm <goal_id>`

Add an explicit confirmation as evidence, boosting confidence.

1. Look up goal — if not found, output "Goal not found: {goal_id}"
2. Create an EvidenceMarker node with content "User explicitly confirmed this goal"
3. Create EVIDENCED_BY relationship from marker to the goal
4. Output: "Confirmed goal '{goal_id}'. Evidence count increased."

### `/intent correct <goal_id> <new_description>`

Update a goal's description and log the correction.

1. Look up goal — if not found, output "Goal not found: {goal_id}"
2. Update the Intent node's description field
3. Output: "Updated goal '{goal_id}' description."

### `/intent promote <goal_id>`

Promote a session-scoped goal to persistent tier.

1. Look up goal — if not found or not tier "session", output error
2. Update tier to "persistent"
3. Output: "Promoted '{goal_id}' from session to persistent tier."

## Error Handling

- Unknown operation: show this help text with all available operations
- Missing args: show usage for that specific operation
- Goal not found: "Goal not found: {goal_id}"
