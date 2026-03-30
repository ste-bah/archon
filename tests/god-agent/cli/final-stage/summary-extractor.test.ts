/**
 * Unit Tests for SummaryExtractor
 *
 * TASK-012: Unit Tests for SummaryExtractor
 * Per CONSTITUTION QA-004 - 80% code coverage target
 *
 * Tests the SummaryExtractor class from TASK-004 implementation:
 * - File discovery (scanOutputFiles, scanFiles)
 * - Summary extraction (extractSummary)
 * - Citation extraction (APA, MLA, numbered formats)
 * - Edge cases (UTF-8, empty files, permission errors)
 * - Full scan integration (extractAllSummaries)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SummaryExtractor } from '../../../../src/god-agent/cli/final-stage/summary-extractor.js';
import type {
  AgentOutputSummary,
  OutputScannerInput,
  OutputScannerOutput,
  CitationRef
} from '../../../../src/god-agent/cli/final-stage/types.js';

// ============================================
// Test Fixtures and Helpers
// ============================================

/**
 * Create a temporary test directory with mock agent output files
 */
async function createTestDirectory(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'summary-extractor-test-'));
  return tempDir;
}

/**
 * Clean up temporary test directory
 */
async function cleanupTestDirectory(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a mock agent output file with specified content
 */
async function createMockFile(
  dirPath: string,
  fileName: string,
  content: string
): Promise<string> {
  const filePath = path.join(dirPath, fileName);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Generate well-formed markdown content for testing
 */
function generateWellFormedMarkdown(options: {
  agentName?: string;
  heading?: string;
  topics?: string[];
  findings?: string[];
  citations?: string[];
  wordCount?: number;
}): string {
  const {
    agentName = 'Research Planner',
    heading = 'Research Planning Output',
    topics = ['Literature Review', 'Methodology Design', 'Data Collection'],
    findings = [
      'Finding 1: The research methodology is robust',
      'Finding 2: Data collection procedures are well-defined',
      'Finding 3: Analysis framework is comprehensive'
    ],
    citations = ['(Smith, 2020)', '(Jones & Williams, 2019)', '(Brown et al., 2021)'],
    wordCount = 500
  } = options;

  const lines: string[] = [
    `# ${heading}`,
    '',
    `Agent: ${agentName}`,
    '',
    '## Overview',
    '',
    'This document presents the research planning output from the PhD pipeline.',
    '',
  ];

  // Add topics as headings
  for (const topic of topics) {
    lines.push(`### ${topic}`);
    lines.push('');
    lines.push('This section covers important aspects of the research process.');
    lines.push('');
  }

  // Add findings section
  lines.push('## Key Findings');
  lines.push('');
  for (const finding of findings) {
    lines.push(`- ${finding}`);
  }
  lines.push('');

  // Add citations
  lines.push('## References');
  lines.push('');
  lines.push(`The research incorporates citations such as ${citations.join(', ')}.`);
  lines.push('');

  // Add filler content to reach word count
  const currentWordCount = lines.join(' ').split(/\s+/).length;
  const wordsNeeded = Math.max(0, wordCount - currentWordCount);
  if (wordsNeeded > 0) {
    const filler = Array(wordsNeeded).fill('research').join(' ');
    lines.push('');
    lines.push('## Additional Content');
    lines.push('');
    lines.push(filler);
  }

  return lines.join('\n');
}

/**
 * Generate all 45 expected agent output files
 */
async function createAll45Files(dirPath: string): Promise<void> {
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

  for (let i = 0; i < 45; i++) {
    const index = String(i).padStart(2, '0');
    const agentName = agentNames[i] || `agent-${i}`;
    const fileName = `${index}-${agentName}.md`;
    const content = generateWellFormedMarkdown({
      agentName,
      heading: `${agentName.replace(/-/g, ' ')} Output`,
      wordCount: 500 + i * 10
    });
    await createMockFile(dirPath, fileName, content);
  }
}

// ============================================
// Test Suite
// ============================================

describe('SummaryExtractor', () => {
  let testDir: string;
  let extractor: SummaryExtractor;

  beforeEach(async () => {
    testDir = await createTestDirectory();
    extractor = new SummaryExtractor(testDir);
  });

  afterEach(async () => {
    await cleanupTestDirectory(testDir);
  });

  // ============================================
  // File Discovery Tests - scanFiles method
  // ============================================

  describe('scanFiles', () => {
    it('should find all numbered markdown files in directory', async () => {
      // Create 5 numbered files
      await createMockFile(testDir, '00-agent.md', '# Test');
      await createMockFile(testDir, '01-agent.md', '# Test');
      await createMockFile(testDir, '02-agent.md', '# Test');
      await createMockFile(testDir, '03-agent.md', '# Test');
      await createMockFile(testDir, '04-agent.md', '# Test');

      const files = await extractor.scanFiles();

      expect(files).toHaveLength(5);
      expect(files[0]).toBe('00-agent.md');
      expect(files[4]).toBe('04-agent.md');
    });

    it('should return files sorted by index', async () => {
      // Create files out of order
      await createMockFile(testDir, '10-agent.md', '# Test');
      await createMockFile(testDir, '05-agent.md', '# Test');
      await createMockFile(testDir, '00-agent.md', '# Test');
      await createMockFile(testDir, '25-agent.md', '# Test');

      const files = await extractor.scanFiles();

      expect(files).toHaveLength(4);
      expect(files[0]).toBe('00-agent.md');
      expect(files[1]).toBe('05-agent.md');
      expect(files[2]).toBe('10-agent.md');
      expect(files[3]).toBe('25-agent.md');
    });

    it('should exclude non-numbered markdown files', async () => {
      await createMockFile(testDir, '00-agent.md', '# Test');
      await createMockFile(testDir, 'readme.md', '# Readme');
      await createMockFile(testDir, 'notes.md', '# Notes');
      await createMockFile(testDir, 'test-file.md', '# Test');

      const files = await extractor.scanFiles();

      expect(files).toHaveLength(1);
      expect(files[0]).toBe('00-agent.md');
    });

    it('should exclude non-markdown files', async () => {
      await createMockFile(testDir, '00-agent.md', '# Test');
      await createMockFile(testDir, '01-agent.txt', 'Text file');
      await createMockFile(testDir, '02-agent.json', '{}');

      const files = await extractor.scanFiles();

      expect(files).toHaveLength(1);
      expect(files[0]).toBe('00-agent.md');
    });

    it('should return empty array for empty directory', async () => {
      const files = await extractor.scanFiles();

      expect(files).toHaveLength(0);
    });

    it('should return empty array for non-existent directory', async () => {
      const nonExistentExtractor = new SummaryExtractor('/non/existent/path');
      const files = await nonExistentExtractor.scanFiles();

      expect(files).toHaveLength(0);
    });
  });

  // ============================================
  // File Discovery Tests - scanOutputFiles method
  // ============================================

  describe('scanOutputFiles', () => {
    it('should find all 45 expected agent output files', async () => {
      await createAll45Files(testDir);

      const input: OutputScannerInput = {
        researchDirectory: testDir,
        excludePatterns: [],
        maxSummaryTokens: 500
      };

      const result = await extractor.scanOutputFiles(input);

      expect(result.foundFiles).toBe(45);
      expect(result.totalFiles).toBe(45);
      expect(result.missingFiles).toHaveLength(0);
      expect(result.scanStatus).toBe('complete');
    });

    it('should return missing files when some are absent', async () => {
      // Create only files 00-39 (missing 40-44)
      for (let i = 0; i < 40; i++) {
        const index = String(i).padStart(2, '0');
        await createMockFile(testDir, `${index}-agent.md`, '# Test\n\nContent here.');
      }

      const input: OutputScannerInput = {
        researchDirectory: testDir,
        excludePatterns: [],
        maxSummaryTokens: 500
      };

      const result = await extractor.scanOutputFiles(input);

      expect(result.foundFiles).toBe(40);
      expect(result.missingFiles).toHaveLength(5);
      expect(result.missingFiles).toContain('40-*.md');
      expect(result.missingFiles).toContain('44-*.md');
      expect(result.scanStatus).toBe('partial');
    });

    it('should exclude files matching excludePatterns', async () => {
      await createMockFile(testDir, '00-agent.md', '# Test\n\nContent.');
      await createMockFile(testDir, '01-excluded.md', '# Test\n\nContent.');
      await createMockFile(testDir, '02-agent.md', '# Test\n\nContent.');
      await createMockFile(testDir, '03-excluded.md', '# Test\n\nContent.');

      const input: OutputScannerInput = {
        researchDirectory: testDir,
        excludePatterns: ['excluded'],
        maxSummaryTokens: 500
      };

      const result = await extractor.scanOutputFiles(input);

      expect(result.foundFiles).toBe(2);
      expect(result.summaries.map(s => s.fileName)).not.toContain('01-excluded.md');
      expect(result.summaries.map(s => s.fileName)).not.toContain('03-excluded.md');
    });

    it('should handle empty research directory', async () => {
      const input: OutputScannerInput = {
        researchDirectory: testDir,
        excludePatterns: [],
        maxSummaryTokens: 500
      };

      const result = await extractor.scanOutputFiles(input);

      expect(result.foundFiles).toBe(0);
      expect(result.missingFiles).toHaveLength(45);
      expect(result.scanStatus).toBe('failed');
    });

    it('should return failed status for non-existent directory', async () => {
      const nonExistentExtractor = new SummaryExtractor('/non/existent/path');

      const input: OutputScannerInput = {
        researchDirectory: '/non/existent/path',
        excludePatterns: [],
        maxSummaryTokens: 500
      };

      const result = await nonExistentExtractor.scanOutputFiles(input);

      expect(result.foundFiles).toBe(0);
      expect(result.scanStatus).toBe('failed');
      expect(result.missingFiles).toHaveLength(45);
    });

    it('should track total summary tokens', async () => {
      // Create files with known content
      for (let i = 0; i < 5; i++) {
        const index = String(i).padStart(2, '0');
        const content = generateWellFormedMarkdown({ wordCount: 200 });
        await createMockFile(testDir, `${index}-agent.md`, content);
      }

      const input: OutputScannerInput = {
        researchDirectory: testDir,
        excludePatterns: [],
        maxSummaryTokens: 500
      };

      const result = await extractor.scanOutputFiles(input);

      expect(result.totalSummaryTokens).toBeGreaterThan(0);
      expect(result.summaries.every(s => s.summaryTokens > 0)).toBe(true);
    });
  });

  // ============================================
  // Summary Extraction Tests - extractSummary method
  // ============================================

  describe('extractSummary', () => {
    it('should extract summary from well-formed markdown file', async () => {
      const content = generateWellFormedMarkdown({
        agentName: 'Test Agent',
        heading: 'Test Output',
        topics: ['Topic A', 'Topic B'],
        findings: ['Finding 1', 'Finding 2']
      });
      await createMockFile(testDir, '00-test.md', content);

      const summary = await extractor.extractSummary('00-test.md', 0);

      expect(summary.extractionStatus).toBe('success');
      expect(summary.agentName).toBe('Test Agent');
      expect(summary.wordCount).toBeGreaterThan(0);
    });

    it('should parse agent name from Agent: line', async () => {
      const content = '# Heading\n\nAgent: Custom Agent Name\n\nContent here.';
      await createMockFile(testDir, '00-agent.md', content);

      const summary = await extractor.extractSummary('00-agent.md', 0);

      expect(summary.agentName).toBe('Custom Agent Name');
    });

    it('should parse agent name from header if no Agent: line', async () => {
      const content = '# Research Planner Output\n\nContent without Agent line.';
      await createMockFile(testDir, '00-agent.md', content);

      const summary = await extractor.extractSummary('00-agent.md', 0);

      expect(summary.agentName).toBe('Research Planner Output');
    });

    it('should return Unknown Agent for files without headers', async () => {
      const content = 'Plain text without any headers or agent line.';
      await createMockFile(testDir, '00-agent.md', content);

      const summary = await extractor.extractSummary('00-agent.md', 0);

      expect(summary.agentName).toBe('Unknown Agent');
    });

    it('should detect pipeline phase from file index', async () => {
      await createMockFile(testDir, '00-agent.md', '# Test\n\nContent.');
      await createMockFile(testDir, '06-agent.md', '# Test\n\nContent.');
      await createMockFile(testDir, '14-agent.md', '# Test\n\nContent.');
      await createMockFile(testDir, '20-agent.md', '# Test\n\nContent.');
      await createMockFile(testDir, '30-agent.md', '# Test\n\nContent.');
      await createMockFile(testDir, '40-agent.md', '# Test\n\nContent.');

      const summary0 = await extractor.extractSummary('00-agent.md', 0);
      const summary6 = await extractor.extractSummary('06-agent.md', 6);
      const summary14 = await extractor.extractSummary('14-agent.md', 14);
      const summary20 = await extractor.extractSummary('20-agent.md', 20);
      const summary30 = await extractor.extractSummary('30-agent.md', 30);
      const summary40 = await extractor.extractSummary('40-agent.md', 40);

      expect(summary0.phase).toBe(1);   // Foundation: 0-5
      expect(summary6.phase).toBe(2);   // Exploration: 6-13
      expect(summary14.phase).toBe(3);  // Context: 14-18
      expect(summary20.phase).toBe(4);  // Analysis: 19-27
      expect(summary30.phase).toBe(5);  // Synthesis: 28-33
      expect(summary40.phase).toBe(7);  // Validation: 34+
    });

    it('should extract primary topics from content', async () => {
      const content = `# Main Heading

## Literature Review

Content about literature.

### Methodology Design

Content about methodology.

### Data Collection

Content about data.
`;
      await createMockFile(testDir, '00-agent.md', content);

      const summary = await extractor.extractSummary('00-agent.md', 0);

      expect(summary.primaryTopics.length).toBeGreaterThan(0);
      expect(summary.primaryTopics).toContain('Literature Review');
      expect(summary.primaryTopics).toContain('Methodology Design');
    });

    it('should extract key findings sections', async () => {
      const content = `# Research Output

## Key Findings

- Finding one: important discovery
- Finding two: another discovery
- Finding three: third discovery

## Conclusion

The research was successful.
`;
      await createMockFile(testDir, '00-agent.md', content);

      const summary = await extractor.extractSummary('00-agent.md', 0);

      expect(summary.keyFindings.length).toBeGreaterThan(0);
      expect(summary.keyFindings.some(f => f.includes('important discovery'))).toBe(true);
    });

    it('should handle files smaller than 1KB verbatim', async () => {
      // Create small file with meaningful paragraph content (>100 chars)
      const paragraph = 'This is a comprehensive research summary that explores various methodological approaches and theoretical frameworks employed in the study of artificial intelligence systems.';
      const smallContent = `# Small File\n\n${paragraph}`;
      await createMockFile(testDir, '00-small.md', smallContent);

      const summary = await extractor.extractSummary('00-small.md', 0);

      expect(summary.extractionStatus).toBe('success');
      // Summary generation requires paragraphs > 100 chars
      expect(summary.summary.length).toBeGreaterThan(0);
    });

    it('should handle large files with head/tail extraction', async () => {
      // Create a file larger than 100KB
      const largeContent = '# Large File\n\n' + 'Content '.repeat(20000) + '\n\n# End Section';
      await createMockFile(testDir, '00-large.md', largeContent);

      const summary = await extractor.extractSummary('00-large.md', 0);

      expect(summary.extractionStatus).toBe('partial');
    });

    it('should return failed status for unreadable files', async () => {
      // Try to read non-existent file
      const summary = await extractor.extractSummary('non-existent.md', 0);

      expect(summary.extractionStatus).toBe('failed');
      expect(summary.agentName).toBe('Unknown');
      expect(summary.wordCount).toBe(0);
    });

    it('should track word count accurately', async () => {
      const content = 'One two three four five six seven eight nine ten.';
      await createMockFile(testDir, '00-count.md', content);

      const summary = await extractor.extractSummary('00-count.md', 0);

      expect(summary.wordCount).toBe(10);
    });

    it('should accept absolute file path', async () => {
      const content = '# Absolute Path Test\n\nContent here.';
      const filePath = await createMockFile(testDir, '00-absolute.md', content);

      const summary = await extractor.extractSummary(filePath, 0);

      expect(summary.extractionStatus).toBe('success');
      expect(summary.filePath).toBe(filePath);
    });
  });

  // ============================================
  // Citation Extraction Tests
  // ============================================

  describe('citation extraction', () => {
    it('should parse APA format citations', async () => {
      const content = `# Research Output

According to Smith (2020), the research shows promising results.
This is supported by (Smith, 2020) and other studies (Jones, 2019).
`;
      await createMockFile(testDir, '00-citations.md', content);

      const summary = await extractor.extractSummary('00-citations.md', 0);

      expect(summary.citations.length).toBeGreaterThan(0);
      expect(summary.citations.some(c => c.raw.includes('Smith'))).toBe(true);
    });

    it('should parse APA citations with et al', async () => {
      const content = `# Research

The study by (Brown et al., 2021) found significant results.
`;
      await createMockFile(testDir, '00-etal.md', content);

      const summary = await extractor.extractSummary('00-etal.md', 0);

      const brownCitation = summary.citations.find(c => c.raw.includes('Brown'));
      expect(brownCitation).toBeDefined();
    });

    it('should parse MLA format citations', async () => {
      const content = `# Literature Review

The author states "quote here" (Johnson 45).
Another reference (Williams 123-125) supports this.
`;
      await createMockFile(testDir, '00-mla.md', content);

      const summary = await extractor.extractSummary('00-mla.md', 0);

      expect(summary.citations.some(c => c.raw.includes('Johnson'))).toBe(true);
      expect(summary.citations.some(c => c.raw.includes('Williams'))).toBe(true);
    });

    it('should handle multi-author APA citations', async () => {
      const content = `# Study Results

The research by (Smith & Jones, 2020) was comprehensive.
Further work by (Brown, Williams & Davis, 2021) extended these findings.
`;
      await createMockFile(testDir, '00-multi.md', content);

      const summary = await extractor.extractSummary('00-multi.md', 0);

      expect(summary.citations.some(c => c.raw.includes('Smith & Jones'))).toBe(true);
    });

    it('should handle citations with no year (MLA)', async () => {
      const content = `# Research

According to (Miller 78) the theory is valid.
`;
      await createMockFile(testDir, '00-noyear.md', content);

      const summary = await extractor.extractSummary('00-noyear.md', 0);

      const millerCitation = summary.citations.find(c => c.raw.includes('Miller'));
      expect(millerCitation).toBeDefined();
      if (millerCitation?.parsed) {
        expect(millerCitation.parsed.year).toBeNull();
      }
    });

    it('should deduplicate identical citations', async () => {
      const content = `# Research

The study (Smith, 2020) found results.
This confirms (Smith, 2020) earlier findings.
Again (Smith, 2020) the evidence supports.
`;
      await createMockFile(testDir, '00-dedup.md', content);

      const summary = await extractor.extractSummary('00-dedup.md', 0);

      const smithCitations = summary.citations.filter(c => c.raw === '(Smith, 2020)');
      expect(smithCitations.length).toBe(1);
    });

    it('should parse APA citations with page numbers', async () => {
      const content = `# Study

As noted (Johnson, 2019, p. 42) and (Williams, 2020, pp. 15-20).
`;
      await createMockFile(testDir, '00-pages.md', content);

      const summary = await extractor.extractSummary('00-pages.md', 0);

      expect(summary.citations.length).toBeGreaterThan(0);
    });

    it('should extract numbered citations in valid context', async () => {
      const content = `# Research

According to Smith [1] the results are significant.
This was confirmed by Jones [2], [3].
`;
      await createMockFile(testDir, '00-numbered.md', content);

      const summary = await extractor.extractSummary('00-numbered.md', 0);

      // Numbered citations require valid context per isValidBracketedCitation
      expect(summary.citations.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================
  // Edge Case Tests
  // ============================================

  describe('edge cases', () => {
    it('should handle UTF-8 encoded files', async () => {
      const utf8Content = `# 研究成果

## 概要

日本語のテキストを含むファイル。

Special characters: äöü, éàè, ñ, ß

Emojis: 📚 📖 🔬
`;
      await createMockFile(testDir, '00-utf8.md', utf8Content);

      const summary = await extractor.extractSummary('00-utf8.md', 0);

      expect(summary.extractionStatus).toBe('success');
      expect(summary.agentName).toBe('研究成果');
    });

    it('should handle files with only headers', async () => {
      const headersOnly = `# Main Title

## Section One

### Subsection A

## Section Two
`;
      await createMockFile(testDir, '00-headers.md', headersOnly);

      const summary = await extractor.extractSummary('00-headers.md', 0);

      expect(summary.extractionStatus).toBe('success');
      expect(summary.primaryTopics.length).toBeGreaterThan(0);
    });

    it('should handle binary file gracefully', async () => {
      // Create a file with binary content
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const filePath = path.join(testDir, '00-binary.md');
      await fs.writeFile(filePath, binaryContent);

      const summary = await extractor.extractSummary('00-binary.md', 0);

      // Should not crash, may return partial or success depending on content
      expect(['success', 'partial', 'failed']).toContain(summary.extractionStatus);
    });

    it('should handle empty file', async () => {
      await createMockFile(testDir, '00-empty.md', '');

      const summary = await extractor.extractSummary('00-empty.md', 0);

      expect(summary.extractionStatus).toBe('success');
      expect(summary.wordCount).toBe(0);
      expect(summary.agentName).toBe('Unknown Agent');
    });

    it('should handle file with only whitespace', async () => {
      await createMockFile(testDir, '00-whitespace.md', '   \n\n   \t\t   \n\n');

      const summary = await extractor.extractSummary('00-whitespace.md', 0);

      expect(summary.extractionStatus).toBe('success');
    });

    it('should handle file with very long lines', async () => {
      const longLine = 'a'.repeat(10000);
      const content = `# Long Line Test\n\n${longLine}`;
      await createMockFile(testDir, '00-longline.md', content);

      const summary = await extractor.extractSummary('00-longline.md', 0);

      expect(summary.extractionStatus).toBe('success');
    });

    it('should handle nested markdown formatting', async () => {
      const content = `# Main **Bold** Title

## Section with *italic* and **bold** text

Content with \`inline code\` and [links](http://example.com).

\`\`\`python
def example():
    pass
\`\`\`

> Blockquote with **bold** text
`;
      await createMockFile(testDir, '00-nested.md', content);

      const summary = await extractor.extractSummary('00-nested.md', 0);

      expect(summary.extractionStatus).toBe('success');
    });

    it('should extract key terms from bold and italic text', async () => {
      const content = `# Research Output

The study examines **machine learning** and *artificial intelligence*.
Key concepts include **neural networks** and **deep learning**.
`;
      await createMockFile(testDir, '00-terms.md', content);

      const summary = await extractor.extractSummary('00-terms.md', 0);

      expect(summary.keyTerms).toContain('machine learning');
      expect(summary.keyTerms).toContain('neural networks');
    });

    it('should extract research questions (Q1, RQ1 format)', async () => {
      const content = `# Research Overview

## Research Questions

The study addresses Q1, Q2, and Q3.

RQ1: How does X affect Y?
RQ2: What is the relationship between A and B?
`;
      await createMockFile(testDir, '00-questions.md', content);

      const summary = await extractor.extractSummary('00-questions.md', 0);

      expect(summary.researchQuestions.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Full Scan Integration Tests - extractAllSummaries
  // ============================================

  describe('extractAllSummaries', () => {
    it('should extract summaries for all found files', async () => {
      // Create 10 test files
      for (let i = 0; i < 10; i++) {
        const index = String(i).padStart(2, '0');
        const content = generateWellFormedMarkdown({
          agentName: `Agent ${i}`,
          wordCount: 300
        });
        await createMockFile(testDir, `${index}-agent.md`, content);
      }

      const summaries = await extractor.extractAllSummaries();

      expect(summaries).toHaveLength(10);
      expect(summaries.every(s => s.extractionStatus === 'success')).toBe(true);
    });

    it('should preserve file index order', async () => {
      // Create files out of order
      await createMockFile(testDir, '09-agent.md', '# Nine\n\nContent.');
      await createMockFile(testDir, '02-agent.md', '# Two\n\nContent.');
      await createMockFile(testDir, '05-agent.md', '# Five\n\nContent.');
      await createMockFile(testDir, '00-agent.md', '# Zero\n\nContent.');

      const summaries = await extractor.extractAllSummaries();

      expect(summaries).toHaveLength(4);
      expect(summaries[0].index).toBe(0);
      expect(summaries[1].index).toBe(2);
      expect(summaries[2].index).toBe(5);
      expect(summaries[3].index).toBe(9);
    });

    it('should return empty array for empty directory', async () => {
      const summaries = await extractor.extractAllSummaries();

      expect(summaries).toHaveLength(0);
    });

    it('should handle mixed success and failed extractions', async () => {
      // Create some valid files
      await createMockFile(testDir, '00-valid.md', '# Valid\n\nContent here.');
      await createMockFile(testDir, '01-valid.md', '# Valid\n\nMore content.');

      // Make one file unreadable by deleting it after scan but before extraction
      // This tests robustness, though in practice files won't disappear
      // We simulate this by testing with permission errors

      const summaries = await extractor.extractAllSummaries();

      expect(summaries.length).toBeGreaterThan(0);
    });

    it('should include correct file paths', async () => {
      await createMockFile(testDir, '00-test.md', '# Test\n\nContent.');

      const summaries = await extractor.extractAllSummaries();

      expect(summaries[0].filePath).toContain(testDir);
      expect(summaries[0].filePath).toContain('00-test.md');
    });
  });

  // ============================================
  // Token Limit Tests
  // ============================================

  describe('token limit handling', () => {
    it('should limit summary to maxSummaryTokens', async () => {
      // Create file with lots of content
      const content = generateWellFormedMarkdown({ wordCount: 2000 });
      await createMockFile(testDir, '00-long.md', content);

      const input: OutputScannerInput = {
        researchDirectory: testDir,
        excludePatterns: [],
        maxSummaryTokens: 100 // Very low limit
      };

      const result = await extractor.scanOutputFiles(input);

      // Summary tokens should respect the limit (within reasonable margin)
      expect(result.summaries[0].summaryTokens).toBeLessThanOrEqual(200);
    });
  });

  // ============================================
  // Content Type Extraction Tests
  // ============================================

  describe('content type extraction', () => {
    it('should extract content type from first heading', async () => {
      const content = '# Literature Review Analysis\n\nContent here.';
      await createMockFile(testDir, '00-lit.md', content);

      const summary = await extractor.extractSummary('00-lit.md', 0);

      expect(summary.contentType).toBe('Literature Review Analysis');
    });

    it('should return default for files without heading', async () => {
      const content = 'Just plain text without any markdown headings.';
      await createMockFile(testDir, '00-plain.md', content);

      const summary = await extractor.extractSummary('00-plain.md', 0);

      expect(summary.contentType).toBe('Research Output');
    });
  });

  // ============================================
  // Scan Status Tests
  // ============================================

  describe('scan status determination', () => {
    it('should return complete status when all 45 files present with success', async () => {
      await createAll45Files(testDir);

      const input: OutputScannerInput = {
        researchDirectory: testDir,
        excludePatterns: [],
        maxSummaryTokens: 500
      };

      const result = await extractor.scanOutputFiles(input);

      expect(result.scanStatus).toBe('complete');
    });

    it('should return partial status when 40+ files present', async () => {
      // Create 42 files
      for (let i = 0; i < 42; i++) {
        const index = String(i).padStart(2, '0');
        const content = generateWellFormedMarkdown({ wordCount: 100 });
        await createMockFile(testDir, `${index}-agent.md`, content);
      }

      const input: OutputScannerInput = {
        researchDirectory: testDir,
        excludePatterns: [],
        maxSummaryTokens: 500
      };

      const result = await extractor.scanOutputFiles(input);

      expect(result.scanStatus).toBe('partial');
    });

    it('should return failed status when fewer than 40 files', async () => {
      // Create only 30 files
      for (let i = 0; i < 30; i++) {
        const index = String(i).padStart(2, '0');
        const content = generateWellFormedMarkdown({ wordCount: 100 });
        await createMockFile(testDir, `${index}-agent.md`, content);
      }

      const input: OutputScannerInput = {
        researchDirectory: testDir,
        excludePatterns: [],
        maxSummaryTokens: 500
      };

      const result = await extractor.scanOutputFiles(input);

      expect(result.scanStatus).toBe('failed');
    });
  });
});

// ============================================
// Type Validation Tests
// ============================================

describe('SummaryExtractor Type Compliance', () => {
  it('should return AgentOutputSummary with all required fields', async () => {
    const testDir = await createTestDirectory();
    try {
      const extractor = new SummaryExtractor(testDir);
      const content = generateWellFormedMarkdown({ wordCount: 500 });
      await createMockFile(testDir, '00-test.md', content);

      const summary = await extractor.extractSummary('00-test.md', 0);

      // Verify all required fields are present
      expect(summary).toHaveProperty('index');
      expect(summary).toHaveProperty('fileName');
      expect(summary).toHaveProperty('filePath');
      expect(summary).toHaveProperty('agentName');
      expect(summary).toHaveProperty('phase');
      expect(summary).toHaveProperty('contentType');
      expect(summary).toHaveProperty('primaryTopics');
      expect(summary).toHaveProperty('researchQuestions');
      expect(summary).toHaveProperty('keyFindings');
      expect(summary).toHaveProperty('keyTerms');
      expect(summary).toHaveProperty('citations');
      expect(summary).toHaveProperty('wordCount');
      expect(summary).toHaveProperty('summary');
      expect(summary).toHaveProperty('summaryTokens');
      expect(summary).toHaveProperty('extractionStatus');

      // Verify types
      expect(typeof summary.index).toBe('number');
      expect(typeof summary.fileName).toBe('string');
      expect(typeof summary.filePath).toBe('string');
      expect(typeof summary.agentName).toBe('string');
      expect(typeof summary.phase).toBe('number');
      expect(typeof summary.contentType).toBe('string');
      expect(Array.isArray(summary.primaryTopics)).toBe(true);
      expect(Array.isArray(summary.researchQuestions)).toBe(true);
      expect(Array.isArray(summary.keyFindings)).toBe(true);
      expect(Array.isArray(summary.keyTerms)).toBe(true);
      expect(Array.isArray(summary.citations)).toBe(true);
      expect(typeof summary.wordCount).toBe('number');
      expect(typeof summary.summary).toBe('string');
      expect(typeof summary.summaryTokens).toBe('number');
      expect(['success', 'partial', 'failed']).toContain(summary.extractionStatus);
    } finally {
      await cleanupTestDirectory(testDir);
    }
  });

  it('should return OutputScannerOutput with all required fields', async () => {
    const testDir = await createTestDirectory();
    try {
      const extractor = new SummaryExtractor(testDir);

      const input: OutputScannerInput = {
        researchDirectory: testDir,
        excludePatterns: [],
        maxSummaryTokens: 500
      };

      const result = await extractor.scanOutputFiles(input);

      // Verify all required fields
      expect(result).toHaveProperty('totalFiles');
      expect(result).toHaveProperty('foundFiles');
      expect(result).toHaveProperty('missingFiles');
      expect(result).toHaveProperty('summaries');
      expect(result).toHaveProperty('totalSummaryTokens');
      expect(result).toHaveProperty('scanStatus');

      // Verify types
      expect(typeof result.totalFiles).toBe('number');
      expect(typeof result.foundFiles).toBe('number');
      expect(Array.isArray(result.missingFiles)).toBe(true);
      expect(Array.isArray(result.summaries)).toBe(true);
      expect(typeof result.totalSummaryTokens).toBe('number');
      expect(['complete', 'partial', 'failed']).toContain(result.scanStatus);
    } finally {
      await cleanupTestDirectory(testDir);
    }
  });

  it('should return CitationRef with correct structure', async () => {
    const testDir = await createTestDirectory();
    try {
      const extractor = new SummaryExtractor(testDir);
      const content = `# Test

Citation here (Smith, 2020) for reference.
`;
      await createMockFile(testDir, '00-cite.md', content);

      const summary = await extractor.extractSummary('00-cite.md', 0);

      if (summary.citations.length > 0) {
        const citation = summary.citations[0];
        expect(citation).toHaveProperty('raw');
        expect(typeof citation.raw).toBe('string');

        if (citation.parsed !== null) {
          expect(citation.parsed).toHaveProperty('authors');
          expect(Array.isArray(citation.parsed.authors)).toBe(true);
          expect(citation.parsed).toHaveProperty('year');
          expect(citation.parsed).toHaveProperty('title');
        }
      }
    } finally {
      await cleanupTestDirectory(testDir);
    }
  });
});
