/**
 * Complete TypeScript type definitions for Phase 8 Final Stage
 *
 * Implements SPEC-TECH-001 Section 3 - Data Structures
 * Addresses gaps: GAP-H012 (CLI), GAP-C007 (Output Structure)
 */

// ============================================
// Re-exports from universal modules
// ============================================

export type { StyleCharacteristics, RegionalSettings } from '../../universal/style-analyzer.js';

// ============================================
// State Types
// ============================================

export type FinalStageState =
  | 'IDLE'
  | 'INITIALIZING'
  | 'SCANNING'
  | 'SUMMARIZING'
  | 'MAPPING'
  | 'WRITING'
  | 'COMBINING'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'FAILED';

export type PhaseStatus = 'pending' | 'running' | 'success' | 'warning' | 'failed';

/** Dynamic chapter number type - supports 5-12 chapters per dissertation-architect structure */
export type ChapterNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

// ============================================
// Error Types
// ============================================

export type FinalStageErrorCode =
  | 'NO_RESEARCH_DIR'
  | 'OUTPUT_EXISTS'
  | 'SCAN_FAILED'
  | 'MAPPING_FAILED'
  | 'NO_SOURCES'
  | 'STYLE_ERROR'
  | 'WRITE_ERROR'
  | 'TOKEN_OVERFLOW'
  | 'VALIDATION_FAILED'
  | 'SECURITY_VIOLATION'
  | 'CONSTITUTION_VIOLATION';

/**
 * Custom error class for Final Stage operations
 * Exit codes per CONSTITUTION Appendix B
 */
export class FinalStageError extends Error {
  constructor(
    message: string,
    public readonly code: FinalStageErrorCode,
    public readonly recoverable: boolean,
    public readonly exitCode?: number
  ) {
    super(message);
    this.name = 'FinalStageError';
  }

  /**
   * Map error code to exit code per CONSTITUTION Appendix B
   */
  static getExitCode(code: FinalStageErrorCode): number {
    const exitCodeMap: Record<FinalStageErrorCode, number> = {
      NO_RESEARCH_DIR: 2,
      OUTPUT_EXISTS: 1,
      SCAN_FAILED: 2,
      MAPPING_FAILED: 4,
      NO_SOURCES: 4,
      STYLE_ERROR: 5,
      WRITE_ERROR: 1,
      TOKEN_OVERFLOW: 3,
      VALIDATION_FAILED: 5,
      SECURITY_VIOLATION: 6,
      CONSTITUTION_VIOLATION: 7
    };
    return exitCodeMap[code];
  }
}

// ============================================
// Options and Configuration
// ============================================

/**
 * CLI options for finalize command
 * Per SPEC-FUNC-001 Section 3.1
 */
export interface FinalStageOptions {
  /** Overwrite existing final/ outputs */
  force?: boolean;
  /** Show mapping without generating chapters */
  dryRun?: boolean;
  /** Semantic matching threshold (0-1), default: 0.30 */
  threshold?: number;
  /** Enable detailed logging */
  verbose?: boolean;
  /** Skip quality validation (debug only) */
  skipValidation?: boolean;
  /** Write chapters sequentially (safer, slower) */
  sequential?: boolean;
  /** Style profile ID for consistent writing style (REQUIRED for quality output) */
  styleProfileId?: string;
}

export interface SemanticMapperInput {
  /** Minimum relevance score, default: 0.30 */
  threshold: number;
  /** Enable heuristic fallback, default: true */
  fallbackHeuristics: boolean;
}

export interface OutputScannerInput {
  /** Absolute path to research directory */
  researchDirectory: string;
  /** Files to exclude (e.g., ["05-chapter-structure.md"]) */
  excludePatterns: string[];
  /** Maximum tokens per summary, default: 500 */
  maxSummaryTokens: number;
}

// ============================================
// Chapter and Source Types
// ============================================

/**
 * Chapter definition from locked structure
 * AUTHORITATIVE per DI-001
 */
export interface ChapterDefinition {
  /** Chapter number 1-12 (dynamic based on structure) */
  number: ChapterNumber;
  /** Chapter title from structure */
  title: string;
  /** Chapter purpose statement */
  purpose: string;
  /** Section identifiers (e.g., "1.1", "1.2") */
  sections: string[];
  /** Section titles */
  sectionTitles: string[];
  /** Target word count */
  wordTarget: number;
  /** Target citation count */
  citationTarget: number;
  /** Research questions addressed (e.g., ["Q1", "Q2"]) */
  questionsAddressed: string[];
  /** Assigned writing agent name */
  assignedAgent: string;
  /** Keywords for semantic matching */
  keywords: string[];
}

