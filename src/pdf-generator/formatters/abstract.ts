/**
 * APA 7th Edition Abstract Page Formatter
 *
 * Formats abstract pages per APA 7th Edition requirements.
 * The abstract appears on page 2, following the title page.
 *
 * Reference: American Psychological Association. (2020). Publication manual
 * of the American Psychological Association (7th ed.), Section 2.9.
 *
 * Key APA 7th Edition Abstract Requirements:
 * - "Abstract" label: centered, bold, not italicized
 * - Abstract text: single paragraph, flush left (no first-line indent), double-spaced
 * - Word limit: typically 150-250 words
 * - Keywords: Optional, placed below abstract
 * - "Keywords:" in italics, followed by lowercase keywords separated by commas
 *
 * @module pdf-generator/formatters/abstract
 */

import { FormattedAbstract } from '../types.js';
import { APA_ABSTRACT, APA_FONTS } from '../constants.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Input for abstract formatting.
 */
export interface AbstractInput {
  /** Abstract text content */
  text: string;
  /** Optional keywords (will be formatted in lowercase, comma-separated) */
  keywords?: string[];
  /** Maximum word count (default: 250 per APA) */
  maxWords?: number;
  /** Minimum word count (default: 150 as typical recommendation) */
  minWords?: number;
}

/**
 * Result of abstract validation.
 */
export interface AbstractValidation {
  /** Whether the abstract passes validation (no errors) */
  valid: boolean;
  /** Word count of the abstract text */
  wordCount: number;
  /** Critical errors that must be fixed */
  errors: string[];
  /** Warnings about APA compliance (non-blocking) */
  warnings: string[];
}

/**
 * Extended formatted abstract with additional rendering metadata.
 */
export interface ExtendedFormattedAbstract extends FormattedAbstract {
  /** The formatted "Abstract" label */
  label: string;
  /** Formatted keywords string (if provided) */
  formattedKeywords?: string;
  /** Styling configuration */
  styles: AbstractStyles;
  /** Validation result */
  validation: AbstractValidation;
}

/**
 * Styles configuration for abstract rendering.
 */
