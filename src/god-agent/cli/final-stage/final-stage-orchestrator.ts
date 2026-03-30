/**
 * FinalStageOrchestrator - Coordinates Phase 8 Final Assembly
 *
 * Implements SPEC-TECH-001 Section 2.1
 * Addresses gaps: GAP-H012 (CLI), GAP-C007 (Output Structure)
 *
 * State Machine:
 * IDLE -> INITIALIZING -> SCANNING -> SUMMARIZING -> MAPPING ->
 * WRITING -> COMBINING -> VALIDATING -> COMPLETED | FAILED
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type {
  FinalStageState,
  FinalStageOptions,
  FinalStageResult,
  ProgressCallback,
  ProgressReport,
  TokenBudget,
  SemanticMapperOutput,
  OutputScannerOutput,
  ChapterWriterOutput,
  AgentOutputSummary,
  ChapterDefinition,
  StyleCharacteristics,
  ChapterNumber,
  FinalStageErrorCode,
  Phase8PrepareResult,
  ClaudeCodeChapterPrompt
} from './types.js';
import { FinalStageError } from './types.js';
import { SummaryExtractor } from './summary-extractor.js';
import { SemanticMapper } from './semantic-mapper.js';
import { ChapterWriterAgent } from './chapter-writer-agent.js';
import { PaperCombiner } from './paper-combiner.js';
import { StyleApplier } from './style-applier.js';
import { ProgressLogger } from './progress-logger.js';
import type { LogLevel } from './progress-logger.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel as ObsLogLevel } from '../../core/observability/index.js';

const orchLogger = createComponentLogger('FinalStageOrchestrator', {
  minLevel: ObsLogLevel.INFO,
  handlers: [new ConsoleLogHandler()]
});

// ============================================
// Type Definitions for Chapter Structure
// ============================================

/**
 * Chapter structure from 05-chapter-structure.md
 * Per SPEC-FUNC-001 Section 2.2
 */
interface ChapterStructure {
  /** MUST be true per DI-001 */
  locked: boolean;
  /** ISO date when locked */
  generatedAt: string;
  /** Dynamic: 5-12 chapters based on research scope */
  totalChapters: number;
  /** Estimated total words */
  estimatedTotalWords: number;
  /** Chapter definitions */
  chapters: ChapterDefinition[];
  /** Writer agent mapping */
  writerMapping: Record<string, string>;
  /** Research title (optional) */
  researchTitle?: string;
}

// ============================================
// Valid State Transitions
// ============================================

const VALID_STATE_TRANSITIONS: Record<FinalStageState, FinalStageState[]> = {
  'IDLE': ['INITIALIZING'],
  'INITIALIZING': ['SCANNING', 'FAILED'],
  'SCANNING': ['SUMMARIZING', 'FAILED'],
  'SUMMARIZING': ['MAPPING', 'FAILED'],
  'MAPPING': ['WRITING', 'COMPLETED', 'FAILED'], // COMPLETED for dry-run
  'WRITING': ['COMBINING', 'FAILED'],
  'COMBINING': ['VALIDATING', 'FAILED'],
  'VALIDATING': ['COMPLETED', 'FAILED'],
  'COMPLETED': [],
  'FAILED': []
};

// ============================================
// Exit Codes per CONSTITUTION Appendix B
// ============================================

const EXIT_CODES = {
  SUCCESS: 0,
  PARTIAL_SUCCESS: 1,    // OUTPUT_EXISTS, WRITE_ERROR
  NO_RESEARCH_DIR: 2,    // NO_RESEARCH_DIR, SCAN_FAILED
  TOKEN_OVERFLOW: 3,     // TOKEN_OVERFLOW
  NO_SOURCES: 4,         // MAPPING_FAILED, NO_SOURCES
  VALIDATION_FAILED: 5,  // STYLE_ERROR, VALIDATION_FAILED
  SECURITY_VIOLATION: 6, // SECURITY_VIOLATION
  CONSTITUTION_VIOLATION: 7 // CONSTITUTION_VIOLATION
} as const;

// ============================================
// Recovery Strategy Types and Matrix
// ============================================

type RecoveryStrategyType = 'retry' | 'skip' | 'fallback' | 'abort';

interface RecoveryStrategy {
  code: FinalStageErrorCode;
  recoverable: boolean;
  strategy: RecoveryStrategyType;
  maxRetries?: number;
  description: string;
}

/**
 * Recovery strategies per SPEC-FUNC-001 Section 4 Error Handling
 * Defines how each error type should be handled
 */
const RECOVERY_STRATEGIES: RecoveryStrategy[] = [
  {
    code: 'OUTPUT_EXISTS',
    recoverable: true,
    strategy: 'skip',
    description: 'Output exists - use --force to overwrite'
  },
  {
    code: 'SCAN_FAILED',
    recoverable: true,
    strategy: 'retry',
    maxRetries: 2,
    description: 'Scan failed - retry with reduced scope'
  },
  {
    code: 'NO_SOURCES',
    recoverable: true,
    strategy: 'fallback',
    description: 'No sources found - use heuristic mapping'
  },
  {
    code: 'MAPPING_FAILED',
    recoverable: true,
    strategy: 'fallback',
    description: 'Mapping failed - apply fallback heuristics'
  },
  {
    code: 'WRITE_ERROR',
    recoverable: true,
    strategy: 'retry',
    maxRetries: 1,
    description: 'Write error - retry once'
  },
  {
    code: 'TOKEN_OVERFLOW',
    recoverable: false,
    strategy: 'abort',
    description: 'Token budget exceeded - cannot recover'
  },
  {
    code: 'STYLE_ERROR',
    recoverable: true,
    strategy: 'skip',
    description: 'Style error - continue without style application'
  },
  {
    code: 'VALIDATION_FAILED',
    recoverable: true,
    strategy: 'skip',
    description: 'Validation failed - warn only, continue'
  },
  {
    code: 'SECURITY_VIOLATION',
    recoverable: false,
    strategy: 'abort',
    description: 'Security violation - immediate abort required'
  },
  {
    code: 'CONSTITUTION_VIOLATION',
    recoverable: false,
    strategy: 'abort',
    description: 'Constitution violation - immediate abort required'
  },
  {
    code: 'NO_RESEARCH_DIR',
    recoverable: false,
    strategy: 'abort',
    description: 'Research directory not found - cannot proceed'
  }
];

// ============================================
// Default Token Budget Configuration
// ============================================

const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  limit: 200000,
  phases: {
    summaryExtraction: { allocated: 90000, used: 0, remaining: 90000 },
    mapping: { allocated: 10000, used: 0, remaining: 10000 },
    chapterWriting: { allocatedPerChapter: 22500, used: [] }, // 180K / 8 chapters
    combination: { allocated: 20000, used: 0, remaining: 20000 }
  },
  total: { used: 0, budget: 200000, utilization: '0%' }
};

// ============================================
// FinalStageOrchestrator Class
// ============================================

/**
 * FinalStageOrchestrator - Coordinates Phase 8 final assembly
 *
 * Responsibilities:
 * - Load chapter structure from 05-chapter-structure.md
 * - Scan and summarize 45 agent output files
 * - Map outputs to chapters using semantic similarity
 * - Generate N chapter files using ChapterWriterAgent (N from structure, 5-12)
 * - Combine into final paper with ToC
 * - Track token usage and progress
 *
 * Constitution Rules:
 * - FS-001: Outputs to final/ directories only
 * - FS-002: Never write to root folder
 * - FS-005: Archive before overwrite
 * - EX-001: Valid state machine transitions
 * - EX-004: Progress reporting hooks
 */
export class FinalStageOrchestrator {
  // ============================================
  // Private Fields
  // ============================================

  private readonly basePath: string;
  private readonly slug: string;
  private readonly researchDir: string;
  private readonly outputDir: string;

  private state: FinalStageState = 'IDLE';
  private tokenBudget: TokenBudget;
  private startTime: number = 0;
  private verbose: boolean = false;

  // Multiple callback support per GAP-H004
  private progressCallbacks: ProgressCallback[] = [];

  // Structured logging per EX-003
  private logger: ProgressLogger | null = null;

  // Phase timing tracking per TASK-010
  private phaseTimings: Record<string, number> = {};

  // Warning accumulator for tracking recoverable issues
  private warnings: string[] = [];

  // Current execution options (stored for cleanup/recovery access)
  private options: FinalStageOptions | null = null;

  // Component instances (wired in TASK-009)
  private summaryExtractor: SummaryExtractor;
  private semanticMapper: SemanticMapper;
  private chapterWriter: ChapterWriterAgent | null = null;  // Created lazily with style profile
  private paperCombiner: PaperCombiner;
  private styleApplier: StyleApplier;

  // Style profile ID (passed to ChapterWriterAgent for LLM synthesis)
  // CRITICAL: This MUST be set for proper academic writing output
  private _styleProfileId: string | null = null;

  // Style profile (loaded during initialization)
  // Used internally by writeChapters and exposed via getStyleProfile()
  private _styleProfile: StyleCharacteristics | null = null;

  // Research query (extracted from structure or slug)
  // Used for metadata generation and exposed via getResearchQuery()
  private _researchQuery: string = '';

  // Cached intermediate results for prompt generation
  // Populated during execute() or initialize()
  private _chapterStructure: ChapterStructure | null = null;
  private _summaries: AgentOutputSummary[] | null = null;
  private _mapping: SemanticMapperOutput | null = null;

  // ============================================
  // Constructor
  // ============================================

