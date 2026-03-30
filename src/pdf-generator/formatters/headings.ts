/**
 * APA 7th Edition Headings Formatter
 *
 * Implements all 5 APA heading levels with correct formatting per APA 7th Edition.
 * Auto-detects heading levels from Markdown (# through #####) and applies
 * appropriate formatting.
 *
 * Reference: American Psychological Association. (2020). Publication manual
 * of the American Psychological Association (7th ed.), Section 2.27.
 *
 * APA 7th Heading Levels:
 * - Level 1: Centered, Bold, Title Case
 * - Level 2: Flush Left, Bold, Title Case
 * - Level 3: Flush Left, Bold Italic, Title Case
 * - Level 4: Indented 0.5", Bold, Title Case, Ends with Period. Text continues.
 * - Level 5: Indented 0.5", Bold Italic, Title Case, Ends with Period. Text continues.
 *
 * @module pdf-generator/formatters/headings
 */

import { APA_HEADING_STYLES, APA_FONTS, APA_SPACING } from '../constants.js';
import { formatTitleCase } from './title-page.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Valid heading levels (1-5) per APA 7th Edition.
 */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Heading style configuration for a specific level.
 */
export interface HeadingStyle {
  /** Heading level (1-5) */
  level: HeadingLevel;
  /** Text alignment: 'center' for Level 1, 'left' for others */
  alignment: 'center' | 'left';
  /** Whether heading text is bold */
  bold: boolean;
  /** Whether heading text is italic */
  italic: boolean;
  /** Whether heading is indented 0.5" (Levels 4-5) */
  indent: boolean;
  /** Whether heading ends with a period (Levels 4-5) */
  periodAfter: boolean;
  /** Whether paragraph text continues on same line (Levels 4-5) */
  textContinues: boolean;
}

/**
 * Heading style definitions for all 5 APA levels.
 * Derived from APA 7th Edition Section 2.27.
 */
export const HEADING_STYLES: Record<HeadingLevel, HeadingStyle> = {
  1: {
    level: 1,
    alignment: 'center',
    bold: true,
    italic: false,
    indent: false,
    periodAfter: false,
    textContinues: false,
  },
  2: {
    level: 2,
    alignment: 'left',
    bold: true,
    italic: false,
    indent: false,
    periodAfter: false,
    textContinues: false,
  },
  3: {
    level: 3,
    alignment: 'left',
    bold: true,
    italic: true,
    indent: false,
    periodAfter: false,
    textContinues: false,
  },
  4: {
    level: 4,
    alignment: 'left',
    bold: true,
    italic: false,
    indent: true,
    periodAfter: true,
    textContinues: true,
  },
  5: {
    level: 5,
    alignment: 'left',
    bold: true,
    italic: true,
    indent: true,
    periodAfter: true,
    textContinues: true,
  },
};

/**
 * Formatted heading with all output representations.
 */
export interface FormattedHeading {
  /** Original heading level */
  level: HeadingLevel;
  /** Original text before formatting */
  text: string;
  /** Formatted text with title case and period (if applicable) */
  formattedText: string;
  /** Style configuration for this level */
  style: HeadingStyle;
  /** Markdown/LaTeX representation */
  markdown: string;
  /** HTML representation */
  html: string;
  /** Pure LaTeX representation */
  latex: string;
}

// =============================================================================
// HEADING DETECTION
// =============================================================================

/**
 * Detects heading level from a Markdown line.
 * Matches # through ##### at the start of line.
 *
 * @param markdownLine - A line of Markdown text
 * @returns Heading level (1-5) or null if not a heading
 *
 * @example
 * detectHeadingLevel('# Introduction')      // returns 1
 * detectHeadingLevel('### Methods')         // returns 3
 * detectHeadingLevel('Regular paragraph')   // returns null
 * detectHeadingLevel('###### Too deep')     // returns null (only 5 levels)
 */
