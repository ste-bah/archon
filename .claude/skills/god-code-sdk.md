---
description: Generate code using the 48-Agent SDK Pipeline Runner (Agent SDK-based, crash-recoverable)
effort: high
---

Use the SDK Pipeline Runner for code generation with 48 specialized agents, crash recovery, and programmatic tool restrictions.

**Query**: $ARGUMENTS

---

## EXECUTION PROTOCOL

The SDK runner is self-contained — it handles the full agent loop, MCP servers, quality gates, crash recovery, and LEANN indexing internally. You just invoke it and handle the result.

### Step 1: Run the Pipeline

```bash
npx tsx src/god-agent/cli/sdk-pipeline-runner.ts $ARGUMENTS
```

Add `--dry-run` to validate Phase 1 only (7 read-only agents, no file writes):
```bash
npx tsx src/god-agent/cli/sdk-pipeline-runner.ts --dry-run $ARGUMENTS
```

The runner prints JSON to stdout when complete:
```json
{"status": "complete", "sessionId": "abc-123", "agentsCompleted": 48, "totalCostUsd": 12.34}
```

Or on error:
```json
{"status": "error", "error": "Agent task-analyzer failed quality gate after 3 attempts"}
```

### Step 2: Drain LEANN Index Queue

After the runner completes successfully, drain any queued files:

```bash
QUEUE_COUNT=$(jq '.files | length' .claude/runtime/leann-index-queue.json 2>/dev/null || echo "0")
```

If QUEUE_COUNT > 0, call `mcp__leann-search__process_queue` with `maxFiles: 50, timeoutMs: 300000`. Repeat until `queueRemaining: 0`.

### Step 3: Report Results

Parse the JSON output and report: session ID, agents completed, total cost, any errors.

---

## WHAT THE RUNNER HANDLES INTERNALLY

- MCP server lifecycle (leann-search, memorygraph, lancedb-memory)
- MCP health verification with 60s timeout
- Crash recovery on startup (detects interrupted sessions)
- All 11 prompt augmentation layers (same as /god-code)
- Per-agent tool restrictions (Phase 1-3: read-only, Phase 4+: full)
- Quality gate checks with retry (max 2 retries per agent)
- API error retry with exponential backoff (429/500/503)
- Agent output materialization to `.pipeline-state/<session>/`
- LEANN indexing for implementation agents (Phase 4+)
- SDK session map for crash recovery at `.god-agent/sdk-sessions/`

---

## KEY DIFFERENCES FROM /god-code

| | /god-code | /god-code-sdk |
|---|-----------|---------------|
| Orchestration | Claude Code conversation loop | SDK query() per agent |
| Crash recovery | Manual `-resume <sid>` | Automatic on next run |
| Tool restriction | CLAUDE.md rules + hooks | SDK `tools` option + PreToolUse hook |
| Context | Orchestrator context grows | Fresh per agent |
| Output dir | `.god-agent/pipeline-output/` | `.pipeline-state/` |

---

## ROLLBACK

If the SDK pipeline produces worse results:
1. Use `/god-code` instead — always available, unchanged
2. No data migration needed — memory stores are format-compatible
3. Set `PIPELINE_ENGINE=cli` in settings.json env (informational flag)
