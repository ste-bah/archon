/**
 * APA 7th Edition Formatting Constants
 *
 * This file contains all formatting constants required for generating
 * APA 7th Edition compliant professional papers.
 *
 * Reference: American Psychological Association. (2020). Publication manual
 * of the American Psychological Association (7th ed.).
 *
 * @module pdf-generator/constants
 */

// =============================================================================
// PAGE LAYOUT
// =============================================================================

/**
 * APA 7th Edition page margins.
 * Per Section 2.22: Use 1-inch margins on all sides.
 */
export const APA_MARGINS = {
  top: '1in',
  bottom: '1in',
  left: '1in',
  right: '1in',
} as const;

/** Type for APA margin configuration */
export type ApaMargins = typeof APA_MARGINS;

// =============================================================================
// TYPOGRAPHY
// =============================================================================

/**
 * APA 7th Edition font specifications.
 * Per Section 2.19: Use a consistent, accessible font throughout.
 * Times New Roman 12pt is the traditional standard.
 */
export const APA_FONTS = {
  /** Primary font family */
  primary: 'Times New Roman',
  /** Fallback fonts if primary unavailable */
  fallback: ['Georgia', 'serif'] as const,
  /** Font sizes in points */
  size: {
    /** Body text - 12pt */
    body: 12,
    /** Title page text - same as body per APA 7th */
    title: 12,
    /** Level 1 heading - same as body, formatting distinguishes it */
    heading1: 12,
    /** Level 2 heading */
    heading2: 12,
    /** Level 3 heading */
    heading3: 12,
    /** Level 4 heading */
    heading4: 12,
    /** Level 5 heading */
    heading5: 12,
    /** Page numbers */
    pageNumber: 12,
    /** Footnotes - typically smaller */
    footnote: 10,
  },
} as const;

/** Type for APA font configuration */
export type ApaFonts = typeof APA_FONTS;

// =============================================================================
// SPACING
// =============================================================================

/**
 * APA 7th Edition spacing specifications.
 * Per Section 2.21: Double-space the entire paper.
 * Per Section 2.24: Indent first line of paragraphs 0.5 inches.
 */
export const APA_SPACING = {
  /** Line height multiplier - double-spaced */
  lineHeight: 2.0,
  /** First line paragraph indent */
  paragraphIndent: '0.5in',
  /** Space after paragraph (handled by line height) */
  afterParagraph: 0,
  /** Space after heading (text follows on next double-spaced line) */
  afterHeading: 0,
  /** Space before heading */
  beforeHeading: 0,
} as const;

/** Type for APA spacing configuration */
export type ApaSpacing = typeof APA_SPACING;

// =============================================================================
// RUNNING HEAD
// =============================================================================

/**
 * APA 7th Edition running head specifications.
 * Per Section 2.18: Running head is optional for student papers,
 * required for professional papers. Maximum 50 characters.
 */
export const APA_RUNNING_HEAD = {
  /** Maximum character length including spaces */
  maxLength: 50,
  /** Position in document */
  position: 'header',
  /** Text alignment */
  alignment: 'left',
  /** Page number alignment */
  pageNumberAlignment: 'right',
  /** Whether to include "Running head:" label (only on title page for professional) */
  includeLabelOnTitlePage: false,
  /** All caps for running head text */
  allCaps: true,
} as const;

/** Type for APA running head configuration */
export type ApaRunningHead = typeof APA_RUNNING_HEAD;

// =============================================================================
// HEADING STYLES
// =============================================================================

/**
 * APA 7th Edition heading levels.
 * Per Section 2.27: Five levels of headings with specific formatting.
 *
 * Level 1: Centered, Bold, Title Case
 * Level 2: Flush Left, Bold, Title Case
 * Level 3: Flush Left, Bold Italic, Title Case
 * Level 4: Indented, Bold, Title Case, Period. Text begins after period.
 * Level 5: Indented, Bold Italic, Title Case, Period. Text begins after period.
 */
export const APA_HEADING_STYLES = {
  /** Level 1: Centered, Bold, Title Case Heading */
  level1: {
    bold: true,
    italic: false,
    centered: true,
    leftAlign: false,
    indented: false,
    titleCase: true,
    endWithPeriod: false,
    inline: false,
  },
  /** Level 2: Flush Left, Bold, Title Case Heading */
  level2: {
    bold: true,
    italic: false,
    centered: false,
    leftAlign: true,
    indented: false,
    titleCase: true,
    endWithPeriod: false,
    inline: false,
  },
  /** Level 3: Flush Left, Bold Italic, Title Case Heading */
  level3: {
    bold: true,
    italic: true,
    centered: false,
    leftAlign: true,
    indented: false,
    titleCase: true,
    endWithPeriod: false,
    inline: false,
  },
  /** Level 4: Indented, Bold, Title Case Heading, Ending With Period. */
  level4: {
    bold: true,
    italic: false,
    centered: false,
    leftAlign: false,
    indented: true,
    titleCase: true,
    endWithPeriod: true,
    inline: true,
  },
  /** Level 5: Indented, Bold Italic, Title Case Heading, Ending With Period. */
  level5: {
    bold: true,
    italic: true,
    centered: false,
    leftAlign: false,
    indented: true,
    titleCase: true,
    endWithPeriod: true,
    inline: true,
  },
} as const;