export interface AbstractStyles {
  /** Whether the label should be bold */
  labelBold: boolean;
  /** Whether the label should be centered */
  labelCentered: boolean;
  /** Whether abstract text should have no first-line indent (APA: true) */
  noIndent: boolean;
  /** Whether content should be double-spaced */
  doubleSpaced: boolean;
  /** Whether keywords label should be italicized */
  keywordsItalicLabel: boolean;
  /** Whether keywords line should be indented */
  keywordsIndented: boolean;
  /** Font family */
  font: string;
  /** Font size in points */
  fontSize: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Default minimum word count for abstracts.
 * While APA doesn't specify a strict minimum, 150 words is commonly recommended.
 */
const DEFAULT_MIN_WORDS = 150;

/**
 * Default maximum word count per APA 7th Edition.
 */
const DEFAULT_MAX_WORDS = APA_ABSTRACT.maxWords;

// =============================================================================
// WORD COUNT UTILITIES
// =============================================================================

/**
 * Counts the number of words in a text string.
 * Words are defined as sequences of non-whitespace characters.
 *
 * @param text - The text to count words in
 * @returns Number of words in the text
 */
export function countWords(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  // Split by whitespace and filter out empty strings
  return trimmed.split(/\s+/).filter(word => word.length > 0).length;
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validates abstract content against APA 7th Edition requirements.
 *
 * Checks:
 * - Abstract text is not empty (error)
 * - Word count is within recommended range (warning)
 * - Abstract is a single paragraph (warning)
 *
 * @param input - Abstract input to validate
 * @returns Validation result with errors and warnings
 */
export function validateAbstract(input: AbstractInput): AbstractValidation {
  const { text, minWords, maxWords } = input;

  const wordCount = countWords(text);
  const minLimit = minWords ?? DEFAULT_MIN_WORDS;
  const maxLimit = maxWords ?? DEFAULT_MAX_WORDS;

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for empty abstract
  if (!text || !text.trim()) {
    errors.push('Abstract text is required');
  }

  // Check word count against recommended range
  if (wordCount > 0 && wordCount < minLimit) {
    warnings.push(
      `Abstract is ${wordCount} words; APA typically recommends at least ${minLimit} words`
    );
  }

  if (wordCount > maxLimit) {
    warnings.push(
      `Abstract is ${wordCount} words; APA recommends no more than ${maxLimit} words`
    );
  }

  // Check for paragraph breaks (abstract should be single paragraph)
  if (text && text.includes('\n\n')) {
    warnings.push('Abstract should be a single paragraph without breaks per APA 7th Edition');
  }

  // Check for multiple consecutive line breaks (another form of paragraph break)
  if (text && /\n\s*\n/.test(text)) {
    // Already warned above if '\n\n' present, but catch other patterns
    if (!text.includes('\n\n') && !warnings.some(w => w.includes('single paragraph'))) {
      warnings.push('Abstract should be a single paragraph without breaks per APA 7th Edition');
    }
  }

  return {
    valid: errors.length === 0,
    wordCount,
    errors,
    warnings,
  };
}

// =============================================================================
// KEYWORDS FORMATTING
// =============================================================================

/**
 * Formats keywords per APA 7th Edition requirements.
 * Keywords should be lowercase and separated by commas.
 *
 * @param keywords - Array of keyword strings
 * @returns Formatted keywords string
 */
export function formatKeywords(keywords: string[]): string {
  if (!keywords || keywords.length === 0) {
    return '';
  }

  // Convert to lowercase, trim whitespace, filter empty, join with comma-space
  return keywords
    .map(keyword => keyword.toLowerCase().trim())
    .filter(keyword => keyword.length > 0)
    .join(', ');
}

// =============================================================================
// TEXT NORMALIZATION
// =============================================================================

/**
 * Normalizes abstract text to a single paragraph.
 * Removes extra whitespace, collapses line breaks, and trims.
 *
 * @param text - Raw abstract text
 * @returns Normalized single-paragraph text
 */
export function normalizeAbstractText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    // Replace all types of line breaks with spaces
    .replace(/\r\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ')
    // Collapse multiple spaces into one
    .replace(/\s+/g, ' ')
    // Trim leading/trailing whitespace
    .trim();
}

// =============================================================================
// MAIN FORMATTING FUNCTION
// =============================================================================

/**
 * Formats abstract content per APA 7th Edition requirements.
 *
 * APA 7th Edition Abstract Formatting:
 * - Starts on page 2 (after title page)
 * - "Abstract" label centered and bold (not italicized)
 * - Single paragraph with no first-line indentation
 * - Double-spaced throughout
 * - Keywords optional: "Keywords:" in italics, indented, followed by keywords
 *
 * @param input - Abstract input data
 * @returns Formatted abstract object
 */
export function formatAbstract(input: AbstractInput): ExtendedFormattedAbstract {
  const { text, keywords = [] } = input;

  // Validate the input
  const validation = validateAbstract(input);

  // Normalize text to single paragraph
  const normalizedText = normalizeAbstractText(text);

  // Format keywords if provided
  const formattedKeywords = keywords.length > 0 ? formatKeywords(keywords) : undefined;

  return {
    // Base FormattedAbstract fields (from types.ts)
    content: normalizedText,
    keywords: keywords.length > 0 ? keywords : undefined,
    wordCount: validation.wordCount,
    // Extended fields
    label: APA_ABSTRACT.sectionTitle,
    formattedKeywords,
    styles: {
      labelBold: true,
      labelCentered: true,
      noIndent: APA_ABSTRACT.noIndent,
      doubleSpaced: true,
      keywordsItalicLabel: APA_ABSTRACT.keywordsItalic,
      keywordsIndented: APA_ABSTRACT.keywordsIndented,
      font: APA_FONTS.primary,
      fontSize: APA_FONTS.size.body,
    },
    validation,
  };
}

// =============================================================================
// OUTPUT GENERATION - MARKDOWN/LATEX
// =============================================================================

/**
 * Generates LaTeX/Markdown representation of the abstract page.
 * Uses LaTeX commands for proper APA formatting.
 *
 * @param abstract - Formatted abstract object
 * @returns Markdown/LaTeX string for abstract page
 */
export function generateAbstractMarkdown(
  abstract: ExtendedFormattedAbstract | FormattedAbstract
): string {
  const lines: string[] = [];

  // Start new page for abstract (page 2)
  lines.push('\\newpage');
  lines.push('');

  // Centered, bold "Abstract" heading
  lines.push('\\begin{center}');
  lines.push('**Abstract**');
  lines.push('\\end{center}');
  lines.push('');

  // Abstract text - no first-line indent (crucial for APA compliance)
  lines.push('\\noindent');

  // Get the content from either extended or base type
  const content = 'content' in abstract ? abstract.content : '';
  lines.push(content);
  lines.push('');

  // Keywords if present
  const ext = abstract as ExtendedFormattedAbstract;
  const keywordsStr = ext.formattedKeywords || (abstract.keywords && formatKeywords(abstract.keywords));

  if (keywordsStr) {
    // Indented line with italic "Keywords:" label
    lines.push(`\\indent *Keywords:* ${keywordsStr}`);
    lines.push('');
  }

  return lines.join('\n');
}

// =============================================================================
// OUTPUT GENERATION - HTML
// =============================================================================

/**
 * Generates HTML representation of the abstract page.
 * Uses semantic HTML with CSS classes for styling.
 *
 * @param abstract - Formatted abstract object
 * @returns HTML string for abstract page
 */
export function generateAbstractHtml(
  abstract: ExtendedFormattedAbstract | FormattedAbstract
): string {
  const lines: string[] = [];

  lines.push('<section class="abstract-page">');

  // Centered, bold "Abstract" heading
  lines.push('  <h2 class="abstract-heading">Abstract</h2>');
  lines.push('');

  // Abstract text - no first-line indent
  const content = 'content' in abstract ? abstract.content : '';
  lines.push(`  <p class="abstract-text">${escapeHtml(content)}</p>`);

  // Keywords if present
  const ext = abstract as ExtendedFormattedAbstract;
  const keywordsStr = ext.formattedKeywords || (abstract.keywords && formatKeywords(abstract.keywords));

  if (keywordsStr) {
    lines.push('');
    lines.push('  <p class="keywords">');
    lines.push(`    <em>Keywords:</em> ${escapeHtml(keywordsStr)}`);
    lines.push('  </p>');
  }

  lines.push('</section>');

  return lines.join('\n');
}

/**
 * Escapes HTML special characters to prevent XSS.
 *
 * @param text - Text to escape
 * @returns Escaped text safe for HTML insertion
 */
function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// =============================================================================
// CSS STYLES FOR HTML OUTPUT
// =============================================================================

/**
 * Generates CSS styles for abstract page HTML output.
 * Follows APA 7th Edition formatting requirements.
 *
 * Key styles:
 * - Abstract starts on new page (page-break-before)
 * - "Abstract" heading centered and bold
 * - Abstract text has NO first-line indent (unlike body paragraphs)
 * - Keywords line is indented with italic label
 * - All content double-spaced
 *
 * @returns CSS string for abstract page styling
 */
export function getAbstractCss(): string {
  return `
/* Abstract Page Styles - APA 7th Edition */

.abstract-page {
  page-break-before: always;
  font-family: "Times New Roman", Times, Georgia, serif;
  font-size: 12pt;
  line-height: 2; /* Double-spaced */
}

.abstract-heading {
  text-align: center;
  font-weight: bold;
  font-style: normal; /* Not italicized per APA */
  font-size: 12pt;
  margin: 0 0 24pt 0; /* One double-spaced line after heading */
}

.abstract-text {
  text-indent: 0; /* NO first-line indent for abstract - key APA requirement */
  margin: 0;
  line-height: 2; /* Double-spaced */
  text-align: left; /* Flush left */
}

.keywords {
  text-indent: 0.5in; /* Keywords line is indented */
  margin: 24pt 0 0 0; /* One double-spaced line before keywords */
  line-height: 2;
}

.keywords em {
  font-style: italic; /* "Keywords:" label is italicized */
}
`.trim();
}

// =============================================================================
// VALIDATION UTILITIES
// =============================================================================

/**
 * Validates abstract input for required fields and content.
 * More comprehensive than validateAbstract - checks input structure.
 *
 * @param input - Abstract input to validate
 * @returns Object with valid flag and error messages
 */
export function validateAbstractInput(input: AbstractInput): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const result = validateAbstract(input);

  return {
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
  };
}

/**
 * Checks if the abstract word count is within APA recommended limits.
 *
 * @param text - Abstract text to check
 * @param min - Minimum words (default: 150)
 * @param max - Maximum words (default: 250)
 * @returns Object with in-range flag and actual count
 */
export function isWordCountInRange(
  text: string,
  min: number = DEFAULT_MIN_WORDS,
  max: number = DEFAULT_MAX_WORDS
): { inRange: boolean; wordCount: number; min: number; max: number } {
  const wordCount = countWords(text);
  return {
    inRange: wordCount >= min && wordCount <= max,
    wordCount,
    min,
    max,
  };
}
