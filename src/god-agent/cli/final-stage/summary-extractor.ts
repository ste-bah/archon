/**
 * SummaryExtractor - Extracts summaries from agent output files
 *
 * Implements SPEC-TECH-001 Section 2.2 and GAP-C002 from SPEC-FUNC-001 Section 2.3
 *
 * File Size Handling:
 * - Files < 1KB: Copy verbatim (no LLM summarization)
 * - Files 1KB-100KB: Full content for summarization
 * - Files > 100KB: Extract first 10KB + last 10KB, then summarize
 * - Target: 400-600 tokens per summary
 *
 * Constitution Rules:
 * - SE-001: Read-only source access - NEVER modify source files, only read
 * - DI-002: Agent output preservation - original files MUST NOT be modified
 * - EX-002: Unassigned output logging - track all files, log missing ones
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type {
  OutputScannerInput,
  OutputScannerOutput,
  AgentOutputSummary,
  CitationRef
} from './types.js';

/**
 * SummaryExtractor - Scans research directory and extracts structured summaries
 *
 * Expects files named: NN-agent-name.md where NN is 00-44
 * Total expected files: 45
 */
export class SummaryExtractor {
  private readonly researchDir: string;

  /**
   * Citation extraction patterns
   * Per SPEC-FUNC-001 Section 2.3.4
   */
  private static readonly CITATION_PATTERNS = {
    // APA Style: (Smith, 2020), (de Silva, 2019), (Smith & Jones, 2020), (Smith et al., 2020)
    APA: /\(([A-Z][a-z]+(?:\s+(?:et\s+al\.))?(?:\s*[&,]\s*[A-Z][a-z]+)*)[,\s]+(\d{4})[a-z]?(?:,\s*pp?\.\s*\d+(?:\s*[-]\s*\d+)?)?\)/g,
    // MLA Style: (Smith 42), (Jones 123-125)
    MLA: /\(([A-Z][a-z]+)\s+(\d+(?:\s*[-]\s*\d+)?)\)/g,
    // Numbered citations: [1], [10], [42]
    NUMBERED: /\[(\d+)\]/g
  };

  /**
   * Size thresholds in bytes
   */
  private static readonly SIZE_THRESHOLDS = {
    SMALL: 1024,        // 1KB - use verbatim
    LARGE: 102400,      // 100KB - extract head/tail
    HEAD_TAIL: 10240    // 10KB each for head/tail extraction
  };

  /**
   * Total expected agent output files
   */
  private static readonly EXPECTED_FILE_COUNT = 45;

  constructor(researchDir: string) {
    this.researchDir = researchDir;
  }

  /**
   * Scan all output files in the research directory
   *
   * @returns List of all markdown files matching the NN-*.md pattern
   */
  async scanFiles(): Promise<string[]> {
    let files: string[];
    try {
      files = await fs.readdir(this.researchDir);
    } catch {
      // INTENTIONAL: Research directory may not exist yet - return empty list
      return [];
    }

    // Filter to numbered markdown files (00-44)
    return files
      .filter(f => f.endsWith('.md'))
      .filter(f => /^\d{2}-/.test(f))
      .sort((a, b) => {
        const indexA = parseInt(a.slice(0, 2), 10);
        const indexB = parseInt(b.slice(0, 2), 10);
        return indexA - indexB;
      });
  }