/** Type for APA heading style configuration */
export type ApaHeadingStyles = typeof APA_HEADING_STYLES;

/** Type for a single heading level configuration */
export type ApaHeadingLevel = ApaHeadingStyles[keyof ApaHeadingStyles];

/** Valid heading level keys */
export type HeadingLevelKey = keyof ApaHeadingStyles;

// =============================================================================
// REFERENCES
// =============================================================================

/**
 * APA 7th Edition reference list formatting.
 * Per Section 2.12: References start on new page.
 * Per Section 9.43: Hanging indent of 0.5 inches.
 */
export const APA_REFERENCES = {
  /** Hanging indent for reference entries */
  hangingIndent: '0.5in',
  /** Sort entries alphabetically by author surname */
  sortAlphabetically: true,
  /** Double-space all entries */
  doubleSpaced: true,
  /** Start on new page */
  newPage: true,
  /** Center the "References" heading */
  headingCentered: true,
  /** Bold the "References" heading */
  headingBold: true,
  /** Title for the section */
  sectionTitle: 'References',
} as const;

/** Type for APA references configuration */
export type ApaReferences = typeof APA_REFERENCES;

// =============================================================================
// TITLE PAGE
// =============================================================================

/**
 * APA 7th Edition title page specifications.
 * Per Section 2.3-2.6: Professional paper title page elements.
 */
export const APA_TITLE_PAGE = {
  /** Title position from top (approximately 3-4 lines down) */
  titlePosition: 'upper-third',
  /** Title should be bold */
  titleBold: true,
  /** Title case for title */
  titleCase: true,
  /** Maximum recommended title length in words */
  maxTitleWords: 12,
  /** Author name follows title */
  authorFollowsTitle: true,
  /** Affiliation follows author */
  affiliationFollowsAuthor: true,
  /** Include author note on title page for professional papers */
  includeAuthorNote: true,
  /** Include running head on title page */
  includeRunningHead: true,
  /** Page number on title page */
  pageNumber: 1,
} as const;

/** Type for APA title page configuration */
export type ApaTitlePage = typeof APA_TITLE_PAGE;

// =============================================================================
// ABSTRACT
// =============================================================================

/**
 * APA 7th Edition abstract specifications.
 * Per Section 2.9: Abstract is a single paragraph without indentation.
 */
export const APA_ABSTRACT = {
  /** Maximum word count */
  maxWords: 250,
  /** Section title */
  sectionTitle: 'Abstract',
  /** No paragraph indentation in abstract */
  noIndent: true,
  /** Start on new page */
  newPage: true,
  /** Keywords label */
  keywordsLabel: 'Keywords:',
  /** Keywords should be italicized */
  keywordsItalic: true,
  /** Indent the keywords line */
  keywordsIndented: true,
} as const;

/** Type for APA abstract configuration */
export type ApaAbstract = typeof APA_ABSTRACT;

// =============================================================================
// SECTION ORDER
// =============================================================================

/**
 * APA 7th Edition paper section order.
 * Per Chapter 2: Standard order of manuscript pages.
 */
export const APA_SECTION_ORDER = [
  'title-page',
  'abstract',
  'body',
  'references',
  'footnotes',
  'tables',
  'figures',
  'appendices',
] as const;

/** Type for section order */
export type ApaSectionOrder = typeof APA_SECTION_ORDER;

/** Type for individual section names */
export type ApaSectionName = ApaSectionOrder[number];

// =============================================================================
// TABLES AND FIGURES
// =============================================================================

/**
 * APA 7th Edition table formatting.
 * Per Section 7.1-7.21: Table formatting guidelines.
 */
export const APA_TABLES = {
  /** Table number format */
  numberPrefix: 'Table',
  /** Table number is bold */
  numberBold: true,
  /** Table title is italic */
  titleItalic: true,
  /** Title case for table title */
  titleCase: true,
  /** Notes prefix */
  notePrefix: 'Note.',
  /** Note prefix is italic */
  notePrefixItalic: true,
  /** Single-space within table cells */
  cellSpacing: 1.0,
  /** Double-space between table and text */
  spacingFromText: 2.0,
} as const;