  /**
   * Create a new FinalStageOrchestrator
   *
   * @param basePath - Base path for the project (typically process.cwd())
   * @param slug - Research session slug (folder name under docs/research/)
   * @throws FinalStageError if slug is invalid (security violation)
   */
  constructor(basePath: string, slug: string) {
    // SECURITY (S002): Validate slug before use in paths
    const slugValidation = this.validateSlug(slug);
    if (!slugValidation.valid) {
      throw new FinalStageError(
        `Invalid research slug: ${slugValidation.error}`,
        'SECURITY_VIOLATION',
        false,
        FinalStageError.getExitCode('SECURITY_VIOLATION')
      );
    }

    this.basePath = basePath;
    this.slug = slug;
    this.researchDir = path.join(basePath, 'docs/research', slug);
    this.outputDir = path.join(this.researchDir, 'final');

    this.tokenBudget = this.initializeTokenBudget();

    // Initialize most components (TASK-009 wiring)
    // NOTE: ChapterWriterAgent is created lazily in getChapterWriter()
    // to ensure style profile ID is available for LLM synthesis
    this.summaryExtractor = new SummaryExtractor(this.researchDir);
    this.semanticMapper = new SemanticMapper();
    // this.chapterWriter is created lazily with style profile
    this.paperCombiner = new PaperCombiner();
    this.styleApplier = new StyleApplier();
    this._researchQuery = slug;
  }

  /**
   * Get ChapterWriterAgent, creating it lazily with style profile ID
   *
   * CRITICAL: This ensures the style profile is always passed to the writer
   * for proper LLM-based academic prose synthesis.
   */
  private getChapterWriter(): ChapterWriterAgent {
    if (!this.chapterWriter) {
      orchLogger.info('Creating ChapterWriterAgent', { styleProfileId: this._styleProfileId || 'none' });
      this.chapterWriter = new ChapterWriterAgent(
        this._styleProfileId || undefined,
        this.researchDir || undefined
      );
    }
    return this.chapterWriter;
  }

  // ============================================
  // Public Getters
  // ============================================

  /**
   * Get the current style profile
   */
  getStyleProfile(): StyleCharacteristics | null {
    return this._styleProfile;
  }

  /**
   * Get the research query/title
   */
  getResearchQuery(): string {
    return this._researchQuery;
  }

  /**
   * Get the cached chapter structure (available after INITIALIZING phase)
   * Used by CLI for --generate-prompts
   */
  getChapterStructure(): ChapterStructure | null {
    return this._chapterStructure;
  }

  /**
   * Get the cached summaries (available after SUMMARIZING phase)
   * Used by CLI for --generate-prompts
   */
  getSummaries(): AgentOutputSummary[] | null {
    return this._summaries;
  }

  /**
   * Get the cached semantic mapping (available after MAPPING phase)
   * Used by CLI for --generate-prompts
   */
  getMapping(): SemanticMapperOutput | null {
    return this._mapping;
  }

  // ============================================
  // Public Methods
  // ============================================

  /**
   * Execute the complete Phase 8 pipeline
   *
   * State Machine: IDLE -> INITIALIZING -> SCANNING -> SUMMARIZING ->
   *                MAPPING -> WRITING -> COMBINING -> VALIDATING -> COMPLETED
   *
   * @param options - Execution options (force, dryRun, threshold, etc.)
   * @returns FinalStageResult with output paths and metadata
   * @throws FinalStageError on non-recoverable failures
   */
  async execute(options: FinalStageOptions = {}): Promise<FinalStageResult> {
    this.startTime = Date.now();
    this.verbose = options.verbose ?? false;

    // Store options for cleanup/recovery access (TASK-011)
    this.options = options;

    // Reset warnings accumulator for this execution
    this.warnings = [];

    const errors: string[] = [];
    const warnings: string[] = [];

    // Initialize logger for this execution
    this.logger = new ProgressLogger({ verbose: this.verbose, outputDir: null });

    try {
      // ========================================
      // Phase 8.0: Initialize
      // ========================================
      this.setState('INITIALIZING');
      this.startPhaseTimer('INITIALIZING');

      // INITIALIZING phase progress: loading structure
      this.emitProgress({
        phase: 'INITIALIZING',
        message: 'Loading chapter structure...',
        current: -1,
        total: -1,
        elapsedMs: Date.now() - this.startTime
      });

      await this.initialize(options);

      // Initialize file logging if output directory exists
      if (this.verbose) {
        try {
          await this.logger.initFileLogging(this.outputDir);
        } catch {
          // INTENTIONAL: Non-fatal - file logging is optional, continue without it
        }
      }

      // Phase 8.1: Load chapter structure
      this.log('info', 'Loading chapter structure');
      const structure = await this.loadChapterStructure();
      this._chapterStructure = structure;
      this.log('debug', `Loaded ${structure.totalChapters} chapters`, {
        chapters: structure.totalChapters,
        estimatedWords: structure.estimatedTotalWords
      });

      // Phase 8.2: Load style profile (optional)
      this.emitProgress({
        phase: 'INITIALIZING',
        message: 'Loading style profile...',
        current: -1,
        total: -1,
        elapsedMs: Date.now() - this.startTime
      });
      const style = await this.loadStyleProfile();
      this.log('debug', style ? 'Style profile loaded' : 'No style profile found');

      this.endPhaseTimer('INITIALIZING');

      // ========================================
      // Phase 8.3: Scan output files
      // ========================================
      this.setState('SCANNING');
      this.startPhaseTimer('SCANNING');

      this.emitProgress({
        phase: 'SCANNING',
        message: 'Scanning for output files...',
        current: 0,
        total: 45,
        elapsedMs: Date.now() - this.startTime
      });

      const scanResult = await this.scanOutputFiles();

      // Emit scan result
      this.emitProgress({
        phase: 'SCANNING',
        message: `Found ${scanResult.foundFiles} output files`,
        current: scanResult.foundFiles,
        total: scanResult.totalFiles,
        elapsedMs: Date.now() - this.startTime
      });

      this.log('info', `Scan complete: ${scanResult.foundFiles}/${scanResult.totalFiles} files`, {
        found: scanResult.foundFiles,
        total: scanResult.totalFiles,
        missing: scanResult.missingFiles.length
      });

      if (scanResult.scanStatus === 'failed') {
        throw new FinalStageError(
          `Scan failed: only ${scanResult.foundFiles}/${scanResult.totalFiles} files found`,
          'SCAN_FAILED',
          false,
          FinalStageError.getExitCode('SCAN_FAILED')
        );
      }

      if (scanResult.missingFiles.length > 0) {
        warnings.push(`Missing files: ${scanResult.missingFiles.join(', ')}`);
        this.log('warn', `Missing ${scanResult.missingFiles.length} files`, {
          missingFiles: scanResult.missingFiles
        });
      }

      this.endPhaseTimer('SCANNING');

      // ========================================
      // Phase 8.4: Summarize outputs
      // ========================================
      this.setState('SUMMARIZING');
      this.startPhaseTimer('SUMMARIZING');

      const filesToSummarize = scanResult.summaries.length > 0
        ? scanResult.summaries
        : await this.extractSummaries(scanResult);

      // Emit progress per file
      for (let i = 0; i < filesToSummarize.length; i++) {
        this.emitProgress({
          phase: 'SUMMARIZING',
          message: `Extracting summary: ${filesToSummarize[i]?.fileName ?? `file ${i + 1}`}`,
          current: i + 1,
          total: filesToSummarize.length,
          elapsedMs: Date.now() - this.startTime
        });
      }

      const summaries = filesToSummarize;
      this._summaries = summaries;
      this.updateTokenBudget('summaryExtraction', this.calculateSummaryTokens(summaries));

      this.log('info', `Summarized ${summaries.length} files`, {
        files: summaries.length,
        totalTokens: this.calculateSummaryTokens(summaries)
      });

      this.endPhaseTimer('SUMMARIZING');

      // ========================================
      // Phase 8.5: Semantic mapping
      // ========================================
      this.setState('MAPPING');
      this.startPhaseTimer('MAPPING');

      this.emitProgress({
        phase: 'MAPPING',
        message: `Mapping ${summaries.length} sources to ${structure.chapters.length} chapters`,
        current: -1,
        total: -1,
        elapsedMs: Date.now() - this.startTime
      });

      const mapping = await this.mapOutputsToChapters(
        structure.chapters,
        summaries,
        options.threshold ?? 0.30
      );
      this._mapping = mapping;

      this.log('info', 'Semantic mapping complete', {
        chaptersWithSources: mapping.mappings.filter(m => m.sourceCount > 0).length,
        orphanedSources: mapping.orphanedSources.length,
        avgRelevance: mapping.mappingQuality.avgRelevance
      });

      this.emitProgress({
        phase: 'MAPPING',
        message: `Mapped ${summaries.length} sources, ${mapping.orphanedSources.length} orphaned`,
        current: structure.chapters.length,
        total: structure.chapters.length,
        elapsedMs: Date.now() - this.startTime
      });

      this.endPhaseTimer('MAPPING');

      // Dry-run mode: return mapping without generating chapters
      if (options.dryRun) {
        this.setState('COMPLETED');
        this.log('info', 'Dry run complete - skipping chapter generation');
        return this.createDryRunResult(structure, scanResult, mapping, warnings);
      }

      // ========================================
      // Phase 8.6: Write chapters
      // ========================================
      this.setState('WRITING');
      this.startPhaseTimer('WRITING');

      this.emitProgress({
        phase: 'WRITING',
        message: 'Starting chapter writing...',
        current: 0,
        total: structure.chapters.length,
        elapsedMs: Date.now() - this.startTime
      });

      const chapters = await this.writeChapters(
        structure,
        mapping,
        summaries,
        style,
        options.sequential ?? false
      );

      this.log('info', `Wrote ${chapters.length} chapters`, {
        chapters: chapters.length,
        totalWords: chapters.reduce((sum, ch) => sum + ch.wordCount, 0)
      });

      this.endPhaseTimer('WRITING');

      // ========================================
      // Phase 8.7: Combine into final paper
      // ========================================
      this.setState('COMBINING');
      this.startPhaseTimer('COMBINING');

      this.emitProgress({
        phase: 'COMBINING',
        message: 'Generating table of contents...',
        current: 1,
        total: 3,
        elapsedMs: Date.now() - this.startTime
      });

      this.emitProgress({
        phase: 'COMBINING',
        message: 'Combining chapters into final paper...',
        current: 2,
        total: 3,
        elapsedMs: Date.now() - this.startTime
      });

      const finalPaperPath = await this.combineChapters(chapters, structure);
      this.updateTokenBudget('combination', this.estimateCombinationTokens(chapters));

      this.emitProgress({
        phase: 'COMBINING',
        message: 'Writing output files...',
        current: 3,
        total: 3,
        elapsedMs: Date.now() - this.startTime
      });

      this.log('info', `Final paper created: ${finalPaperPath}`);

      this.endPhaseTimer('COMBINING');

      // ========================================
      // Phase 8.8: Validate outputs
      // ========================================
      this.setState('VALIDATING');
      this.startPhaseTimer('VALIDATING');

      this.emitProgress({
        phase: 'VALIDATING',
        message: 'Running quality checks...',
        current: -1,
        total: -1,
        elapsedMs: Date.now() - this.startTime
      });

      if (!options.skipValidation) {
        const validationWarnings = await this.validateOutputs(chapters);
        warnings.push(...validationWarnings);
        if (validationWarnings.length > 0) {
          this.log('warn', `Validation produced ${validationWarnings.length} warnings`, {
            warnings: validationWarnings
          });
        }
      } else {
        this.log('debug', 'Validation skipped per options');
      }

      this.endPhaseTimer('VALIDATING');

      // ========================================
      // Phase 8.9: Completed
      // ========================================
      this.setState('COMPLETED');

      const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);
      const totalCitations = chapters.reduce((sum, ch) => sum + ch.citations.length, 0);

      this.emitProgress({
        phase: 'COMPLETED',
        message: `Paper complete: ${totalWords.toLocaleString()} words, ${totalCitations} citations`,
        current: -1,
        total: -1,
        elapsedMs: Date.now() - this.startTime
      });

      this.log('info', 'Execution completed successfully', {
        totalWords,
        totalCitations,
        chaptersGenerated: chapters.length,
        elapsedMs: Date.now() - this.startTime
      });

      // Close logger
      if (this.logger) {
        await this.logger.close();
      }

      // Merge accumulated warnings with local warnings (TASK-011)
      const allWarnings = [...this.warnings, ...warnings];

      return this.createSuccessResult(
        finalPaperPath,
        chapters,
        mapping,
        scanResult,
        allWarnings
      );

    } catch (error) {
      // Transition to FAILED state if not already there
      if (this.state !== 'FAILED') {
        this.setState('FAILED');
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('error', `Execution failed: ${errorMessage}`, {
        error: errorMessage,
        elapsedMs: Date.now() - this.startTime
      });

      this.emitProgress({
        phase: 'FAILED',
        message: `Error: ${errorMessage}`,
        current: -1,
        total: -1,
        elapsedMs: Date.now() - this.startTime
      });

      // Cleanup partial outputs on failure (TASK-011)
      await this.cleanup();

      // Close logger
      if (this.logger) {
        await this.logger.close();
      }

      // Build error result using the new method (TASK-011)
      if (error instanceof FinalStageError) {
        // Merge accumulated warnings with local warnings
        const allWarnings = [...this.warnings, ...warnings];
        errors.push(`[${error.code}] ${error.message}`);
        return this.createFailureResult(error, errors, allWarnings);
      }

      // Unknown error - wrap in FinalStageError with WRITE_ERROR code
      const wrappedError = new FinalStageError(errorMessage, 'WRITE_ERROR', false, EXIT_CODES.PARTIAL_SUCCESS);
      const allWarnings = [...this.warnings, ...warnings];
      errors.push(errorMessage);
      return this.createFailureResult(wrappedError, errors, allWarnings);
    }
  }

