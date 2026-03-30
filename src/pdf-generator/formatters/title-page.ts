/**
 * APA 7th Edition Title Page Formatter
 *
 * Formats title pages per APA 7th Edition professional paper requirements.
 * Supports both professional and student paper formats.
 *
 * Reference: American Psychological Association. (2020). Publication manual
 * of the American Psychological Association (7th ed.), Sections 2.3-2.8.
 *
 * @module pdf-generator/formatters/title-page
 */

import { FormattedTitlePage } from '../types.js';
import { APA_TITLE_PAGE, APA_FONTS, APA_SPACING, APA_RUNNING_HEAD } from '../constants.js';
import { AuthorInfo } from '../utils/validation.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Extended author information for title page formatting.
 * Extends base AuthorInfo with additional name components for APA formatting.
 */
export interface TitlePageAuthorInfo extends AuthorInfo {
  /** First name (given name) */
  firstName?: string;
  /** Middle name or initial */
  middleName?: string;
  /** Last name (family name/surname) */
  lastName?: string;
  /** Department within institution */
  department?: string;
  /** Institution/University name */
  institution?: string;
}

/**
 * Input for title page formatting.
 */
export interface TitlePageInput {
  /** Paper title (will be converted to title case) */
  title: string;
  /** Author information array */
  authors: TitlePageAuthorInfo[];
  /** Institutional affiliations (overrides author affiliations if provided) */
  affiliations?: string[];
  /** Course number (e.g., "PSY 101") - for student papers */
  courseNumber?: string;
  /** Course name (e.g., "Introduction to Psychology") - for student papers */
  courseName?: string;
  /** Instructor name - for student papers */
  instructorName?: string;
  /** Assignment due date - for student papers */
  dueDate?: string;
  /** Whether this is a student paper (vs professional paper) */
  isStudentPaper?: boolean;
  /** Custom running head (auto-generated from title if not provided) */
  runningHead?: string;
  /** Author note content - for professional papers */
  authorNote?: string;
}

/**
 * Styles configuration for title page rendering.
 */
export interface TitlePageStyles {
  /** Whether title should be bold */
  titleBold: boolean;
  /** Whether content should be centered */
  centered: boolean;
  /** Whether content should be double-spaced */
  doubleSpaced: boolean;
  /** Font family */
  font: string;
  /** Font size in points */
  fontSize: number;
}

/**
 * Extended formatted title page with additional metadata.
 * Extends the base FormattedTitlePage for internal use.
 */
export interface ExtendedFormattedTitlePage extends FormattedTitlePage {
  /** Course information (combined course number and name) */
  courseInfo?: string;
  /** Instructor name */
  instructor?: string;
  /** Due date string */
  dueDate?: string;
  /** Pre-formatted lines for rendering */
  formatted: string[];
  /** Styling configuration */
  styles: TitlePageStyles;
  /** Whether this is a student paper */
  isStudentPaper: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Words that should not be capitalized in title case
 * (except when first or last word of title).
 * Per APA 7th Edition guidelines.
 */
const LOWERCASE_WORDS = new Set([
  // Articles
  'a', 'an', 'the',
  // Coordinating conjunctions
  'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  // Short prepositions (fewer than 4 letters)
  'as', 'at', 'by', 'in', 'of', 'on', 'to', 'up', 'via',
  // Note: APA 7th capitalizes prepositions of 4+ letters
]);

// =============================================================================
// TITLE CASE FORMATTING
// =============================================================================

/**
 * Formats a string in APA title case.
 *
 * Rules per APA 7th Edition:
 * - Capitalize the first word of the title
 * - Capitalize all major words (nouns, verbs, adjectives, adverbs, etc.)
 * - Lowercase articles (a, an, the), short prepositions (< 4 letters),
 *   and coordinating conjunctions (and, but, or, etc.)
 * - Always capitalize the first word after a colon or em dash
 * - Always capitalize the last word
 *
 * @param text - The text to format
 * @returns Title case formatted string
 */
export function formatTitleCase(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return '';
  }

  const words = trimmed.split(/\s+/);

