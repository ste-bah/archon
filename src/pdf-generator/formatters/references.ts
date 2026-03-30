/**
 * APA 7th Edition References Formatter
 *
 * Formats reference lists per APA 7th Edition requirements.
 * Handles alphabetical sorting, hanging indents, and DOI hyperlinking.
 *
 * Reference: American Psychological Association. (2020). Publication manual
 * of the American Psychological Association (7th ed.), Sections 2.12, 9.43.
 *
 * Key APA 7th Edition References Requirements:
 * - "References" heading: centered, bold (same as Level 1 heading)
 * - New page (page break before references section)
 * - Hanging indent: first line flush left, subsequent lines indented 0.5"
 * - Double-spaced within and between entries
 * - Alphabetical order by first author surname (then by year for same author)
 * - DOI format: https://doi.org/xxxxx (as hyperlink when possible)
 *
 * @module pdf-generator/formatters/references
 */

import { FormattedReferences } from '../types.js';
import { APA_REFERENCES, APA_FONTS, APA_SPACING } from '../constants.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Parsed reference with extracted metadata for sorting and formatting.
 */
export interface Reference {
  /** Original raw reference text */
  raw: string;
  /** First author's surname for sorting */
  authors?: string;
  /** Publication year for secondary sorting */
  year?: string;
  /** Work title (if extractable) */
  title?: string;
  /** Source/journal (if extractable) */
  source?: string;
  /** DOI (normalized to https://doi.org/... format) */
  doi?: string;
  /** URL (if not a DOI) */
  url?: string;
  /** Whether parsing was successful */
  parsed: boolean;
}

/**
 * Input for references formatting.
 */
export interface ReferencesInput {
  /** Array of raw reference strings */
  references: string[];
  /** Whether to sort alphabetically by author (default: true per APA) */
  sortAlphabetically?: boolean;
}

/**
 * Extended formatted references with additional rendering metadata.
 */
export interface ExtendedFormattedReferences extends FormattedReferences {
  /** Section label ("References") */
  label: string;
  /** Styling configuration */
  styles: ReferencesStyles;
}

/**
 * Styles configuration for references rendering.
 */
export interface ReferencesStyles {
  /** Whether the label should be bold */
  labelBold: boolean;
  /** Whether the label should be centered */
  labelCentered: boolean;
  /** Hanging indent value (e.g., "0.5in") */
  hangingIndent: string;
  /** Whether content should be double-spaced */
  doubleSpaced: boolean;
  /** Font family */
  font: string;
  /** Font size in points */
  fontSize: number;
}

// =============================================================================
// REFERENCE PARSING
// =============================================================================

/**
 * Parses a raw reference string to extract metadata for sorting.
 *
 * Extracts:
 * - First author surname (for primary sort)
 * - Publication year (for secondary sort)
 * - DOI (for hyperlinking)
 * - URL (if not a DOI)
 *
 * @param rawRef - Raw reference string
 * @returns Parsed reference with extracted metadata
 *
 * @example
 * const ref = parseReference('Smith, J. A. (2020). Title. Journal. https://doi.org/10.1234/abc');
 * // ref.authors = 'Smith'
 * // ref.year = '2020'
 * // ref.doi = 'https://doi.org/10.1234/abc'
 */
export function parseReference(rawRef: string): Reference {
  const ref: Reference = {
    raw: rawRef.trim(),
    parsed: false,
  };

  if (!rawRef || typeof rawRef !== 'string') {
    return ref;
  }

  // Try to extract DOI in various formats
  // Matches: https://doi.org/xxx, http://doi.org/xxx, doi: xxx, doi:xxx
  const doiMatch = rawRef.match(
    /https?:\/\/doi\.org\/([\w.\-/]+)|doi:\s*([\w.\-/]+)/i
  );
  if (doiMatch) {
    const doiValue = doiMatch[1] || doiMatch[2];
    ref.doi = `https://doi.org/${doiValue}`;
  }

  // Try to extract URL (if not DOI)
  if (!ref.doi) {
    // Match URLs but avoid matching partial DOI patterns
    const urlMatch = rawRef.match(/https?:\/\/(?!doi\.org)[^\s)]+/);
    if (urlMatch) {
      ref.url = urlMatch[0];
    }
  }

  // Try to extract year in parentheses (standard APA format)
  // Handles: (2020), (2020a), (2020, January), (n.d.), (in press)
  const yearMatch = rawRef.match(/\((\d{4}[a-z]?)\)/);
  if (yearMatch) {
    ref.year = yearMatch[1];
  } else {
    // Check for special year formats
    const specialYearMatch = rawRef.match(/\((n\.d\.|in press)\)/i);
    if (specialYearMatch) {
      ref.year = specialYearMatch[1].toLowerCase();
    }
  }

  // Try to extract first author surname for sorting
  // APA format typically starts with: LastName, F. M.
  // Also handle organizational authors: American Psychological Association.
  const authorMatch = rawRef.match(
    /^([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)*)/
  );
  if (authorMatch) {
    // Get just the first surname for sorting
    const fullMatch = authorMatch[1];
    // If there's a comma, take everything before it (surname)
    const commaIndex = fullMatch.indexOf(',');
    if (commaIndex > 0) {
      ref.authors = fullMatch.substring(0, commaIndex).trim();
    } else {
      // For organizational authors, use the first word
      ref.authors = fullMatch.split(/\s+/)[0];
    }
  }

  ref.parsed = !!(ref.authors || ref.year);

  return ref;
}

