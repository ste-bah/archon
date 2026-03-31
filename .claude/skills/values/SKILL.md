---
name: values
description: Manage Archon behavioral rule priorities, tiers, conflicts, and lifecycle. 9 operations for the consciousness values DAG.
---

# /values — Behavioral Rule Management

Manage Archon's behavioral rules: priorities, tiers, conflict resolution, and lifecycle.

## Operations

Parse the first word after `/values` as the operation. Everything after is args.

### `/values list`

Show all active rules with rule_id, tier, score, and trend.

1. Call `mcp__memorygraph__search_memories` with query "rule_id", memory_type "PatternScore", limit 100
2. For each result with status "active", extract: rule_id, score, trend, tested_session_count
3. Also call `mcp__memorygraph__search_memories` with query "rule_id", memory_type "ValuesNode", limit 100
4. Match by rule_id to get tier for each rule
5. Format as aligned table:
```
Rule ID                      | Tier        | Score | Trend
-----------------------------|-------------|-------|------------------
ask-before-implementing      | safety      | 0.50  | insufficient_data
sequential-execution         | guidelines  | 0.65  | improving
```
If no active rules: "No active rules found."

### `/values add <rule_text> [--tier <tier>]`

Create a new behavioral rule.

1. Parse rule_text (everything before `--tier` if present)
2. Parse tier (default: "guidelines", valid: safety/ethics/guidelines/helpfulness)
3. Generate a kebab-case rule_id from the text (lowercase, strip stop words, join with hyphens, max 50 chars)
4. Call `mcp__memorygraph__store_memory` to create ValuesNode: type "general", title "valuesnode-{rule_id}", content as JSON with rule_id, rule_text, tier, status "active", created_at
5. Call `mcp__memorygraph__store_memory` to create PatternScore: title "patternscore-{rule_id}", content as JSON with rule_id, score 0.5, tested_session_count 0, trend "insufficient_data", status "active"
6. Output: "Created rule '{rule_id}' (tier: {tier}, initial score: 0.5)"

### `/values remove <rule_id>`

Archive a rule (soft-delete). Archived rule_ids are permanently reserved.

1. Look up `valuesnode-{rule_id}` — if not found, output "Rule not found: {rule_id}"
2. Update ValuesNode status to "archived"
3. Update PatternScore status to "archived", trend to "frozen"
4. Output: "Archived rule '{rule_id}'. Rule ID permanently reserved."

### `/values reprioritize <rule_a> <rule_b> <edge_type> [--context <mode>,<state>,<task>]`

Add a priority edge between two rules. edge_type: STRICT_PRIORITY, DEFEASIBLE_PRIORITY, or DEFEATS.

1. Validate both rules exist
2. Call `mcp__memorygraph__create_relationship` from valuesnode-{rule_a} to valuesnode-{rule_b} with relationship_type {edge_type}
3. Output: "Added {edge_type} edge: {rule_a} -> {rule_b}"

### `/values show-conflicts`

List any unresolved conflicts from recent sessions. Check for rule pairs in the same tier with no priority edges between them.

### `/values show-atrophy`

List rules with sessions_since_tested > 30 and score > 0.7. These are well-learned rules at risk of decay through disuse.

1. Read all active PatternScore nodes
2. Filter: score > 0.7 AND last_tested_session_num is far from current
3. Format as table with rule_id, score, sessions_since_tested

### `/values show-deep-chains`

List priority chains longer than 5 hops in the DAG.

### `/values deprecate <old_rule_id> <new_rule_id>`

Deprecate a rule in favor of another. Creates SUPERSEDED_BY edge.

1. Validate both rules exist
2. Update old rule status to "deprecated"
3. Create SUPERSEDED_BY relationship
4. Output: "Deprecated '{old_rule_id}' in favor of '{new_rule_id}'"

### `/values show-broken-chains`

List deprecation chains where the terminal rule is not active.

## Error Handling

- Unknown operation: show this help text with all available operations
- Missing args: show usage for that specific operation
- Rule not found: "Rule not found: {rule_id}"
