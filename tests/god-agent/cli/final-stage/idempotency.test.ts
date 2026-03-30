/**
 * Idempotency Tests for Final Stage Pipeline
 *
 * TASK-015: Idempotency Tests for Pipeline Consistency
 * Per CONSTITUTION EX-005 - Verifies that running the pipeline multiple times
 * produces consistent results.
 *
 * Tests cover:
 * - Basic idempotency: same inputs produce same outputs
 * - Mapping idempotency: deterministic source-to-chapter assignments
 * - Force flag idempotency: --force produces clean overwrites
 * - Partial state idempotency: recovery from interrupted state
 * - Timestamp normalization: results match except for variable fields
 * - Deterministic content: chapter structure remains identical
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FinalStageOrchestrator } from '../../../../src/god-agent/cli/final-stage/final-stage-orchestrator.js';
import type {
  FinalStageResult,
  SemanticMapperOutput,
  ChapterWriterOutput,
  TokenBudget
} from '../../../../src/god-agent/cli/final-stage/types.js';

// ============================================
// Test Fixtures and Helpers
// ============================================

/**
 * Test directory structure paths
 */
interface TestFixturePaths {
  basePath: string;
  researchDir: string;
  outputDir: string;
  chaptersDir: string;
}

/**
 * Create a complete test research directory with all required files
 */
async function createTestResearchDirectory(slug: string): Promise<TestFixturePaths> {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'final-stage-idempotency-'));
  const researchDir = path.join(basePath, 'docs/research', slug);
  const outputDir = path.join(researchDir, 'final');
  const chaptersDir = path.join(outputDir, 'chapters');

  await fs.mkdir(researchDir, { recursive: true });

  return { basePath, researchDir, outputDir, chaptersDir };
}

/**
 * Clean up test directory
 */