// =============================================================================
// SORTING
// =============================================================================

/**
 * Sorts references alphabetically per APA 7th Edition requirements.
 *
 * Sorting rules:
 * 1. Primary: First author surname (case-insensitive)
 * 2. Secondary: Same author sorted by year (oldest first)
 * 3. Tertiary: Same author, same year sorted by suffix (2020a before 2020b)
 *
 * @param references - Array of parsed references
 * @returns New array sorted per APA requirements
 *
 * @example
 * const refs = [parseReference('Zebra, A. (2020)...'), parseReference('Adams, B. (2019)...')];
 * const sorted = sortReferences(refs);
 * // sorted[0].authors = 'Adams', sorted[1].authors = 'Zebra'
 */
export function sortReferences(references: Reference[]): Reference[] {
  return [...references].sort((a, b) => {
    // Primary sort: author surname (case-insensitive)
    // Use raw text as fallback if author not parsed
    const authorA = (a.authors || a.raw).toLowerCase();
    const authorB = (b.authors || b.raw).toLowerCase();

    if (authorA !== authorB) {
      return authorA.localeCompare(authorB, 'en', { sensitivity: 'base' });
    }

    // Secondary sort: year (oldest first, special cases at end)
    const yearA = a.year || '9999'; // Put unparsed years at end
    const yearB = b.year || '9999';

    // Handle special years
    const normalizeYear = (year: string): string => {
      if (year === 'n.d.') return '9998';
      if (year === 'in press') return '9997';
      return year;
    };

    return normalizeYear(yearA).localeCompare(normalizeYear(yearB));
  });
}

// =============================================================================
// DOI FORMATTING
// =============================================================================

/**
 * Formats a DOI to the standard https://doi.org/ URL format.
 *
 * @param doi - DOI in any common format
 * @returns DOI as full HTTPS URL
 *
 * @example
 * formatDoi('10.1234/abc')           // 'https://doi.org/10.1234/abc'
 * formatDoi('doi: 10.1234/abc')      // 'https://doi.org/10.1234/abc'
 * formatDoi('https://doi.org/10.1234/abc') // unchanged
 */
export function formatDoi(doi: string): string {
  if (!doi || typeof doi !== 'string') {
    return '';
  }

  const trimmed = doi.trim();

  // Already in correct format
  if (trimmed.startsWith('https://doi.org/')) {
    return trimmed;
  }

  // HTTP format - upgrade to HTTPS
  if (trimmed.toLowerCase().startsWith('http://doi.org/')) {
    return trimmed.replace(/^http:/i, 'https:');
  }

  // Just the DOI number starting with 10.
  if (trimmed.startsWith('10.')) {
    return `https://doi.org/${trimmed}`;
  }

  // DOI with prefix
  if (trimmed.toLowerCase().startsWith('doi:')) {
    const doiValue = trimmed.substring(4).trim();
    return `https://doi.org/${doiValue}`;
  }

  // dx.doi.org format - convert to doi.org
  if (trimmed.toLowerCase().includes('dx.doi.org')) {
    return trimmed.replace(/dx\.doi\.org/i, 'doi.org').replace(/^http:/i, 'https:');
  }

  return trimmed;
}

// =============================================================================
// MAIN FORMATTING FUNCTION
// =============================================================================

/**
 * Formats references per APA 7th Edition requirements.
 *
 * APA 7th Edition References Formatting:
 * - "References" heading centered and bold
 * - Start on new page
 * - Hanging indent: 0.5 inches
 * - Double-spaced throughout
 * - Alphabetical by first author surname
 * - DOIs formatted as https://doi.org/ URLs
 *
 * @param input - References input data
 * @returns Formatted references object
 *
 * @example
 * const result = formatReferences({
 *   references: [
 *     'Zebra, A. (2020). Title. Journal. https://doi.org/10.1234',
 *     'Adams, B. (2019). Another title. Publisher.'
 *   ]
 * });
 * // result.entries[0] starts with Adams, result.entries[1] starts with Zebra
 */