  return words.map((word, index, arr) => {
    // Handle empty strings
    if (!word) return word;

    // Check for colon or em dash at end of previous word
    const prevWord = index > 0 ? arr[index - 1] : '';
    const afterColonOrDash = prevWord.endsWith(':') || prevWord.endsWith('—');

    const lowerWord = word.toLowerCase();
    const isFirst = index === 0;
    const isLast = index === arr.length - 1;

    // Always capitalize first word, last word, or word after colon/em dash
    if (isFirst || isLast || afterColonOrDash) {
      return capitalizeWord(word);
    }

    // Check if the word (without punctuation) should be lowercase
    const cleanWord = lowerWord.replace(/[^a-z]/g, '');
    if (LOWERCASE_WORDS.has(cleanWord)) {
      return lowerWord;
    }

    return capitalizeWord(word);
  }).join(' ');
}

/**
 * Capitalizes the first letter of a word, preserving internal capitalization
 * and handling punctuation.
 *
 * @param word - The word to capitalize
 * @returns Capitalized word
 */
function capitalizeWord(word: string): string {
  if (!word) return word;

  // Find the first letter position (skip leading punctuation)
  let firstLetterIndex = 0;
  while (firstLetterIndex < word.length && !/[a-zA-Z]/.test(word[firstLetterIndex])) {
    firstLetterIndex++;
  }

  if (firstLetterIndex >= word.length) {
    return word; // No letters found
  }

  return (
    word.slice(0, firstLetterIndex) +
    word.charAt(firstLetterIndex).toUpperCase() +
    word.slice(firstLetterIndex + 1).toLowerCase()
  );
}

// =============================================================================
// AUTHOR FORMATTING
// =============================================================================

/**
 * Formats a single author name per APA 7th Edition requirements.
 * Uses first name, middle initial (with period), and last name.
 * No titles, degrees, or suffixes.
 *
 * @param author - Author information
 * @returns Formatted author name string
 */
export function formatAuthorName(author: TitlePageAuthorInfo): string {
  // If explicit name components are provided, use them
  if (author.firstName && author.lastName) {
    let name = author.firstName;

    if (author.middleName) {
      // Use middle initial with period
      const initial = author.middleName.charAt(0).toUpperCase();
      name += ` ${initial}.`;
    }

    name += ` ${author.lastName}`;
    return name;
  }

  // Fall back to the full name field, parsing if possible
  if (author.name) {
    return parseAndFormatName(author.name);
  }

  return '';
}

/**
 * Attempts to parse a full name string and format it per APA.
 * Handles common formats: "First Last", "First M. Last", "First Middle Last"
 *
 * @param fullName - Full name string
 * @returns Formatted name
 */
function parseAndFormatName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);

  if (parts.length === 1) {
    return parts[0];
  }

  if (parts.length === 2) {
    return `${parts[0]} ${parts[1]}`;
  }

  // Three or more parts: assume first, middle(s), last
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  const middleParts = parts.slice(1, -1);

  // Convert middle names to initials
  const middleInitials = middleParts
    .map(m => {
      // If already an initial (single letter or letter with period)
      if (m.length <= 2 && /^[A-Za-z]\.?$/.test(m)) {
        return m.replace(/\.$/, '').toUpperCase() + '.';
      }
      return m.charAt(0).toUpperCase() + '.';
    })
    .join(' ');

  return `${firstName} ${middleInitials} ${lastName}`;
}

/**
 * Formats a list of authors for title page display.
 * Handles single author, two authors (with "and"), and multiple authors
 * (with Oxford comma and "and" before last).
 *
 * @param authors - Array of author information
 * @returns Array of formatted author lines (typically one line)
 */
