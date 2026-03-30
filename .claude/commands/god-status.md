---
description: Show Universal Self-Learning God Agent status and learning statistics
---

Display the current status of the Universal Self-Learning God Agent including:
1. Initialization state and runtime
2. Health of underlying systems (VectorDB, GraphDB)
3. Learning statistics (interactions, knowledge entries)
4. Domain expertise accumulated
5. Top performing patterns

Execute the God Agent CLI to check status:

```bash
npx tsx src/god-agent/universal/cli.ts status
```

**Output includes:**
- **Initialization Status** - Whether agent is fully initialized
- **Runtime** - Current runtime environment
- **Health** - Status of VectorDB, GraphDB, and other systems
- **Total Interactions** - Number of interactions processed
- **Knowledge Entries** - Amount of stored knowledge
- **Domain Expertise** - Breakdown by domain
- **Top Patterns** - Most effective learned patterns

**Additional queries:**
```bash
# Query specific domain
npx tsx src/god-agent/universal/cli.ts query --domain "project/api" --limit 10

# Check all domains
npx tsx src/god-agent/universal/cli.ts query --domain "general"
```