export function formatReferences(input: ReferencesInput): ExtendedFormattedReferences {
  const { references: rawRefs, sortAlphabetically = true } = input;

  if (!rawRefs || !Array.isArray(rawRefs)) {
    return {
      label: APA_REFERENCES.sectionTitle,
      entries: [],
      count: 0,
      styles: {
        labelBold: APA_REFERENCES.headingBold,
        labelCentered: APA_REFERENCES.headingCentered,
        hangingIndent: APA_REFERENCES.hangingIndent,
        doubleSpaced: APA_REFERENCES.doubleSpaced,
        font: APA_FONTS.primary,
        fontSize: APA_FONTS.size.body,
      },
    };
  }

  // Parse all references
  let refs = rawRefs
    .filter((ref) => ref && typeof ref === 'string' && ref.trim().length > 0)
    .map(parseReference);

  // Sort if requested (default per APA)
  if (sortAlphabetically) {
    refs = sortReferences(refs);
  }

  // Format for output - normalize DOIs
  const formatted = refs.map((ref) => {
    let text = ref.raw;

    // Normalize DOI format if present
    if (ref.doi) {
      const formattedDoi = formatDoi(ref.doi);
      // Replace the original DOI in the text with the normalized format
      // Handle various DOI formats in the original text
      text = text.replace(
        /https?:\/\/(?:dx\.)?doi\.org\/[\w.\-/]+|doi:\s*[\w.\-/]+/gi,
        formattedDoi
      );
    }

    return text;
  });

  return {
    label: APA_REFERENCES.sectionTitle,
    entries: formatted,
    count: formatted.length,
    styles: {
      labelBold: APA_REFERENCES.headingBold,
      labelCentered: APA_REFERENCES.headingCentered,
      hangingIndent: APA_REFERENCES.hangingIndent,
      doubleSpaced: APA_REFERENCES.doubleSpaced,
      font: APA_FONTS.primary,
      fontSize: APA_FONTS.size.body,
    },
  };
}

// =============================================================================
// OUTPUT GENERATION - MARKDOWN/LATEX
// =============================================================================

/**
 * Generates LaTeX/Markdown representation of the references page.
 * Uses LaTeX commands for proper APA formatting with hanging indents.
 *
 * @param refs - Formatted references object
 * @returns Markdown/LaTeX string for references page
 */
export function generateReferencesMarkdown(
  refs: ExtendedFormattedReferences | FormattedReferences
): string {
  const lines: string[] = [];

  // Start new page for references
  lines.push('\\newpage');
  lines.push('');

  // Centered, bold "References" heading (Level 1 style per APA)
  lines.push('\\begin{center}');
  lines.push('**References**');
  lines.push('\\end{center}');
  lines.push('');

  // Begin hanging indent environment
  // hangparas{indent}{lines-to-indent-from}
  // 0.5in indent, starting from line 2 (1 = indent all lines after first)
  lines.push('\\begin{hangparas}{0.5in}{1}');
  lines.push('');

  // Each reference entry, double-spaced
  refs.entries.forEach((entry) => {
    // Convert DOI URLs to hyperlinks in LaTeX
    let formattedEntry = entry;
    formattedEntry = formattedEntry.replace(
      /(https:\/\/doi\.org\/[\w.\-/]+)/g,
      '\\href{$1}{$1}'
    );
    // Also handle regular URLs
    formattedEntry = formattedEntry.replace(
      /(https?:\/\/(?!doi\.org)[^\s}]+)/g,
      '\\href{$1}{$1}'
    );

    lines.push(formattedEntry);
    lines.push(''); // Double-space between entries
  });

  lines.push('\\end{hangparas}');

  return lines.join('\n');
}

// =============================================================================
// OUTPUT GENERATION - HTML
// =============================================================================

/**
 * Generates HTML representation of the references page.
 * Uses semantic HTML with CSS classes for styling.
 *
 * @param refs - Formatted references object
 * @returns HTML string for references page
 */