/** Type for APA table configuration */
export type ApaTables = typeof APA_TABLES;

/**
 * APA 7th Edition figure formatting.
 * Per Section 7.22-7.36: Figure formatting guidelines.
 */
export const APA_FIGURES = {
  /** Figure number format */
  numberPrefix: 'Figure',
  /** Figure number is bold */
  numberBold: true,
  /** Figure title is italic */
  titleItalic: true,
  /** Title case for figure title */
  titleCase: true,
  /** Notes prefix */
  notePrefix: 'Note.',
  /** Note prefix is italic */
  notePrefixItalic: true,
  /** Double-space between figure and text */
  spacingFromText: 2.0,
} as const;

/** Type for APA figure configuration */
export type ApaFigures = typeof APA_FIGURES;

// =============================================================================
// APPENDICES
// =============================================================================

/**
 * APA 7th Edition appendix formatting.
 * Per Section 2.14: Appendix formatting guidelines.
 */
export const APA_APPENDICES = {
  /** Label for single appendix */
  singleLabel: 'Appendix',
  /** Label format for multiple appendices */
  multiplePrefix: 'Appendix',
  /** Use letters for multiple appendices (A, B, C) */
  useLetters: true,
  /** Each appendix starts on new page */
  newPage: true,
  /** Center the appendix label */
  labelCentered: true,
  /** Bold the appendix label */
  labelBold: true,
  /** Title follows label on same line or next */
  titleOnNextLine: true,
} as const;

/** Type for APA appendix configuration */
export type ApaAppendices = typeof APA_APPENDICES;

// =============================================================================
// GENERATOR CONFIGURATION
// =============================================================================

/**
 * PDF generator priority order.
 * Defines fallback chain for PDF generation methods.
 */
export const GENERATOR_PRIORITY = [
  'pandoc-latex',
  'pandoc-html',
  'pdfkit',
  'puppeteer',
] as const;

/** Type for generator priority */
export type GeneratorPriority = typeof GENERATOR_PRIORITY;

/** Type for individual generator names */
export type GeneratorName = GeneratorPriority[number];

/**
 * Generator-specific configurations.
 */
export const GENERATOR_CONFIG = {
  'pandoc-latex': {
    /** Preferred for best APA compliance */
    preferredForApa: true,
    /** Requires LaTeX installation */
    requiresLatex: true,
    /** Output quality rating */
    qualityRating: 'high',
  },
  'pandoc-html': {
    /** Fallback when LaTeX unavailable */
    preferredForApa: false,
    /** Uses wkhtmltopdf or similar */
    requiresLatex: false,
    /** Output quality rating */
    qualityRating: 'medium',
  },
  'pdfkit': {
    /** Pure JavaScript solution */
    preferredForApa: false,
    /** No external dependencies */
    requiresLatex: false,
    /** Output quality rating */
    qualityRating: 'medium',
  },
  'puppeteer': {
    /** Browser-based rendering */
    preferredForApa: false,
    /** Requires Chromium */
    requiresLatex: false,
    /** Output quality rating */
    qualityRating: 'medium',
  },
} as const;

/** Type for generator configuration */
export type GeneratorConfig = typeof GENERATOR_CONFIG;

// =============================================================================
// VALIDATION LIMITS
// =============================================================================

/**
 * Validation limits and constraints for APA compliance checking.
 */
export const APA_VALIDATION_LIMITS = {
  /** Running head maximum characters */
  runningHeadMaxChars: 50,
  /** Abstract maximum words */
  abstractMaxWords: 250,
  /** Recommended title maximum words */
  titleMaxWords: 12,
  /** Maximum heading levels */
  maxHeadingLevels: 5,
  /** Minimum margin in inches */
  minMarginInches: 1.0,
} as const;

/** Type for validation limits */
export type ApaValidationLimits = typeof APA_VALIDATION_LIMITS;

// =============================================================================
// EXPORT AGGREGATION
// =============================================================================

/**
 * Aggregated APA configuration object for convenient access.
 */
export const APA_CONFIG = {
  margins: APA_MARGINS,
  fonts: APA_FONTS,
  spacing: APA_SPACING,
  runningHead: APA_RUNNING_HEAD,
  headingStyles: APA_HEADING_STYLES,
  references: APA_REFERENCES,
  titlePage: APA_TITLE_PAGE,
  abstract: APA_ABSTRACT,
  sectionOrder: APA_SECTION_ORDER,
  tables: APA_TABLES,
  figures: APA_FIGURES,
  appendices: APA_APPENDICES,
  validationLimits: APA_VALIDATION_LIMITS,
} as const;

/** Type for complete APA configuration */
export type ApaConfig = typeof APA_CONFIG;