/**
 * Summary extracted from agent output file
 * Per SPEC-FUNC-001 Section 2.3
 */
export interface AgentOutputSummary {
  /** File index 0-44 */
  index: number;
  /** Original filename, e.g., "00-principles.md" */
  fileName: string;
  /** Absolute path to file */
  filePath: string;
  /** Extracted agent name */
  agentName: string;
  /** Pipeline phase 1-7 */
  phase: number;
  /** Content type description */
  contentType: string;
  /** Top 5 topics */
  primaryTopics: string[];
  /** Research questions addressed (if stated) */
  researchQuestions: string[];
  /** Top 3 findings */
  keyFindings: string[];
  /** Important terminology */
  keyTerms: string[];
  /** Extracted citations */
  citations: CitationRef[];
  /** Original file word count */
  wordCount: number;
  /** 400-600 token summary text */
  summary: string;
  /** Actual token count */
  summaryTokens: number;
  /** Extraction status */
  extractionStatus: 'success' | 'partial' | 'failed';
}

/**
 * Citation reference structure
 */
export interface CitationRef {
  /** Original citation text */
  raw: string;
  /** Parsed citation data (null if parsing failed) */
  parsed: {
    authors: string[];
    year: number | null;
    title: string | null;
  } | null;
}

// ============================================
// Mapping Types
// ============================================

/**
 * Chapter-to-source mapping result
 * Per SPEC-FUNC-001 Section 2.4
 */
export interface ChapterMapping {
  /** Chapter number */
  chapterNumber: ChapterNumber;
  /** Chapter title */
  chapterTitle: string;
  /** File indices with score >= threshold + 0.2 */
  primarySources: number[];
  /** File indices with score >= threshold */
  secondarySources: number[];
  /** Combined list (primary + secondary) */
  allSources: number[];
  /** Average semantic score */
  avgRelevanceScore: number;
  /** Minimum score in mapping */
  minRelevanceScore: number;
  /** Total sources assigned */
  sourceCount: number;
}

/**
 * Full semantic mapping output
 */
export interface SemanticMapperOutput {
  /** Mapping for each chapter */
  mappings: ChapterMapping[];
  /** Files not mapped to any chapter */
  orphanedSources: number[];
  /** Mapping quality metrics */
  mappingQuality: {
    /** % chapters with >= 1 source */
    coverage: number;
    /** Global average score */
    avgRelevance: number;
    /** Std dev of source counts */
    balance: number;
  };
  /** Algorithm identifier */
  algorithm: string;
  /** Threshold used */
  threshold: number;
  /** Count of fallback assignments */
  fallbacksApplied: number;
}

/**
 * Output scanner result
 */
export interface OutputScannerOutput {
  /** Expected: 45 */
  totalFiles: number;
  /** Actual found */
  foundFiles: number;
  /** List of missing file patterns */
  missingFiles: string[];
  /** Extracted summaries */
  summaries: AgentOutputSummary[];
  /** Sum of all summary tokens */
  totalSummaryTokens: number;
  /** Scan status */
  scanStatus: 'complete' | 'partial' | 'failed';
}

// ============================================
// Chapter Output Types
// ============================================

/**
 * Cross-reference between chapters
 * Per GAP-C004
 */
export interface CrossReference {
  /** Source location */
  sourceLocation: { chapter: number; section: string };
  /** Target chapter number */
  targetChapter: number;
  /** Target section (null for whole chapter) */
  targetSection: string | null;
  /** Link text displayed */
  linkText: string;
  /** Markdown link format */
  linkFormat: string;
}

/**
 * Section information
 */
export interface SectionInfo {
  /** Section ID (e.g., "1.1") */
  id: string;
  /** Section title */
  title: string;
  /** Word count */
  wordCount: number;
}

/**
 * Chapter quality metrics
 * Per GAP-H003 (word count enforcement)
 */
export interface QualityMetrics {
  /** % of target word count (70%-130% acceptable) */
  wordCountCompliance: number;
  /** Total citation count */
  citationCount: number;
  /** Unique sources actually used */
  uniqueSourcesUsed: number;
  /** Style violation count */
  styleViolations: number;
}

/**
 * Chapter writer output
 */
export interface ChapterWriterOutput {
  /** Chapter number */
  chapterNumber: ChapterNumber;
  /** Chapter title */
  title: string;
  /** Full markdown content */
  content: string;
  /** Total word count */
  wordCount: number;
  /** Citations in chapter */
  citations: CitationRef[];
  /** Cross-references to other chapters */
  crossReferences: CrossReference[];
  /** Section breakdown */
  sections: SectionInfo[];
  /** Quality metrics */
  qualityMetrics: QualityMetrics;
  /** Generation status */
  generationStatus: PhaseStatus;
  /** Warnings during generation */
  warnings: string[];
  /** Tokens used for generation */
  tokensUsed: number;
}

