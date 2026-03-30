/**
 * PDF Generator Type Definitions
 *
 * Core type definitions for the APA 7th Edition PDF generator system.
 * Provides interfaces for generators, formatted papers, and results.
 *
 * @module pdf-generator/types
 */

import type {
  ApaMargins,
  ApaFonts,
  ApaSpacing,
  ApaSectionName,
  ApaHeadingStyles,
  ApaConfig,
} from './constants.js';

import type {
  AuthorInfo,
  PaperInput,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './utils/validation.js';

// =============================================================================
// RE-EXPORTS
// =============================================================================

// Re-export validation types for convenience
export type { AuthorInfo, PaperInput, ValidationResult, ValidationError, ValidationWarning };

// Re-export constant types for convenience
export type { ApaMargins, ApaFonts, ApaSpacing, ApaSectionName, ApaHeadingStyles, ApaConfig };

// =============================================================================
// GENERATOR TYPES
// =============================================================================

/**
 * Available PDF generator types.
 * - pandoc-latex: Best quality, requires LaTeX installation
 * - pandoc-html: Good quality, no LaTeX required
 * - pdfkit: Pure JavaScript, no external dependencies
 */
export type GeneratorType = 'pandoc-latex' | 'pandoc-html' | 'pdfkit';

/**
 * Result of a PDF generation operation.
 */
export interface GeneratorResult {
  /** Whether generation succeeded */
  success: boolean;
  /** Path to the generated file (if successful) */
  outputPath?: string;
  /** Error details (if failed) */
  error?: Error;
  /** Which generator was used */
  generator: GeneratorType;
  /** Time taken in milliseconds */
  processingTime: number;
  /** Non-fatal warnings during generation */
  warnings?: string[];
}

/**
 * Options for PDF generation.
 */
export interface PdfOptions {
  /** Output file path */
  outputPath: string;
  /** Output format (default: pdf) */
  format?: 'pdf' | 'docx';
  /** Preferred generator to use (will fallback if unavailable) */
  preferredGenerator?: GeneratorType;
  /** Custom path to pandoc executable */
  pandocPath?: string;
  /** Enable debug output */
  debug?: boolean;
  /** Temporary directory for intermediate files */
  tempDir?: string;
  /** Keep intermediate files for debugging */
  keepIntermediateFiles?: boolean;
}

// =============================================================================
// FORMATTED PAPER TYPES
// =============================================================================

/**
 * A fully formatted paper ready for PDF generation.
 * All APA formatting has been applied.
 */
export interface FormattedPaper {
  /** Formatted title page content */
  titlePage: FormattedTitlePage;
  /** Formatted abstract (optional for some paper types) */
  abstract?: FormattedAbstract;
  /** Formatted body content */
  body: FormattedBody;
  /** Formatted references section */
  references?: FormattedReferences;
  /** Formatted appendices */
  appendices?: FormattedAppendix[];
  /** Paper metadata */
  metadata?: PaperMetadata;
}

/**
 * Formatted title page following APA 7th Edition.
 */
export interface FormattedTitlePage {
  /** Paper title (bold, centered) */
  title: string;
  /** Author information */
  authors: AuthorInfo[];
  /** Institutional affiliations */
  affiliations: string[];
  /** Author note (for professional papers) */
  authorNote?: string;
  /** Running head text (max 50 chars, ALL CAPS) */
  runningHead: string;
  /** Page number (always 1 for title page) */
  pageNumber: number;
}

/**
 * Formatted abstract following APA 7th Edition.
 */
export interface FormattedAbstract {
  /** Abstract text (single paragraph, no indent) */
  content: string;
  /** Keywords (italicized label, indented) */
  keywords?: string[];
  /** Word count for validation */
  wordCount: number;
}

/**
 * Formatted paper body with sections.
 */
export interface FormattedBody {
  /** Raw content (may include markdown or other markup) */
  content: string;
  /** Parsed sections with heading levels */
  sections: FormattedSection[];
}

/**
 * A formatted section within the paper body.
 */
export interface FormattedSection {
  /** Heading level (1-5 per APA 7th Edition) */
  level: 1 | 2 | 3 | 4 | 5;
  /** Section title */
  title: string;
  /** Section content */
  content: string;
  /** Child sections (for nested structure) */
  subsections?: FormattedSection[];
}

/**
 * Formatted references section.
 */
export interface FormattedReferences {
  /** Individual reference entries (with hanging indent) */
  entries: string[];
  /** Total reference count */
  count: number;
}

/**
 * A formatted appendix.
 */
export interface FormattedAppendix {
  /** Appendix label (e.g., "A", "B") */
  label: string;
  /** Appendix title */
  title: string;
  /** Appendix content */
  content: string;
}

/**
 * Paper metadata for tracking and processing.
 */
export interface PaperMetadata {
  /** Original input validation result */
  validation?: ValidationResult;
  /** Date/time of formatting */
  formattedAt?: Date;
  /** Version of formatter used */
  formatterVersion?: string;
  /** Total word count */
  totalWordCount?: number;
  /** Total page estimate */
  estimatedPages?: number;
}

// =============================================================================
// GENERATOR INTERFACE
// =============================================================================

/**
 * Interface that all PDF generators must implement.
 */
export interface IPdfGenerator {
  /** Generator type identifier */
  readonly type: GeneratorType;
  /** Whether this generator is currently available */
  readonly available: boolean;

  /**
   * Check if this generator is available on the current system.
   * May involve checking for external dependencies.
   */
  checkAvailability(): Promise<boolean>;

  /**
   * Generate a PDF from a formatted paper.
   * @param paper - The formatted paper to convert
   * @param options - Generation options
   * @returns Generation result with success/failure and output path
   */
  generate(paper: FormattedPaper, options: PdfOptions): Promise<GeneratorResult>;

  /**
   * Clean up any temporary resources.
   * Called after generation completes.
   */
  cleanup?(): Promise<void>;
}

// =============================================================================
// CALLBACK TYPES
// =============================================================================

/**
 * Callback for reporting generation progress.
 * @param stage - Current stage name (e.g., "Formatting", "Generating PDF")
 * @param percent - Completion percentage (0-100)
 */
export type ProgressCallback = (stage: string, percent: number) => void;

/**
 * Callback for logging messages during generation.
 * @param level - Log level
 * @param message - Log message
 * @param data - Optional additional data
 */
export type LogCallback = (
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  data?: unknown
) => void;

// =============================================================================
// FORMATTER TYPES
// =============================================================================

/**
 * Options for the APA formatter.
 */
export interface FormatterOptions {
  /** Paper type affects formatting rules */
  paperType?: 'professional' | 'student';
  /** Include running head (required for professional, optional for student) */
  includeRunningHead?: boolean;
  /** Auto-generate running head from title if not provided */
  autoGenerateRunningHead?: boolean;
  /** Strict mode fails on warnings */
  strictMode?: boolean;
}

/**
 * Result of formatting a paper.
 */
export interface FormatterResult {
  /** The formatted paper */
  paper: FormattedPaper;
  /** Validation result from input */
  validation: ValidationResult;
  /** Whether formatting succeeded */
  success: boolean;
  /** Errors that prevented formatting */
  errors?: string[];
  /** Warnings during formatting */
  warnings?: string[];
}

// =============================================================================
// PIPELINE TYPES
// =============================================================================

/**
 * Complete pipeline options combining formatting and generation.
 */
export interface PipelineOptions extends PdfOptions, FormatterOptions {
  /** Progress callback */
  onProgress?: ProgressCallback;
  /** Log callback */
  onLog?: LogCallback;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Result of the complete pipeline.
 */
export interface PipelineResult {
  /** Formatting result */
  formatting: FormatterResult;
  /** Generation result */
  generation: GeneratorResult;
  /** Overall success */
  success: boolean;
  /** Total processing time */
  totalTime: number;
}