export function generateReferencesHtml(
  refs: ExtendedFormattedReferences | FormattedReferences
): string {
  const lines: string[] = [];

  lines.push('<section class="references-page">');

  // Centered, bold "References" heading
  lines.push('  <h2 class="references-heading">References</h2>');
  lines.push('');
  lines.push('  <div class="references-list">');

  refs.entries.forEach((entry) => {
    // First escape HTML, then convert URLs to hyperlinks
    let formattedEntry = escapeHtml(entry);

    // Convert DOI URLs to hyperlinks
    formattedEntry = formattedEntry.replace(
      /(https:\/\/doi\.org\/[\w.\-/]+)/g,
      '<a href="$1" class="doi-link">$1</a>'
    );

    // Convert other URLs to hyperlinks (that aren't already linked)
    formattedEntry = formattedEntry.replace(
      /(https?:\/\/(?!doi\.org)[^\s<]+)/g,
      '<a href="$1" class="url-link">$1</a>'
    );

    lines.push(`    <p class="reference-entry">${formattedEntry}</p>`);
  });

  lines.push('  </div>');
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
 * Generates CSS styles for references page HTML output.
 * Follows APA 7th Edition formatting requirements.
 *
 * Key styles:
 * - References start on new page (page-break-before)
 * - "References" heading centered and bold
 * - Hanging indent: first line flush left, subsequent indented 0.5"
 * - Double-spaced throughout
 * - DOI links styled without underline (per typical academic formatting)
 *
 * @returns CSS string for references page styling
 */
export function getReferencesCss(): string {
  return `
/* References Page Styles - APA 7th Edition */

.references-page {
  page-break-before: always;
  font-family: "Times New Roman", Times, Georgia, serif;
  font-size: 12pt;
  line-height: 2; /* Double-spaced */
}

.references-heading {
  text-align: center;
  font-weight: bold;
  font-style: normal; /* Not italicized per APA */
  font-size: 12pt;
  margin: 0 0 24pt 0; /* One double-spaced line after heading */
}

.references-list {
  line-height: 2; /* Double-spaced */
}

.reference-entry {
  padding-left: 0.5in; /* Hanging indent */
  text-indent: -0.5in; /* Negative indent pulls first line back */
  margin-bottom: 0; /* Double-spacing handles spacing */
  margin-top: 0;
  line-height: 2;
  text-align: left;
}

.reference-entry a,
.doi-link,
.url-link {
  color: inherit; /* Same color as text per APA */
  text-decoration: none; /* No underline per APA digital formatting */
}

/* Print styles */
@media print {
  .references-page {
    page-break-before: always;
  }

  .reference-entry a {
    color: inherit;
    text-decoration: none;
  }
}
`.trim();
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Validates reference entries for common formatting issues.
 *
 * @param references - Array of reference strings
 * @returns Validation result with warnings
 */
export function validateReferences(references: string[]): {
  valid: boolean;
  count: number;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (!references || references.length === 0) {
    return { valid: true, count: 0, warnings: [] };
  }

  const validRefs = references.filter(
    (ref) => ref && typeof ref === 'string' && ref.trim().length > 0
  );

  validRefs.forEach((ref, index) => {
    // Check for DOI without https:// prefix
    if (ref.match(/\bdoi:\s*10\./i) && !ref.match(/https?:\/\/doi\.org/)) {
      warnings.push(
        `Reference ${index + 1}: DOI should be formatted as https://doi.org/... URL`
      );
    }

    // Check for missing year
    if (!ref.match(/\(\d{4}[a-z]?\)/) && !ref.match(/\((n\.d\.|in press)\)/i)) {
      warnings.push(
        `Reference ${index + 1}: Missing or non-standard year format`
      );
    }

    // Check for very short references (likely incomplete)
    if (ref.trim().length < 30) {
      warnings.push(
        `Reference ${index + 1}: Entry appears incomplete (very short)`
      );
    }
  });

  return {
    valid: true,
    count: validRefs.length,
    warnings,
  };
}

/**
 * Extracts all DOIs from a list of references.
 * Useful for DOI validation or link checking.
 *
 * @param references - Array of reference strings
 * @returns Array of extracted DOI URLs
 */
export function extractDois(references: string[]): string[] {
  if (!references || !Array.isArray(references)) {
    return [];
  }

  const dois: string[] = [];

  references.forEach((ref) => {
    const parsed = parseReference(ref);
    if (parsed.doi) {
      dois.push(parsed.doi);
    }
  });

  return dois;
}

/**
 * Counts unique authors in reference list.
 * Useful for statistics and validation.
 *
 * @param references - Array of reference strings
 * @returns Count of unique first authors
 */
export function countUniqueAuthors(references: string[]): number {
  if (!references || !Array.isArray(references)) {
    return 0;
  }

  const authors = new Set<string>();

  references.forEach((ref) => {
    const parsed = parseReference(ref);
    if (parsed.authors) {
      authors.add(parsed.authors.toLowerCase());
    }
  });

  return authors.size;
}
