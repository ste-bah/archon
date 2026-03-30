---
description: Learn a writing style from PDF documents for the God Agent
---

Learn a writing style from PDF documents in specified directories. The God Agent will:
1. Extract text from PDFs using poppler-utils
2. Analyze writing characteristics (sentence structure, vocabulary, tone)
3. Create a composite style profile
4. Store it for use in future writing tasks

**Usage:** `/god-learn-style <profile-name> <directory-paths...>`

**Arguments:** $ARGUMENTS

Execute the style learning script:

```bash
node scripts/learn-style.mjs $ARGUMENTS
```

**Examples:**
```bash
# Learn from a single directory
node scripts/learn-style.mjs academic-papers docs2/social_science_papers

# Learn from multiple directories
node scripts/learn-style.mjs research-style docs2/human_era_papers docs2/social_science_papers

# Use default directories (docs2/social_science_papers, docs2/human_era_papers)
node scripts/learn-style.mjs academic-papers
```

**Prerequisites:**
- Install poppler-utils: `sudo apt install poppler-utils`
- PDFs must contain extractable text (not scanned images)

**Output includes:**
- Extraction summary (PDFs processed, success/failure)
- Style characteristics:
  - Sentence structure (length distribution, complexity)
  - Vocabulary (academic words, unique words, contractions)
  - Tone (formality, objectivity, hedging)
  - Structure (paragraph length, passive voice, transitions)
  - Citation style detected

**After learning:**
- Profile is set as ACTIVE automatically
- Future `/god-write` calls will use this style
- Check status with `/god-style-status`
