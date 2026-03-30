/**
 * APA 7th Edition Running Head Formatter
 *
 * Formats running heads per APA 7th Edition requirements.
 * Supports both professional and student paper formats.
 *
 * Reference: American Psychological Association. (2020). Publication manual
 * of the American Psychological Association (7th ed.), Section 2.18.
 *
 * Key requirements:
 * - Professional papers: Running head required on all pages
 * - Student papers: Running head optional (varies by instructor)
 * - Maximum 50 characters including spaces
 * - ALL CAPS (uppercase)
 * - Positioned in header: running head flush left, page number flush right
 * - 0.5" from top of page
 * - Same font as body text
 *
 * @module pdf-generator/formatters/running-head
 */

import { APA_RUNNING_HEAD, APA_FONTS } from '../constants.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Input parameters for running head generation.
 */
export interface RunningHeadInput {
  /** Custom running head text (if not provided, auto-generated from title) */
  runningHead?: string;
  /** Paper title used to auto-generate running head if not explicitly provided */
  title?: string;
  /** Maximum character length (default: 50 per APA 7th) */
  maxLength?: number;
  /** Whether to include running head on title page (default: true for professional) */
  includeOnTitlePage?: boolean;
  /** Whether this is a student paper (running head optional) */
  isStudentPaper?: boolean;
}

/**
 * Formatted running head output with styling and rendering information.
 */
export interface FormattedRunningHead {
  /** The formatted running head text (ALL CAPS, truncated if necessary) */
  text: string;
  /** Original length before truncation */
  originalLength: number;
  /** Whether the text was truncated to meet max length */
  truncated: boolean;
  /** Styling information for rendering */
  styles: {
    /** Whether text is in all caps */
    allCaps: boolean;
    /** Font family */
    font: string;
    /** Font size in points */
    fontSize: number;
    /** Whether flush left aligned */
    flushLeft: boolean;
  };
  /** LaTeX header configuration */
  latex: string;
  /** HTML header markup */
  html: string;
  /** CSS for running head styling */
  css: string;
}

/**
 * Validation result for running head text.
 */
export interface RunningHeadValidation {
  /** Whether the running head is valid */
  valid: boolean;
  /** Error messages (issues that must be fixed) */
  errors: string[];
  /** Warning messages (recommendations) */
  warnings: string[];
}

// =============================================================================
// TRUNCATION UTILITIES
// =============================================================================

/**
 * Truncates text to maximum length, preferring word boundaries.
 *
 * This function attempts to truncate at a word boundary to avoid
 * cutting words in the middle. If no suitable word boundary is found
 * within 60% of the max length, it truncates at the exact position.
 *
 * @param text - The text to truncate
 * @param maxLength - Maximum character length
 * @returns Object with truncated text and whether truncation occurred
 *
 * @example
 * ```typescript
 * truncateToMax("THE EFFECTS OF CLIMATE CHANGE ON BIODIVERSITY", 30);
 * // Returns: { text: "THE EFFECTS OF CLIMATE CHANGE", truncated: true }
 * ```
 */
export function truncateToMax(
  text: string,
  maxLength: number
): { text: string; truncated: boolean } {
  if (!text) {
    return { text: '', truncated: false };
  }

  if (text.length <= maxLength) {
    return { text, truncated: false };
  }

  // Get the substring up to max length
  const truncated = text.substring(0, maxLength);

  // Find the last space within the truncated portion
  const lastSpace = truncated.lastIndexOf(' ');

  // Only cut at word boundary if we keep at least 60% of max length
  // This prevents very short running heads when the first word is long
  if (lastSpace > maxLength * 0.6) {
    return {
      text: truncated.substring(0, lastSpace).trim(),
      truncated: true,
    };
  }

  // No suitable word boundary found, truncate at max length
  return {
    text: truncated.trim(),
    truncated: true,
  };
}

// =============================================================================
// RUNNING HEAD GENERATION
// =============================================================================