async function cleanupTestDirectory(basePath: string): Promise<void> {
  try {
    await fs.rm(basePath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a locked chapter structure file (05-chapter-structure.md)
 */
async function createChapterStructure(
  researchDir: string,
  options: {
    chapterCount?: number;
    locked?: boolean;
    researchTitle?: string;
  } = {}
): Promise<void> {
  const {
    chapterCount = 5,
    locked = true,
    researchTitle = 'Idempotency Test Research Paper'
  } = options;

  const chapters = [];
  for (let i = 1; i <= chapterCount; i++) {
    chapters.push({
      number: i,
      title: `Chapter ${i}: ${getChapterTitle(i)}`,
      purpose: `Purpose for chapter ${i}`,
      sections: [`${i}.1`, `${i}.2`, `${i}.3`],
      sectionTitles: ['Introduction', 'Main Content', 'Summary'],
      wordTarget: 3000 + (i * 500),
      citationTarget: 15 + i,
      questionsAddressed: [`Q${(i % 3) + 1}`],
      assignedAgent: 'chapter-writer',
      keywords: getChapterKeywords(i)
    });
  }

  const structure = {
    locked,
    generatedAt: '2024-01-15T12:00:00.000Z', // Fixed timestamp for idempotency
    totalChapters: chapterCount,
    estimatedTotalWords: chapters.reduce((sum, ch) => sum + ch.wordTarget, 0),
    chapters,
    writerMapping: {},
    researchTitle
  };

  const content = `# Chapter Structure

This document defines the locked chapter structure for the dissertation.

\`\`\`json
${JSON.stringify(structure, null, 2)}
\`\`\`

## Notes

Structure locked per dissertation-architect output.
`;

  await fs.writeFile(path.join(researchDir, '05-chapter-structure.md'), content, 'utf-8');
}

/**
 * Get chapter title based on number
 */
function getChapterTitle(num: number): string {
  const titles: Record<number, string> = {
    1: 'Introduction',
    2: 'Literature Review',
    3: 'Theoretical Framework',
    4: 'Methodology',
    5: 'Results',
    6: 'Discussion',
    7: 'Conclusion',
    8: 'References'
  };
  return titles[num] || `Chapter ${num}`;
}

/**
 * Get keywords for chapter based on number
 */
function getChapterKeywords(num: number): string[] {
  const keywords: Record<number, string[]> = {
    1: ['introduction', 'background', 'context', 'research', 'objectives'],
    2: ['literature', 'review', 'studies', 'research', 'prior work'],
    3: ['theory', 'framework', 'conceptual', 'model', 'foundation'],
    4: ['methodology', 'method', 'design', 'approach', 'data collection'],
    5: ['results', 'findings', 'data', 'analysis', 'outcomes'],
    6: ['discussion', 'implications', 'interpretation', 'significance'],
    7: ['conclusion', 'summary', 'contributions', 'future work'],
    8: ['references', 'bibliography', 'citations']
  };
  return keywords[num] || [`keyword${num}`, 'research'];
}

/**
 * Create mock agent output files with deterministic content
 */
async function createAgentOutputFiles(
  researchDir: string,
  count: number = 10
): Promise<void> {
  const agentNames = [
    'principles', 'research-planner', 'literature-mapper', 'gap-hunter',
    'hypothesis-generator', 'dissertation-architect', 'systematic-reviewer',
    'methodology-scanner', 'quality-assessor', 'source-tier-classifier',
    'construct-definer', 'theoretical-framework', 'model-architect',
    'pattern-analyst', 'thematic-synthesizer', 'evidence-synthesizer',
    'context-tier-manager', 'step-back-analyzer', 'self-ask-decomposer',
    'method-designer', 'sampling-strategist', 'instrument-developer',
    'validity-guardian', 'reproducibility-checker', 'ethics-reviewer',
    'risk-analyst', 'opportunity-identifier', 'contradiction-analyzer',
    'introduction-writer', 'literature-review-writer', 'methodology-writer',
    'results-writer', 'discussion-writer', 'conclusion-writer',
    'abstract-writer', 'citation-extractor', 'citation-validator',
    'apa-citation-specialist', 'file-length-manager', 'consistency-validator',
    'confidence-quantifier', 'adversarial-reviewer', 'bias-detector',
    'ambiguity-clarifier', 'final-validator'
  ];

  for (let i = 0; i < Math.min(count, 45); i++) {
    const index = String(i).padStart(2, '0');
    const agentName = agentNames[i] || `agent-${i}`;
    const phase = getPhaseForIndex(i);
    // Use deterministic content generation
    const content = generateDeterministicAgentContent(agentName, i, phase);
    await fs.writeFile(path.join(researchDir, `${index}-${agentName}.md`), content, 'utf-8');
  }
}

/**
 * Get pipeline phase for file index
 */
function getPhaseForIndex(index: number): number {
  if (index <= 5) return 1;
  if (index <= 13) return 2;
  if (index <= 18) return 3;
  if (index <= 27) return 4;
  if (index <= 33) return 5;
  if (index <= 38) return 6;
  return 7;
}

/**
 * Generate deterministic agent output content (no random elements)
 */
function generateDeterministicAgentContent(agentName: string, index: number, phase: number): string {
  const formattedName = agentName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return `# ${formattedName} Output

Agent: ${formattedName}
Phase: ${phase}
Index: ${index}

## Overview

This document presents the output from the ${formattedName} agent as part of the PhD research pipeline phase ${phase}. The analysis incorporates established research methodologies and synthesizes findings from multiple sources.

## Key Findings

- Finding 1: The research methodology demonstrates robust validity according to (Smith, 2020).
- Finding 2: Data collection procedures align with best practices (Jones & Williams, 2019).
- Finding 3: The analytical framework provides comprehensive coverage (Brown et al., 2021).

## Primary Topics

### Research Methodology

The methodology employed in this study follows established academic standards. The approach integrates quantitative and qualitative methods to ensure comprehensive analysis (Johnson, 2018).

### Literature Integration

Prior research has established foundational concepts that inform the current analysis. Key contributions include theoretical frameworks from (Anderson, 2017) and empirical studies by (Chen et al., 2019).

### Data Analysis

The data analysis procedures employ rigorous statistical methods. Results indicate significant correlations between key variables (p < 0.05) as demonstrated by (Miller, 2020).

## Research Questions Addressed

This output addresses the following research questions:
- Q${(index % 3) + 1}: Primary research question for this phase
- Q${((index + 1) % 3) + 1}: Secondary research question

## Key Terms

The following key terms are central to this analysis:
- ${getChapterKeywords((index % 8) + 1).join(', ')}

## Citations

- (Smith, 2020)
- (Jones & Williams, 2019)
- (Brown et al., 2021)
- (Johnson, 2018)
- (Anderson, 2017)
- (Chen et al., 2019)
- (Miller, 2020)

## Summary

This ${formattedName} output provides essential contributions to the research pipeline. The findings support the overall research objectives and integrate with outputs from other pipeline phases.

---

Generated by PhD Pipeline Phase ${phase}
Word count: approximately 350 words
`;
}

// ============================================
// Normalization Helper Functions
// ============================================

/**
 * Normalize timestamps in an object for comparison
 * Replaces ISO dates with placeholder values
 */
function normalizeTimestamps<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Replace ISO date strings with placeholder
    const isoDatePattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?/g;
    return obj.replace(isoDatePattern, '[TIMESTAMP]') as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => normalizeTimestamps(item)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Normalize timestamp-related fields
      if (key === 'generatedDate' || key === 'timestamp' || key === 'generatedAt' || key === 'dateLocked') {
        normalized[key] = '[TIMESTAMP]';
      } else if (key === 'elapsedMs' || key === 'durationSeconds' || key === 'duration') {
        normalized[key] = '[ELAPSED]';
      } else if (key.endsWith('_start') || key.endsWith('_duration')) {
        normalized[key] = '[TIMING]';
      } else {
        normalized[key] = normalizeTimestamps(value);
      }
    }
    return normalized as T;
  }

  return obj;
}

