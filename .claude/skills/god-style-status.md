---
description: Show God Agent style profile status and available profiles
---

Display the current style profile status for the God Agent, including:
1. Active style profile (if any)
2. All available style profiles
3. Style characteristics of the active profile

Execute the style status script:

```bash
node scripts/style-status.mjs
```

**Output includes:**
- **Total profiles** - Number of learned style profiles
- **Active profile** - Currently active profile name (or None)
- **Available profiles** - List of all profiles with:
  - ID, source count, type, tags, creation date
  - Active marker (→) for currently active profile

**Active profile characteristics** (if one is set):
- Tone: Formality and objectivity level
- Sentence complexity percentage
- Academic vocabulary ratio
- Passive voice usage
- Citation style detected
- Common transitions learned
- Sample phrases from source documents

**Related commands:**
```bash
# Learn a new style
/god-learn-style <name> <pdf-directories...>

# Write using active style
/god-write <topic>

# Write with options
npx tsx src/god-agent/universal/cli.ts write "Topic" --style academic --format paper
```
