---
description: Ask the Universal Self-Learning God Agent anything with DAI-001 agent selection
---

Ask the Universal Self-Learning God Agent anything. The agent will:
1. Auto-detect the appropriate mode and select the best specialist agent via DAI-001
2. Create a learning trajectory for feedback tracking
3. Search its knowledge base for relevant patterns
4. Generate a response using accumulated knowledge

**Query:** $ARGUMENTS

## Step 1: Get DAI-001 Agent Selection

Run the God Agent CLI to get the selected agent and built prompt:

```bash
npx tsx src/god-agent/universal/cli.ts ask "$ARGUMENTS" --json
```

## Step 2: Parse CLI Output

The CLI will output JSON like:
```json
{
  "command": "ask",
  "selectedAgent": "ambiguity-clarifier",
  "prompt": "## Agent: ambiguity-clarifier...",
  "isPipeline": false,
  "result": { ... },
  "success": true,
  "trajectoryId": "trj_xxx"
}
```

## Step 3: Spawn Task() with Selected Agent

**CRITICAL**: You MUST spawn a Task() subagent. Do NOT do the work directly.

If `isPipeline` is false (single agent):
```
Task("[selectedAgent from JSON]", "[prompt from JSON]")
```

If `isPipeline` is true (multi-agent pipeline):
```
Use UniversalAgent.runPipeline() with the pipeline from result
```

## Step 4: Present Output

Present the subagent's output to the user along with the trajectory ID for feedback.

## Step 5: Provide Feedback (Recommended)

To improve learning, provide feedback:
```bash
npx tsx src/god-agent/universal/cli.ts feedback [trajectoryId] [rating 0-1] --trajectory --notes "feedback"
```

---

**DAI-002 Command Integration**: This command routes questions to the most appropriate specialist agent via DAI-001 dynamic selection.