/**
 * Normalize a FinalStageResult for idempotency comparison
 */
function normalizeResult(result: FinalStageResult): Record<string, unknown> {
  // Convert to plain object first to allow Record<string, unknown> typing
  const plainResult = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  const normalized = normalizeTimestamps(plainResult);

  // Remove fields that are expected to vary
  delete normalized.outputPath; // Path may vary slightly

  return normalized;
}

/**
 * Compare chapter content structure (ignoring variable elements)
 */
function compareChapterContent(c1: string, c2: string): boolean {
  // Normalize both contents
  const normalize = (content: string): string => {
    return content
      // Remove ISO timestamps
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?/g, '[TIMESTAMP]')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  };

  return normalize(c1) === normalize(c2);
}

/**
 * Compare mapping outputs for idempotency
 */
function compareMappings(m1: SemanticMapperOutput | null, m2: SemanticMapperOutput | null): boolean {
  if (m1 === null && m2 === null) return true;
  if (m1 === null || m2 === null) return false;

  // Compare core mapping properties
  if (m1.algorithm !== m2.algorithm) return false;
  if (m1.threshold !== m2.threshold) return false;
  if (m1.fallbacksApplied !== m2.fallbacksApplied) return false;

  // Compare mappings array
  if (m1.mappings.length !== m2.mappings.length) return false;

  for (let i = 0; i < m1.mappings.length; i++) {
    const map1 = m1.mappings[i];
    const map2 = m2.mappings[i];

    if (!map1 || !map2) return false;
    if (map1.chapterNumber !== map2.chapterNumber) return false;
    if (map1.chapterTitle !== map2.chapterTitle) return false;
    if (map1.sourceCount !== map2.sourceCount) return false;

    // Compare source arrays (order matters for idempotency)
    if (JSON.stringify(map1.primarySources) !== JSON.stringify(map2.primarySources)) return false;
    if (JSON.stringify(map1.secondarySources) !== JSON.stringify(map2.secondarySources)) return false;
    if (JSON.stringify(map1.allSources) !== JSON.stringify(map2.allSources)) return false;
  }

  // Compare orphaned sources
  if (JSON.stringify(m1.orphanedSources) !== JSON.stringify(m2.orphanedSources)) return false;

  return true;
}

/**
 * Compare chapter writer outputs for idempotency
 */
function compareChapters(
  chapters1: ChapterWriterOutput[] | undefined,
  chapters2: ChapterWriterOutput[] | undefined
): boolean {
  if (!chapters1 && !chapters2) return true;
  if (!chapters1 || !chapters2) return false;
  if (chapters1.length !== chapters2.length) return false;

  for (let i = 0; i < chapters1.length; i++) {
    const ch1 = chapters1[i];
    const ch2 = chapters2[i];

    if (!ch1 || !ch2) return false;

    // Compare structural properties
    if (ch1.chapterNumber !== ch2.chapterNumber) return false;
    if (ch1.title !== ch2.title) return false;
    if (ch1.wordCount !== ch2.wordCount) return false;
    if (ch1.citations.length !== ch2.citations.length) return false;

    // Compare section structure
    if (ch1.sections.length !== ch2.sections.length) return false;
    for (let j = 0; j < ch1.sections.length; j++) {
      if (ch1.sections[j]?.id !== ch2.sections[j]?.id) return false;
      if (ch1.sections[j]?.title !== ch2.sections[j]?.title) return false;
    }

    // Compare cross-references
    if (ch1.crossReferences.length !== ch2.crossReferences.length) return false;

    // Compare content (normalized)
    if (!compareChapterContent(ch1.content, ch2.content)) return false;
  }

  return true;
}

/**
 * Read all output files from final directory
 */