// ============================================
// Final Paper Types
// ============================================

/**
 * Paper metadata
 * Per GAP-H010
 */
export interface PaperMetadata {
  /** Paper title */
  title: string;
  /** Research slug */
  slug: string;
  /** Generation timestamp ISO */
  generatedDate: string;
}

/**
 * Final combined paper
 */
export interface FinalPaper {
  /** Paper title */
  title: string;
  /** Table of contents markdown */
  toc: string;
  /** All chapter outputs */
  chapters: ChapterWriterOutput[];
  /** Full combined markdown */
  combinedContent: string;
  /** Metadata */
  metadata: PaperMetadata;
}

// ============================================
// Result Types
// ============================================

/**
 * Final stage execution result
 */
export interface FinalStageResult {
  /** Overall success */
  success: boolean;
  /** Was dry run */
  dryRun: boolean;
  /** Output file path (null if dry-run) */
  outputPath: string | null;
  /** Total words in paper */
  totalWords: number;
  /** Total citations */
  totalCitations: number;
  /** Chapters generated count */
  chaptersGenerated: number;
  /** Mapping result */
  mapping: SemanticMapperOutput | null;
  /** Chapter outputs (if not dry-run) */
  chapters?: ChapterWriterOutput[];
  /** Scan result */
  scanResult?: OutputScannerOutput;
  /** Warnings */
  warnings: string[];
  /** Errors */
  errors: string[];
  /** Token usage metadata */
  metadata: TokenBudget | null;
  /** Exit code per CONSTITUTION Appendix B */
  exitCode: number;
}

// ============================================
// Progress and Monitoring Types
// ============================================

/**
 * Progress report for callbacks
 * Per GAP-H004
 */
export interface ProgressReport {
  /** Current phase name */
  phase: string;
  /** Human-readable message */
  message: string;
  /** Current item index (-1 if not applicable) */
  current: number;
  /** Total items (-1 if not applicable) */
  total: number;
  /** Elapsed milliseconds */
  elapsedMs: number;
}

/**
 * Progress callback function type
 */
export type ProgressCallback = (report: ProgressReport) => void;

// ============================================
// Token Budget Types
// ============================================

/**
 * Token budget tracking
 * Per GAP-H009
 */
export interface TokenBudget {
  /** Total limit (200K default) */
  limit: number;
  /** Per-phase allocation and usage */
  phases: {
    summaryExtraction: {
      /** Allocated tokens (90K) */
      allocated: number;
      /** Tokens used */
      used: number;
      /** Remaining */
      remaining: number;
    };
    mapping: {
      /** Allocated tokens (100K) */
      allocated: number;
      /** Tokens used */
      used: number;
      /** Remaining */
      remaining: number;
    };
    chapterWriting: {
      /** Per-chapter allocation (180K / N chapters) */
      allocatedPerChapter: number;
      /** Array of tokens used per chapter */
      used: number[];
    };
    combination: {
      /** Allocated tokens (20K) */
      allocated: number;
      /** Tokens used */
      used: number;
      /** Remaining */
      remaining: number;
    };
  };
  /** Total summary */
  total: {
    /** Total used */
    used: number;
    /** Total budget */
    budget: number;
    /** Utilization percentage string */
    utilization: string;
  };
}

// ============================================
// Metadata Types
// ============================================

/**
 * Individual phase result
 */
export interface PhaseResult {
  /** Duration in milliseconds */
  duration: number;
  /** Phase status */
  status: PhaseStatus;
  /** Items processed */
  itemsProcessed: number;
}

/**
 * Full execution metadata
 * Per GAP-H010
 */