export function formatAuthorList(authors: TitlePageAuthorInfo[]): string[] {
  if (!authors || authors.length === 0) {
    return [];
  }

  const formattedNames = authors.map(formatAuthorName).filter(n => n.length > 0);

  if (formattedNames.length === 0) {
    return [];
  }

  if (formattedNames.length === 1) {
    return [formattedNames[0]];
  }

  if (formattedNames.length === 2) {
    return [`${formattedNames[0]} and ${formattedNames[1]}`];
  }

  // Three or more authors: use Oxford comma
  const allButLast = formattedNames.slice(0, -1);
  const last = formattedNames[formattedNames.length - 1];
  return [`${allButLast.join(', ')}, and ${last}`];
}

// =============================================================================
// AFFILIATION FORMATTING
// =============================================================================

/**
 * Formats affiliations for title page display.
 * If explicit affiliations are provided, use those.
 * Otherwise, extract unique affiliations from authors.
 *
 * Per APA 7th Edition:
 * - Department and university on separate lines for each affiliation
 * - Multiple affiliations listed in order of authors
 *
 * @param authors - Array of author information
 * @param affiliations - Optional explicit affiliations array
 * @returns Array of affiliation lines
 */
export function formatAffiliations(
  authors: TitlePageAuthorInfo[],
  affiliations?: string[]
): string[] {
  // If explicit affiliations provided, use them
  if (affiliations && affiliations.length > 0) {
    return affiliations;
  }

  // Extract unique affiliations from authors, preserving order
  const seen = new Set<string>();
  const result: string[] = [];

  for (const author of authors) {
    // Build affiliation from department + institution or use affiliation field
    let affil = '';

    if (author.department && author.institution) {
      affil = `${author.department}, ${author.institution}`;
    } else if (author.institution) {
      affil = author.institution;
    } else if (author.affiliation) {
      affil = author.affiliation;
    }

    if (affil && !seen.has(affil)) {
      seen.add(affil);
      result.push(affil);
    }
  }

  return result;
}

// =============================================================================
// RUNNING HEAD FORMATTING
// =============================================================================

/**
 * Generates a running head from the paper title.
 * Per APA 7th Edition: Abbreviated title, ALL CAPS, max 50 characters.
 *
 * @param title - Paper title
 * @param maxLength - Maximum length (default 50)
 * @returns Running head string
 */
export function generateRunningHead(title: string, maxLength: number = 50): string {
  if (!title) return '';

  // Convert to uppercase
  let runningHead = title.toUpperCase();

  // If within limit, return as-is
  if (runningHead.length <= maxLength) {
    return runningHead;
  }

  // Need to abbreviate - try to cut at word boundary
  let abbreviated = runningHead.slice(0, maxLength);

  // Find last space to avoid cutting mid-word
  const lastSpace = abbreviated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.7) { // Only cut at word if we keep at least 70%
    abbreviated = abbreviated.slice(0, lastSpace);
  }

  return abbreviated.trim();
}

// =============================================================================
// MAIN FORMATTING FUNCTION
// =============================================================================

/**
 * Formats a complete title page per APA 7th Edition requirements.
 *
 * For professional papers:
 * - Title (bold, centered, upper half of page)
 * - Author name(s)
 * - Affiliation(s)
 * - Author note (optional)
 * - Running head with page number
 *
 * For student papers:
 * - Title (bold, centered)
 * - Author name(s)
 * - Affiliation(s)
 * - Course number and name
 * - Instructor name
 * - Assignment due date
 *
 * @param input - Title page input data
 * @returns Formatted title page object
 */