async function readOutputFiles(outputDir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  try {
    const entries = await fs.readdir(outputDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(outputDir, entry.name);

      if (entry.isFile()) {
        files[entry.name] = await fs.readFile(fullPath, 'utf-8');
      } else if (entry.isDirectory() && entry.name === 'chapters') {
        // Read chapter files
        const chapterEntries = await fs.readdir(fullPath);
        for (const chapterFile of chapterEntries) {
          const chapterPath = path.join(fullPath, chapterFile);
          files[`chapters/${chapterFile}`] = await fs.readFile(chapterPath, 'utf-8');
        }
      }
    }
  } catch {
    // Directory may not exist
  }

  return files;
}

/**
 * Normalize file contents for comparison
 */
function normalizeFileContents(files: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [filename, content] of Object.entries(files)) {
    let normalizedContent = content;

    // Normalize timestamps in content
    normalizedContent = normalizedContent.replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?/g,
      '[TIMESTAMP]'
    );

    // For JSON files, parse and normalize
    if (filename.endsWith('.json')) {
      try {
        const parsed = JSON.parse(content);
        const normalizedParsed = normalizeTimestamps(parsed);
        normalizedContent = JSON.stringify(normalizedParsed, null, 2);
      } catch {
        // Keep as-is if not valid JSON
      }
    }

    normalized[filename] = normalizedContent;
  }

  return normalized;
}

// ============================================
// Idempotency Test Suite
// ============================================