export function detectHeadingLevel(markdownLine: string): HeadingLevel | null {
  if (!markdownLine || typeof markdownLine !== 'string') {
    return null;
  }

  const match = markdownLine.match(/^(#{1,5})\s+(.+)$/);
  if (!match) {
    return null;
  }

  const hashCount = match[1].length;
  if (hashCount >= 1 && hashCount <= 5) {
    return hashCount as HeadingLevel;
  }

  return null;
}

/**
 * Extracts the heading text from a Markdown heading line.
 * Removes the leading hash symbols and whitespace.
 *
 * @param markdownLine - A Markdown heading line
 * @returns The heading text without Markdown syntax
 *
 * @example
 * extractHeadingText('# Introduction')  // returns 'Introduction'
 * extractHeadingText('### Methods')     // returns 'Methods'
 * extractHeadingText('Plain text')      // returns 'Plain text' (passthrough)
 */
export function extractHeadingText(markdownLine: string): string {
  if (!markdownLine || typeof markdownLine !== 'string') {
    return '';
  }

  const match = markdownLine.match(/^#{1,5}\s+(.+)$/);
  return match ? match[1].trim() : markdownLine.trim();
}

// =============================================================================
// HEADING FORMATTING
// =============================================================================

/**
 * Formats a heading according to APA 7th Edition requirements.
 * Applies title case, adds period for levels 4-5, and generates
 * multiple output formats (Markdown, HTML, LaTeX).
 *
 * @param text - The heading text (without Markdown syntax)
 * @param level - The heading level (1-5)
 * @returns FormattedHeading object with all representations
 *
 * @example
 * const heading = formatHeading('research methods', 1);
 * // heading.formattedText = 'Research Methods'
 * // heading.style.alignment = 'center'
 *
 * const subheading = formatHeading('data collection', 4);
 * // subheading.formattedText = 'Data Collection.'
 * // subheading.style.indent = true
 */
export function formatHeading(text: string, level: HeadingLevel): FormattedHeading {
  const style = HEADING_STYLES[level];

  // Apply APA title case using shared utility
  let formattedText = formatTitleCase(text);

  // Add period for levels 4 and 5 (inline headings)
  if (style.periodAfter && formattedText && !formattedText.endsWith('.')) {
    formattedText += '.';
  }

  return {
    level,
    text,
    formattedText,
    style,
    markdown: generateHeadingMarkdown(formattedText, level, style),
    html: generateHeadingHtml(formattedText, level, style),
    latex: generateHeadingLatex(formattedText, level, style),
  };
}

/**
 * Formats a Markdown heading line directly.
 * Combines detection, extraction, and formatting.
 *
 * @param markdownLine - A Markdown heading line (e.g., '# Introduction')
 * @returns FormattedHeading or null if not a valid heading
 */
export function formatMarkdownHeading(markdownLine: string): FormattedHeading | null {
  const level = detectHeadingLevel(markdownLine);
  if (!level) {
    return null;
  }

  const text = extractHeadingText(markdownLine);
  return formatHeading(text, level);
}

// =============================================================================
// OUTPUT GENERATION - MARKDOWN/LATEX
// =============================================================================

/**
 * Generates Markdown/LaTeX representation of a heading.
 *
 * @param text - Formatted heading text
 * @param level - Heading level
 * @param style - Heading style configuration
 * @returns Markdown string with LaTeX commands for formatting
 */
function generateHeadingMarkdown(
  text: string,
  level: HeadingLevel,
  style: HeadingStyle
): string {
  if (!text) return '';

  let formatted = text;

  // Apply bold and italic formatting
  if (style.bold && style.italic) {
    formatted = `***${formatted}***`;
  } else if (style.bold) {
    formatted = `**${formatted}**`;
  } else if (style.italic) {
    formatted = `*${formatted}*`;
  }

  // Levels 1-3: Standalone block headings
  if (level <= 3) {
    if (style.alignment === 'center') {
      return `\n\\begin{center}\n${formatted}\n\\end{center}\n`;
    }
    return `\n${formatted}\n`;
  }

  // Levels 4-5: Indented inline headings (text continues on same line)
  // Use \\hspace for indentation in LaTeX
  const indent = style.indent ? '\\hspace{0.5in}' : '';
  return `${indent}${formatted} `;
}

// =============================================================================
// OUTPUT GENERATION - HTML
// =============================================================================

/**
 * Generates HTML representation of a heading.
 *
 * @param text - Formatted heading text
 * @param level - Heading level
 * @param style - Heading style configuration
 * @returns HTML string with appropriate tags and classes
 */
function generateHeadingHtml(
  text: string,
  level: HeadingLevel,
  style: HeadingStyle
): string {
  if (!text) return '';

  const classes: string[] = [`heading-level-${level}`];

  if (style.alignment === 'center') {
    classes.push('text-center');
  }
  if (style.bold) {
    classes.push('font-bold');
  }
  if (style.italic) {
    classes.push('italic');
  }
  if (style.indent) {
    classes.push('indent');
  }
  if (style.textContinues) {
    classes.push('inline-heading');
  }

  // Use semantic heading tags for levels 1-3, span for inline levels 4-5
  const tag = level <= 3 ? `h${level + 1}` : 'span';
  const classAttr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';

  return `<${tag}${classAttr}>${escapeHtml(text)}</${tag}>`;
}

// =============================================================================
// OUTPUT GENERATION - LATEX
// =============================================================================

/**
 * Generates pure LaTeX representation of a heading.
 *
 * @param text - Formatted heading text
 * @param level - Heading level
 * @param style - Heading style configuration
 * @returns LaTeX string with appropriate sectioning commands
 */
function generateHeadingLatex(
  text: string,
  level: HeadingLevel,
  style: HeadingStyle
): string {
  if (!text) return '';

  // Escape LaTeX special characters
  let formatted = escapeLatex(text);

  // Apply text formatting
  if (style.italic) {
    formatted = `\\textit{${formatted}}`;
  }
  if (style.bold) {
    formatted = `\\textbf{${formatted}}`;
  }

  // Generate appropriate LaTeX sectioning command
  switch (level) {
    case 1:
      // Level 1: Centered, bold - use section* with centering
      return `\\section*{\\centering ${formatted}}`;
    case 2:
      // Level 2: Flush left, bold - use subsection*
      return `\\subsection*{${formatted}}`;
    case 3:
      // Level 3: Flush left, bold italic - use subsubsection*
      return `\\subsubsection*{${formatted}}`;
    case 4:
    case 5:
      // Levels 4-5: Indented paragraph headings
      return `\\paragraph{${formatted}}`;
    default:
      return formatted;
  }
}

// =============================================================================
// DOCUMENT PROCESSING
// =============================================================================

/**
 * Processes all headings in a Markdown document.
 * Converts Markdown headings to APA-formatted headings.
 *
 * @param markdown - Full Markdown document content
 * @returns Processed document with APA-formatted headings
 *
 * @example
 * const input = '# Introduction\nSome text\n## Background';
 * const output = processHeadings(input);
 * // Headings are now formatted per APA 7th Edition
 */
export function processHeadings(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') {
    return '';
  }

  const lines = markdown.split('\n');
  const processed: string[] = [];

  for (const line of lines) {
    const level = detectHeadingLevel(line);
    if (level) {
      const text = extractHeadingText(line);
      const heading = formatHeading(text, level);
      processed.push(heading.markdown);
    } else {
      processed.push(line);
    }
  }

  return processed.join('\n');
}

/**
 * Extracts all headings from a Markdown document.
 * Useful for generating a table of contents.
 *
 * @param markdown - Full Markdown document content
 * @returns Array of FormattedHeading objects in document order
 */
export function extractAllHeadings(markdown: string): FormattedHeading[] {
  if (!markdown || typeof markdown !== 'string') {
    return [];
  }

  const lines = markdown.split('\n');
  const headings: FormattedHeading[] = [];

  for (const line of lines) {
    const level = detectHeadingLevel(line);
    if (level) {
      const text = extractHeadingText(line);
      headings.push(formatHeading(text, level));
    }
  }

  return headings;
}

/**
 * Parsed section with content - used internally before building hierarchy.
 */
interface ParsedSection {
  level: HeadingLevel;
  title: string;
  content: string;
  lineIndex: number;
}

/**
 * FormattedSection type matching the types.ts definition.
 * Represents a hierarchical section with content and subsections.
 */
export interface FormattedSectionOutput {
  level: 1 | 2 | 3 | 4 | 5;
  title: string;
  content: string;
  subsections?: FormattedSectionOutput[];
}

/**
 * Parses a Markdown document into hierarchical sections.
 * Extracts headings, their content, and builds nested structure.
 *
 * @param markdown - Full Markdown document content
 * @returns Array of FormattedSection objects with content and subsections
 *
 * @example
 * const markdown = `
 * # Chapter 1
 * Introduction text here.
 *
 * ## Section 1.1
 * Section content.
 *
 * # Chapter 2
 * Another chapter.
 * `;
 * const sections = parseMarkdownToSections(markdown);
 * // Returns:
 * // [
 * //   { level: 1, title: 'Chapter 1', content: 'Introduction text here.\n\n',
 * //     subsections: [{ level: 2, title: 'Section 1.1', content: 'Section content.\n\n' }] },
 * //   { level: 1, title: 'Chapter 2', content: 'Another chapter.\n' }
 * // ]
 */
export function parseMarkdownToSections(markdown: string): FormattedSectionOutput[] {
  if (!markdown || typeof markdown !== 'string') {
    return [];
  }

  const lines = markdown.split('\n');
  const flatSections: ParsedSection[] = [];

  // First pass: identify all sections with their line indices
  // Track code block state to avoid parsing shell comments as headings
  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Toggle code block state on fence markers
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip heading detection inside code blocks
    if (inCodeBlock) {
      continue;
    }

    const level = detectHeadingLevel(line);
    if (level) {
      const text = extractHeadingText(line);
      flatSections.push({
        level,
        title: text,
        content: '',
        lineIndex: i,
      });
    }
  }

  // Second pass: extract content between each heading and the next
  for (let i = 0; i < flatSections.length; i++) {
    const section = flatSections[i];
    const startLine = section.lineIndex + 1; // Start after the heading line
    const endLine = i < flatSections.length - 1
      ? flatSections[i + 1].lineIndex
      : lines.length;

    // Extract content lines between this heading and the next
    const contentLines = lines.slice(startLine, endLine);
    section.content = contentLines.join('\n').trim();
  }

  // Third pass: build hierarchical structure
  return buildSectionHierarchy(flatSections);
}

/**
 * Builds a hierarchical section structure from a flat list.
 * Nests subsections under their parent sections based on heading levels.
 *
 * @param flatSections - Flat array of parsed sections
 * @returns Hierarchical array with subsections nested
 */
function buildSectionHierarchy(flatSections: ParsedSection[]): FormattedSectionOutput[] {
  if (flatSections.length === 0) {
    return [];
  }

  const result: FormattedSectionOutput[] = [];
  const stack: { section: FormattedSectionOutput; level: number }[] = [];

  for (const flat of flatSections) {
    const section: FormattedSectionOutput = {
      level: flat.level,
      title: flat.title,
      content: flat.content,
      subsections: [],
    };

    // Pop stack until we find a parent (lower level number = higher in hierarchy)
    while (stack.length > 0 && stack[stack.length - 1].level >= flat.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      // Top-level section
      result.push(section);
    } else {
      // Child of the section on top of stack
      const parent = stack[stack.length - 1].section;
      if (!parent.subsections) {
        parent.subsections = [];
      }
      parent.subsections.push(section);
    }

    // Push current section onto stack
    stack.push({ section, level: flat.level });
  }

  // Clean up empty subsections arrays
  cleanupEmptySubsections(result);

  return result;
}

/**
 * Removes empty subsections arrays from the hierarchy.
 * Recursively cleans the section tree.
 *
 * @param sections - Array of sections to clean
 */
function cleanupEmptySubsections(sections: FormattedSectionOutput[]): void {
  for (const section of sections) {
    if (section.subsections && section.subsections.length === 0) {
      delete section.subsections;
    } else if (section.subsections) {
      cleanupEmptySubsections(section.subsections);
    }
  }
}

/**
 * Validates heading hierarchy in a document.
 * Checks that headings follow proper nesting (no skipping levels).
 *
 * @param headings - Array of formatted headings
 * @returns Validation result with any hierarchy issues
 */
export function validateHeadingHierarchy(headings: FormattedHeading[]): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!headings || headings.length === 0) {
    return { valid: true, issues: [] };
  }

  let previousLevel = 0;

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];

    // First heading should be level 1 or start at a reasonable level
    if (i === 0 && heading.level > 2) {
      issues.push(
        `Document should start with a Level 1 or 2 heading, found Level ${heading.level}`
      );
    }

    // Check for skipped levels (jumping from 1 to 3, etc.)
    if (previousLevel > 0 && heading.level > previousLevel + 1) {
      issues.push(
        `Heading "${heading.text}" at Level ${heading.level} skips Level ${previousLevel + 1}`
      );
    }

    previousLevel = heading.level;
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// =============================================================================
// CSS STYLES
// =============================================================================

