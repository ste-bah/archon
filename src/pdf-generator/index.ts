/**
 * PDF Generator Module - Public API Entry Point
 *
 * APA 7th Edition compliant PDF generation with automatic
 * capability detection and fallback support.
 *
 * This module provides:
 * - Unified `generatePdf()` function for simple usage
 * - `APAPdfGenerator` class for object-oriented usage
 * - Re-exports of all types, constants, and formatters
 *
 * @module pdf-generator
 */

// =============================================================================
// TYPE RE-EXPORTS
// =============================================================================

export type {
  // Core generator types
  GeneratorType,
  GeneratorResult,
  IPdfGenerator,
  PdfOptions,
  // Formatted document types
  FormattedPaper,
  FormattedTitlePage,
  FormattedAbstract,
  FormattedBody,
  FormattedSection,
  FormattedReferences,
  FormattedAppendix,
  PaperMetadata,
  // Formatter types
  FormatterOptions,
  FormatterResult,
  // Pipeline types
  PipelineOptions,
  PipelineResult,
  // Callback types
  ProgressCallback,
  LogCallback,
} from './types.js';

// Re-export validation types that are re-exported from types.ts
export type {
  AuthorInfo,
  PaperInput,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './types.js';

// =============================================================================
// CONSTANT RE-EXPORTS
// =============================================================================

export {
  // Page layout
  APA_MARGINS,
  // Typography
  APA_FONTS,
  APA_SPACING,
  // Document sections
  APA_RUNNING_HEAD,
  APA_TITLE_PAGE,
  APA_ABSTRACT,
  APA_HEADING_STYLES,
  APA_REFERENCES,
  APA_SECTION_ORDER,
  APA_TABLES,
  APA_FIGURES,
  APA_APPENDICES,
  APA_VALIDATION_LIMITS,
  // Generator config
  GENERATOR_PRIORITY,
  GENERATOR_CONFIG,
  // Combined config
  APA_CONFIG,
} from './constants.js';

export type {
  ApaMargins,
  ApaFonts,
  ApaSpacing,
  ApaSectionName,
  ApaHeadingStyles,
  ApaConfig,
} from './constants.js';

// =============================================================================
// FACTORY RE-EXPORTS
// =============================================================================

export {
  detectCapabilities,
  createGenerator,
  createGeneratorSync,
  getRecommendedGeneratorType,
  PandocGenerator,
  PdfKitGenerator,
} from './factory.js';

export type { GeneratorCapabilities } from './factory.js';

// =============================================================================
// FORMATTER RE-EXPORTS
// =============================================================================

// Title page formatter
export {
  formatTitlePage,
  generateTitlePageMarkdown,
  generateTitlePageHtml,
  getTitlePageCss,
  formatTitleCase,
} from './formatters/title-page.js';

export type {
  TitlePageInput,
  ExtendedFormattedTitlePage,
} from './formatters/title-page.js';

// Abstract formatter
export {
  formatAbstract,
  generateAbstractMarkdown,
  generateAbstractHtml,
  getAbstractCss,
  validateAbstract as validateAbstractFormat,
  countWords,
  formatKeywords,
  normalizeAbstractText,
} from './formatters/abstract.js';

export type {
  AbstractInput,
  AbstractValidation,
  ExtendedFormattedAbstract,
} from './formatters/abstract.js';

// Headings formatter
export {
  formatHeading,
  formatMarkdownHeading,
  processHeadings,
  extractAllHeadings,
  validateHeadingHierarchy,
  getHeadingsCss,
  detectHeadingLevel,
  extractHeadingText,
  getApaHeadingStyle,
  describeHeadingLevel,
  HEADING_STYLES,
} from './formatters/headings.js';

export type {
  HeadingLevel,
  HeadingStyle,
  FormattedHeading,
} from './formatters/headings.js';

// References formatter
export {
  formatReferences,
  generateReferencesMarkdown,
  generateReferencesHtml,
  getReferencesCss,
  parseReference,
  sortReferences,
  formatDoi,
  validateReferences,
  extractDois,
  countUniqueAuthors,
} from './formatters/references.js';

export type {
  ReferencesInput,
  Reference,
  ExtendedFormattedReferences,
  ReferencesStyles,
} from './formatters/references.js';

// Running head formatter
export {
  formatRunningHead,
  generateRunningHead,
  getRunningHeadCss,
  validateRunningHead as validateRunningHeadFormat,
  truncateToMax,
  abbreviateTitle,
  shouldDisplayRunningHead,
} from './formatters/running-head.js';

export type {
  RunningHeadInput,
  FormattedRunningHead,
  RunningHeadValidation,
} from './formatters/running-head.js';

// =============================================================================
// VALIDATION RE-EXPORTS
// =============================================================================

export {
  validatePaper,
  validateAuthor,
  validateTitle,
  validateAbstract as validateAbstractContent,
  validateRunningHead as validateRunningHeadContent,
  validateReference,
  validateHeadingLevel,
  mergeValidationResults,
  isValidRunningHead,
  isValidAbstract,
  isValidTitle,
  isValidPaper,
  isValidOrcid,
  isUppercase,
  countWords as countWordsValidation,
  getErrorsOnly,
  getWarningsOnly,
  formatValidationResult,
  ValidationErrorCodes,
  ValidationWarningCodes,
} from './utils/validation.js';

// =============================================================================
// GENERATOR RE-EXPORTS
// =============================================================================

export { BaseGenerator } from './generators/base-generator.js';

// =============================================================================
// CONFIGURATION RE-EXPORTS
// =============================================================================

export type {
  PdfGeneratorConfig,
  ConfigValidationResult,
  PreferredGenerator,
  LogLevel,
  MarginConfig,
  FontConfig,
} from './config.js';

export {
  ConfigManager,
  loadConfig,
  getConfig,
  configure,
  validateConfig,
  resetConfig,
  DEFAULT_CONFIG,
} from './config.js';

// =============================================================================
// MAIN API TYPES
// =============================================================================

/**
 * Options for PDF generation.
 */
export interface GeneratePdfOptions {
  /** Paper content and metadata */
  paper: PaperInputForGeneration;
  /** Output file path (without extension) */
  outputPath: string;
  /** Preferred generator type (auto-detected if not specified) */
  preferredGenerator?: import('./types.js').GeneratorType;
  /** Additional PDF options */
  pdfOptions?: Partial<import('./types.js').PdfOptions>;
  /** Progress callback */
  onProgress?: (percent: number, message: string) => void;
  /** Log callback */
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

/**
 * Paper input structure for generation.
 * Combines title page, abstract, body, and references.
 */
export interface PaperInputForGeneration {
  /** Paper title */
  title: string;
  /** Running head (max 50 chars, will be auto-shortened if needed) */
  runningHead?: string;
  /** Authors (at least one required) */
  authors: Array<{
    name: string;
    affiliationIds?: number[];
    orcid?: string;
    correspondingAuthor?: boolean;
    email?: string;
  }>;
  /** Affiliations */
  affiliations?: Array<{
    id: number;
    name: string;
    department?: string;
    city?: string;
    state?: string;
    country?: string;
  }>;
  /** Author note (optional) */
  authorNote?: string;
  /** Abstract text */
  abstract: string;
  /** Keywords (optional) */
  keywords?: string[];
  /** Body content (markdown) */
  body: string;
  /** References (formatted strings) */
  references?: string[];
  /** Course information (for student papers) */
  course?: string;
  /** Instructor name (for student papers) */
  instructor?: string;
  /** Due date (for student papers) */
  dueDate?: string;
}

/**
 * Result of PDF generation.
 */
export interface GeneratePdfResult {
  /** Whether generation succeeded */
  success: boolean;
  /** Path to generated PDF (if successful) */
  outputPath?: string;
  /** Generator type that was used */
  generatorUsed: import('./types.js').GeneratorType;
  /** Any warnings during generation */
  warnings: string[];
  /** Error message (if failed) */
  error?: string;
  /** Generation duration in milliseconds */
  durationMs?: number;
}

// =============================================================================
// IMPORTS FOR IMPLEMENTATION
// =============================================================================

import {
  detectCapabilities as _detectCapabilities,
  createGenerator as _createGenerator,
  type GeneratorCapabilities,
} from './factory.js';

import { formatTitlePage as _formatTitlePage } from './formatters/title-page.js';
import { formatAbstract as _formatAbstract } from './formatters/abstract.js';
import { extractAllHeadings as _extractAllHeadings, parseMarkdownToSections } from './formatters/headings.js';
import { formatReferences as _formatReferences } from './formatters/references.js';
import { formatRunningHead as _formatRunningHead } from './formatters/running-head.js';

import type { GeneratorType, FormattedPaper, FormattedTitlePage } from './types.js';

// =============================================================================
// MAIN API FUNCTION
// =============================================================================

/**
 * Generates an APA 7th Edition formatted PDF from paper content.
 *
 * Orchestrates the full workflow:
 * 1. Detect capabilities and create appropriate generator
 * 2. Format title page
 * 3. Format abstract
 * 4. Process headings in body
 * 5. Format references
 * 6. Generate running head
 * 7. Assemble full document
 * 8. Generate PDF
 *
 * @param options - Generation options
 * @returns Generation result with success status and warnings
 *
 * @example
 * ```typescript
 * const result = await generatePdf({
 *   paper: {
 *     title: 'Effects of Sleep on Memory',
 *     authors: [{ name: 'Jane Smith', affiliationIds: [1] }],
 *     affiliations: [{ id: 1, name: 'University of Example' }],
 *     abstract: 'This study examines...',
 *     body: '# Introduction\n\nSleep plays a crucial role...',
 *     references: ['Smith, J. (2023). Sleep research. *Journal*, 1(1), 1-10.'],
 *   },
 *   outputPath: './output/paper',
 * });
 *
 * if (result.success) {
 *   console.log(`PDF generated: ${result.outputPath}`);
 * }
 * ```
 */
export async function generatePdf(
  options: GeneratePdfOptions
): Promise<GeneratePdfResult> {
  const startTime = Date.now();
  const warnings: string[] = [];
  const { paper, outputPath, preferredGenerator, pdfOptions, onProgress, onLog } = options;

  const log = (level: 'info' | 'warn' | 'error', message: string) => {
    if (level === 'warn') {
      warnings.push(message);
    }
    onLog?.(level, message);
  };

  const progress = (percent: number, message: string) => {
    onProgress?.(percent, message);
  };

  try {
    // Step 1: Detect capabilities and create generator
    progress(5, 'Detecting PDF generation capabilities...');
    const capabilities = await _detectCapabilities();
    log('info', `Capabilities detected: pandocLatex=${capabilities.pandocLatex}, pandocHtml=${capabilities.pandocHtml}, pdfkit=true`);

    let generatorType: GeneratorType;
    if (preferredGenerator && isGeneratorAvailable(preferredGenerator, capabilities)) {
      generatorType = preferredGenerator;
    } else {
      generatorType = selectBestGenerator(capabilities);
    }

    progress(10, `Creating ${generatorType} generator...`);
    // createGenerator accepts PdfOptions | undefined - we pass undefined here
    // and provide outputPath when calling generate()
    const generator = await _createGenerator(undefined, generatorType);

    // Step 2: Format title page
    progress(15, 'Formatting title page...');
    // Convert PaperInputForGeneration authors to TitlePageAuthorInfo format
    const titlePageAuthors = paper.authors.map(a => ({
      name: a.name,
      orcid: a.orcid,
      // Map affiliation from affiliations array if available
      affiliation: paper.affiliations?.find(aff => a.affiliationIds?.includes(aff.id))?.name,
    }));
    // Convert affiliations to string array (TitlePageInput expects string[])
    const titlePageAffiliations = paper.affiliations?.map(aff => {
      const parts = [aff.name];
      if (aff.department) parts.unshift(aff.department);
      return parts.join(', ');
    });
    const titlePageInput = {
      title: paper.title,
      authors: titlePageAuthors,
      affiliations: titlePageAffiliations,
      authorNote: paper.authorNote,
      runningHead: paper.runningHead,
      courseNumber: paper.course,
      instructorName: paper.instructor,
      dueDate: paper.dueDate,
      isStudentPaper: Boolean(paper.course || paper.instructor),
    };
    const formattedTitlePage = _formatTitlePage(titlePageInput);

    // Step 3: Format abstract
    progress(25, 'Formatting abstract...');
    const formattedAbstract = _formatAbstract({
      text: paper.abstract,
      keywords: paper.keywords,
    });
    if (!formattedAbstract.validation.valid) {
      formattedAbstract.validation.errors.forEach(e => log('warn', `Abstract: ${e}`));
    }
    formattedAbstract.validation.warnings.forEach(w => log('warn', `Abstract: ${w}`));

    // Step 4: Process headings in body
    progress(35, 'Processing headings...');
    const processedHeadings = _extractAllHeadings(paper.body);

    // Step 5: Format references
    progress(45, 'Formatting references...');
    const formattedReferences = paper.references
      ? _formatReferences({
          references: paper.references,
          sortAlphabetically: true,
        })
      : null;

    // Step 6: Generate running head
    progress(55, 'Generating running head...');
    const runningHeadText = paper.runningHead || paper.title;
    const formattedRunningHead = _formatRunningHead({
      runningHead: paper.runningHead,
      title: paper.title,
    });

    // Step 7: Assemble full document
    progress(65, 'Assembling document...');

    // Build the title page structure matching FormattedTitlePage interface
    // ExtendedFormattedTitlePage has `title` (formatted), `affiliations` (formatted strings), `authors` (AuthorInfo[])
    const titlePage: FormattedTitlePage = {
      title: formattedTitlePage.title, // Already formatted by _formatTitlePage
      authors: formattedTitlePage.authors, // Already in AuthorInfo[] format
      affiliations: formattedTitlePage.affiliations, // Already formatted string[]
      authorNote: formattedTitlePage.authorNote,
      runningHead: formattedRunningHead?.text || formattedTitlePage.runningHead || runningHeadText.toUpperCase().substring(0, 50),
      pageNumber: formattedTitlePage.pageNumber,
    };

    const formattedPaper: FormattedPaper = {
      titlePage,
      abstract: {
        content: formattedAbstract.content,
        keywords: formattedAbstract.keywords,
        wordCount: formattedAbstract.wordCount,
      },
      body: {
        content: paper.body,
        sections: parseMarkdownToSections(paper.body),
      },
      references: formattedReferences
        ? {
            entries: formattedReferences.entries,
            count: formattedReferences.count,
          }
        : undefined,
    };

    // Step 8: Generate PDF
    progress(75, 'Generating PDF...');
    // Build complete PdfOptions - outputPath is always provided from GeneratePdfOptions
    const generatorOptions: import('./types.js').PdfOptions = {
      outputPath,
      format: pdfOptions?.format,
      preferredGenerator: pdfOptions?.preferredGenerator,
      pandocPath: pdfOptions?.pandocPath,
      debug: pdfOptions?.debug,
      tempDir: pdfOptions?.tempDir,
      keepIntermediateFiles: pdfOptions?.keepIntermediateFiles,
    };
    const result = await generator.generate(formattedPaper, generatorOptions);

    const durationMs = Date.now() - startTime;
    progress(100, 'PDF generation complete');

    if (result.success) {
      return {
        success: true,
        outputPath: result.outputPath,
        generatorUsed: generatorType,
        warnings,
        durationMs,
      };
    } else {
      return {
        success: false,
        generatorUsed: generatorType,
        warnings,
        error: result.error?.message || 'Unknown generation error',
        durationMs,
      };
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Generation failed: ${errorMessage}`);

    return {
      success: false,
      generatorUsed: preferredGenerator || 'pdfkit',
      warnings,
      error: errorMessage,
      durationMs,
    };
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Checks if a generator type is available given current capabilities.
 */
function isGeneratorAvailable(
  type: GeneratorType,
  capabilities: GeneratorCapabilities
): boolean {
  switch (type) {
    case 'pandoc-latex':
      return capabilities.pandocLatex;
    case 'pandoc-html':
      return capabilities.pandocHtml;
    case 'pdfkit':
      return true; // Always available
    default:
      return false;
  }
}

/**
 * Selects the best available generator based on capabilities.
 * Preference: pandoc-latex > pandoc-html > pdfkit
 */
function selectBestGenerator(capabilities: GeneratorCapabilities): GeneratorType {
  if (capabilities.pandocLatex) {
    return 'pandoc-latex';
  }
  if (capabilities.pandocHtml) {
    return 'pandoc-html';
  }
  return 'pdfkit';
}

// =============================================================================
// CLASS-BASED API
// =============================================================================

/**
 * Object-oriented interface for APA PDF generation.
 *
 * Provides more control over the generation process with
 * separate initialization and generation phases.
 *
 * @example
 * ```typescript
 * const generator = new APAPdfGenerator();
 * await generator.initialize();
 *
 * console.log('Capabilities:', generator.getCapabilities());
 *
 * const result = await generator.generate({
 *   title: 'My Paper',
 *   authors: [{ name: 'Jane Smith' }],
 *   abstract: 'This paper...',
 *   body: '# Introduction\n...',
 * }, './output/paper');
 * ```
 */
export class APAPdfGenerator {
  private capabilities: GeneratorCapabilities | null = null;
  private initialized = false;
  private preferredGenerator?: GeneratorType;
  private pdfOptions?: Partial<import('./types.js').PdfOptions>;

  /**
   * Creates a new APAPdfGenerator instance.
   *
   * @param options - Optional configuration
   */
  constructor(options?: {
    preferredGenerator?: GeneratorType;
    pdfOptions?: Partial<import('./types.js').PdfOptions>;
  }) {
    this.preferredGenerator = options?.preferredGenerator;
    this.pdfOptions = options?.pdfOptions;
  }

  /**
   * Initializes the generator by detecting system capabilities.
   * Must be called before generate().
   *
   * @returns The detected capabilities
   */
  async initialize(): Promise<GeneratorCapabilities> {
    this.capabilities = await _detectCapabilities();
    this.initialized = true;
    return this.capabilities;
  }

  /**
   * Returns the detected capabilities.
   * Throws if initialize() hasn't been called.
   *
   * @returns Generator capabilities
   */
  getCapabilities(): GeneratorCapabilities {
    if (!this.capabilities) {
      throw new Error('APAPdfGenerator not initialized. Call initialize() first.');
    }
    return this.capabilities;
  }

  /**
   * Checks if the generator has been initialized.
   *
   * @returns True if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Generates a PDF from paper content.
   *
   * @param paper - Paper content and metadata
   * @param outputPath - Output file path (without extension)
   * @param callbacks - Optional progress and log callbacks
   * @returns Generation result
   */
  async generate(
    paper: PaperInputForGeneration,
    outputPath: string,
    callbacks?: {
      onProgress?: (percent: number, message: string) => void;
      onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
    }
  ): Promise<GeneratePdfResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    return generatePdf({
      paper,
      outputPath,
      preferredGenerator: this.preferredGenerator,
      pdfOptions: this.pdfOptions,
      onProgress: callbacks?.onProgress,
      onLog: callbacks?.onLog,
    });
  }

  /**
   * Returns the generator type that will be used.
   *
   * @returns The selected generator type
   */
  getSelectedGenerator(): GeneratorType {
    if (!this.capabilities) {
      throw new Error('APAPdfGenerator not initialized. Call initialize() first.');
    }

    if (this.preferredGenerator && isGeneratorAvailable(this.preferredGenerator, this.capabilities)) {
      return this.preferredGenerator;
    }
    return selectBestGenerator(this.capabilities);
  }
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

/**
 * Default export for simple import usage.
 */
export default {
  generatePdf,
  APAPdfGenerator,
};