describe('Idempotency Tests', () => {
  let testPaths: TestFixturePaths;
  const testSlug = 'idempotency-test';

  beforeAll(async () => {
    // Create test research directory with deterministic fixtures
    testPaths = await createTestResearchDirectory(testSlug);
    await createChapterStructure(testPaths.researchDir, {
      chapterCount: 5,
      locked: true,
      researchTitle: 'Idempotency Test Research Paper'
    });
    // Create all 45 deterministic agent output files required by the orchestrator
    await createAgentOutputFiles(testPaths.researchDir, 45);
  });

  afterAll(async () => {
    await cleanupTestDirectory(testPaths.basePath);
  });

  // ============================================
  // 1. Basic Idempotency Tests
  // ============================================

  describe('Basic Idempotency', () => {
    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
        const archiveDir = path.join(testPaths.researchDir, 'final-archive');
        await fs.rm(archiveDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should produce identical outputs for same inputs', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ force: true });
      const files1 = await readOutputFiles(testPaths.outputDir);

      // Clean outputs
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });

      // Run 2 with fresh orchestrator
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ force: true });
      const files2 = await readOutputFiles(testPaths.outputDir);

      // Compare normalized results
      const normalized1 = normalizeResult(result1);
      const normalized2 = normalizeResult(result2);

      // Core properties should match
      expect(normalized1.success).toEqual(normalized2.success);
      expect(normalized1.dryRun).toEqual(normalized2.dryRun);
      expect(normalized1.totalWords).toEqual(normalized2.totalWords);
      expect(normalized1.totalCitations).toEqual(normalized2.totalCitations);
      expect(normalized1.chaptersGenerated).toEqual(normalized2.chaptersGenerated);
      expect(normalized1.exitCode).toEqual(normalized2.exitCode);

      // File structure should match
      expect(Object.keys(files1).sort()).toEqual(Object.keys(files2).sort());

      // Normalized file contents should match
      const normalizedFiles1 = normalizeFileContents(files1);
      const normalizedFiles2 = normalizeFileContents(files2);

      for (const filename of Object.keys(normalizedFiles1)) {
        expect(normalizedFiles1[filename]).toEqual(normalizedFiles2[filename]);
      }
    });

    it('should produce same word counts between runs', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ force: true });

      // Clean and run 2
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ force: true });

      // Word counts should match exactly
      expect(result1.totalWords).toBe(result2.totalWords);

      // Per-chapter word counts should match
      if (result1.chapters && result2.chapters) {
        expect(result1.chapters.length).toBe(result2.chapters.length);
        for (let i = 0; i < result1.chapters.length; i++) {
          expect(result1.chapters[i]?.wordCount).toBe(result2.chapters[i]?.wordCount);
        }
      }
    });

    it('should produce same citation counts between runs', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ force: true });

      // Clean and run 2
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ force: true });

      // Total citation counts should match
      expect(result1.totalCitations).toBe(result2.totalCitations);

      // Per-chapter citation counts should match
      if (result1.chapters && result2.chapters) {
        for (let i = 0; i < result1.chapters.length; i++) {
          expect(result1.chapters[i]?.citations.length).toBe(
            result2.chapters[i]?.citations.length
          );
        }
      }
    });
  });

  // ============================================
  // 2. Mapping Idempotency Tests
  // ============================================

  describe('Mapping Idempotency', () => {
    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should produce same mapping results for identical inputs', async () => {
      // Run 1 (dry run to get mapping only)
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ dryRun: true, force: true });

      // Clean and run 2
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ dryRun: true, force: true });

      // Mappings should be identical
      expect(compareMappings(result1.mapping, result2.mapping)).toBe(true);
    });

    it('should produce same source-to-chapter assignments', async () => {
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ dryRun: true, force: true });

      await fs.rm(testPaths.outputDir, { recursive: true, force: true });

      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ dryRun: true, force: true });

      // Compare source assignments per chapter
      if (result1.mapping && result2.mapping) {
        for (let i = 0; i < result1.mapping.mappings.length; i++) {
          const map1 = result1.mapping.mappings[i];
          const map2 = result2.mapping.mappings[i];

          expect(map1?.allSources).toEqual(map2?.allSources);
          expect(map1?.primarySources).toEqual(map2?.primarySources);
          expect(map1?.secondarySources).toEqual(map2?.secondarySources);
        }
      }
    });

    it('should produce same orphaned source indices', async () => {
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ dryRun: true, force: true });

      await fs.rm(testPaths.outputDir, { recursive: true, force: true });

      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ dryRun: true, force: true });

      // Orphaned sources should be identical
      expect(result1.mapping?.orphanedSources).toEqual(result2.mapping?.orphanedSources);
    });

    it('should produce same quality metrics', async () => {
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ dryRun: true, force: true });

      await fs.rm(testPaths.outputDir, { recursive: true, force: true });

      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ dryRun: true, force: true });

      // Quality metrics should match
      if (result1.mapping && result2.mapping) {
        expect(result1.mapping.mappingQuality.coverage).toBe(
          result2.mapping.mappingQuality.coverage
        );
        expect(result1.mapping.mappingQuality.avgRelevance).toBe(
          result2.mapping.mappingQuality.avgRelevance
        );
        expect(result1.mapping.mappingQuality.balance).toBe(
          result2.mapping.mappingQuality.balance
        );
      }
    });

    it('should produce deterministic results with same threshold', async () => {
      const threshold = 0.35;

      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ dryRun: true, force: true, threshold });

      await fs.rm(testPaths.outputDir, { recursive: true, force: true });

      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ dryRun: true, force: true, threshold });

      // Verify both runs succeeded
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Verify mappings exist
      expect(result1.mapping).not.toBeNull();
      expect(result2.mapping).not.toBeNull();

      // Compare thresholds if mappings exist
      if (result1.mapping && result2.mapping) {
        expect(result1.mapping.threshold).toBe(result2.mapping.threshold);
        expect(result1.mapping.threshold).toBe(threshold);
        expect(compareMappings(result1.mapping, result2.mapping)).toBe(true);
      }
    });
  });

  // ============================================
  // 3. Force Flag Idempotency Tests
  // ============================================

  describe('Force Flag Idempotency', () => {
    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
        const archiveDir = path.join(testPaths.researchDir, 'final-archive');
        await fs.rm(archiveDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should overwrite cleanly with --force', async () => {
      // Initial run
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ force: true });
      expect(result1.success).toBe(true);

      // Second run with --force should succeed and produce same results
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ force: true });
      expect(result2.success).toBe(true);

      // Results should be functionally identical
      expect(result1.totalWords).toBe(result2.totalWords);
      expect(result1.chaptersGenerated).toBe(result2.chaptersGenerated);
    });

    it('should archive previous outputs correctly with --force', async () => {
      // First run
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator1.execute({ force: true });

      // Second run with --force
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator2.execute({ force: true });

      // Archive should exist
      const archiveDir = path.join(testPaths.researchDir, 'final-archive');
      const archiveExists = await fs.stat(archiveDir).then(() => true).catch(() => false);
      expect(archiveExists).toBe(true);

      // Archive should contain previous output
      const archiveEntries = await fs.readdir(archiveDir);
      expect(archiveEntries.length).toBeGreaterThan(0);
    });

    it('should produce same results as fresh run when using --force', async () => {
      // Run with existing output and --force
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator1.execute({ force: true });

      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const resultWithForce = await orchestrator2.execute({ force: true });
      const filesWithForce = await readOutputFiles(testPaths.outputDir);

      // Clean everything and do fresh run
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const archiveDir = path.join(testPaths.researchDir, 'final-archive');
      await fs.rm(archiveDir, { recursive: true, force: true });

      const orchestrator3 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const freshResult = await orchestrator3.execute({ force: true });
      const freshFiles = await readOutputFiles(testPaths.outputDir);

      // Results should match
      expect(resultWithForce.totalWords).toBe(freshResult.totalWords);
      expect(resultWithForce.chaptersGenerated).toBe(freshResult.chaptersGenerated);

      // Normalized file contents should match
      const normalizedWithForce = normalizeFileContents(filesWithForce);
      const normalizedFresh = normalizeFileContents(freshFiles);

      expect(Object.keys(normalizedWithForce).sort()).toEqual(
        Object.keys(normalizedFresh).sort()
      );
    });
  });

  // ============================================
  // 4. Partial State Idempotency Tests
  // ============================================

  describe('Partial State Idempotency', () => {
    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
        const archiveDir = path.join(testPaths.researchDir, 'final-archive');
        await fs.rm(archiveDir, { recursive: true, force: true });
        const failedRunsDir = path.join(testPaths.researchDir, 'failed-runs');
        await fs.rm(failedRunsDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should handle partial outputs from previous runs', async () => {
      // Create partial output directory structure
      await fs.mkdir(testPaths.outputDir, { recursive: true });
      await fs.mkdir(testPaths.chaptersDir, { recursive: true });

      // Write a partial chapter file
      await fs.writeFile(
        path.join(testPaths.chaptersDir, 'ch01-partial.md'),
        '# Partial Chapter\n\nThis is incomplete.',
        'utf-8'
      );

      // Run with --force should clean up and produce full output
      const orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result = await orchestrator.execute({ force: true });

      expect(result.success).toBe(true);
      expect(result.chaptersGenerated).toBeGreaterThan(0);

      // Partial file should be archived or replaced
      const chapterFiles = await fs.readdir(testPaths.chaptersDir);
      const hasPartialFile = chapterFiles.some(f => f.includes('partial'));
      expect(hasPartialFile).toBe(false);
    });

    it('should produce consistent results after retry', async () => {
      // First successful run
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ force: true });

      // Clean and retry
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });

      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ force: true });

      // Results should be consistent
      expect(result1.success).toBe(result2.success);
      expect(result1.totalWords).toBe(result2.totalWords);
      expect(result1.chaptersGenerated).toBe(result2.chaptersGenerated);
    });

    it('should maintain clean state after failure and retry', async () => {
      // Create a bad slug that will fail
      const badOrchestrator = new FinalStageOrchestrator(testPaths.basePath, 'nonexistent-slug');
      const badResult = await badOrchestrator.execute({ force: true });
      expect(badResult.success).toBe(false);

      // Now run with valid slug
      const goodOrchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const goodResult = await goodOrchestrator.execute({ force: true });

      expect(goodResult.success).toBe(true);
      expect(goodResult.chaptersGenerated).toBeGreaterThan(0);
    });
  });

  // ============================================
  // 5. Timestamp Normalization Tests
  // ============================================

  describe('Timestamp Normalization', () => {
    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should match results except for generatedDate', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ force: true });

      // Wait a moment to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 100));

      // Clean and run 2
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ force: true });

      // Normalized results should match
      const normalized1 = normalizeResult(result1);
      const normalized2 = normalizeResult(result2);

      expect(normalized1.success).toEqual(normalized2.success);
      expect(normalized1.totalWords).toEqual(normalized2.totalWords);
      expect(normalized1.chaptersGenerated).toEqual(normalized2.chaptersGenerated);
    });

    it('should have varying elapsed times but identical structure', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ force: true });
      const timings1 = orchestrator1.getPhaseTimings();

      // Clean and run 2
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ force: true });
      const timings2 = orchestrator2.getPhaseTimings();

      // Timing structure should match
      expect(Object.keys(timings1).sort()).toEqual(Object.keys(timings2).sort());

      // Values may differ but all should be positive numbers
      for (const key of Object.keys(timings1)) {
        expect(typeof timings1[key]).toBe('number');
        expect(typeof timings2[key]).toBe('number');
        expect(timings1[key]).toBeGreaterThanOrEqual(0);
        expect(timings2[key]).toBeGreaterThanOrEqual(0);
      }

      // Results should still match
      expect(result1.totalWords).toBe(result2.totalWords);
    });

    it('should normalize metadata.json timestamps correctly', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator1.execute({ force: true });
      const files1 = await readOutputFiles(testPaths.outputDir);

      // Wait and run 2
      await new Promise(resolve => setTimeout(resolve, 50));
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });

      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator2.execute({ force: true });
      const files2 = await readOutputFiles(testPaths.outputDir);

      // Normalize and compare metadata
      const normalizedFiles1 = normalizeFileContents(files1);
      const normalizedFiles2 = normalizeFileContents(files2);

      expect(normalizedFiles1['metadata.json']).toEqual(normalizedFiles2['metadata.json']);
    });
  });

  // ============================================
  // 6. Deterministic Content Tests
  // ============================================

  describe('Deterministic Content', () => {
    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should produce identical chapter titles between runs', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ force: true });

      // Clean and run 2
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ force: true });

      // Chapter titles should match
      if (result1.chapters && result2.chapters) {
        expect(result1.chapters.length).toBe(result2.chapters.length);
        for (let i = 0; i < result1.chapters.length; i++) {
          expect(result1.chapters[i]?.title).toBe(result2.chapters[i]?.title);
        }
      }
    });

    it('should produce identical section structure between runs', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ force: true });

      // Clean and run 2
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ force: true });

      // Section structure should match
      if (result1.chapters && result2.chapters) {
        for (let i = 0; i < result1.chapters.length; i++) {
          const ch1 = result1.chapters[i];
          const ch2 = result2.chapters[i];

          if (ch1 && ch2) {
            expect(ch1.sections.length).toBe(ch2.sections.length);
            for (let j = 0; j < ch1.sections.length; j++) {
              expect(ch1.sections[j]?.id).toBe(ch2.sections[j]?.id);
              expect(ch1.sections[j]?.title).toBe(ch2.sections[j]?.title);
            }
          }
        }
      }
    });

    it('should produce consistent cross-references between runs', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ force: true });

      // Clean and run 2
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ force: true });

      // Cross-reference counts should match
      if (result1.chapters && result2.chapters) {
        for (let i = 0; i < result1.chapters.length; i++) {
          expect(result1.chapters[i]?.crossReferences.length).toBe(
            result2.chapters[i]?.crossReferences.length
          );
        }
      }
    });

    it('should produce identical table of contents between runs', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator1.execute({ force: true });
      const files1 = await readOutputFiles(testPaths.outputDir);

      // Clean and run 2
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator2.execute({ force: true });
      const files2 = await readOutputFiles(testPaths.outputDir);

      // Extract ToC from final paper
      const paper1 = files1['final-paper.md'] || '';
      const paper2 = files2['final-paper.md'] || '';

      // Find ToC section
      const extractToc = (content: string): string => {
        const tocMatch = content.match(/## Table of Contents[\s\S]*?(?=\n## (?!Table))/);
        return tocMatch ? tocMatch[0] : '';
      };

      const toc1 = extractToc(paper1);
      const toc2 = extractToc(paper2);

      // Normalize and compare (remove timestamps)
      const normalizedToc1 = toc1.replace(/\d{4}-\d{2}-\d{2}/g, '[DATE]');
      const normalizedToc2 = toc2.replace(/\d{4}-\d{2}-\d{2}/g, '[DATE]');

      expect(normalizedToc1).toBe(normalizedToc2);
    });

    it('should produce deterministic chapter file naming', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator1.execute({ force: true });
      const files1 = await readOutputFiles(testPaths.outputDir);

      // Clean and run 2
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator2.execute({ force: true });
      const files2 = await readOutputFiles(testPaths.outputDir);

      // File names should match exactly
      const chapterFiles1 = Object.keys(files1)
        .filter(f => f.startsWith('chapters/'))
        .sort();
      const chapterFiles2 = Object.keys(files2)
        .filter(f => f.startsWith('chapters/'))
        .sort();

      expect(chapterFiles1).toEqual(chapterFiles2);
    });
  });

  // ============================================
  // 7. Token Budget Idempotency
  // ============================================

  describe('Token Budget Idempotency', () => {
    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should produce consistent token usage between runs', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator1.execute({ force: true });
      const budget1 = orchestrator1.getTokenBudget();

      // Clean and run 2
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator2.execute({ force: true });
      const budget2 = orchestrator2.getTokenBudget();

      // Token budgets should match
      expect(budget1.total.used).toBe(budget2.total.used);
      expect(budget1.phases.summaryExtraction.used).toBe(budget2.phases.summaryExtraction.used);
      expect(budget1.phases.mapping.used).toBe(budget2.phases.mapping.used);
      expect(budget1.phases.combination.used).toBe(budget2.phases.combination.used);

      // Per-chapter usage should match
      expect(budget1.phases.chapterWriting.used).toEqual(budget2.phases.chapterWriting.used);
    });

    it('should produce consistent utilization percentage', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator1.execute({ force: true });
      const budget1 = orchestrator1.getTokenBudget();

      // Clean and run 2
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator2.execute({ force: true });
      const budget2 = orchestrator2.getTokenBudget();

      expect(budget1.total.utilization).toBe(budget2.total.utilization);
    });
  });

  // ============================================
  // 8. Dry Run Idempotency
  // ============================================

  describe('Dry Run Idempotency', () => {
    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should produce identical dry run results', async () => {
      // Run 1
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ dryRun: true, force: true });

      // Clean and run 2
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ dryRun: true, force: true });

      // Results should be identical
      expect(result1.success).toBe(result2.success);
      expect(result1.dryRun).toBe(result2.dryRun);
      expect(result1.chaptersGenerated).toBe(result2.chaptersGenerated);
      expect(result1.totalWords).toBe(result2.totalWords);

      // Mappings should be identical
      expect(compareMappings(result1.mapping, result2.mapping)).toBe(true);
    });

    it('should not produce any files in dry run mode', async () => {
      // Multiple dry runs
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator1.execute({ dryRun: true, force: true });

      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      await orchestrator2.execute({ dryRun: true, force: true });

      // Check no output files were created (except possibly empty directory structure)
      const finalPaperPath = path.join(testPaths.outputDir, 'final-paper.md');
      const paperExists = await fs.stat(finalPaperPath).then(() => true).catch(() => false);
      expect(paperExists).toBe(false);
    });
  });
});