/**
 * Generates a running head string from input parameters.
 *
 * This function either uses a provided running head or generates one
 * from the paper title. For student papers without an explicit running
 * head, returns null (as running heads are optional for student papers).
 *
 * Per APA 7th Edition:
 * - Running head should be an abbreviated title
 * - Maximum 50 characters including spaces
 * - ALL CAPS
 *
 * @param input - Running head input parameters
 * @returns The generated running head text (ALL CAPS) or null if not applicable
 *
 * @example
 * ```typescript
 * // Using explicit running head
 * generateRunningHead({ runningHead: "Climate Change Effects" });
 * // Returns: "CLIMATE CHANGE EFFECTS"
 *
 * // Auto-generating from title
 * generateRunningHead({ title: "The Long-Term Effects of Climate Change" });
 * // Returns: "THE LONG-TERM EFFECTS OF CLIMATE CHANGE"
 *
 * // Student paper without running head
 * generateRunningHead({ isStudentPaper: true });
 * // Returns: null
 * ```
 */
export function generateRunningHead(input: RunningHeadInput): string | null {
  // Student papers may not need running head
  if (input.isStudentPaper && !input.runningHead) {
    return null;
  }

  const maxLength = input.maxLength ?? APA_RUNNING_HEAD.maxLength;

  // Use provided running head or generate from title
  let text = input.runningHead || input.title || '';

  if (!text) {
    return null;
  }

  // Convert to uppercase (APA requirement)
  text = text.toUpperCase();

  // Truncate if necessary
  const { text: truncatedText } = truncateToMax(text, maxLength);

  return truncatedText;
}

// =============================================================================
// MAIN FORMATTING FUNCTION
// =============================================================================

/**
 * Formats a running head with complete styling and rendering information.
 *
 * This is the main entry point for running head formatting. It generates
 * the running head text and provides all necessary information for
 * rendering in various output formats (LaTeX, HTML, PDF).
 *
 * @param input - Running head input parameters
 * @returns Complete formatted running head or null if not applicable
 *
 * @example
 * ```typescript
 * const result = formatRunningHead({
 *   title: "Effects of Meditation on Stress Reduction",
 *   isStudentPaper: false
 * });
 *
 * console.log(result.text);  // "EFFECTS OF MEDITATION ON STRESS REDUCTION"
 * console.log(result.truncated);  // false
 * console.log(result.latex);  // LaTeX fancyhdr configuration
 * ```
 */
export function formatRunningHead(
  input: RunningHeadInput
): FormattedRunningHead | null {
  const text = generateRunningHead(input);

  if (!text) {
    return null;
  }

  const originalText = (input.runningHead || input.title || '').toUpperCase();
  const maxLength = input.maxLength ?? APA_RUNNING_HEAD.maxLength;

  return {
    text,
    originalLength: originalText.length,
    truncated: originalText.length > maxLength,
    styles: {
      allCaps: true,
      font: APA_FONTS.primary,
      fontSize: APA_FONTS.size.body,
      flushLeft: true,
    },
    latex: generateLatexHeader(text, input.includeOnTitlePage),
    html: generateHtmlHeader(text),
    css: getRunningHeadCss(),
  };
}

// =============================================================================
// LATEX OUTPUT
// =============================================================================

/**
 * Generates LaTeX configuration for running head using fancyhdr.
 *
 * Creates a complete LaTeX header/footer configuration that:
 * - Places running head flush left in the header
 * - Places page number flush right in the header
 * - Removes the header rule line
 *
 * @param runningHead - The running head text (should already be ALL CAPS)
 * @param includeOnTitlePage - Whether to include on title page (default: true)
 * @returns LaTeX code for header configuration
 */