  /**
   * Extract summary from a single file
   *
   * @param filePath - Absolute or relative path to the file
   * @param index - File index (0-44)
   * @returns Structured summary per AgentOutputSummary interface
   */
  async extractSummary(filePath: string, index: number): Promise<AgentOutputSummary> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.researchDir, filePath);

    const fileName = path.basename(filePath);

    let content: string;
    try {
      content = await fs.readFile(absolutePath, 'utf-8');
    } catch {
      // INTENTIONAL: File read failure - return structured failed summary for tracking
      return this.createFailedSummary(index, fileName, absolutePath);
    }

    const fileSize = Buffer.byteLength(content, 'utf-8');
    const wordCount = this.countWords(content);

    // Extract metadata
    const agentName = this.extractAgentName(content);
    const phase = this.determinePhase(index);
    const contentType = this.extractContentType(content);
    const citations = this.extractCitations(content);

    // Handle size-based extraction per GAP-C002
    let summaryContent: string;
    let extractionStatus: 'success' | 'partial' | 'failed' = 'success';

    if (fileSize < SummaryExtractor.SIZE_THRESHOLDS.SMALL) {
      // Small file: use verbatim content
      summaryContent = content;
    } else if (fileSize > SummaryExtractor.SIZE_THRESHOLDS.LARGE) {
      // Large file: extract head + tail
      const headSize = SummaryExtractor.SIZE_THRESHOLDS.HEAD_TAIL;
      const head = content.slice(0, headSize);
      const tail = content.slice(-headSize);
      summaryContent = `${head}\n\n[...content truncated (${Math.round(fileSize / 1024)}KB total)...]\n\n${tail}`;
      extractionStatus = 'partial';
    } else {
      // Normal file: use full content for summarization
      summaryContent = content;
    }

    // Strip metadata headers BEFORE extraction to prevent agent metadata leaking into summaries
    summaryContent = this.stripMetadataHeaders(summaryContent);

    // Extract key information
    const primaryTopics = this.extractTopics(summaryContent);
    const researchQuestions = this.extractResearchQuestions(summaryContent);
    const keyFindings = this.extractKeyFindings(summaryContent);
    const keyTerms = this.extractKeyTerms(summaryContent);

    // Generate summary text (400-600 tokens target)
    const summary = this.generateSummaryText(summaryContent, 500);
    const summaryTokens = this.estimateTokens(summary);

    return {
      index,
      fileName,
      filePath: absolutePath,
      agentName,
      phase,
      contentType,
      primaryTopics,
      researchQuestions,
      keyFindings,
      keyTerms,
      citations,
      wordCount,
      summary,
      summaryTokens,
      extractionStatus
    };
  }

  /**
   * Extract summaries from all agent output files
   *
   * @returns Array of summaries sorted by file index
   */
  async extractAllSummaries(): Promise<AgentOutputSummary[]> {
    const files = await this.scanFiles();
    const summaries: AgentOutputSummary[] = [];

    for (const file of files) {
      const index = parseInt(file.slice(0, 2), 10);
      const summary = await this.extractSummary(file, index);
      summaries.push(summary);
    }

    // Sort by index to ensure order
    return summaries.sort((a, b) => a.index - b.index);
  }

  /**
   * Scan all output files and extract summaries with full reporting
   *
   * @param input - Scanner configuration
   * @returns Complete scan result with status
   */
  async scanOutputFiles(input: OutputScannerInput): Promise<OutputScannerOutput> {
    const { excludePatterns, maxSummaryTokens } = input;

    // List all markdown files
    let files: string[];
    try {
      files = await fs.readdir(this.researchDir);
    } catch {
      // INTENTIONAL: Directory access failure - return structured scan result with failed status
      return {
        totalFiles: SummaryExtractor.EXPECTED_FILE_COUNT,
        foundFiles: 0,
        missingFiles: this.generateExpectedFiles(),
        summaries: [],
        totalSummaryTokens: 0,
        scanStatus: 'failed'
      };
    }

    // Filter to numbered markdown files
    const mdFiles = files
      .filter(f => f.endsWith('.md'))
      .filter(f => /^\d{2}-/.test(f))
      .filter(f => !excludePatterns.some(p => f.includes(p)));

    // Identify expected vs found
    const expectedIndices = Array.from({ length: SummaryExtractor.EXPECTED_FILE_COUNT }, (_, i) => i);
    const foundIndices = mdFiles.map(f => parseInt(f.slice(0, 2), 10));
    const missingIndices = expectedIndices.filter(i => !foundIndices.includes(i));
    const missingFiles = missingIndices.map(i => `${String(i).padStart(2, '0')}-*.md`);

    // Extract summaries
    const summaries: AgentOutputSummary[] = [];
    let totalSummaryTokens = 0;

    for (const file of mdFiles) {
      const index = parseInt(file.slice(0, 2), 10);
      const summary = await this.extractSummaryWithTokenLimit(file, index, maxSummaryTokens);
      summaries.push(summary);
      totalSummaryTokens += summary.summaryTokens;
    }

    // Sort by index
    summaries.sort((a, b) => a.index - b.index);

    // Determine status per TASK-004 spec
    let scanStatus: 'complete' | 'partial' | 'failed';
    if (summaries.length === SummaryExtractor.EXPECTED_FILE_COUNT &&
        summaries.every(s => s.extractionStatus === 'success')) {
      scanStatus = 'complete';
    } else if (summaries.length >= 40) {
      scanStatus = 'partial';
    } else {
      scanStatus = 'failed';
    }

    return {
      totalFiles: SummaryExtractor.EXPECTED_FILE_COUNT,
      foundFiles: summaries.length,
      missingFiles,
      summaries,
      totalSummaryTokens,
      scanStatus
    };
  }

  /**
   * Extract summary with specific token limit
   */
  private async extractSummaryWithTokenLimit(
    fileName: string,
    index: number,
    maxTokens: number
  ): Promise<AgentOutputSummary> {
    const filePath = path.join(this.researchDir, fileName);

    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      // INTENTIONAL: File read failure - return structured failed summary for caller handling
      return this.createFailedSummary(index, fileName, filePath);
    }

    const fileSize = Buffer.byteLength(content, 'utf-8');
    const wordCount = this.countWords(content);

    // Extract metadata
    const agentName = this.extractAgentName(content);
    const phase = this.determinePhase(index);
    const contentType = this.extractContentType(content);
    const citations = this.extractCitations(content);

    // Handle size-based extraction
    let summaryContent: string;
    let extractionStatus: 'success' | 'partial' | 'failed' = 'success';

    if (fileSize < SummaryExtractor.SIZE_THRESHOLDS.SMALL) {
      summaryContent = content;
    } else if (fileSize > SummaryExtractor.SIZE_THRESHOLDS.LARGE) {
      const headSize = SummaryExtractor.SIZE_THRESHOLDS.HEAD_TAIL;
      const head = content.slice(0, headSize);
      const tail = content.slice(-headSize);
      summaryContent = `${head}\n\n[...content truncated...]\n\n${tail}`;
      extractionStatus = 'partial';
    } else {
      summaryContent = content;
    }

    // Strip metadata headers BEFORE extraction to prevent agent metadata leaking into summaries
    summaryContent = this.stripMetadataHeaders(summaryContent);

    // Extract key information
    const primaryTopics = this.extractTopics(summaryContent);
    const researchQuestions = this.extractResearchQuestions(summaryContent);
    const keyFindings = this.extractKeyFindings(summaryContent);
    const keyTerms = this.extractKeyTerms(summaryContent);

    // Generate summary text with specified token limit
    const summary = this.generateSummaryText(summaryContent, maxTokens);
    const summaryTokens = this.estimateTokens(summary);

    return {
      index,
      fileName,
      filePath,
      agentName,
      phase,
      contentType,
      primaryTopics,
      researchQuestions,
      keyFindings,
      keyTerms,
      citations,
      wordCount,
      summary,
      summaryTokens,
      extractionStatus
    };
  }

  /**
   * Extract agent name from content
   * Looks for "Agent:" line or first heading
   */
  private extractAgentName(content: string): string {
    // Try explicit agent line first
    const agentMatch = content.match(/Agent:\s*([^\n]+)/i);
    if (agentMatch) {
      return agentMatch[1].trim();
    }

    // Fall back to first heading
    const headingMatch = content.match(/^#\s*([^\n]+)/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }

    return 'Unknown Agent';
  }

  /**
   * Determine pipeline phase from file index
   * Per SPEC-FUNC-001 Section 2.3.4
   */
  private determinePhase(index: number): number {
    if (index <= 5) return 1;   // Foundation
    if (index <= 13) return 2;  // Exploration
    if (index <= 18) return 3;  // Context
    if (index <= 27) return 4;  // Analysis
    if (index <= 33) return 5;  // Synthesis/Writing
    return 7;                    // Validation
  }

  /**
   * Extract content type from first heading
   */
  private extractContentType(content: string): string {
    const firstHeading = content.match(/^#+\s*([^\n]+)/m);
    return firstHeading ? firstHeading[1].trim() : 'Research Output';
  }

  /**
   * Extract citations from content
   * Supports APA, MLA, and numbered formats
   */
  private extractCitations(content: string): CitationRef[] {
    const citations: CitationRef[] = [];
    const seen = new Set<string>();

    // APA citations
    const apaPattern = new RegExp(SummaryExtractor.CITATION_PATTERNS.APA.source, 'g');
    let match;
    while ((match = apaPattern.exec(content)) !== null) {
      const raw = match[0];
      if (!seen.has(raw)) {
        seen.add(raw);
        citations.push({
          raw,
          parsed: {
            authors: [match[1]],
            year: parseInt(match[2], 10),
            title: null
          }
        });
      }
    }

    // MLA citations
    const mlaPattern = new RegExp(SummaryExtractor.CITATION_PATTERNS.MLA.source, 'g');
    while ((match = mlaPattern.exec(content)) !== null) {
      const raw = match[0];
      if (!seen.has(raw)) {
        seen.add(raw);
        citations.push({
          raw,
          parsed: {
            authors: [match[1]],
            year: null,
            title: null
          }
        });
      }
    }

    // Numbered citations - validate context to avoid false positives
    const numberedPattern = new RegExp(SummaryExtractor.CITATION_PATTERNS.NUMBERED.source, 'g');
    while ((match = numberedPattern.exec(content)) !== null) {
      const raw = match[0];
      if (!seen.has(raw) && this.isValidBracketedCitation(match, content)) {
        seen.add(raw);
        citations.push({
          raw,
          parsed: null
        });
      }
    }

    return citations;
  }

  /**
   * Validate bracketed citation to avoid false positives
   * Per SPEC-FUNC-001 Section 2.3.4
   */
  private isValidBracketedCitation(match: RegExpExecArray, content: string): boolean {
    const precedingStart = Math.max(0, match.index - 50);
    const precedingText = content.slice(precedingStart, match.index);
    const followingText = content.slice(
      match.index + match[0].length,
      match.index + match[0].length + 20
    );

    // Valid if: preceded by author name
    if (/[A-Z][a-z]+\s*$/.test(precedingText)) return true;

    // Valid if: followed by comma and another bracket
    if (/^\s*,?\s*\[\d+\]/.test(followingText)) return true;

    // Valid if: preceded by another bracket citation
    if (/\[\d+\]\s*,?\s*$/.test(precedingText)) return true;

    // Check for citation context keywords
    if (/(?:according\s+to|study|research|found|showed|reported|et\s+al)\s*$/i.test(precedingText)) {
      return true;
    }

    return false;
  }

  /**
   * Extract primary topics from headings
   * Returns top 5 topics
   */
  private extractTopics(content: string): string[] {
    const headings = content.match(/^#{1,3}\s*([^\n]+)/gm) || [];
    const topics = headings
      .map(h => h.replace(/^#+\s*/, '').trim())
      .filter(h => h.length > 3 && h.length < 100)
      .filter(h => !h.toLowerCase().includes('table of contents'))
      .filter(h => !h.toLowerCase().includes('references'))
      .slice(0, 5);

    return topics;
  }

  /**
   * Extract research questions from content
   * Looks for Q1, Q2, RQ1, RQ2 patterns
   */
  private extractResearchQuestions(content: string): string[] {
    const questions: string[] = [];

    // Look for explicit research questions sections
    const qMatch = content.match(/research\s+questions?[:\s]*([^\n]+(?:\n(?!\n)[^\n]+)*)/gi);
    if (qMatch) {
      for (const match of qMatch) {
        const qs = match.match(/(?:Q|RQ)\d+/gi);
        if (qs) questions.push(...qs);
      }
    }

    // Also look for inline question references
    const inlineQs = content.match(/\b(?:Q|RQ)\d+\b/gi) || [];
    for (const q of inlineQs) {
      if (!questions.includes(q.toUpperCase())) {
        questions.push(q.toUpperCase());
      }
    }

    return [...new Set(questions)].slice(0, 10);
  }

  /**
   * Extract key findings from content
   * Returns top 3 findings
   */
  private extractKeyFindings(content: string): string[] {
    const findings: string[] = [];

    // Look for findings/conclusions sections
    const findingsMatch = content.match(/(?:key\s+)?(?:findings?|conclusions?|results?)[:\s]*\n((?:[-*]\s*[^\n]+\n?)+)/gi);
    if (findingsMatch) {
      for (const match of findingsMatch) {
        const items = match.match(/[-*]\s*([^\n]+)/g);
        if (items) {
          findings.push(
            ...items
              .map(i => i.replace(/^[-*]\s*/, '').trim())
              .filter(i => i.length > 10)
              .slice(0, 3)
          );
        }
      }
    }

    // If no structured findings, try numbered lists
    if (findings.length === 0) {
      const numberedMatch = content.match(/\d+\.\s+([^\n]+)/g);
      if (numberedMatch) {
        findings.push(
          ...numberedMatch
            .map(i => i.replace(/^\d+\.\s+/, '').trim())
            .filter(i => i.length > 20 && i.length < 200)
            .slice(0, 3)
        );
      }
    }

    return findings.slice(0, 3);
  }

  /**
   * Extract key terms from content
   * Returns up to 15 terms
   */
  private extractKeyTerms(content: string): string[] {
    const terms: string[] = [];

    // Look for bold text (markdown emphasis)
    const boldTerms = content.match(/\*\*([^*]+)\*\*/g) || [];
    for (const term of boldTerms) {
      const cleaned = term.replace(/\*\*/g, '').trim();
      if (cleaned.length > 2 && cleaned.length < 50) {
        terms.push(cleaned);
      }
    }

    // Look for italic text
    const italicTerms = content.match(/\*([^*\n]+)\*/g) || [];
    for (const term of italicTerms) {
      const cleaned = term.replace(/\*/g, '').trim();
      if (cleaned.length > 2 && cleaned.length < 50 && !terms.includes(cleaned)) {
        terms.push(cleaned);
      }
    }

    // Look for definitions (term: definition pattern)
    const definitions = content.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*[:-]/gm) || [];
    for (const def of definitions) {
      const term = def.replace(/[:-]\s*$/, '').trim();
      if (term.length > 2 && term.length < 50 && !terms.includes(term)) {
        terms.push(term);
      }
    }

    return [...new Set(terms)].slice(0, 15);
  }

  /**
   * Strip agent metadata headers from content
   * Removes blocks like "Status:", "Agent:", "Date:", etc.
   */
  private stripMetadataHeaders(content: string): string {
    // Split into lines
    const lines = content.split('\n');
    const cleanedLines: string[] = [];
    let inMetadataBlock = true;
    let consecutiveMetadataLines = 0;

    // Metadata patterns to strip - supports both plain and markdown bold format
    const metadataPatterns = [
      /^\*?\*?Status\*?\*?:\s*/i,
      /^\*?\*?Agent\*?\*?:\s*/i,
      /^\*?\*?Date\*?\*?:\s*/i,
      /^\*?\*?Analysis Type\*?\*?:\s*/i,
      /^\*?\*?Input\*?\*?:\s*/i,
      /^\*?\*?Output\*?\*?:\s*/i,
      /^\*?\*?Components?\s*Scored\*?\*?:\s*/i,
      /^\*?\*?Methodology\*?\*?:\s*/i,
      /^\*?\*?Overall\s+Confidence\*?\*?:\s*/i,
      /^\*?\*?Truth\s+Score\*?\*?:\s*/i,
      /^\*?\*?Word\s+Count\*?\*?:\s*/i,
      /^\*?\*?Citation\s+Count\*?\*?:\s*/i,
      /^\*?\*?Chapter\*?\*?:\s*/i,
      /^\*?\*?Structure\*?\*?:\s*/i,
      /^\*?\*?PhD\s+Standard\*?\*?:\s*/i,
      /^\*?\*?APA\s+.*Compliance\*?\*?:\s*/i,
      /^\*?\*?Pipeline\s+Phase\*?\*?:\s*/i,
      /^\*?\*?Research\s+Questions?\*?\*?:\s*/i,
      /^\*?\*?Posterior\s+Confidence\*?\*?/i,
      /^\*?\*?Prior\s+Confidence\*?\*?/i,
      /^\*?\*?Confidence\s+Interval\*?\*?/i,
      /^\*?\*?Themes?\s+Covered\*?\*?:\s*/i,
      /^\*?\*?Gaps?\s+Identified\*?\*?:\s*/i,
      /^\*?\*?Total\s+Citations\*?\*?:\s*/i,
      /^\s*-\s+[A-Z][^:]+:\s*\d+%/,  // Bullet points with percentages like "- HCMT v2.0 Theory: 73%"
      /^\s*-\s+[A-Z][^:]+:\s*\[\d+%/,  // Bullet points with CI like "- Overall: [62-72%]"
      /^`+.*`+$/,  // Lines that are just backticks/file paths
      /^\(THIS FILE\)/i,
      /^---+$/,  // Horizontal rules (often used as metadata separators)

      // Research artifact patterns (internal workflow markers)
      // These patterns account for markdown formatting: headings (###), bold (**), bullets (-)
      /^(?:#{1,4}\s*)?(?:\d+\.\s*)?\*?\*?Q\d+\*?\*?:/,  // Research questions like Q1:, **Q9**:, 1. **Q1**:
      /^(?:-\s*)?\*?\*?FLAG\*?\*?:/i,  // Internal flags
      /^(?:-\s*)?\*?\*?XP\s+Earned\*?\*?:/i,  // Gamification metadata
      /^(?:-\s*)?\*?\*?Measurable\s+Criteria\*?\*?:/i,  // Evaluation blocks
      /^(?:#{1,4}\s*)?(?:-\s*)?\*?\*?Step-Back\s+Analysis\*?\*?:/i,  // Analysis headers (with optional heading)
      /^(?:-\s*)?\*?\*?Category\*?\*?:/i,  // Category markers
      /^(?:-\s*)?\*?\*?Evidence\*?\*?:/i,  // Evidence markers
      /^(?:-\s*)?\*?\*?Gaps?\*?\*?:/i,  // Gap markers
      /^(?:-\s*)?\*?\*?Section\s+\d+\.\d+\s+[A-Z]/,  // Duplicate section markers
      /^(?:-\s*)?\[\d+%\s*-\s*\d+%\]/,  // Confidence intervals like [62-72%]
      /^(?:-\s*)?\*?\*?Confidence\*?\*?:\s*\d+%/i,  // Confidence percentages
      /^(?:-\s*)?\*?\*?Prior\*?\*?:/i,  // Prior probability
      /^(?:-\s*)?\*?\*?Posterior\*?\*?:/i,  // Posterior probability
      /^(?:-\s*)?\*?\*?Likelihood\*?\*?:/i,  // Likelihood ratio
      /^(?:-\s*)?\*?\*?Score\*?\*?:\s*\d/i,  // Score lines
      /^(?:-\s*)?\*?\*?Rating\*?\*?:/i,  // Rating lines
      /^(?:-\s*)?\*?\*?Assessment\*?\*?:/i,  // Assessment markers
      /^(?:-\s*)?\*?\*?Verdict\*?\*?:/i,  // Verdict lines
      /^(?:-\s*)?\*?\*?Recommendation\*?\*?:/i,  // Recommendation markers
      /^(?:-\s*)?\*?\*?Research\s+Goal\*?\*?:/i,  // Research goal headers
      /^(?:-\s*)?\*?\*?Average\s+Confidence\s+Score\*?\*?:/i,  // Average confidence
      /^(?:-\s*)?\*?\*?Research\s+Flags\*?\*?:/i,  // Research flags
      /^(?:-\s*)?\*?\*?Total\s+Questions\s+Generated\*?\*?:/i,  // Question counts
      /^(?:-\s*)?\*?\*?Domain\*?\*?:/i,  // Domain markers
      /^(?:-\s*)?\*?\*?Subject\*?\*?:/i,  // Subject markers
      /^(?:-\s*)?\*?\*?Supporting\s+Evidence\*?\*?:/i,  // Supporting evidence markers
      /^(?:#{1,4}\s*)?\*?\*?CRITICAL\s*\([^)]*\)\*?\*?$/i,  // CRITICAL headers
      /^(?:#{1,4}\s*)?\*?\*?IMPORTANT\s*\([^)]*\)\*?\*?$/i,  // IMPORTANT headers
      /^(?:#{1,4}\s*)?\*?\*?SUFFICIENT\s+CONFIDENCE\*?\*?\s*\([^)]*\)?$/i,  // Confidence headers
      /^(?:-\s*)?\*?\*?CRITICAL\s+UNKNOWNS?\*?\*?\s*\([^)]*\)?$/i,  // Critical unknowns headers
      /^(?:-\s*)?\*?\*?CRITICAL\*?\*?:\s*\d+\s+terms?/i,  // Critical term counts
      /^Evidence\s+Quality\s+Scoring\s*\([^)]*\)/i,  // Evidence quality scoring headers
    ];

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Skip empty lines at the start
      if (inMetadataBlock && trimmedLine === '') {
        // Allow one blank line, but if we've seen metadata, might be end of block
        if (consecutiveMetadataLines > 2) {
          inMetadataBlock = false;
        }
        continue;
      }

      // Check if this line is metadata
      const isMetadata = metadataPatterns.some(pattern => pattern.test(trimmedLine));

      if (inMetadataBlock && isMetadata) {
        consecutiveMetadataLines++;
        continue; // Skip metadata lines
      }

      // If we hit non-metadata content, we're done with the metadata block
      if (inMetadataBlock && !isMetadata && trimmedLine.length > 0) {
        // But check if this looks like a continuation of metadata (short lines with colons)
        if (trimmedLine.length < 100 && trimmedLine.includes(':') && consecutiveMetadataLines > 0) {
          continue; // Still in metadata
        }
        inMetadataBlock = false;
      }

      // After metadata block, still filter out stray metadata lines
      if (!inMetadataBlock) {
        // Skip lines that are clearly metadata even in the body
        if (metadataPatterns.some(pattern => pattern.test(trimmedLine))) {
          continue;
        }
      }

      cleanedLines.push(line);
    }

    return cleanedLines.join('\n').trim();
  }

  /**
   * Generate summary text from content
   * Target: 400-600 tokens
   */
  private generateSummaryText(content: string, maxTokens: number): string {
    // First strip metadata headers
    const strippedContent = this.stripMetadataHeaders(content);

    // Remove markdown formatting for cleaner summary
    const cleanContent = strippedContent
      .replace(/^#+\s*/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`[^`]+`/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Split into paragraphs
    const paragraphs = cleanContent.split(/\n\n+/);
    const meaningfulParagraphs = paragraphs.filter(p =>
      p.length > 100 &&
      !p.startsWith('|') &&
      !p.match(/^\s*[-*]\s/) &&
      !p.match(/^\d+\.\s/)
    );

    let summary = '';
    let currentTokens = 0;
    const targetTokens = Math.min(maxTokens, 600);

    for (const para of meaningfulParagraphs) {
      const paraTokens = this.estimateTokens(para);
      if (currentTokens + paraTokens > targetTokens) {
        // Add partial paragraph if we have room
        if (currentTokens < 400 && summary.length > 0) {
          const remaining = (targetTokens - currentTokens) * 4; // Rough char estimate
          summary += para.slice(0, remaining) + '...';
        }
        break;
      }
      summary += para + '\n\n';
      currentTokens += paraTokens;
    }

    // Ensure minimum content
    if (summary.length === 0 && meaningfulParagraphs.length > 0) {
      // At least include truncated first paragraph
      const maxChars = maxTokens * 4;
      summary = meaningfulParagraphs[0].slice(0, maxChars);
      if (meaningfulParagraphs[0].length > maxChars) {
        summary += '...';
      }
    }

    return summary.trim();
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.split(/\s+/).filter(w => w.length > 0).length;
  }

  /**
   * Estimate token count
   * Rough approximation: 1 token = 4 characters for English
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Generate list of expected file patterns
   */
  private generateExpectedFiles(): string[] {
    return Array.from({ length: SummaryExtractor.EXPECTED_FILE_COUNT }, (_, i) =>
      `${String(i).padStart(2, '0')}-*.md`
    );
  }

  /**
   * Create a failed summary for files that couldn't be read
   */
  private createFailedSummary(
    index: number,
    fileName: string,
    filePath: string
  ): AgentOutputSummary {
    return {
      index,
      fileName,
      filePath,
      agentName: 'Unknown',
      phase: this.determinePhase(index),
      contentType: 'Unknown',
      primaryTopics: [],
      researchQuestions: [],
      keyFindings: [],
      keyTerms: [],
      citations: [],
      wordCount: 0,
      summary: '',
      summaryTokens: 0,
      extractionStatus: 'failed'
    };
  }
}