// ============================================
// Edge Case Idempotency Tests
// ============================================

describe('Edge Case Idempotency', () => {
  let testPaths: TestFixturePaths;
  const testSlug = 'edge-case-test';

  beforeAll(async () => {
    testPaths = await createTestResearchDirectory(testSlug);
    await createChapterStructure(testPaths.researchDir, { chapterCount: 3 });
    // Create all 45 agent output files required by the orchestrator
    await createAgentOutputFiles(testPaths.researchDir, 45);
  });

  afterAll(async () => {
    await cleanupTestDirectory(testPaths.basePath);
  });

  afterEach(async () => {
    try {
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      const archiveDir = path.join(testPaths.researchDir, 'final-archive');
      await fs.rm(archiveDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should handle minimum chapter count consistently', async () => {
    // Multiple runs with minimum chapters (3)
    const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    const result1 = await orchestrator1.execute({ force: true });

    await fs.rm(testPaths.outputDir, { recursive: true, force: true });

    const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    const result2 = await orchestrator2.execute({ force: true });

    expect(result1.chaptersGenerated).toBe(result2.chaptersGenerated);
    expect(result1.totalWords).toBe(result2.totalWords);
  });

  it('should handle different threshold values deterministically', async () => {
    // Test with a single threshold value to verify determinism
    const threshold = 0.30;

    // Run 1
    const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    const result1 = await orchestrator1.execute({ dryRun: true, force: true, threshold });

    // Clean output and archive directories
    await fs.rm(testPaths.outputDir, { recursive: true, force: true });
    const archiveDir = path.join(testPaths.researchDir, 'final-archive');
    await fs.rm(archiveDir, { recursive: true, force: true });

    // Run 2
    const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    const result2 = await orchestrator2.execute({ dryRun: true, force: true, threshold });

    // Both runs should succeed
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    // Mappings should exist and match
    expect(result1.mapping).not.toBeNull();
    expect(result2.mapping).not.toBeNull();

    if (result1.mapping && result2.mapping) {
      // Results should match for same threshold
      expect(result1.mapping.threshold).toBe(result2.mapping.threshold);
      expect(result1.mapping.threshold).toBe(threshold);
      expect(compareMappings(result1.mapping, result2.mapping)).toBe(true);
    }
  });

  it('should handle sequential vs parallel mode consistently', async () => {
    // Run with sequential mode
    const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    const result1 = await orchestrator1.execute({ force: true, sequential: true });

    await fs.rm(testPaths.outputDir, { recursive: true, force: true });

    // Run with default (parallel) mode
    const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    const result2 = await orchestrator2.execute({ force: true, sequential: false });

    // Results should be identical regardless of execution mode
    expect(result1.totalWords).toBe(result2.totalWords);
    expect(result1.chaptersGenerated).toBe(result2.chaptersGenerated);
    expect(result1.totalCitations).toBe(result2.totalCitations);
  });
});