function generateLatexHeader(
  runningHead: string,
  includeOnTitlePage = true
): string {
  // Escape special LaTeX characters
  const escapedText = escapeLatex(runningHead);

  const titlePageHandling = includeOnTitlePage
    ? `\\fancypagestyle{plain}{
  \\fancyhf{}
  \\fancyhead[L]{${escapedText}}
  \\fancyhead[R]{\\thepage}
  \\renewcommand{\\headrulewidth}{0pt}
}`
    : `\\fancypagestyle{plain}{
  \\fancyhf{}
  \\fancyhead[R]{\\thepage}
  \\renewcommand{\\headrulewidth}{0pt}
}`;

  return `% APA 7th Edition Running Head Configuration
\\usepackage{fancyhdr}
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{${escapedText}}
\\fancyhead[R]{\\thepage}
\\renewcommand{\\headrulewidth}{0pt}
\\setlength{\\headheight}{14.5pt}

% Title page style (first page)
${titlePageHandling}
`;
}

/**
 * Escapes special LaTeX characters in text.
 *
 * @param text - Text to escape
 * @returns LaTeX-safe text
 */
function escapeLatex(text: string): string {
  if (!text) return '';

  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, '\\$&')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

// =============================================================================
// HTML OUTPUT
// =============================================================================

/**
 * Generates HTML markup for running head container.
 *
 * Creates a semantic header element with:
 * - Running head text flush left
 * - Page number placeholder flush right
 *
 * The page number is rendered via CSS counters or JavaScript
 * depending on the PDF generation method.
 *
 * @param runningHead - The running head text
 * @returns HTML string for the header
 */
function generateHtmlHeader(runningHead: string): string {
  return `<header class="running-head-container" role="banner">
  <span class="running-head" aria-label="Running head">${escapeHtml(runningHead)}</span>
  <span class="page-number" aria-label="Page number"></span>
</header>`;
}

/**
 * Escapes HTML special characters to prevent XSS.
 *
 * @param text - Text to escape
 * @returns HTML-safe text
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
// CSS STYLES
// =============================================================================

/**
 * Generates CSS styles for running head formatting.
 *
 * Provides both:
 * - @page rules for print/PDF media
 * - .running-head-container styles for screen display
 *
 * Per APA 7th Edition:
 * - Header is 0.5" from top of page
 * - Running head flush left
 * - Page number flush right
 * - Same font as body text (Times New Roman 12pt)
 *
 * @returns CSS string for running head styling
 */