export function formatTitlePage(input: TitlePageInput): ExtendedFormattedTitlePage {
  const {
    title,
    authors,
    affiliations,
    courseNumber,
    courseName,
    instructorName,
    dueDate,
    isStudentPaper = false,
    runningHead,
    authorNote,
  } = input;

  // Format title in title case
  const formattedTitle = formatTitleCase(title);

  // Format authors
  const authorLines = formatAuthorList(authors);

  // Format affiliations
  const affiliationLines = formatAffiliations(authors, affiliations);

  // Generate or use provided running head
  const finalRunningHead = runningHead
    ? runningHead.toUpperCase().slice(0, APA_RUNNING_HEAD.maxLength)
    : generateRunningHead(formattedTitle);

  // Build formatted lines array for rendering
  const formatted: string[] = [];

  // Title (bold, centered)
  formatted.push(formattedTitle);
  formatted.push(''); // Blank line after title

  // Author name(s)
  authorLines.forEach(line => formatted.push(line));

  // Affiliation(s)
  affiliationLines.forEach(line => formatted.push(line));

  // Build course info string
  let courseInfo: string | undefined;
  if (courseNumber && courseName) {
    courseInfo = `${courseNumber}: ${courseName}`;
  } else if (courseName) {
    courseInfo = courseName;
  } else if (courseNumber) {
    courseInfo = courseNumber;
  }

  // Student paper additional elements
  if (isStudentPaper) {
    formatted.push(''); // Blank line before course info
    if (courseInfo) {
      formatted.push(courseInfo);
    }
    if (instructorName) {
      formatted.push(instructorName);
    }
    if (dueDate) {
      formatted.push(dueDate);
    }
  }

  // Professional paper author note
  if (!isStudentPaper && authorNote) {
    formatted.push('');
    formatted.push('Author Note');
    formatted.push(authorNote);
  }

  // Convert TitlePageAuthorInfo[] back to AuthorInfo[] for FormattedTitlePage
  const baseAuthors: AuthorInfo[] = authors.map(a => ({
    name: a.name || formatAuthorName(a),
    affiliation: a.affiliation || a.institution,
    orcid: a.orcid,
  }));

  return {
    // Base FormattedTitlePage fields
    title: formattedTitle,
    authors: baseAuthors,
    affiliations: affiliationLines,
    authorNote: authorNote,
    runningHead: finalRunningHead,
    pageNumber: APA_TITLE_PAGE.pageNumber,
    // Extended fields
    courseInfo,
    instructor: instructorName,
    dueDate,
    formatted,
    isStudentPaper,
    styles: {
      titleBold: APA_TITLE_PAGE.titleBold,
      centered: true,
      doubleSpaced: true,
      font: APA_FONTS.primary,
      fontSize: APA_FONTS.size.body,
    },
  };
}

// =============================================================================
// OUTPUT GENERATION
// =============================================================================

/**
 * Generates LaTeX/Markdown representation of the title page.
 * Uses LaTeX commands for proper APA formatting.
 *
 * @param titlePage - Formatted title page object
 * @returns Markdown/LaTeX string for title page
 */
export function generateTitlePageMarkdown(
  titlePage: ExtendedFormattedTitlePage | FormattedTitlePage
): string {
  const lines: string[] = [];

  // Page break and centering for title page
  lines.push('\\newpage');
  lines.push('');
  lines.push('\\begin{center}');
  lines.push('');

  // Vertical spacing to position in upper third
  lines.push('\\vspace*{2in}');
  lines.push('');

  // Title in bold
  lines.push(`**${titlePage.title}**`);
  lines.push('');

  // Authors
  const authorNames = titlePage.authors.map(a =>
    typeof a === 'string' ? a : a.name
  );
  authorNames.forEach(author => {
    lines.push(author);
  });
  lines.push('');

  // Affiliations
  titlePage.affiliations.forEach(affil => {
    lines.push(affil);
  });

  // Check for extended fields
  const extended = titlePage as ExtendedFormattedTitlePage;

  // Course info if present (student papers)
  if (extended.courseInfo) {
    lines.push('');
    lines.push(extended.courseInfo);
  }
  if (extended.instructor) {
    lines.push(extended.instructor);
  }
  if (extended.dueDate) {
    lines.push(extended.dueDate);
  }

  // Author note if present (professional papers)
  if (titlePage.authorNote) {
    lines.push('');
    lines.push('\\vspace{1in}');
    lines.push('');
    lines.push('**Author Note**');
    lines.push('');
    lines.push(titlePage.authorNote);
  }

  lines.push('');
  lines.push('\\end{center}');
  lines.push('\\newpage');

  return lines.join('\n');
}

/**
 * Generates HTML representation of the title page.
 * Uses semantic HTML with CSS classes for styling.
 *
 * @param titlePage - Formatted title page object
 * @returns HTML string for title page
 */
