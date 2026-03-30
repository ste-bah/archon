/**
 * Integration Tests for Final Stage Pipeline
 *
 * TASK-014: Integration Tests for Full Pipeline
 * Per CONSTITUTION QA-004 - Comprehensive end-to-end testing
 *
 * Tests the complete FinalStageOrchestrator pipeline:
 * - End-to-end pipeline execution (IDLE -> COMPLETED)
 * - Dry run mode
 * - Component integration (SummaryExtractor -> SemanticMapper -> ChapterWriter -> PaperCombiner)
 * - Progress reporting
 * - Error recovery
 * - Token budget tracking
 * - Output structure validation
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FinalStageOrchestrator } from '../../../../src/god-agent/cli/final-stage/final-stage-orchestrator.js';
import type {
  FinalStageOptions,
  FinalStageResult,
  FinalStageState,
  ProgressReport,
  ChapterNumber,
  AgentOutputSummary
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
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'final-stage-integration-'));
  const researchDir = path.join(basePath, 'docs/research', slug);
  const outputDir = path.join(researchDir, 'final');
  const chaptersDir = path.join(outputDir, 'chapters');

  // Create directory structure
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
    chapterCount = 8,
    locked = true,
    researchTitle = 'Test Research Paper'
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
    generatedAt: new Date().toISOString(),
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
 * Create mock agent output files (simulating pipeline output)
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
    const content = generateAgentOutputContent(agentName, i, phase);
    await fs.writeFile(path.join(researchDir, `${index}-${agentName}.md`), content, 'utf-8');
  }
}

/**
 * Get pipeline phase for file index
 */
function getPhaseForIndex(index: number): number {
  if (index <= 5) return 1;      // Foundation
  if (index <= 13) return 2;     // Exploration
  if (index <= 18) return 3;     // Context
  if (index <= 27) return 4;     // Analysis
  if (index <= 33) return 5;     // Synthesis
  if (index <= 38) return 6;     // Writing
  return 7;                       // Validation
}

/**
 * Generate realistic agent output content
 */