  /**
   * Register progress callback for real-time updates
   * Per EX-004: Progress reporting hooks must exist
   * Multiple callbacks can be registered
   *
   * @param callback - Function to receive progress reports
   */
  onProgress(callback: ProgressCallback): void {
    this.progressCallbacks.push(callback);
  }

  /**
   * Remove a progress callback
   *
   * @param callback - Callback to remove
   */
  offProgress(callback: ProgressCallback): void {
    const index = this.progressCallbacks.indexOf(callback);
    if (index !== -1) {
      this.progressCallbacks.splice(index, 1);
    }
  }

  /**
   * Clear all progress callbacks
   */
  clearProgressCallbacks(): void {
    this.progressCallbacks.length = 0;
  }

  /**
   * Get current execution state
   * @returns Current FinalStageState
   */
  getState(): FinalStageState {
    return this.state;
  }

  /**
   * Get current token budget status
   * @returns Copy of current TokenBudget
   */
  getTokenBudget(): TokenBudget {
    return JSON.parse(JSON.stringify(this.tokenBudget));
  }

  /**
   * Get phase timing metrics
   * Per TASK-010: Track and report timing per phase
   *
   * @returns Record of phase timing data in milliseconds
   */
  getPhaseTimings(): Record<string, number> {
    return { ...this.phaseTimings };
  }

  /**
   * Get the progress logger instance (for advanced usage)
   *
   * @returns ProgressLogger or null if not initialized
   */
  getLogger(): ProgressLogger | null {
    return this.logger;
  }

  // ============================================
  // Private Methods: State Management
  // ============================================

  /**
   * Transition to a new state with validation
   * Per EX-001: State machine transitions must be valid
   *
   * @param newState - Target state
   * @throws FinalStageError if transition is invalid
   */
  private setState(newState: FinalStageState): void {
    const validTransitions = VALID_STATE_TRANSITIONS[this.state];

    if (!validTransitions.includes(newState)) {
      throw new FinalStageError(
        `Invalid state transition: ${this.state} -> ${newState}. Valid: ${validTransitions.join(', ')}`,
        'CONSTITUTION_VIOLATION',
        false,
        FinalStageError.getExitCode('CONSTITUTION_VIOLATION')
      );
    }

    const previousState = this.state;
    this.state = newState;

    this.reportProgress(
      `State transition: ${previousState} -> ${newState}`,
      -1,
      -1
    );
  }

  /**
   * Emit progress to all registered callbacks
   * Per EX-004: Progress reporting hooks
   *
   * @param report - Progress report to emit
   */
  private emitProgress(report: ProgressReport): void {
    for (const callback of this.progressCallbacks) {
      try {
        callback(report);
      } catch (e) {
        // Don't let callback errors break execution
        // Log but continue
        if (this.verbose) {
          orchLogger.error('Progress callback error', e instanceof Error ? e : new Error(String(e)));
        }
      }
    }

    // Also log to logger if available
    if (this.logger) {
      this.logger.emitProgress(report);
    }
  }

  /**
   * Report progress to all callbacks
   * Per EX-004: Progress reporting hooks
   *
   * @param message - Human-readable progress message
   * @param current - Current progress value (-1 if not applicable)
   * @param total - Total progress value (-1 if not applicable)
   */
  private reportProgress(message: string, current: number, total: number): void {
    const report: ProgressReport = {
      phase: this.state,
      message,
      current,
      total,
      elapsedMs: Date.now() - this.startTime
    };
    this.emitProgress(report);
  }

  /**
   * Structured logging with levels
   * Per EX-003: Log all state transitions
   *
   * @param level - Log level (debug, info, warn, error)
   * @param message - Log message
   * @param data - Optional additional data
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>): void {
    if (!this.verbose && level === 'debug') return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      phase: this.state,
      message,
      elapsedMs: Date.now() - this.startTime,
      ...data
    };

    // Output based on level
    if (level === 'error') {
      console.error(JSON.stringify(logEntry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(logEntry));
    } else if (this.verbose) {
      console.log(JSON.stringify(logEntry));
    }

    // Also log via logger if available
    if (this.logger) {
      const logLevel = level.toUpperCase() as LogLevel;
      this.logger.log(logLevel, this.state, message, data);
    }
  }

  /**
   * Start timing a phase
   *
   * @param phase - Phase name
   */
  private startPhaseTimer(phase: string): void {
    this.phaseTimings[`${phase}_start`] = Date.now();
    if (this.logger) {
      this.logger.startPhase(phase as FinalStageState);
    }
  }

  /**
   * End timing for a phase
   *
   * @param phase - Phase name
   */
  private endPhaseTimer(phase: string): void {
    const start = this.phaseTimings[`${phase}_start`];
    if (start) {
      this.phaseTimings[`${phase}_duration`] = Date.now() - start;
      if (this.logger) {
        this.logger.endPhase(phase as FinalStageState);
      }
    }
  }

  // ============================================
  // Private Methods: Error Recovery (TASK-011)
  // ============================================

  /**
   * Get recovery strategy for a given error code
   * Per SPEC-FUNC-001 Section 4 Error Handling
   *
   * @param code - Error code to look up
   * @returns Recovery strategy or default abort strategy
   */
  private getRecoveryStrategy(code: FinalStageErrorCode): RecoveryStrategy {
    const strategy = RECOVERY_STRATEGIES.find(s => s.code === code);
    if (strategy) {
      return strategy;
    }
    // Default to abort for unknown error codes
    return {
      code,
      recoverable: false,
      strategy: 'abort',
      description: `Unknown error: ${code}`
    };
  }