export function generateTitlePageHtml(
  titlePage: ExtendedFormattedTitlePage | FormattedTitlePage
): string {
  const lines: string[] = [];

  lines.push('<div class="title-page">');

  // Title
  lines.push(`  <h1 class="paper-title">${escapeHtml(titlePage.title)}</h1>`);
  lines.push('');

  // Authors block
  lines.push('  <div class="author-block">');
  titlePage.authors.forEach(author => {
    const name = typeof author === 'string' ? author : author.name;
    lines.push(`    <p class="author">${escapeHtml(name)}</p>`);
  });
  lines.push('  </div>');
  lines.push('');

  // Affiliations block
  lines.push('  <div class="affiliation-block">');
  titlePage.affiliations.forEach(affil => {
    lines.push(`    <p class="affiliation">${escapeHtml(affil)}</p>`);
  });
  lines.push('  </div>');

  // Check for extended fields
  const extended = titlePage as ExtendedFormattedTitlePage;

  // Course info block (student papers)
  if (extended.courseInfo || extended.instructor || extended.dueDate) {
    lines.push('');
    lines.push('  <div class="course-block">');
    if (extended.courseInfo) {
      lines.push(`    <p class="course">${escapeHtml(extended.courseInfo)}</p>`);
    }
    if (extended.instructor) {
      lines.push(`    <p class="instructor">${escapeHtml(extended.instructor)}</p>`);
    }
    if (extended.dueDate) {
      lines.push(`    <p class="due-date">${escapeHtml(extended.dueDate)}</p>`);
    }
    lines.push('  </div>');
  }

  // Author note (professional papers)
  if (titlePage.authorNote) {
    lines.push('');
    lines.push('  <div class="author-note">');
    lines.push('    <h2 class="author-note-heading">Author Note</h2>');
    lines.push(`    <p class="author-note-content">${escapeHtml(titlePage.authorNote)}</p>`);
    lines.push('  </div>');
  }

  lines.push('</div>');

  return lines.join('\n');
}

/**
 * Escapes HTML special characters to prevent XSS.
 *
 * @param text - Text to escape
 * @returns Escaped text
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
 * Generates CSS styles for title page HTML output.
 * Follows APA 7th Edition formatting requirements.
 *
 * @returns CSS string for title page styling
 */
export function getTitlePageCss(): string {
  return `
.title-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  min-height: 100vh;
  padding-top: 33vh;
  font-family: "Times New Roman", Times, Georgia, serif;
  font-size: 12pt;
  line-height: 2;
  text-align: center;
}

.paper-title {
  font-size: 12pt;
  font-weight: bold;
  margin: 0 0 24pt 0;
  line-height: 2;
}

.author-block {
  margin-bottom: 0;
}

.author-block .author {
  margin: 0;
  line-height: 2;
}

.affiliation-block {
  margin-bottom: 0;
}

.affiliation-block .affiliation {
  margin: 0;
  line-height: 2;
}

.course-block {
  margin-top: 24pt;
}

.course-block p {
  margin: 0;
  line-height: 2;
}

.author-note {
  margin-top: 48pt;
  text-align: left;
  max-width: 6.5in;
}

.author-note-heading {
  font-size: 12pt;
  font-weight: bold;
  text-align: center;
  margin: 0 0 24pt 0;
}

.author-note-content {
  text-indent: 0.5in;
  margin: 0;
  line-height: 2;
}
`.trim();
}

// =============================================================================
// UTILITY EXPORTS
// =============================================================================

/**
 * Validates title page input for required fields.
 *
 * @param input - Title page input to validate
 * @returns Object with valid flag and error messages
 */
export function validateTitlePageInput(input: TitlePageInput): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!input.title || input.title.trim().length === 0) {
    errors.push('Title is required');
  }

  if (!input.authors || input.authors.length === 0) {
    errors.push('At least one author is required');
  } else {
    input.authors.forEach((author, index) => {
      const hasName = author.name || (author.firstName && author.lastName);
      if (!hasName) {
        errors.push(`Author ${index + 1} must have a name`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
