---
description: Provide feedback for a God Agent trajectory to improve learning
---

Provide feedback for a God Agent trajectory to enable weight updates and pattern creation in the learning system.

**Usage:** `/god-feedback <trajectoryId> <rating 0-1> [notes]`

**Parameters:**
- `trajectoryId` - The trajectory ID from a previous /god-ask, /god-code, /god-research, or /god-write response
- `rating` - Quality rating from 0 to 1 (0.8+ triggers auto-pattern creation)
- `notes` - Optional feedback notes

Execute the God Agent CLI to provide feedback:

```bash
npx tsx src/god-agent/universal/cli.ts feedback "$ARGUMENTS" --trajectory
```

**Note:** The `--trajectory` (or `-t`) flag is required when providing a trajectory ID (IDs starting with `traj_`).

**Examples:**
```bash
# Positive feedback
npx tsx src/god-agent/universal/cli.ts feedback traj_1234567890_abc123 0.95 --trajectory --notes "Excellent code solution"

# Negative feedback
npx tsx src/god-agent/universal/cli.ts feedback traj_9876543210_xyz789 0.3 --trajectory --notes "Output was not relevant"
```

**What happens based on rating:**
- Rating >= 0.7: Reinforces the pattern (positive learning)
- Rating 0.4-0.7: Neutral feedback (recorded for analysis)
- Rating < 0.4: Weakens the pattern (negative learning)
- Rating >= 0.8: Auto-creates new pattern for future use (FR-11)

**Learning Impact:**
- High ratings strengthen successful patterns
- Low ratings weaken unsuccessful approaches
- Feedback accumulates to improve future responses
- Patterns with consistent high ratings become preferred