export function getRunningHeadCss(): string {
  return `/* APA 7th Edition Running Head Styles */

/* Print/PDF styles using CSS Paged Media */
@page {
  margin-top: 1in;
  @top-left {
    content: attr(data-running-head);
    font-family: "Times New Roman", Times, Georgia, serif;
    font-size: 12pt;
    text-transform: uppercase;
    vertical-align: bottom;
    padding-bottom: 0.5in;
  }
  @top-right {
    content: counter(page);
    font-family: "Times New Roman", Times, Georgia, serif;
    font-size: 12pt;
    vertical-align: bottom;
    padding-bottom: 0.5in;
  }
}

/* Screen display styles */
.running-head-container {
  position: fixed;
  top: 0.5in;
  left: 1in;
  right: 1in;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-family: "Times New Roman", Times, Georgia, serif;
  font-size: 12pt;
  line-height: 1;
  z-index: 1000;
}

.running-head {
  text-transform: uppercase;
  text-align: left;
}

.page-number {
  text-align: right;
}

/* For paged.js or similar polyfills */
.pagedjs_page .running-head-container {
  position: absolute;
  top: 0;
}

/* Print media query fallback */
@media print {
  .running-head-container {
    position: running(header);
  }

  @page {
    @top-left {
      content: element(header);
    }
  }
}`;
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validates a running head against APA 7th Edition requirements.
 *
 * Checks:
 * - Running head is not empty (required for professional papers)
 * - Running head does not exceed maximum length (50 characters)
 * - Running head is in ALL CAPS (warning if not)
 *
 * @param text - The running head text to validate
 * @param maxLength - Maximum allowed length (default: 50)
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```typescript
 * validateRunningHead("CLIMATE CHANGE EFFECTS");
 * // Returns: { valid: true, errors: [], warnings: [] }
 *
 * validateRunningHead("This is way too long and will exceed the fifty character limit");
 * // Returns: { valid: false, errors: ["Running head exceeds 50 characters..."], warnings: [...] }
 * ```
 */
export function validateRunningHead(
  text: string,
  maxLength?: number
): RunningHeadValidation {
  const max = maxLength ?? APA_RUNNING_HEAD.maxLength;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if empty
  if (!text || text.trim().length === 0) {
    errors.push('Running head is required for professional papers');
    return { valid: false, errors, warnings };
  }

  const trimmedText = text.trim();

  // Check length
  if (trimmedText.length > max) {
    errors.push(
      `Running head exceeds ${max} characters (currently ${trimmedText.length} characters). ` +
        `Per APA 7th Edition, the running head must be no more than ${max} characters including spaces.`
    );
  }

  // Check for all caps (warning only, as this can be auto-corrected)
  if (trimmedText !== trimmedText.toUpperCase()) {
    warnings.push(
      'Running head should be in ALL CAPS per APA 7th Edition. ' +
        'This will be automatically corrected during formatting.'
    );
  }

  // Check for leading/trailing whitespace
  if (text !== trimmedText) {
    warnings.push('Running head contains leading or trailing whitespace that will be removed.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Creates a running head from a title by abbreviating intelligently.
 *
 * This function attempts to create a meaningful abbreviation when
 * the title exceeds the maximum length by:
 * 1. Removing subtitle (after colon)
 * 2. Removing articles at the beginning
 * 3. Truncating at word boundary
 *
 * @param title - The full paper title
 * @param maxLength - Maximum character length (default: 50)
 * @returns Abbreviated running head in ALL CAPS
 *
 * @example
 * ```typescript
 * abbreviateTitle("The Effects of Climate Change on Global Biodiversity: A Meta-Analysis");
 * // Returns: "EFFECTS OF CLIMATE CHANGE ON GLOBAL BIODIVERSITY"
 * ```
 */
export function abbreviateTitle(title: string, maxLength = 50): string {
  if (!title) return '';

  let abbreviated = title.toUpperCase().trim();

  // If already within limit, return as-is
  if (abbreviated.length <= maxLength) {
    return abbreviated;
  }

  // Remove subtitle (text after colon)
  const colonIndex = abbreviated.indexOf(':');
  if (colonIndex > 0 && colonIndex < abbreviated.length - 1) {
    const mainTitle = abbreviated.substring(0, colonIndex).trim();
    if (mainTitle.length <= maxLength) {
      return mainTitle;
    }
    abbreviated = mainTitle;
  }

  // Remove leading articles if still too long
  const articlesToRemove = ['THE ', 'A ', 'AN '];
  for (const article of articlesToRemove) {
    if (abbreviated.startsWith(article) && abbreviated.length > maxLength) {
      const withoutArticle = abbreviated.substring(article.length);
      if (withoutArticle.length <= maxLength) {
        return withoutArticle;
      }
      abbreviated = withoutArticle;
      break;
    }
  }

  // Final truncation at word boundary
  const { text } = truncateToMax(abbreviated, maxLength);
  return text;
}

/**
 * Checks if a running head needs to be displayed based on paper type and page.
 *
 * @param isStudentPaper - Whether this is a student paper
 * @param hasExplicitRunningHead - Whether an explicit running head was provided
 * @param pageNumber - Current page number (1-indexed)
 * @param includeOnTitlePage - Whether to include on title page
 * @returns Whether the running head should be displayed
 */
export function shouldDisplayRunningHead(
  isStudentPaper: boolean,
  hasExplicitRunningHead: boolean,
  pageNumber: number,
  includeOnTitlePage = true
): boolean {
  // Title page check
  if (pageNumber === 1 && !includeOnTitlePage) {
    return false;
  }

  // Professional papers always need running head
  if (!isStudentPaper) {
    return true;
  }

  // Student papers only show running head if explicitly provided
  return hasExplicitRunningHead;
}