export interface ExecutionMetadata {
  execution: {
    /** ISO timestamp */
    timestamp: string;
    /** Total duration seconds */
    durationSeconds: number;
    /** Per-phase results */
    phases: Record<string, PhaseResult>;
  };
  document: {
    /** Document title */
    title: string;
    /** Original research query */
    researchQuery: string;
    /** Total word count */
    totalWords: number;
    /** Total citations */
    totalCitations: number;
    /** Per-chapter summary */
    chapters: Array<{
      number: number;
      title: string;
      words: number;
      citations: number;
      wordCountCompliance: number;
    }>;
  };
  sources: {
    /** Total source files */
    totalFiles: number;
    /** Files processed */
    processedFiles: number;
    /** Missing files */
    missingFiles: string[];
    /** Total source word count */
    totalSourceWords: number;
  };
  mapping: {
    /** Algorithm used */
    algorithm: string;
    /** Threshold used */
    threshold: number;
    /** Sources per chapter */
    chapterSourceCounts: number[];
    /** Orphaned source indices */
    orphanedSources: number[];
    /** Fallbacks applied count */
    fallbacksApplied: number;
  };
  quality: {
    /** Word count compliance summary */
    wordCountCompliance: string;
    /** Citation preservation summary */
    citationPreservation: string;
    /** Style compliance summary */
    styleCompliance: string;
    /** Cross-reference validity summary */
    crossReferencesValid: string;
  };
  /** Token usage */
  tokenUsage: TokenBudget;
}

// ============================================
// Chapter Structure Types (from 05-chapter-structure.md)
// ============================================

/**
 * Chapter structure reader output
 * Per SPEC-FUNC-001 Section 2.2
 */
export interface ChapterStructureReaderOutput {
  /** MUST be true per DI-001 */
  locked: boolean;
  /** ISO date when locked */
  dateLocked: string;
  /** Dynamic: 5-12 chapters based on research scope */
  totalChapters: number;
  /** Chapter definitions */
  chapters: ChapterDefinition[];
  /** Valid chapter reference numbers [1..N] */
  validReferences: number[];
  /** Total word target range */
  totalWordTarget: { min: number; max: number };
  /** Total citation target */
  totalCitationTarget: number;
}

// ============================================
// Input Types for Chapter Writer
// ============================================

/**
 * Chapter writer input
 */
export interface ChapterWriterInput {
  /** Chapter definition from structure */
  chapter: ChapterDefinition;
  /** Mapped source summaries */
  sources: AgentOutputSummary[];
  /** Style characteristics (null for default) */
  style: import('../../universal/style-analyzer.js').StyleCharacteristics | null;
  /** All chapter definitions for cross-referencing */
  allChapters: ChapterDefinition[];
  /** Token budget for this chapter */
  tokenBudget: number;
  /** Synthesis guidance from 06-chapter-synthesizer.md (optional) */
  synthesisGuidance?: string;
}

// ============================================
// Validation Types
// ============================================

/**
 * Mapping validation result
 * Per GAP-H005
 */
export interface MappingValidationResult {
  /** Overall valid */
  valid: boolean;
  /** Chapters with zero sources */
  emptyChapters: number[];
  /** Chapters below threshold */
  lowCoverageChapters: Array<{ chapter: number; sourceCount: number }>;
  /** Validation messages */
  messages: string[];
}

/**
 * Style validation result
 */
export interface StyleValidationResult {
  /** Overall compliant */
  compliant: boolean;
  /** Violation details */
  violations: Array<{
    type: string;
    location: string;
    message: string;
  }>;
}

// ============================================
// Phase 8 Claude Code Integration Types
// ============================================

/**
 * Claude Code Task tool prompt for chapter writing
 * Follows ClaudeFlow 4-part prompt pattern
 */
export interface ClaudeCodeChapterPrompt {
  /** Chapter number (1-12) */
  chapterNumber: ChapterNumber;
  /** Chapter title */
  chapterTitle: string;
  /** Full 4-part ClaudeFlow prompt */
  prompt: string;
  /** Suggested subagent type for Task tool */
  subagentType: string;
  /** Expected output file path */
  outputPath: string;
  /** Token budget for this chapter */
  tokenBudget: number;
}

/**
 * Result from prepareForClaudeCode() method
 * Contains all data needed for Claude Code to execute Phase 8
 */
export interface Phase8PrepareResult {
  /** Whether preparation succeeded */
  success: boolean;
  /** Research slug */
  slug: string;
  /** Base path to research directory */
  basePath: string;
  /** Path to final/ output directory */
  finalOutputDir: string;
  /** Total chapters to write */
  totalChapters: number;
  /** Chapter prompts ready for Task tool */
  chapterPrompts: ClaudeCodeChapterPrompt[];
  /** Scan results summary */
  scanSummary: {
    totalFiles: number;
    foundFiles: number;
    missingFiles: string[];
  };
  /** Mapping results summary */
  mappingSummary: {
    algorithm: string;
    threshold: number;
    orphanedSources: number[];
    coverage: number;
  };
  /** Errors encountered during preparation */
  errors: string[];
  /** Warnings encountered during preparation */
  warnings: string[];
  /** Memory namespace for this research */
  memoryNamespace: string;
  /** Instructions for Claude Code execution */
  executionInstructions: string;
}