  /**
   * Execute a phase with error handling and recovery
   * Per CONSTITUTION EX-002 and SPEC-FUNC-001 Section 4
   *
   * Implements try-catch wrappers with:
   * - Retry logic for recoverable errors
   * - Fallback actions where applicable
   * - Skip strategy for non-critical errors
   * - Abort for non-recoverable errors
   *
   * @param phase - Phase to execute
   * @param operation - Async operation to execute
   * @param errorCode - Error code to use if operation fails
   * @param fallbackAction - Optional fallback action for recoverable errors
   * @returns Result of operation or null if skipped
   *
   * @remarks This method is available for use by subclasses or future refactoring
   * to wrap individual phase executions with standardized error handling.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async safeExecutePhase<T>(
    phase: FinalStageState,
    operation: () => Promise<T>,
    errorCode: FinalStageErrorCode,
    fallbackAction?: () => Promise<T>
  ): Promise<T | null> {
    const strategy = this.getRecoveryStrategy(errorCode);

    try {
      this.setState(phase);
      return await operation();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Log the error
      this.log('error', `Phase ${phase} failed: ${errorMessage}`, {
        errorCode,
        recoverable: strategy.recoverable,
        strategy: strategy.strategy
      });

      // If error is already a FinalStageError with non-recoverable code, re-throw
      if (error instanceof FinalStageError && !error.recoverable) {
        throw error;
      }

      // Handle based on recovery strategy
      if (strategy.recoverable) {
        switch (strategy.strategy) {
          case 'retry': {
            const maxRetries = strategy.maxRetries ?? 1;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              this.log('warn', `Retry ${attempt}/${maxRetries} for phase ${phase}`);
              this.warnings.push(`${phase}: Retry ${attempt}/${maxRetries} after error: ${errorMessage}`);
              try {
                return await operation();
              } catch (retryError) {
                const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
                this.log('warn', `Retry ${attempt} failed: ${retryMessage}`);
                if (attempt === maxRetries) {
                  // All retries exhausted, try fallback if available
                  if (fallbackAction) {
                    this.log('info', `Applying fallback action for ${phase}`);
                    try {
                      return await fallbackAction();
                    } catch (fallbackError) {
                      // Fallback also failed, record and continue to abort/skip
                      this.log('error', `Fallback failed for ${phase}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
                    }
                  }
                }
              }
            }
            break;
          }

          case 'fallback': {
            if (fallbackAction) {
              this.log('info', `Applying fallback action for ${phase}`);
              this.warnings.push(`${phase}: Using fallback due to error: ${errorMessage}`);
              try {
                return await fallbackAction();
              } catch (fallbackError) {
                this.log('error', `Fallback failed for ${phase}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
              }
            }
            break;
          }

          case 'skip': {
            // Log warning and continue
            this.log('warn', `Skipping ${phase} due to recoverable error: ${errorMessage}`);
            this.warnings.push(`${phase}: Skipped due to error: ${errorMessage}`);
            return null;
          }

          case 'abort':
          default:
            // Fall through to abort handling
            break;
        }
      }

      // Non-recoverable or all recovery attempts failed - transition to FAILED and throw
      this.setState('FAILED');
      throw new FinalStageError(
        errorMessage,
        errorCode,
        false,
        FinalStageError.getExitCode(errorCode)
      );
    }
  }

  /**
   * Cleanup partial outputs on failure
   * Per CONSTITUTION FS-003: Cleanup partial outputs on failure
   *
   * Only removes partial outputs if:
   * - Current state is FAILED
   * - Not in dry-run mode
   * - Output directory exists
   */
  private async cleanup(): Promise<void> {
    // Only cleanup if we're in a failed state
    if (this.state !== 'FAILED') {
      return;
    }

    // Don't cleanup in dry-run mode
    if (this.options?.dryRun) {
      this.log('debug', 'Skipping cleanup in dry-run mode');
      return;
    }

    const partialOutputDir = path.join(this.outputDir, 'chapters');
    try {
      const exists = await this.directoryExists(partialOutputDir);
      if (exists) {
        this.log('info', 'Cleaning up partial outputs after failure');

        // Read directory to check for partial files
        const files = await fs.readdir(partialOutputDir);
        if (files.length > 0) {
          // Move partial outputs to a failed-runs archive instead of deleting
          const failedRunsDir = path.join(this.researchDir, 'failed-runs');
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const failedArchive = path.join(failedRunsDir, timestamp);

          await fs.mkdir(failedArchive, { recursive: true });
          await fs.rename(this.outputDir, path.join(failedArchive, 'final'));

          this.log('info', `Partial outputs archived to: ${failedArchive}`);

          // Prune old failed runs (keep only last 3)
          await this.pruneArchives(failedRunsDir, 3);
        }
      }
    } catch (cleanupError) {
      // Non-fatal: log but don't throw
      this.log('warn', `Cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
  }

  /**
   * Build error result with comprehensive error info
   * Per TASK-011: Result builder with error info
   *
   * @param error - The error that caused failure
   * @returns FinalStageResult with error details
   *
   * @remarks This method provides an alternative way to build error results
   * and is available for use by subclasses or alternative error handling paths.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected buildErrorResult(error: FinalStageError): FinalStageResult {
    return {
      success: false,
      dryRun: this.options?.dryRun ?? false,
      outputPath: null,
      totalWords: 0,
      totalCitations: 0,
      chaptersGenerated: 0,
      mapping: null,
      warnings: [...this.warnings],
      errors: [`[${error.code}] ${error.message}`],
      metadata: this.tokenBudget,
      exitCode: error.exitCode ?? FinalStageError.getExitCode(error.code)
    };
  }

  // ============================================
  // Private Methods: Initialization
  // ============================================

  /**
   * Initialize the orchestrator for execution
   * Per FS-005: Archive before overwrite
   *
   * @param options - Execution options
   * @throws FinalStageError if research directory doesn't exist or output exists without --force
   */
  private async initialize(options: FinalStageOptions): Promise<void> {
    // Check research directory exists
    if (!await this.directoryExists(this.researchDir)) {
      throw new FinalStageError(
        `Research directory not found: ${this.researchDir}`,
        'NO_RESEARCH_DIR',
        false,
        FinalStageError.getExitCode('NO_RESEARCH_DIR')
      );
    }

    // Check if output directory already exists
    const outputExists = await this.directoryExists(this.outputDir);

    if (outputExists) {
      if (options.force) {
        // Archive existing output per FS-005
        await this.archiveExistingOutput();
      } else {
        throw new FinalStageError(
          `Output directory exists: ${this.outputDir}. Use --force to overwrite.`,
          'OUTPUT_EXISTS',
          true,
          FinalStageError.getExitCode('OUTPUT_EXISTS')
        );
      }
    }

    // Create output directories per FS-001
    await fs.mkdir(this.outputDir, { recursive: true });
    await fs.mkdir(path.join(this.outputDir, 'chapters'), { recursive: true });
  }

  /**
   * Check if a directory exists
   *
   * @param dir - Directory path to check
   * @returns true if directory exists
   */
  private async directoryExists(dir: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dir);
      return stat.isDirectory();
    } catch {
      // INTENTIONAL: Directory stat failure means directory doesn't exist - false is correct
      return false;
    }
  }

  /**
   * Archive existing output directory
   * Per FS-005: Archive before overwrite
   * Retains only the last 5 archived versions
   */
  private async archiveExistingOutput(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archiveBaseDir = path.join(this.researchDir, 'final-archive');
    const archiveDir = path.join(archiveBaseDir, timestamp);

    // Create archive directory
    await fs.mkdir(archiveBaseDir, { recursive: true });

    // Move current output to archive
    await fs.rename(this.outputDir, archiveDir);

    // Prune old archives (keep only last 5)
    await this.pruneArchives(archiveBaseDir, 5);
  }

  /**
   * Prune archive directories, keeping only the most recent
   *
   * @param archiveDir - Base archive directory
   * @param keepCount - Number of archives to retain
   */
  private async pruneArchives(archiveDir: string, keepCount: number): Promise<void> {
    try {
      const entries = await fs.readdir(archiveDir, { withFileTypes: true });
      const dirs = entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
        .reverse();

      // Remove oldest archives beyond keepCount
      for (let i = keepCount; i < dirs.length; i++) {
        await fs.rm(path.join(archiveDir, dirs[i]), { recursive: true, force: true });
      }
    } catch {
      // INTENTIONAL: Archive pruning is non-critical - errors during cleanup are acceptable
    }
  }

  // ============================================
  // Private Methods: Token Budget
  // ============================================

  /**
   * Initialize token budget with default allocations
   * @returns Initialized TokenBudget
   */
  private initializeTokenBudget(): TokenBudget {
    return JSON.parse(JSON.stringify(DEFAULT_TOKEN_BUDGET));
  }

  /**
   * Update token budget for a specific phase
   *
   * @param phase - Phase name
   * @param tokens - Tokens used
   */
  private updateTokenBudget(phase: string, tokens: number): void {
    if (phase === 'summaryExtraction') {
      this.tokenBudget.phases.summaryExtraction.used = tokens;
      this.tokenBudget.phases.summaryExtraction.remaining =
        this.tokenBudget.phases.summaryExtraction.allocated - tokens;
    } else if (phase === 'mapping') {
      this.tokenBudget.phases.mapping.used = tokens;
      this.tokenBudget.phases.mapping.remaining =
        this.tokenBudget.phases.mapping.allocated - tokens;
    } else if (phase === 'combination') {
      this.tokenBudget.phases.combination.used = tokens;
      this.tokenBudget.phases.combination.remaining =
        this.tokenBudget.phases.combination.allocated - tokens;
    } else if (phase.startsWith('chapter')) {
      const chapterNum = parseInt(phase.replace('chapter', ''), 10);
      if (!isNaN(chapterNum) && chapterNum >= 1) {
        const idx = chapterNum - 1;
        while (this.tokenBudget.phases.chapterWriting.used.length <= idx) {
          this.tokenBudget.phases.chapterWriting.used.push(0);
        }
        this.tokenBudget.phases.chapterWriting.used[idx] = tokens;
      }
    }

    // Update totals
    const totalUsed =
      this.tokenBudget.phases.summaryExtraction.used +
      this.tokenBudget.phases.mapping.used +
      this.tokenBudget.phases.chapterWriting.used.reduce((a, b) => a + b, 0) +
      this.tokenBudget.phases.combination.used;

    this.tokenBudget.total.used = totalUsed;
    this.tokenBudget.total.utilization =
      `${((totalUsed / this.tokenBudget.total.budget) * 100).toFixed(1)}%`;

    // Check for token overflow
    if (totalUsed > this.tokenBudget.limit) {
      throw new FinalStageError(
        `Token budget exceeded: ${totalUsed} > ${this.tokenBudget.limit}`,
        'TOKEN_OVERFLOW',
        false,
        FinalStageError.getExitCode('TOKEN_OVERFLOW')
      );
    }
  }

  // ============================================
  // Private Methods: Validation
  // ============================================

  /**
   * Validate research slug for security (S002)
   * Prevents path traversal and injection attacks
   *
   * @param slug - Slug to validate
   * @returns Validation result with error message if invalid
   */
  private validateSlug(slug: string): { valid: boolean; error?: string } {
    // Must be lowercase alphanumeric with dashes, 3+ chars
    if (slug.length < 1) {
      return { valid: false, error: 'Slug cannot be empty' };
    }

    if (slug.length > 64) {
      return { valid: false, error: 'Slug exceeds 64 character limit' };
    }

    // Allow single/double character slugs OR standard format
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && !/^[a-z0-9]{1,2}$/.test(slug)) {
      return {
        valid: false,
        error: 'Slug must be lowercase alphanumeric with dashes, starting and ending with alphanumeric'
      };
    }

    if (slug.includes('--')) {
      return { valid: false, error: 'Slug cannot contain consecutive dashes' };
    }

    // Prevent path traversal patterns
    if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
      return { valid: false, error: 'Slug contains invalid path characters' };
    }

    return { valid: true };
  }

  /**
   * Slugify a title for file naming (CC004 - FS-003 compliance)
   *
   * @param title - Title to slugify
   * @returns Slugified string safe for filenames
   */
  protected slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')  // Remove special chars except spaces
      .trim()
      .replace(/\s+/g, '-')          // Spaces to dashes
      .substring(0, 50);             // Max 50 chars
  }

  // ============================================
  // Private Methods: Phase Stubs (TASK-004-008)
  // ============================================

  /**
   * Load chapter structure from 05-chapter-structure.md
   * WIRED: Parses locked structure from markdown file (TASK-009)
   *
   * @returns Parsed chapter structure
   */
  private async loadChapterStructure(): Promise<ChapterStructure> {
    // Try primary file first, then fallback to dissertation-architect
    const primaryPath = path.join(this.researchDir, '05-chapter-structure.md');
    const fallbackPath = path.join(this.researchDir, '05-dissertation-architect.md');

    // Verify file exists - try primary, then fallback
    let content: string;
    let usedPath: string;
    try {
      content = await fs.readFile(primaryPath, 'utf-8');
      usedPath = primaryPath;
    } catch {
      // Try fallback path (dissertation-architect also contains chapter structure)
      try {
        content = await fs.readFile(fallbackPath, 'utf-8');
        usedPath = fallbackPath;
      } catch {
        // INTENTIONAL: Neither file exists - throw descriptive error for user
        throw new FinalStageError(
          `Chapter structure not found. Tried:\n  - ${primaryPath}\n  - ${fallbackPath}\nRun dissertation-architect first.`,
          'NO_SOURCES',
          false,
          FinalStageError.getExitCode('NO_SOURCES')
        );
      }
    }

    // Extract JSON from markdown code block
    const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);

        // Validate required fields
        if (!parsed.locked) {
          throw new FinalStageError(
            'Chapter structure is not locked. Lock structure before final assembly.',
            'CONSTITUTION_VIOLATION',
            false,
            FinalStageError.getExitCode('CONSTITUTION_VIOLATION')
          );
        }

        // Build ChapterStructure from parsed JSON
        // Handle both field name conventions: wordTarget/targetWords, citationTarget/targetCitations, assignedAgent/writerAgent
        const chapters: ChapterDefinition[] = (parsed.chapters || []).map((ch: Record<string, unknown>) => ({
          number: ch.number as ChapterNumber,
          title: ch.title as string || '',
          purpose: ch.purpose as string || '',
          sections: (ch.sections as string[]) || [],
          sectionTitles: (ch.sectionTitles as string[]) || [],
          wordTarget: (ch.wordTarget as number) || (ch.targetWords as number) || 5000,
          citationTarget: (ch.citationTarget as number) || (ch.targetCitations as number) || 20,
          questionsAddressed: (ch.questionsAddressed as string[]) || [],
          assignedAgent: (ch.assignedAgent as string) || (ch.writerAgent as string) || 'chapter-writer',
          keywords: (ch.keywords as string[]) || this.extractKeywordsFromChapter(ch)
        }));

        // Update research query from structure if available
        if (parsed.researchTitle) {
          this._researchQuery = parsed.researchTitle as string;
        }

        return {
          locked: parsed.locked as boolean,
          generatedAt: parsed.generatedAt as string || parsed.dateLocked as string || new Date().toISOString(),
          totalChapters: chapters.length,
          estimatedTotalWords: chapters.reduce((sum, ch) => sum + ch.wordTarget, 0),
          chapters,
          writerMapping: parsed.writerMapping as Record<string, string> || {},
          researchTitle: parsed.researchTitle as string || this.slug
        };
      } catch (e) {
        if (e instanceof FinalStageError) throw e;
        throw new FinalStageError(
          `Failed to parse chapter structure JSON: ${e instanceof Error ? e.message : String(e)}`,
          'NO_SOURCES',
          false,
          FinalStageError.getExitCode('NO_SOURCES')
        );
      }
    }

    // Fallback: Try to extract structure from markdown headings
    return this.parseChapterStructureFromMarkdown(content);
  }

  /**
   * Load synthesis guidance from 06-chapter-synthesizer.md
   * This provides detailed writing guidance for each chapter including:
   * - Research question mappings
   * - Construct definitions
   * - Anti-pattern highlighting
   * - Synthesis approach and narrative arc
   *
   * @returns Synthesis guidance content or null if not available
   */
  private async loadSynthesisGuidance(): Promise<string | null> {
    const guidancePath = path.join(this.researchDir, '06-chapter-synthesizer.md');

    try {
      const content = await fs.readFile(guidancePath, 'utf-8');
      orchLogger.info('Loaded synthesis guidance from 06-chapter-synthesizer.md');
      return content;
    } catch {
      // Synthesis guidance is optional - log and continue
      orchLogger.debug('No synthesis guidance found at', { path: guidancePath });
      return null;
    }
  }

  /**
   * Extract chapter-specific synthesis guidance from the full guidance document
   *
   * @param fullGuidance - Full synthesis guidance content
   * @param chapterNumber - Chapter number to extract guidance for
   * @returns Chapter-specific guidance or null
   */
  private extractChapterGuidance(fullGuidance: string, chapterNumber: number): string | null {
    // Look for chapter-specific section: ## Chapter N: or ### Chapter N
    const chapterPattern = new RegExp(
      `(?:##|###)\\s*Chapter\\s+${chapterNumber}[:\\s]([\\s\\S]*?)(?=(?:##|###)\\s*Chapter\\s+\\d|$)`,
      'i'
    );

    const match = fullGuidance.match(chapterPattern);
    if (match && match[1]) {
      return match[1].trim();
    }

    return null;
  }

  /**
   * Extract keywords from chapter definition
   */
  private extractKeywordsFromChapter(ch: Record<string, unknown>): string[] {
    const keywords: string[] = [];
    const title = (ch.title as string) || '';
    const purpose = (ch.purpose as string) || '';

    // Extract from title (split on spaces, filter stopwords)
    const titleWords = title.toLowerCase().split(/\s+/).filter(w =>
      w.length > 3 && !['the', 'and', 'for', 'with', 'from'].includes(w)
    );
    keywords.push(...titleWords);

    // Extract from purpose
    const purposeWords = purpose.toLowerCase().split(/\s+/).filter(w =>
      w.length > 4 && !['the', 'and', 'for', 'with', 'from', 'this', 'that'].includes(w)
    ).slice(0, 10);
    keywords.push(...purposeWords);

    return [...new Set(keywords)];
  }

  /**
   * Parse chapter structure from markdown headings when JSON not available
   */
  private parseChapterStructureFromMarkdown(content: string): ChapterStructure {
    const chapters: ChapterDefinition[] = [];

    // Match chapter headings: ## Chapter N: Title
    const chapterMatches = content.matchAll(/##\s*Chapter\s+(\d+):\s*([^\n]+)/gi);

    for (const match of chapterMatches) {
      const number = parseInt(match[1], 10) as ChapterNumber;
      const title = match[2].trim();

      chapters.push({
        number,
        title,
        purpose: '',
        sections: [`${number}.1`, `${number}.2`, `${number}.3`],
        sectionTitles: ['Introduction', 'Main Content', 'Summary'],
        wordTarget: 5000,
        citationTarget: 20,
        questionsAddressed: [],
        assignedAgent: 'chapter-writer',
        keywords: this.extractKeywordsFromChapter({ title, purpose: '' })
      });
    }

    // If no chapters found, create default structure
    if (chapters.length === 0) {
      for (let i = 1; i <= 8; i++) {
        chapters.push({
          number: i as ChapterNumber,
          title: `Chapter ${i}`,
          purpose: '',
          sections: [`${i}.1`, `${i}.2`, `${i}.3`],
          sectionTitles: ['Introduction', 'Main Content', 'Summary'],
          wordTarget: 5000,
          citationTarget: 20,
          questionsAddressed: [],
          assignedAgent: 'chapter-writer',
          keywords: []
        });
      }
    }

    return {
      locked: true,
      generatedAt: new Date().toISOString(),
      totalChapters: chapters.length,
      estimatedTotalWords: chapters.reduce((sum, ch) => sum + ch.wordTarget, 0),
      chapters,
      writerMapping: {},
      researchTitle: this.slug
    };
  }

  /**
   * Load style profile if available
   * WIRED: Loads JSON style profile from multiple locations (TASK-009)
   *
   * CRITICAL: Also stores the style profile ID for ChapterWriterAgent
   * to use during LLM-based synthesis.
   *
   * Search order:
   * 1. options.styleProfileId (explicit override)
   * 2. .god-agent/style-profiles/<slug>.json
   * 3. <researchDir>/style-profile.json
   * 4. .agentdb/universal/style-profiles.json (academic-papers profile)
   *
   * @returns Style characteristics or null if not found
   */
  private async loadStyleProfile(): Promise<StyleCharacteristics | null> {
    // Check if styleProfileId was passed in options
    if (this.options?.styleProfileId) {
      this._styleProfileId = this.options.styleProfileId;
      this.log('info', `Using explicit style profile ID: ${this._styleProfileId}`);
    }

    // Location 1: Slug-specific profile
    const profilePath = path.join(this.basePath, '.god-agent/style-profiles', `${this.slug}.json`);
    try {
      const content = await fs.readFile(profilePath, 'utf-8');
      const profile = JSON.parse(content) as StyleCharacteristics;
      this._styleProfile = profile;
      this._styleProfileId = this._styleProfileId || this.slug;  // Use slug as ID
      this.log('info', `Loaded style profile from ${profilePath}`);
      return profile;
    } catch {
      // INTENTIONAL: Style profile not at this location - try next search location
    }

    // Location 2: Research directory profile
    const altPath = path.join(this.researchDir, 'style-profile.json');
    try {
      const content = await fs.readFile(altPath, 'utf-8');
      const profile = JSON.parse(content) as StyleCharacteristics;
      this._styleProfile = profile;
      this._styleProfileId = this._styleProfileId || `${this.slug}-local`;  // Use slug-local as ID
      this.log('info', `Loaded style profile from ${altPath}`);
      return profile;
    } catch {
      // INTENTIONAL: Style profile not at this location - try next search location
    }

    // Location 3: AgentDB universal style profiles (look for academic-papers or first en-GB profile)
    const agentDbPath = path.join(this.basePath, '.agentdb/universal/style-profiles.json');
    try {
      const content = await fs.readFile(agentDbPath, 'utf-8');
      const data = JSON.parse(content) as { profiles: Record<string, { characteristics: StyleCharacteristics }> };

      // Find academic-papers profile or any en-GB profile
      for (const [key, value] of Object.entries(data.profiles)) {
        if (key.startsWith('academic-papers') || value.characteristics?.regional?.languageVariant === 'en-GB') {
          this._styleProfile = value.characteristics;
          this._styleProfileId = this._styleProfileId || key;  // Use the profile key as ID
          this.log('info', `Loaded style profile '${key}' from AgentDB (ID: ${this._styleProfileId})`);
          return value.characteristics;
        }
      }
    } catch {
      // INTENTIONAL: AgentDB profiles not available - style profile is optional, use defaults
    }

    // No style profile found
    this._styleProfile = null;
    this.log('debug', 'No style profile found, using defaults');
    return null;
  }

  /**
   * Scan output files in research directory
   * WIRED: Uses SummaryExtractor component (TASK-009)
   *
   * @returns Scanner output with found files
   */
  private async scanOutputFiles(): Promise<OutputScannerOutput> {
    // Use SummaryExtractor to scan and extract summaries
    const scanResult = await this.summaryExtractor.scanOutputFiles({
      researchDirectory: this.researchDir,
      excludePatterns: ['05-chapter-structure.md', 'final/'],
      maxSummaryTokens: 500
    });

    return scanResult;
  }

  /**
   * Extract summaries from scanned files
   * WIRED: Uses SummaryExtractor component (TASK-009)
   *
   * @param scanResult - Scan result with file info
   * @returns Array of agent output summaries
   */
  private async extractSummaries(
    scanResult: OutputScannerOutput
  ): Promise<AgentOutputSummary[]> {
    // Summaries are already extracted during scanning
    // If additional extraction is needed, use summaryExtractor.extractAllSummaries()
    if (scanResult.summaries.length > 0) {
      return scanResult.summaries;
    }

    // Fallback: extract all summaries directly
    return await this.summaryExtractor.extractAllSummaries();
  }

  /**
   * Calculate total tokens used for summaries
   *
   * @param summaries - Array of summaries
   * @returns Total token count
   */
  private calculateSummaryTokens(summaries: AgentOutputSummary[]): number {
    return summaries.reduce((total, s) => total + s.summaryTokens, 0);
  }

  /**
   * Map outputs to chapters using semantic similarity
   * WIRED: Uses SemanticMapper component (TASK-009)
   *
   * @param chapters - Chapter definitions
   * @param summaries - Agent output summaries
   * @param threshold - Similarity threshold
   * @returns Semantic mapper output
   */
  private async mapOutputsToChapters(
    chapters: ChapterDefinition[],
    summaries: AgentOutputSummary[],
    threshold: number
  ): Promise<SemanticMapperOutput> {
    // Use SemanticMapper to compute chapter-to-source mappings
    const mappingResult = await this.semanticMapper.mapOutputsToChapters(
      chapters,
      summaries,
      {
        threshold,
        fallbackHeuristics: true
      }
    );

    // Update token budget for mapping phase
    // Estimate: ~10 tokens per source-chapter comparison
    const mappingTokens = chapters.length * summaries.length * 10;
    this.updateTokenBudget('mapping', mappingTokens);

    return mappingResult;
  }

  /**
   * Write chapters using ChapterWriterAgent
   * WIRED: Uses ChapterWriterAgent and StyleApplier components (TASK-009)
   *
   * @param structure - Chapter structure
   * @param mapping - Semantic mapping
   * @param summaries - Agent output summaries
   * @param style - Style characteristics
   * @param sequential - Execute sequentially if true
   * @returns Array of chapter writer outputs
   */
  private async writeChapters(
    structure: ChapterStructure,
    mapping: SemanticMapperOutput,
    summaries: AgentOutputSummary[],
    style: StyleCharacteristics | null,
    sequential: boolean
  ): Promise<ChapterWriterOutput[]> {
    const chapters: ChapterWriterOutput[] = [];
    const totalChapters = structure.chapters.length;

    // Build index map for fast source lookup
    const summaryByIndex = new Map<number, AgentOutputSummary>();
    for (const summary of summaries) {
      summaryByIndex.set(summary.index, summary);
    }

    // Process chapters sequentially or in order (per EX-001)
    for (let i = 0; i < totalChapters; i++) {
      const chapterDef = structure.chapters[i];
      if (!chapterDef) continue;

      // Emit detailed progress for WRITING phase per chapter
      this.emitProgress({
        phase: 'WRITING',
        message: `Writing Chapter ${chapterDef.number}: ${chapterDef.title}`,
        current: i + 1,
        total: totalChapters,
        elapsedMs: Date.now() - this.startTime
      });

      this.log('debug', `Writing chapter ${chapterDef.number}`, {
        chapter: chapterDef.number,
        title: chapterDef.title,
        wordTarget: chapterDef.wordTarget
      });

      // Find mapping for this chapter
      const chapterMapping = mapping.mappings.find(
        m => m.chapterNumber === chapterDef.number
      );

      // Collect sources for this chapter
      const chapterSources: AgentOutputSummary[] = [];
      if (chapterMapping) {
        for (const sourceIndex of chapterMapping.allSources) {
          const source = summaryByIndex.get(sourceIndex);
          if (source) {
            chapterSources.push(source);
          }
        }
      }

      // Write chapter using ChapterWriterAgent (with style profile for LLM synthesis)
      const chapterOutput = await this.getChapterWriter().writeChapter({
        chapter: chapterDef,
        sources: chapterSources,
        style,
        allChapters: structure.chapters,
        tokenBudget: this.tokenBudget.phases.chapterWriting.allocatedPerChapter
      });

      // Apply style using StyleApplier
      const styledOutput = await this.styleApplier.applyStyle({
        content: chapterOutput.content,
        style,
        chapterNumber: chapterDef.number as ChapterNumber
      });

      // Update chapter content with styled version
      chapterOutput.content = styledOutput.styledContent;

      // Add any style violations to quality metrics
      if (styledOutput.validation.violations.length > 0) {
        chapterOutput.qualityMetrics.styleViolations =
          styledOutput.validation.violations.length;
        chapterOutput.warnings.push(
          ...styledOutput.validation.violations.map(v => `Style: ${v.message}`)
        );
      }

      // Update token budget for this chapter
      this.updateTokenBudget(`chapter${chapterDef.number}`, chapterOutput.tokensUsed);

      chapters.push(chapterOutput);

      // Report chapter completion with detailed metrics
      this.log('info', `Chapter ${chapterDef.number} complete`, {
        chapter: chapterDef.number,
        wordCount: chapterOutput.wordCount,
        citations: chapterOutput.citations.length,
        tokensUsed: chapterOutput.tokensUsed,
        compliance: chapterOutput.qualityMetrics.wordCountCompliance
      });

      this.emitProgress({
        phase: 'WRITING',
        message: `Chapter ${chapterDef.number} complete (${chapterOutput.wordCount.toLocaleString()} words)`,
        current: i + 1,
        total: totalChapters,
        elapsedMs: Date.now() - this.startTime
      });

      // If not sequential, we could batch these in parallel
      // For now, we process sequentially per Constitution EX-001
      if (sequential) {
        // Small delay to prevent overwhelming resources
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return chapters;
  }

  /**
   * Generate synthesis prompts for Claude Code to spawn chapter-synthesizer agents
   *
   * This is the PREFERRED method for high-quality output. Instead of writing
   * chapters directly (which uses basic concatenation), this generates prompts
   * that Claude Code can use to spawn the chapter-synthesizer agent for each
   * chapter.
   *
   * @param structure - Chapter structure from dissertation-architect
   * @param summaries - Output summaries from scanner
   * @param mapping - Chapter-to-source mapping
   * @returns Array of synthesis prompts for Claude Code Task tool
   */
  async generateSynthesisPrompts(
    structure: ChapterStructure,
    summaries: AgentOutputSummary[],
    mapping: SemanticMapperOutput
  ): Promise<import('./chapter-writer-agent.js').ChapterSynthesisPrompt[]> {
    const prompts: import('./chapter-writer-agent.js').ChapterSynthesisPrompt[] = [];
    const style = this._styleProfile;

    // Create index for fast source lookup
    const summaryByIndex = new Map<number, AgentOutputSummary>();
    for (const summary of summaries) {
      summaryByIndex.set(summary.index, summary);
    }

    // Load synthesis guidance from 06-chapter-synthesizer.md (optional but valuable)
    const fullSynthesisGuidance = await this.loadSynthesisGuidance();
    if (fullSynthesisGuidance) {
      orchLogger.info('Loaded synthesis guidance for writing agents');
    }

    orchLogger.info('Generating synthesis prompts', { totalChapters: structure.totalChapters, styleProfileId: this._styleProfileId || 'default' });

    for (const chapterDef of structure.chapters) {
      // Find mapping for this chapter
      const chapterMapping = mapping.mappings.find(
        (m) => m.chapterNumber === chapterDef.number
      );

      // Collect sources for this chapter
      const chapterSources: AgentOutputSummary[] = [];
      if (chapterMapping) {
        for (const sourceIndex of chapterMapping.allSources) {
          const source = summaryByIndex.get(sourceIndex);
          if (source) {
            chapterSources.push(source);
          }
        }
      }

      // Extract chapter-specific synthesis guidance if available
      let chapterGuidance: string | undefined;
      if (fullSynthesisGuidance) {
        const extracted = this.extractChapterGuidance(fullSynthesisGuidance, chapterDef.number);
        chapterGuidance = extracted || fullSynthesisGuidance; // Fall back to full guidance
      }

      // Generate synthesis prompt using ChapterWriterAgent
      const prompt = await this.getChapterWriter().generateSynthesisPrompt({
        chapter: chapterDef,
        sources: chapterSources,
        style,
        allChapters: structure.chapters,
        tokenBudget: this.tokenBudget.phases.chapterWriting.allocatedPerChapter,
        synthesisGuidance: chapterGuidance
      });

      prompts.push(prompt);

      this.log('debug', `Generated synthesis prompt for Chapter ${chapterDef.number}`, {
        chapter: chapterDef.number,
        title: chapterDef.title,
        sections: prompt.sections.length,
        styleProfile: prompt.styleProfileId,
        hasSynthesisGuidance: !!chapterGuidance
      });
    }

    return prompts;
  }

  /**
   * Combine chapters into final paper
   * WIRED: Uses PaperCombiner component (TASK-009)
   *
   * @param chapters - Written chapters
   * @param structure - Chapter structure
   * @returns Path to final paper
   */
  private async combineChapters(
    chapters: ChapterWriterOutput[],
    structure: ChapterStructure
  ): Promise<string> {
    // Generate paper metadata
    const metadata = this.paperCombiner.generateMetadata(this.slug, chapters);

    // Override title with research title if available
    if (structure.researchTitle) {
      metadata.title = structure.researchTitle;
    }

    // Combine chapters into final paper
    const finalPaper = await this.paperCombiner.combine(chapters, metadata);

    // Write all output files (chapters, final paper, metadata.json)
    await this.paperCombiner.writeOutputFiles(finalPaper, this.outputDir);

    // Return path to final paper
    const finalPaperPath = path.join(this.outputDir, 'final-paper.md');
    return finalPaperPath;
  }

  /**
   * Estimate tokens used for combination phase
   *
   * @param chapters - Written chapters
   * @returns Estimated token count
   */
  private estimateCombinationTokens(chapters: ChapterWriterOutput[]): number {
    // Rough estimate: 1 token per 4 characters
    const totalContent = chapters.reduce((sum, ch) => sum + ch.content.length, 0);
    return Math.ceil(totalContent / 4);
  }

  /**
   * Validate generated outputs
   * WIRED: Validates chapters per Constitution QA-001 (TASK-009)
   *
   * @param chapters - Written chapters
   * @returns Array of warning messages
   */
  private async validateOutputs(chapters: ChapterWriterOutput[]): Promise<string[]> {
    const warnings: string[] = [];

    for (const chapter of chapters) {
      // QA-001: Word count compliance must be 70%-130%
      const compliance = chapter.qualityMetrics.wordCountCompliance;
      if (compliance < 0.70) {
        warnings.push(
          `Chapter ${chapter.chapterNumber}: Word count ${(compliance * 100).toFixed(0)}% is below 70% of target`
        );
      } else if (compliance > 1.30) {
        warnings.push(
          `Chapter ${chapter.chapterNumber}: Word count ${(compliance * 100).toFixed(0)}% exceeds 130% of target`
        );
      }

      // Check citation count
      if (chapter.citations.length === 0) {
        warnings.push(
          `Chapter ${chapter.chapterNumber}: No citations found`
        );
      }

      // Check for style violations
      if (chapter.qualityMetrics.styleViolations > 0) {
        warnings.push(
          `Chapter ${chapter.chapterNumber}: ${chapter.qualityMetrics.styleViolations} style violations`
        );
      }

      // Check generation status
      if (chapter.generationStatus === 'failed') {
        warnings.push(
          `Chapter ${chapter.chapterNumber}: Generation failed`
        );
      }

      // Aggregate chapter warnings
      warnings.push(...chapter.warnings.map(w =>
        `Chapter ${chapter.chapterNumber}: ${w}`
      ));
    }

    // Cross-chapter validation
    const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);
    if (totalWords < 20000) {
      warnings.push(
        `Total word count (${totalWords}) is below minimum threshold of 20,000`
      );
    }

    return warnings;
  }

  // ============================================
  // Private Methods: Result Creation
  // ============================================

  /**
   * Create result for dry-run mode
   *
   * @param _structure - Chapter structure (unused in stub)
   * @param scanResult - Scan result
   * @param mapping - Semantic mapping
   * @param warnings - Warning messages
   * @returns Dry-run result
   */
  private createDryRunResult(
    _structure: ChapterStructure,
    scanResult: OutputScannerOutput,
    mapping: SemanticMapperOutput,
    warnings: string[]
  ): FinalStageResult {
    return {
      success: true,
      dryRun: true,
      outputPath: null,
      totalWords: 0,
      totalCitations: 0,
      chaptersGenerated: 0,
      mapping,
      scanResult,
      warnings,
      errors: [],
      metadata: this.tokenBudget,
      exitCode: 0
    };
  }

  /**
   * Create success result
   *
   * @param outputPath - Path to final paper
   * @param chapters - Written chapters
   * @param mapping - Semantic mapping
   * @param scanResult - Scan result
   * @param warnings - Warning messages
   * @returns Success result
   */
  private createSuccessResult(
    outputPath: string,
    chapters: ChapterWriterOutput[],
    mapping: SemanticMapperOutput,
    scanResult: OutputScannerOutput,
    warnings: string[]
  ): FinalStageResult {
    const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);
    const totalCitations = chapters.reduce(
      (sum, ch) => sum + ch.citations.length,
      0
    );

    return {
      success: true,
      dryRun: false,
      outputPath,
      totalWords,
      totalCitations,
      chaptersGenerated: chapters.length,
      mapping,
      chapters,
      scanResult,
      warnings,
      errors: [],
      metadata: this.tokenBudget,
      exitCode: 0
    };
  }

  /**
   * Create failure result
   *
   * @param error - The error that caused failure
   * @param errors - Error messages
   * @param warnings - Warning messages
   * @returns Failure result
   */
  private createFailureResult(
    error: FinalStageError,
    errors: string[],
    warnings: string[]
  ): FinalStageResult {
    return {
      success: false,
      dryRun: false,
      outputPath: null,
      totalWords: 0,
      totalCitations: 0,
      chaptersGenerated: 0,
      mapping: null,
      warnings,
      errors,
      metadata: this.tokenBudget,
      exitCode: error.exitCode ?? FinalStageError.getExitCode(error.code)
    };
  }

  // ============================================
  // Phase 8 Claude Code Integration
  // [PHASE-8-CLAUDECODE] Prepare prompts for Claude Code Task tool
  // ============================================

  /**
   * Prepare Phase 8 for Claude Code execution
   *
   * This method runs phases 8.0-8.5 (Initialize, Scan, Summarize, Map)
   * and generates synthesis prompts, but does NOT execute chapter writing.
   *
   * The returned data should be stored in memory and used by Claude Code
   * to spawn chapter-writer agents via the Task tool.
   *
   * [PHASE-8-CLAUDECODE] Integration with ClaudeFlow methodology
   *
   * @param options - Execution options
   * @returns Preparation result with synthesis prompts
   */
  async prepareForClaudeCode(options: FinalStageOptions = {}): Promise<Phase8PrepareResult> {
    this.startTime = Date.now();
    this.verbose = options.verbose ?? false;
    this.options = options;
    this.warnings = [];

    const errors: string[] = [];
    const warnings: string[] = [];

    this.logger = new ProgressLogger({ verbose: this.verbose, outputDir: null });

    try {
      // ========================================
      // Phase 8.0: Initialize
      // ========================================
      this.setState('INITIALIZING');
      this.startPhaseTimer('INITIALIZING');

      this.emitProgress({
        phase: 'INITIALIZING',
        message: 'Loading chapter structure for Claude Code preparation...',
        current: -1,
        total: -1,
        elapsedMs: Date.now() - this.startTime
      });

      await this.initialize(options);

      // Phase 8.1: Load chapter structure
      const structure = await this.loadChapterStructure();
      this._chapterStructure = structure;

      // Phase 8.2: Load style profile
      const style = await this.loadStyleProfile();
      this._styleProfile = style;

      this.endPhaseTimer('INITIALIZING');

      // ========================================
      // Phase 8.3: Scan output files
      // ========================================
      this.setState('SCANNING');
      this.startPhaseTimer('SCANNING');

      this.emitProgress({
        phase: 'SCANNING',
        message: 'Scanning for output files...',
        current: 0,
        total: 45,
        elapsedMs: Date.now() - this.startTime
      });

      const scanResult = await this.scanOutputFiles();

      if (scanResult.scanStatus === 'failed') {
        throw new FinalStageError(
          `Scan failed: only ${scanResult.foundFiles}/${scanResult.totalFiles} files found`,
          'SCAN_FAILED',
          false,
          FinalStageError.getExitCode('SCAN_FAILED')
        );
      }

      if (scanResult.missingFiles.length > 0) {
        warnings.push(`Missing files: ${scanResult.missingFiles.join(', ')}`);
      }

      this.endPhaseTimer('SCANNING');

      // ========================================
      // Phase 8.4: Summarize outputs
      // ========================================
      this.setState('SUMMARIZING');
      this.startPhaseTimer('SUMMARIZING');

      const summaries = scanResult.summaries.length > 0
        ? scanResult.summaries
        : await this.extractSummaries(scanResult);

      this._summaries = summaries;
      this.updateTokenBudget('summaryExtraction', this.calculateSummaryTokens(summaries));

      this.endPhaseTimer('SUMMARIZING');

      // ========================================
      // Phase 8.5: Semantic mapping
      // ========================================
      this.setState('MAPPING');
      this.startPhaseTimer('MAPPING');

      this.emitProgress({
        phase: 'MAPPING',
        message: `Mapping ${summaries.length} sources to ${structure.chapters.length} chapters`,
        current: -1,
        total: -1,
        elapsedMs: Date.now() - this.startTime
      });

      const mapping = await this.mapOutputsToChapters(
        structure.chapters,
        summaries,
        options.threshold ?? 0.30
      );
      this._mapping = mapping;

      this.endPhaseTimer('MAPPING');

      // ========================================
      // Generate synthesis prompts for Claude Code
      // ========================================
      this.emitProgress({
        phase: 'MAPPING',
        message: 'Generating synthesis prompts for Claude Code Task tool...',
        current: structure.chapters.length,
        total: structure.chapters.length,
        elapsedMs: Date.now() - this.startTime
      });

      const synthesisPrompts = await this.generateSynthesisPrompts(structure, summaries, mapping);

      // Transform to ClaudeCodeChapterPrompt format with 4-part ClaudeFlow prompts
      // DYNAMIC: Each chapter uses its assigned specialized agent from dissertation-architect
      const chapterPrompts: ClaudeCodeChapterPrompt[] = synthesisPrompts.map((prompt, index) => {
        // Find the chapter definition to get its dynamically assigned agent
        const chapter = structure.chapters.find(ch => ch.number === prompt.chapterNumber);
        const dynamicAgent = chapter?.assignedAgent ?? 'chapter-synthesizer';

        return {
          chapterNumber: prompt.chapterNumber as ChapterNumber,
          chapterTitle: prompt.chapterTitle,
          prompt: this.buildClaudeFlowPrompt(prompt, index, structure.totalChapters, this.slug),
          subagentType: dynamicAgent,
          outputPath: prompt.outputPath,
          tokenBudget: Math.floor(180000 / structure.totalChapters)
        };
      });

      const memoryNamespace = `phd/${this.slug}/phase8`;

      orchLogger.info('Phase 8 preparation complete for Claude Code', {
        totalChapters: structure.totalChapters,
        promptsGenerated: chapterPrompts.length,
        orphanedSources: mapping.orphanedSources.length
      });

      return {
        success: true,
        slug: this.slug,
        basePath: this.basePath,
        finalOutputDir: this.outputDir,
        totalChapters: structure.totalChapters,
        chapterPrompts,
        scanSummary: {
          totalFiles: scanResult.totalFiles,
          foundFiles: scanResult.foundFiles,
          missingFiles: scanResult.missingFiles
        },
        mappingSummary: {
          algorithm: mapping.algorithm,
          threshold: mapping.threshold,
          orphanedSources: mapping.orphanedSources,
          coverage: mapping.mappingQuality.coverage
        },
        errors,
        warnings,
        memoryNamespace,
        executionInstructions: `
## Phase 8 Execution Instructions for Claude Code

Execute chapters SEQUENTIALLY using the Task tool with DYNAMIC specialized agents.
Each chapter uses its own assigned writing agent from the dissertation structure.

For each chapter in chapterPrompts:
1. Use the Task tool with subagent_type=chapterPrompts[i].subagentType
   (e.g., 'introduction-writer', 'literature-review-writer', 'methodology-writer', etc.)
2. Pass the prompt field as the agent's instructions
3. Wait for completion before starting the next chapter (99.9% sequential per ClaudeFlow)
4. Verify chapter was written to outputPath
5. Store progress to memory after each chapter completes

After all chapters complete, use the Task tool to spawn a final-combiner agent
to assemble the complete paper from all chapter outputs.

Memory namespace: ${memoryNamespace}
Total chapters: ${structure.totalChapters}
Agents are DYNAMICALLY assigned per chapter from dissertation-architect structure.
`.trim()
      };

    } catch (error) {
      orchLogger.error('Phase 8 preparation failed', { error });

      const finalStageError = error instanceof FinalStageError
        ? error
        : new FinalStageError(
            error instanceof Error ? error.message : String(error),
            'SCAN_FAILED',
            false
          );

      return {
        success: false,
        slug: this.slug,
        basePath: this.basePath,
        finalOutputDir: this.outputDir,
        totalChapters: 0,
        chapterPrompts: [],
        scanSummary: {
          totalFiles: 0,
          foundFiles: 0,
          missingFiles: []
        },
        mappingSummary: {
          algorithm: 'none',
          threshold: 0,
          orphanedSources: [],
          coverage: 0
        },
        errors: [finalStageError.message],
        warnings,
        memoryNamespace: `phd/${this.slug}/phase8`,
        executionInstructions: 'Phase 8 preparation failed. See errors for details.'
      };
    }
  }

  /**
   * Build a ClaudeFlow-compatible 4-part prompt for a chapter
   *
   * This transforms a ChapterSynthesisPrompt into a format suitable for
   * Claude Code's Task tool with proper WORKFLOW CONTEXT, MEMORY RETRIEVAL,
   * and MEMORY STORAGE sections per ClaudeFlow methodology.
   *
   * @param prompt - Original synthesis prompt
   * @param chapterIndex - 0-based index (for workflow context)
   * @param totalChapters - Total number of chapters
   * @param slug - Session slug for memory namespace
   * @returns ClaudeFlow-formatted prompt string
   */
  buildClaudeFlowPrompt(
    prompt: import('./chapter-writer-agent.js').ChapterSynthesisPrompt,
    chapterIndex: number,
    totalChapters: number,
    slug: string
  ): string {
    const agentNum = chapterIndex + 1;
    const prevChapters = chapterIndex > 0
      ? Array.from({ length: chapterIndex }, (_, i) => `Chapter ${i + 1} ✓`).join(', ')
      : 'None';
    const nextChapters = chapterIndex < totalChapters - 1
      ? Array.from({ length: totalChapters - chapterIndex - 1 }, (_, i) => `Chapter ${chapterIndex + i + 2}`).join(', ')
      : 'Final Combiner';

    return `## YOUR TASK
Write Chapter ${prompt.chapterNumber}: "${prompt.chapterTitle}"

Target: ${prompt.wordTarget} words across ${prompt.sections.length} sections.
Output to: ${prompt.outputPath}

${prompt.prompt}

## WORKFLOW CONTEXT
Agent #${agentNum} of ${totalChapters + 1} | Previous: ${prevChapters} | Next: ${nextChapters}

This is a SEQUENTIAL chapter writing pipeline. Each chapter must complete before the next begins.
The final agent will combine all chapters into the complete paper.

## MEMORY RETRIEVAL
\`\`\`
# Retrieve chapter structure and mapping from MemoryGraph
mcp__memorygraph__recall_memories with query "phd/${slug}/phase8/structure"
mcp__memorygraph__recall_memories with query "phd/${slug}/phase8/mapping"
${chapterIndex > 0 ? `# Retrieve previous chapter for continuity
mcp__memorygraph__recall_memories with query "phd/${slug}/chapters/chapter-${chapterIndex}"` : ''}
\`\`\`

Understand:
- Chapter structure and section requirements
- Semantic mapping of sources to this chapter
${chapterIndex > 0 ? '- Previous chapter content for narrative flow' : ''}

## MEMORY STORAGE (For Next Agents)
After writing, store the chapter content via MemoryGraph:

\`\`\`
mcp__memorygraph__store_memory with type "general", title "phd/${slug}/chapters/chapter-${prompt.chapterNumber}", content '{"chapterNumber": ${prompt.chapterNumber}, "title": "${prompt.chapterTitle}", "wordCount": <actual>, "outputPath": "${prompt.outputPath}"}', tags ["phd-pipeline", "${slug}"]
\`\`\`

## STEPS
1. Read source files listed in the prompt
2. Retrieve memories for context
3. Write chapter sections following style guidelines
4. Save chapter to ${prompt.outputPath}
5. Store chapter metadata in MemoryGraph
6. Verify: recall memories with query "phd/${slug}/chapters/chapter-${prompt.chapterNumber}"

## SUCCESS CRITERIA
- Chapter written to ${prompt.outputPath}
- Word count within 70%-130% of ${prompt.wordTarget} target
- All sections from structure included
- Citations properly formatted
- Chapter metadata stored in memory for next agent`;
  }
}
