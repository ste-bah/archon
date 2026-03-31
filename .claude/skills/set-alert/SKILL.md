---
name: set-alert
description: Define alert rules for Archon's proactive outreach. Rules are stored in MemoryGraph and evaluated by the daily outreach task. Supports create, list, and remove operations.
---

# /set-alert — Alert Rule Management

## Usage

### Create an alert rule

When the user says `/set-alert <description>`, parse their intent and create an alert_rule memory:

1. Determine the rule components:
   - **topic**: what to alert about (e.g., "FastAPI", "memory_count", "circuit breaker")
   - **condition**: `new_memory` (alert when new memory matches topic), `threshold` (alert when metric exceeds value), or `keyword` (alert when any memory content contains keyword)
   - **value**: threshold value (for threshold conditions), or empty
   - **channel**: `dm` (DM to Steven) or `ai-chat` (A.I.-Chat channel). Default: `ai-chat`
   - **severity**: `critical` (immediate send, up to 3/day) or `info` (batched into daily digest). Default: `info`

2. Validate the rule:
   - Topic must be non-empty
   - Condition must be one of: `new_memory`, `threshold`, `keyword`
   - If condition is `threshold`, value must be provided (e.g., ">250", "<10", ">=100")
   - Content must NOT contain credentials, API keys, tokens, or sensitive patterns

3. Store to MemoryGraph:
```
mcp__memorygraph__store_memory(
  type="general",
  title="Alert: <topic>",
  content=<JSON rule: {"topic": "<topic>", "condition": "<condition>", "value": "<value>", "channel": "<channel>", "severity": "<severity>"}>,
  tags=["alert-rule", "pinned", "<severity>"],
  importance=0.8
)
```

4. Confirm to user: "Alert rule created: **<topic>** (<condition>, <severity>)"

### List alert rules

When the user says `/set-alert list`:

1. Search MemoryGraph:
```
mcp__memorygraph__search_memories(query="alert-rule", limit=20)
```

2. Display each rule in a table or list format:
   - Topic
   - Condition (and value if threshold)
   - Severity
   - Channel

3. If no rules found, say: "No alert rules configured. Use `/set-alert topic=\"...\" condition=\"...\"` to create one."

### Remove an alert rule

When the user says `/set-alert remove <topic>`:

1. Search for the alert rule:
```
mcp__memorygraph__search_memories(query="Alert: <topic>", limit=5)
```

2. Find the matching rule by topic in the results

3. Delete it:
```
mcp__memorygraph__delete_memory(id=<matched_memory_id>)
```

4. Confirm: "Alert rule removed: **<topic>**"

5. If not found: "No alert rule found for topic: **<topic>**"

## Examples

```
/set-alert topic="FastAPI" condition="new_memory"
→ Alert when a new memory about FastAPI is stored

/set-alert topic="memory_count" condition="threshold" value=">250"
→ Alert when memory count exceeds 250

/set-alert topic="security" condition="keyword"
→ Alert when any memory content contains "security"

/set-alert topic="deployment failure" condition="keyword" severity="critical" channel="dm"
→ Critical alert via DM when any memory contains "deployment failure"

/set-alert list
→ Shows all active alert rules

/set-alert remove FastAPI
→ Removes the FastAPI alert rule
```

## Rules

- Alert rules are tagged `pinned` — they must never be archived or auto-deleted
- Importance is always 0.8 (high but below user corrections at 1.0)
- Security: alert rules must NOT contain credentials, API keys, tokens, or sensitive patterns. Reject if detected.
- Rules are EVALUATED by the outreach task (TASK-COG-023), not by this skill. This skill only manages CRUD.
- Default severity is `info`, default channel is `ai-chat`
- Maximum 20 alert rules at a time (warn if approaching limit on create)