/**
 * Generates CSS styles for APA 7th Edition headings.
 * Use with HTML output for proper formatting.
 *
 * @returns CSS string for heading styling
 */
export function getHeadingsCss(): string {
  return `
/* APA 7th Edition Heading Styles */

.heading-level-1 {
  text-align: center;
  font-weight: bold;
  font-style: normal;
  font-size: ${APA_FONTS.size.heading1}pt;
  line-height: ${APA_SPACING.lineHeight};
  margin: 0;
  padding: 0;
}

.heading-level-2 {
  text-align: left;
  font-weight: bold;
  font-style: normal;
  font-size: ${APA_FONTS.size.heading2}pt;
  line-height: ${APA_SPACING.lineHeight};
  margin: 0;
  padding: 0;
}

.heading-level-3 {
  text-align: left;
  font-weight: bold;
  font-style: italic;
  font-size: ${APA_FONTS.size.heading3}pt;
  line-height: ${APA_SPACING.lineHeight};
  margin: 0;
  padding: 0;
}

.heading-level-4 {
  text-indent: ${APA_SPACING.paragraphIndent};
  font-weight: bold;
  font-style: normal;
  font-size: ${APA_FONTS.size.heading4}pt;
  line-height: ${APA_SPACING.lineHeight};
  display: inline;
}

.heading-level-5 {
  text-indent: ${APA_SPACING.paragraphIndent};
  font-weight: bold;
  font-style: italic;
  font-size: ${APA_FONTS.size.heading5}pt;
  line-height: ${APA_SPACING.lineHeight};
  display: inline;
}

.inline-heading {
  display: inline;
}

.inline-heading::after {
  content: " ";
}

.text-center {
  text-align: center;
}

.font-bold {
  font-weight: bold;
}

.italic {
  font-style: italic;
}

.indent {
  text-indent: ${APA_SPACING.paragraphIndent};
}
`.trim();
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

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

/**
 * Escapes LaTeX special characters.
 *
 * @param text - Text to escape
 * @returns Escaped text safe for LaTeX
 */
function escapeLatex(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, (match) => `\\${match}`)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * Gets the APA heading style configuration from constants.
 *
 * @param level - Heading level (1-5)
 * @returns Heading style from APA_HEADING_STYLES constant
 */
export function getApaHeadingStyle(
  level: HeadingLevel
): (typeof APA_HEADING_STYLES)[keyof typeof APA_HEADING_STYLES] {
  const key = `level${level}` as keyof typeof APA_HEADING_STYLES;
  return APA_HEADING_STYLES[key];
}

/**
 * Converts a heading level number to its APA description.
 *
 * @param level - Heading level (1-5)
 * @returns Human-readable description of the heading format
 */
export function describeHeadingLevel(level: HeadingLevel): string {
  const descriptions: Record<HeadingLevel, string> = {
    1: 'Centered, Bold, Title Case',
    2: 'Flush Left, Bold, Title Case',
    3: 'Flush Left, Bold Italic, Title Case',
    4: 'Indented 0.5", Bold, Title Case, Ends with Period. Text continues.',
    5: 'Indented 0.5", Bold Italic, Title Case, Ends with Period. Text continues.',
  };
  return descriptions[level];
}