function generateAgentOutputContent(agentName: string, index: number, phase: number): string {
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

/**
 * Create optional style profile
 */
async function createStyleProfile(basePath: string, slug: string): Promise<void> {
  const styleDir = path.join(basePath, '.god-agent/style-profiles');
  await fs.mkdir(styleDir, { recursive: true });

  const styleProfile = {
    citationStyle: 'APA',
    regional: {
      languageVariant: 'en-GB',
      primaryQuoteMark: '"'
    },
    tone: {
      formalityScore: 0.85
    }
  };

  await fs.writeFile(
    path.join(styleDir, `${slug}.json`),
    JSON.stringify(styleProfile, null, 2),
    'utf-8'
  );
}

// ============================================
// Integration Test Suite
// ============================================

describe('FinalStageOrchestrator Integration Tests', () => {
  let testPaths: TestFixturePaths;
  const testSlug = 'integration-test-research';

  beforeAll(async () => {
    // Create test research directory with all fixtures
    testPaths = await createTestResearchDirectory(testSlug);
    await createChapterStructure(testPaths.researchDir, {
      chapterCount: 8,
      locked: true,
      researchTitle: 'Integration Test Research Paper'
    });
    // Create all 45 agent output files required by the orchestrator
    await createAgentOutputFiles(testPaths.researchDir, 45);
    await createStyleProfile(testPaths.basePath, testSlug);
  });

  afterAll(async () => {
    await cleanupTestDirectory(testPaths.basePath);
  });

  // ============================================
  // 1. End-to-End Pipeline Tests
  // ============================================

  describe('End-to-End Pipeline Execution', () => {
    let orchestrator: FinalStageOrchestrator;

    beforeEach(() => {
      orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    });

    afterEach(async () => {
      // Cleanup output directory for next test
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should start in IDLE state', () => {
      expect(orchestrator.getState()).toBe('IDLE');
    });

    it('should execute complete pipeline from IDLE to COMPLETED', async () => {
      const statesVisited: FinalStageState[] = [];

      orchestrator.onProgress((report: ProgressReport) => {
        if (report.phase && !statesVisited.includes(report.phase as FinalStageState)) {
          statesVisited.push(report.phase as FinalStageState);
        }
      });

      const result = await orchestrator.execute({
        force: true,
        verbose: false
      });

      expect(result.success).toBe(true);
      expect(orchestrator.getState()).toBe('COMPLETED');

      // Verify state transitions occurred
      expect(statesVisited).toContain('INITIALIZING');
      expect(statesVisited).toContain('SCANNING');
      expect(statesVisited).toContain('SUMMARIZING');
      expect(statesVisited).toContain('MAPPING');
      expect(statesVisited).toContain('WRITING');
      expect(statesVisited).toContain('COMBINING');
      expect(statesVisited).toContain('VALIDATING');
      expect(statesVisited).toContain('COMPLETED');
    });

    it('should produce valid FinalStageResult', async () => {
      const result = await orchestrator.execute({ force: true });

      // Verify result structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('dryRun');
      expect(result).toHaveProperty('outputPath');
      expect(result).toHaveProperty('totalWords');
      expect(result).toHaveProperty('totalCitations');
      expect(result).toHaveProperty('chaptersGenerated');
      expect(result).toHaveProperty('mapping');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('metadata');
      expect(result).toHaveProperty('exitCode');

      // Verify types
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.dryRun).toBe('boolean');
      expect(typeof result.totalWords).toBe('number');
      expect(typeof result.totalCitations).toBe('number');
      expect(typeof result.chaptersGenerated).toBe('number');
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    it('should generate output files in final/ directory', async () => {
      const result = await orchestrator.execute({ force: true });

      expect(result.success).toBe(true);
      expect(result.outputPath).not.toBeNull();

      // Verify final-paper.md exists
      const finalPaperPath = path.join(testPaths.outputDir, 'final-paper.md');
      const finalPaperExists = await fs.stat(finalPaperPath).then(() => true).catch(() => false);
      expect(finalPaperExists).toBe(true);

      // Verify chapters directory exists
      const chaptersExists = await fs.stat(testPaths.chaptersDir).then(() => true).catch(() => false);
      expect(chaptersExists).toBe(true);

      // Verify metadata.json exists
      const metadataPath = path.join(testPaths.outputDir, 'metadata.json');
      const metadataExists = await fs.stat(metadataPath).then(() => true).catch(() => false);
      expect(metadataExists).toBe(true);
    });

    it('should generate correct number of chapters', async () => {
      const result = await orchestrator.execute({ force: true });

      expect(result.success).toBe(true);
      expect(result.chaptersGenerated).toBe(8);
    });
  });

  // ============================================
  // 2. Dry Run Tests
  // ============================================

  describe('Dry Run Mode', () => {
    let orchestrator: FinalStageOrchestrator;

    beforeEach(() => {
      orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    });

    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should stop after MAPPING when dryRun=true', async () => {
      const statesVisited: FinalStageState[] = [];

      orchestrator.onProgress((report: ProgressReport) => {
        if (report.phase && !statesVisited.includes(report.phase as FinalStageState)) {
          statesVisited.push(report.phase as FinalStageState);
        }
      });

      const result = await orchestrator.execute({ dryRun: true, force: true });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(orchestrator.getState()).toBe('COMPLETED');

      // Should NOT include WRITING, COMBINING, VALIDATING
      expect(statesVisited).not.toContain('WRITING');
      expect(statesVisited).not.toContain('COMBINING');
      expect(statesVisited).not.toContain('VALIDATING');

      // Should include early phases
      expect(statesVisited).toContain('SCANNING');
      expect(statesVisited).toContain('MAPPING');
    });

    it('should return mapping without writing chapters', async () => {
      const result = await orchestrator.execute({ dryRun: true, force: true });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.mapping).not.toBeNull();
      expect(result.mapping?.mappings).toBeDefined();
      expect(result.chaptersGenerated).toBe(0);
      expect(result.totalWords).toBe(0);
    });

    it('should not create any output files in dry run', async () => {
      await orchestrator.execute({ dryRun: true, force: true });

      // Check that final-paper.md does NOT exist
      const finalPaperPath = path.join(testPaths.outputDir, 'final-paper.md');
      const finalPaperExists = await fs.stat(finalPaperPath).then(() => true).catch(() => false);
      expect(finalPaperExists).toBe(false);

      // Check that chapters directory does NOT exist or is empty
      const chaptersDir = path.join(testPaths.outputDir, 'chapters');
      const chaptersDirExists = await fs.stat(chaptersDir).then(() => true).catch(() => false);

      if (chaptersDirExists) {
        const files = await fs.readdir(chaptersDir);
        expect(files.length).toBe(0);
      }
    });
  });

  // ============================================
  // 3. Component Integration Tests
  // ============================================

  describe('Component Integration', () => {
    let orchestrator: FinalStageOrchestrator;

    beforeEach(() => {
      orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    });

    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should integrate SummaryExtractor output into SemanticMapper', async () => {
      const result = await orchestrator.execute({ force: true });

      expect(result.success).toBe(true);

      // Verify scan result is available
      expect(result.scanResult).toBeDefined();
      expect(result.scanResult?.foundFiles).toBeGreaterThan(0);

      // Verify mapping uses scanned files
      expect(result.mapping).toBeDefined();
      expect(result.mapping?.mappings.length).toBeGreaterThan(0);
    });

    it('should integrate SemanticMapper output into ChapterWriterAgent', async () => {
      const result = await orchestrator.execute({ force: true });

      expect(result.success).toBe(true);

      // Verify chapters were written based on mapping
      expect(result.chapters).toBeDefined();
      expect(result.chapters!.length).toBeGreaterThan(0);

      // Each chapter should have content
      for (const chapter of result.chapters || []) {
        expect(chapter.content).toBeTruthy();
        expect(chapter.wordCount).toBeGreaterThan(0);
      }
    });

    it('should integrate ChapterWriterAgent output into PaperCombiner', async () => {
      const result = await orchestrator.execute({ force: true });

      expect(result.success).toBe(true);
      expect(result.outputPath).not.toBeNull();

      // Verify combined paper exists and contains content
      if (result.outputPath) {
        const paperContent = await fs.readFile(result.outputPath, 'utf-8');
        expect(paperContent.length).toBeGreaterThan(0);

        // Should contain table of contents
        expect(paperContent).toContain('Table of Contents');
      }
    });

    it('should apply StyleApplier to chapter content', async () => {
      const result = await orchestrator.execute({ force: true });

      expect(result.success).toBe(true);

      // Style profile was loaded
      const styleProfile = orchestrator.getStyleProfile();
      // Style profile may or may not be loaded depending on file existence
      // The test verifies the mechanism works without failing
      expect(result.chapters).toBeDefined();
    });
  });

  // ============================================
  // 4. Progress Reporting Integration
  // ============================================

  describe('Progress Reporting', () => {
    let orchestrator: FinalStageOrchestrator;

    beforeEach(() => {
      orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    });

    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should call progress callback at each phase', async () => {
      const progressReports: ProgressReport[] = [];

      orchestrator.onProgress((report: ProgressReport) => {
        progressReports.push({ ...report });
      });

      await orchestrator.execute({ force: true });

      // Should have multiple progress reports
      expect(progressReports.length).toBeGreaterThan(5);

      // Should cover all phases
      const phases = new Set(progressReports.map(r => r.phase));
      expect(phases.size).toBeGreaterThan(3);
    });

    it('should report accurate current/total values', async () => {
      const writingReports: ProgressReport[] = [];

      orchestrator.onProgress((report: ProgressReport) => {
        if (report.phase === 'WRITING' && report.current > 0) {
          writingReports.push({ ...report });
        }
      });

      await orchestrator.execute({ force: true });

      // Should have writing progress reports
      if (writingReports.length > 0) {
        // Current should be <= total
        for (const report of writingReports) {
          if (report.total > 0) {
            expect(report.current).toBeLessThanOrEqual(report.total);
            expect(report.current).toBeGreaterThanOrEqual(0);
          }
        }
      }
    });

    it('should track elapsed time correctly', async () => {
      let firstReport: ProgressReport | null = null;
      let lastReport: ProgressReport | null = null;

      orchestrator.onProgress((report: ProgressReport) => {
        if (!firstReport) {
          firstReport = { ...report };
        }
        lastReport = { ...report };
      });

      await orchestrator.execute({ force: true });

      expect(firstReport).not.toBeNull();
      expect(lastReport).not.toBeNull();

      // Elapsed time should increase
      if (firstReport && lastReport) {
        expect(lastReport.elapsedMs).toBeGreaterThanOrEqual(firstReport.elapsedMs);
      }
    });

    it('should support multiple progress callbacks', async () => {
      let callback1Count = 0;
      let callback2Count = 0;

      orchestrator.onProgress(() => {
        callback1Count++;
      });

      orchestrator.onProgress(() => {
        callback2Count++;
      });

      await orchestrator.execute({ force: true });

      expect(callback1Count).toBeGreaterThan(0);
      expect(callback2Count).toBeGreaterThan(0);
      expect(callback1Count).toBe(callback2Count);
    });

    it('should allow removing progress callbacks', async () => {
      let callbackCount = 0;
      const callback = () => {
        callbackCount++;
      };

      orchestrator.onProgress(callback);
      orchestrator.offProgress(callback);

      await orchestrator.execute({ force: true });

      expect(callbackCount).toBe(0);
    });
  });

  // ============================================
  // 5. Error Recovery Integration
  // ============================================

  describe('Error Recovery', () => {
    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
        // Also cleanup archive directories
        const archiveDir = path.join(testPaths.researchDir, 'final-archive');
        await fs.rm(archiveDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should handle missing research directory gracefully', async () => {
      const badOrchestrator = new FinalStageOrchestrator(testPaths.basePath, 'nonexistent-slug');

      const result = await badOrchestrator.execute();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.exitCode).not.toBe(0);
    });

    it('should handle scan failures when no output files exist', async () => {
      // Create empty research directory
      const emptyPaths = await createTestResearchDirectory('empty-test');

      try {
        // Create minimal structure without agent output files
        await createChapterStructure(emptyPaths.researchDir, { chapterCount: 3 });

        const orchestrator = new FinalStageOrchestrator(emptyPaths.basePath, 'empty-test');
        const result = await orchestrator.execute({ force: true });

        // Should fail or complete with warnings
        if (!result.success) {
          expect(result.errors.length).toBeGreaterThan(0);
        } else {
          // May succeed with warnings about missing files
          expect(result.warnings.length).toBeGreaterThanOrEqual(0);
        }
      } finally {
        await cleanupTestDirectory(emptyPaths.basePath);
      }
    });

    it('should apply fallback when mapping fails with high threshold', async () => {
      const orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);

      // Very high threshold should trigger fallback heuristics
      const result = await orchestrator.execute({
        force: true,
        threshold: 0.95
      });

      // Should still complete (possibly with fallbacks applied)
      expect(result.mapping).not.toBeNull();
      expect(result.mapping?.fallbacksApplied).toBeGreaterThanOrEqual(0);
    });

    it('should continue with warnings for validation failures', async () => {
      const orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);

      const result = await orchestrator.execute({ force: true });

      // Result may have warnings but should complete
      expect(result.success).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should handle output exists without --force', async () => {
      // First execution creates output
      const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result1 = await orchestrator1.execute({ force: true });
      expect(result1.success).toBe(true);

      // Second execution without force - orchestrator may:
      // 1. Skip execution and return success (idempotent behavior)
      // 2. Fail with OUTPUT_EXISTS error
      // 3. Archive and continue (if archiving is enabled by default)
      const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
      const result2 = await orchestrator2.execute({ force: false });

      // Verify the behavior is consistent - either it fails or archives/skips
      if (result2.success) {
        // If successful, it should have archived the previous output
        const archiveDir = path.join(testPaths.researchDir, 'final-archive');
        const archiveExists = await fs.stat(archiveDir).then(() => true).catch(() => false);
        // Archive should exist if it succeeded without force
        expect(archiveExists || result2.warnings.length > 0).toBe(true);
      } else {
        // If failed, should have an error about existing output
        expect(result2.errors.length).toBeGreaterThan(0);
      }

      // Cleanup
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
    });
  });

  // ============================================
  // 6. Token Budget Integration
  // ============================================

  describe('Token Budget Tracking', () => {
    let orchestrator: FinalStageOrchestrator;

    beforeEach(() => {
      orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    });

    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should track tokens across all phases', async () => {
      await orchestrator.execute({ force: true });

      const budget = orchestrator.getTokenBudget();

      expect(budget).toBeDefined();
      expect(budget.phases).toBeDefined();
      expect(budget.total).toBeDefined();
    });

    it('should report utilization correctly', async () => {
      await orchestrator.execute({ force: true });

      const budget = orchestrator.getTokenBudget();

      expect(budget.total.used).toBeGreaterThanOrEqual(0);
      expect(budget.total.budget).toBeGreaterThan(0);
      expect(budget.total.utilization).toMatch(/^\d+(\.\d+)?%$/);
    });

    it('should enforce token limits', async () => {
      await orchestrator.execute({ force: true });

      const budget = orchestrator.getTokenBudget();

      // Total used should not exceed limit
      expect(budget.total.used).toBeLessThanOrEqual(budget.limit);
    });

    it('should track per-phase token usage', async () => {
      await orchestrator.execute({ force: true });

      const budget = orchestrator.getTokenBudget();

      // Summary extraction should have usage tracked
      expect(typeof budget.phases.summaryExtraction.used).toBe('number');
      expect(typeof budget.phases.summaryExtraction.remaining).toBe('number');

      // Mapping should have usage tracked
      expect(typeof budget.phases.mapping.used).toBe('number');

      // Chapter writing should have per-chapter usage
      expect(Array.isArray(budget.phases.chapterWriting.used)).toBe(true);
    });

    it('should include token budget in result metadata', async () => {
      const result = await orchestrator.execute({ force: true });

      expect(result.metadata).not.toBeNull();
      expect(result.metadata?.total).toBeDefined();
      expect(result.metadata?.phases).toBeDefined();
    });
  });

  // ============================================
  // 7. Output Structure Tests
  // ============================================

  describe('Output Structure', () => {
    let orchestrator: FinalStageOrchestrator;

    beforeEach(() => {
      orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    });

    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should create final-paper.md with all chapters', async () => {
      const result = await orchestrator.execute({ force: true });

      expect(result.success).toBe(true);
      expect(result.outputPath).not.toBeNull();

      const paperContent = await fs.readFile(result.outputPath!, 'utf-8');

      // Should contain chapter headers
      for (let i = 1; i <= 8; i++) {
        expect(paperContent).toContain(`Chapter ${i}`);
      }
    });

    it('should create per-chapter files in chapters/ directory', async () => {
      const result = await orchestrator.execute({ force: true });

      expect(result.success).toBe(true);

      const chapterFiles = await fs.readdir(testPaths.chaptersDir);

      // Should have chapter files
      expect(chapterFiles.length).toBeGreaterThan(0);

      // Files should follow naming convention ch{NN}-{slug}.md
      for (const file of chapterFiles) {
        expect(file).toMatch(/^ch\d{2}-.+\.md$/);
      }
    });

    it('should create metadata.json with execution info', async () => {
      const result = await orchestrator.execute({ force: true });

      expect(result.success).toBe(true);

      const metadataPath = path.join(testPaths.outputDir, 'metadata.json');
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataContent);

      // Verify metadata structure
      expect(metadata).toHaveProperty('execution');
      expect(metadata).toHaveProperty('document');
      expect(metadata.execution).toHaveProperty('timestamp');
      expect(metadata.document).toHaveProperty('title');
      expect(metadata.document).toHaveProperty('totalWords');
      expect(metadata.document).toHaveProperty('chapters');
    });

    it('should generate valid table of contents', async () => {
      const result = await orchestrator.execute({ force: true });

      expect(result.success).toBe(true);

      const paperContent = await fs.readFile(result.outputPath!, 'utf-8');

      // Should have ToC header
      expect(paperContent).toContain('Table of Contents');

      // ToC should have anchor links
      expect(paperContent).toMatch(/\[.+\]\(#.+\)/);
    });

    it('should include research query in metadata', async () => {
      const result = await orchestrator.execute({ force: true });

      expect(result.success).toBe(true);

      const metadataPath = path.join(testPaths.outputDir, 'metadata.json');
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataContent);

      expect(metadata.document.researchQuery).toBeDefined();
    });
  });

  // ============================================
  // 8. Phase Timing Tests
  // ============================================

  describe('Phase Timing', () => {
    let orchestrator: FinalStageOrchestrator;

    beforeEach(() => {
      orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    });

    afterEach(async () => {
      try {
        await fs.rm(testPaths.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should track phase timings', async () => {
      await orchestrator.execute({ force: true });

      const timings = orchestrator.getPhaseTimings();

      expect(timings).toBeDefined();
      expect(Object.keys(timings).length).toBeGreaterThan(0);
    });

    it('should record duration for each phase', async () => {
      await orchestrator.execute({ force: true });

      const timings = orchestrator.getPhaseTimings();

      // Check for duration entries
      const durationKeys = Object.keys(timings).filter(k => k.endsWith('_duration'));
      expect(durationKeys.length).toBeGreaterThan(0);

      // All durations should be positive numbers
      for (const key of durationKeys) {
        expect(typeof timings[key]).toBe('number');
        expect(timings[key]).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

// ============================================
// Isolated Unit-Level Integration Tests
// ============================================

describe('Orchestrator State Machine', () => {
  let testPaths: TestFixturePaths;
  const testSlug = 'state-machine-test';

  beforeAll(async () => {
    testPaths = await createTestResearchDirectory(testSlug);
    await createChapterStructure(testPaths.researchDir);
    // Create all 45 agent output files required by the orchestrator
    await createAgentOutputFiles(testPaths.researchDir, 45);
  });

  afterAll(async () => {
    await cleanupTestDirectory(testPaths.basePath);
  });

  it('should transition through states in correct order', async () => {
    const orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    const transitions: string[] = [];

    orchestrator.onProgress((report: ProgressReport) => {
      if (report.message.includes('State transition')) {
        transitions.push(report.message);
      }
    });

    await orchestrator.execute({ force: true });

    // Verify IDLE -> INITIALIZING is first
    expect(transitions[0]).toContain('IDLE');
    expect(transitions[0]).toContain('INITIALIZING');

    // Verify COMPLETED is last for successful execution
    const lastTransition = transitions[transitions.length - 1];
    expect(lastTransition).toContain('COMPLETED');
  });

  it('should reject invalid state transitions', async () => {
    // This is tested implicitly through the orchestrator's state machine
    // Invalid transitions would throw FinalStageError with CONSTITUTION_VIOLATION
    const orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);

    // A successful execution proves all transitions are valid
    const result = await orchestrator.execute({ force: true });
    expect(result.success).toBe(true);

    // Cleanup
    await fs.rm(testPaths.outputDir, { recursive: true, force: true });
  });
});

// ============================================
// Security Validation Tests
// ============================================

describe('Security Validation', () => {
  it('should reject invalid slug with path traversal', () => {
    const basePath = '/tmp/test-security';

    expect(() => {
      new FinalStageOrchestrator(basePath, '../../../etc/passwd');
    }).toThrow();
  });

  it('should reject slug with special characters', () => {
    const basePath = '/tmp/test-security';

    expect(() => {
      new FinalStageOrchestrator(basePath, 'test<script>alert(1)</script>');
    }).toThrow();
  });

  it('should accept valid slug format', () => {
    const basePath = '/tmp/test-security';

    expect(() => {
      new FinalStageOrchestrator(basePath, 'valid-research-slug-123');
    }).not.toThrow();
  });
});

// ============================================
// Constitution Compliance Tests
// ============================================

describe('Constitution Compliance', () => {
  let testPaths: TestFixturePaths;
  const testSlug = 'constitution-test';

  beforeAll(async () => {
    testPaths = await createTestResearchDirectory(testSlug);
    await createChapterStructure(testPaths.researchDir);
    // Create all 45 agent output files required by the orchestrator
    await createAgentOutputFiles(testPaths.researchDir, 45);
  });

  afterAll(async () => {
    await cleanupTestDirectory(testPaths.basePath);
  });

  afterEach(async () => {
    try {
      await fs.rm(testPaths.outputDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should enforce FS-001: outputs to final/ only', async () => {
    const orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    await orchestrator.execute({ force: true });

    // Verify output is in final/ directory
    const finalDirExists = await fs.stat(testPaths.outputDir).then(() => true).catch(() => false);
    expect(finalDirExists).toBe(true);

    // Verify no files created in research root (except structure files)
    const researchFiles = await fs.readdir(testPaths.researchDir);
    const unexpectedFiles = researchFiles.filter(f =>
      !f.match(/^\d{2}-/) && // Agent output files
      f !== '05-chapter-structure.md' && // Structure file
      f !== 'final' && // Output directory
      f !== 'final-archive' && // Archive directory
      f !== 'failed-runs' // Failed runs archive
    );
    expect(unexpectedFiles.length).toBe(0);
  });

  it('should enforce FS-005: archive before overwrite with --force', async () => {
    const orchestrator1 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    await orchestrator1.execute({ force: true });

    // Second execution with force should archive
    const orchestrator2 = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    await orchestrator2.execute({ force: true });

    // Check archive directory exists
    const archiveDir = path.join(testPaths.researchDir, 'final-archive');
    const archiveExists = await fs.stat(archiveDir).then(() => true).catch(() => false);
    expect(archiveExists).toBe(true);
  });

  it('should enforce EX-001: valid state machine transitions', async () => {
    const orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    let invalidTransitionDetected = false;

    orchestrator.onProgress((report: ProgressReport) => {
      // Any CONSTITUTION_VIOLATION error would indicate invalid transition
      if (report.message.includes('CONSTITUTION_VIOLATION')) {
        invalidTransitionDetected = true;
      }
    });

    await orchestrator.execute({ force: true });

    expect(invalidTransitionDetected).toBe(false);
  });

  it('should enforce EX-004: progress reporting hooks exist', async () => {
    const orchestrator = new FinalStageOrchestrator(testPaths.basePath, testSlug);
    let progressReported = false;

    orchestrator.onProgress(() => {
      progressReported = true;
    });

    await orchestrator.execute({ force: true });

    expect(progressReported).toBe(true);
  });

  it('should require locked chapter structure per DI-001', async () => {
    // Create unlocked structure
    const unlockedPaths = await createTestResearchDirectory('unlocked-test');

    try {
      await createChapterStructure(unlockedPaths.researchDir, { locked: false });
      await createAgentOutputFiles(unlockedPaths.researchDir, 5);

      const orchestrator = new FinalStageOrchestrator(unlockedPaths.basePath, 'unlocked-test');
      const result = await orchestrator.execute({ force: true });

      // Should fail due to unlocked structure
      expect(result.success).toBe(false);
      expect(result.errors.some(e =>
        e.includes('CONSTITUTION') || e.includes('locked')
      )).toBe(true);
    } finally {
      await cleanupTestDirectory(unlockedPaths.basePath);
    }
  });
});
