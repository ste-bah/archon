/**
 * APA 7th Edition Validation Utilities
 *
 * Provides validation functions for ensuring APA compliance in academic papers.
 * All functions are pure and return structured ValidationResult objects.
 *
 * Reference: American Psychological Association. (2020). Publication manual
 * of the American Psychological Association (7th ed.).
 *
 * @module pdf-generator/utils/validation
 */

import {
  APA_VALIDATION_LIMITS,
  APA_RUNNING_HEAD,
  APA_ABSTRACT,
} from '../constants.js';

// =============================================================================
// TYPES
// =============================================================================

/** Result of a validation operation. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/** A validation error indicating a critical APA compliance issue. */
export interface ValidationError {
  code: string;
  message: string;
  field: string;
  received?: unknown;
  expected?: unknown;
}

/** A validation warning indicating a non-critical issue. */
export interface ValidationWarning {
  code: string;
  message: string;
  suggestion?: string;
}

/** Author information for APA paper. */
export interface AuthorInfo {
  name: string;
  affiliation?: string;
  orcid?: string;
}

/** Complete paper input for validation. */
export interface PaperInput {
  title: string;
  runningHead?: string;
  authors: AuthorInfo[];
  abstract?: string;
  keywords?: string[];
  body: string;
  references?: string[];
}

// =============================================================================
// ERROR & WARNING CODES
// =============================================================================

export const ValidationErrorCodes = {
  RUNNING_HEAD_TOO_LONG: 'RUNNING_HEAD_TOO_LONG',
  RUNNING_HEAD_NOT_UPPERCASE: 'RUNNING_HEAD_NOT_UPPERCASE',
  RUNNING_HEAD_EMPTY: 'RUNNING_HEAD_EMPTY',
  ABSTRACT_TOO_LONG: 'ABSTRACT_TOO_LONG',
  ABSTRACT_EMPTY: 'ABSTRACT_EMPTY',
  TITLE_REQUIRED: 'TITLE_REQUIRED',
  TITLE_WHITESPACE_ONLY: 'TITLE_WHITESPACE_ONLY',
  AUTHOR_NAME_REQUIRED: 'AUTHOR_NAME_REQUIRED',
  AUTHOR_NAME_EMPTY: 'AUTHOR_NAME_EMPTY',
  NO_AUTHORS: 'NO_AUTHORS',
  REFERENCE_MISSING_AUTHOR: 'REFERENCE_MISSING_AUTHOR',
  REFERENCE_MISSING_YEAR: 'REFERENCE_MISSING_YEAR',
  REFERENCE_MISSING_TITLE: 'REFERENCE_MISSING_TITLE',
  REFERENCE_MALFORMED: 'REFERENCE_MALFORMED',
  HEADING_LEVEL_INVALID: 'HEADING_LEVEL_INVALID',
  BODY_EMPTY: 'BODY_EMPTY',
  ORCID_INVALID_FORMAT: 'ORCID_INVALID_FORMAT',
} as const;

export const ValidationWarningCodes = {
  RUNNING_HEAD_MIXED_CASE: 'RUNNING_HEAD_MIXED_CASE',
  ABSTRACT_NEAR_LIMIT: 'ABSTRACT_NEAR_LIMIT',
  TITLE_RECOMMENDED_LENGTH: 'TITLE_RECOMMENDED_LENGTH',
  MISSING_AFFILIATION: 'MISSING_AFFILIATION',
  MISSING_ABSTRACT: 'MISSING_ABSTRACT',
  MISSING_KEYWORDS: 'MISSING_KEYWORDS',
  FEW_REFERENCES: 'FEW_REFERENCES',
  REFERENCE_LOWERCASE_START: 'REFERENCE_LOWERCASE_START',
} as const;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function createEmptyResult(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

/** Counts words in a text string. */
export function countWords(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).filter(w => w.length > 0).length;
}

/** Checks if a string is entirely uppercase. */
export function isUppercase(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const letters = text.replace(/[^a-zA-Z]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}

/** Validates ORCID format: 0000-0000-0000-000X where X can be 0-9 or X. */
export function isValidOrcid(orcid: string): boolean {
  if (!orcid || typeof orcid !== 'string') return false;
  const cleanOrcid = orcid.replace(/^https?:\/\/orcid\.org\//, '');
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(cleanOrcid);
}

/** Merges multiple validation results into one. */
export function mergeValidationResults(...results: ValidationResult[]): ValidationResult {
  const merged: ValidationResult = { valid: true, errors: [], warnings: [] };
  for (const result of results) {
    merged.errors.push(...result.errors);
    merged.warnings.push(...result.warnings);
  }
  merged.valid = merged.errors.length === 0;
  return merged;
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/** Validates a running head for APA 7th Edition compliance. Max 50 chars, ALL CAPS. */
export function validateRunningHead(text: string): ValidationResult {
  const result = createEmptyResult();

  if (text === null || text === undefined || (typeof text === 'string' && text.trim().length === 0)) {
    result.errors.push({
      code: ValidationErrorCodes.RUNNING_HEAD_EMPTY,
      message: 'Running head cannot be empty',
      field: 'runningHead',
      received: text,
    });
    result.valid = false;
    return result;
  }

  const trimmedText = text.trim();

  if (trimmedText.length > APA_RUNNING_HEAD.maxLength) {
    result.errors.push({
      code: ValidationErrorCodes.RUNNING_HEAD_TOO_LONG,
      message: `Running head exceeds maximum length of ${APA_RUNNING_HEAD.maxLength} characters`,
      field: 'runningHead',
      received: trimmedText.length,
      expected: `<= ${APA_RUNNING_HEAD.maxLength}`,
    });
    result.valid = false;
  }

  if (!isUppercase(trimmedText)) {
    const hasUppercase = /[A-Z]/.test(trimmedText);
    const hasLowercase = /[a-z]/.test(trimmedText);

    if (hasUppercase && hasLowercase) {
      result.warnings.push({
        code: ValidationWarningCodes.RUNNING_HEAD_MIXED_CASE,
        message: 'Running head should be in ALL CAPS per APA 7th Edition',
        suggestion: `Convert to: "${trimmedText.toUpperCase()}"`,
      });
    } else if (hasLowercase) {
      result.errors.push({
        code: ValidationErrorCodes.RUNNING_HEAD_NOT_UPPERCASE,
        message: 'Running head must be in ALL CAPS per APA 7th Edition',
        field: 'runningHead',
        received: trimmedText,
        expected: trimmedText.toUpperCase(),
      });
      result.valid = false;
    }
  }

  return result;
}

/** Validates an abstract for APA 7th Edition compliance. Max 250 words. */
export function validateAbstract(text: string): ValidationResult {
  const result = createEmptyResult();

  if (text === null || text === undefined || (typeof text === 'string' && text.trim().length === 0)) {
    result.errors.push({
      code: ValidationErrorCodes.ABSTRACT_EMPTY,
      message: 'Abstract cannot be empty',
      field: 'abstract',
      received: text,
    });
    result.valid = false;
    return result;
  }

  const wordCount = countWords(text.trim());

  if (wordCount > APA_ABSTRACT.maxWords) {
    result.errors.push({
      code: ValidationErrorCodes.ABSTRACT_TOO_LONG,
      message: `Abstract exceeds maximum of ${APA_ABSTRACT.maxWords} words`,
      field: 'abstract',
      received: wordCount,
      expected: `<= ${APA_ABSTRACT.maxWords}`,
    });
    result.valid = false;
  }

  const warningThreshold = Math.floor(APA_ABSTRACT.maxWords * 0.9);
  if (wordCount >= warningThreshold && wordCount <= APA_ABSTRACT.maxWords) {
    result.warnings.push({
      code: ValidationWarningCodes.ABSTRACT_NEAR_LIMIT,
      message: `Abstract is ${wordCount}/${APA_ABSTRACT.maxWords} words (near limit)`,
      suggestion: 'Consider condensing if possible',
    });
  }

  return result;
}

/** Validates a paper title for APA 7th Edition compliance. Required, <=12 words recommended. */
export function validateTitle(title: string): ValidationResult {
  const result = createEmptyResult();

  if (title === null || title === undefined || typeof title !== 'string') {
    result.errors.push({
      code: ValidationErrorCodes.TITLE_REQUIRED,
      message: 'Title is required',
      field: 'title',
      received: title,
    });
    result.valid = false;
    return result;
  }

  if (title.trim().length === 0) {
    result.errors.push({
      code: ValidationErrorCodes.TITLE_WHITESPACE_ONLY,
      message: 'Title cannot be empty or whitespace only',
      field: 'title',
      received: title,
    });
    result.valid = false;
    return result;
  }

  const wordCount = countWords(title.trim());
  if (wordCount > APA_VALIDATION_LIMITS.titleMaxWords) {
    result.warnings.push({
      code: ValidationWarningCodes.TITLE_RECOMMENDED_LENGTH,
      message: `Title has ${wordCount} words; APA recommends ${APA_VALIDATION_LIMITS.titleMaxWords} or fewer`,
      suggestion: 'Consider shortening the title if possible',
    });
  }

  return result;
}

/** Validates author information for APA 7th Edition compliance. */
export function validateAuthor(author: AuthorInfo): ValidationResult {
  const result = createEmptyResult();

  if (author === null || author === undefined) {
    result.errors.push({
      code: ValidationErrorCodes.AUTHOR_NAME_REQUIRED,
      message: 'Author information is required',
      field: 'author',
      received: author,
    });
    result.valid = false;
    return result;
  }

  if (!author.name || (typeof author.name === 'string' && author.name.trim().length === 0)) {
    result.errors.push({
      code: author.name === undefined ? ValidationErrorCodes.AUTHOR_NAME_REQUIRED : ValidationErrorCodes.AUTHOR_NAME_EMPTY,
      message: author.name === undefined ? 'Author name is required' : 'Author name cannot be empty',
      field: 'author.name',
      received: author.name,
    });
    result.valid = false;
  }

  if (!author.affiliation || (typeof author.affiliation === 'string' && author.affiliation.trim().length === 0)) {
    result.warnings.push({
      code: ValidationWarningCodes.MISSING_AFFILIATION,
      message: 'Author affiliation is recommended for APA papers',
      suggestion: 'Add institutional affiliation for the author',
    });
  }

  if (author.orcid && !isValidOrcid(author.orcid)) {
    result.errors.push({
      code: ValidationErrorCodes.ORCID_INVALID_FORMAT,
      message: 'ORCID must be in format 0000-0000-0000-000X',
      field: 'author.orcid',
      received: author.orcid,
      expected: '0000-0000-0000-000X',
    });
    result.valid = false;
  }

  return result;
}

/** Validates a reference entry for basic APA format compliance. */
export function validateReference(ref: string): ValidationResult {
  const result = createEmptyResult();

  if (ref === null || ref === undefined || typeof ref !== 'string' || ref.trim().length === 0) {
    result.errors.push({
      code: ValidationErrorCodes.REFERENCE_MALFORMED,
      message: 'Reference cannot be empty',
      field: 'reference',
      received: ref,
    });
    result.valid = false;
    return result;
  }

  const trimmedRef = ref.trim();
  const yearPattern = /\((\d{4}[a-z]?|n\.d\.)\)/;
  const yearMatch = trimmedRef.match(yearPattern);

  if (!yearMatch) {
    result.errors.push({
      code: ValidationErrorCodes.REFERENCE_MISSING_YEAR,
      message: 'Reference must include publication year in parentheses (e.g., (2020) or (n.d.))',
      field: 'reference',
      received: trimmedRef,
    });
    result.valid = false;
  }

  if (/^[a-z]/.test(trimmedRef)) {
    result.warnings.push({
      code: ValidationWarningCodes.REFERENCE_LOWERCASE_START,
      message: 'Reference should start with author name (capitalized) or title',
      suggestion: 'Ensure author surname is capitalized',
    });
  }

  if (yearMatch && yearMatch.index !== undefined) {
    const beforeYear = trimmedRef.substring(0, yearMatch.index).trim();
    if (beforeYear.length < 2) {
      result.errors.push({
        code: ValidationErrorCodes.REFERENCE_MISSING_AUTHOR,
        message: 'Reference appears to be missing author information',
        field: 'reference',
        received: trimmedRef,
      });
      result.valid = false;
    }

    const afterYear = trimmedRef.substring(yearMatch.index + yearMatch[0].length).trim();
    if (afterYear.length < 3) {
      result.errors.push({
        code: ValidationErrorCodes.REFERENCE_MISSING_TITLE,
        message: 'Reference appears to be missing title information',
        field: 'reference',
        received: trimmedRef,
      });
      result.valid = false;
    }
  }

  return result;
}

/** Validates a heading level for APA 7th Edition compliance. Must be 1-5. */
export function validateHeadingLevel(level: number): ValidationResult {
  const result = createEmptyResult();

  if (level === null || level === undefined || typeof level !== 'number' || isNaN(level)) {
    result.errors.push({
      code: ValidationErrorCodes.HEADING_LEVEL_INVALID,
      message: 'Heading level must be a number',
      field: 'headingLevel',
      received: level,
    });
    result.valid = false;
    return result;
  }

  if (!Number.isInteger(level) || level < 1 || level > APA_VALIDATION_LIMITS.maxHeadingLevels) {
    result.errors.push({
      code: ValidationErrorCodes.HEADING_LEVEL_INVALID,
      message: `Heading level must be an integer between 1 and ${APA_VALIDATION_LIMITS.maxHeadingLevels}`,
      field: 'headingLevel',
      received: level,
      expected: `1-${APA_VALIDATION_LIMITS.maxHeadingLevels}`,
    });
    result.valid = false;
  }

  return result;
}

/** Validates a complete paper input for APA 7th Edition compliance. */
export function validatePaper(paper: PaperInput): ValidationResult {
  if (paper === null || paper === undefined) {
    return {
      valid: false,
      errors: [{ code: 'PAPER_REQUIRED', message: 'Paper input is required', field: 'paper', received: paper }],
      warnings: [],
    };
  }

  const results: ValidationResult[] = [];

  results.push(validateTitle(paper.title));

  if (paper.runningHead !== undefined && paper.runningHead !== null) {
    results.push(validateRunningHead(paper.runningHead));
  }

  if (!paper.authors || paper.authors.length === 0) {
    results.push({
      valid: false,
      errors: [{ code: ValidationErrorCodes.NO_AUTHORS, message: 'At least one author is required', field: 'authors', received: paper.authors }],
      warnings: [],
    });
  } else {
    paper.authors.forEach((author, i) => {
      const authorResult = validateAuthor(author);
      authorResult.errors = authorResult.errors.map(err => ({ ...err, field: err.field.replace('author', `authors[${i}]`) }));
      results.push(authorResult);
    });
  }

  if (paper.abstract !== undefined && paper.abstract !== null) {
    results.push(validateAbstract(paper.abstract));
  } else {
    results.push({ valid: true, errors: [], warnings: [{ code: ValidationWarningCodes.MISSING_ABSTRACT, message: 'Abstract is recommended for APA papers', suggestion: 'Consider adding an abstract (max 250 words)' }] });
  }

  if (!paper.keywords || paper.keywords.length === 0) {
    results.push({ valid: true, errors: [], warnings: [{ code: ValidationWarningCodes.MISSING_KEYWORDS, message: 'Keywords are recommended for APA papers', suggestion: 'Consider adding 3-5 keywords' }] });
  }

  if (!paper.body || (typeof paper.body === 'string' && paper.body.trim().length === 0)) {
    results.push({ valid: false, errors: [{ code: ValidationErrorCodes.BODY_EMPTY, message: 'Paper body content is required', field: 'body', received: paper.body }], warnings: [] });
  }

  if (paper.references && paper.references.length > 0) {
    paper.references.forEach((ref, i) => {
      const refResult = validateReference(ref);
      refResult.errors = refResult.errors.map(err => ({ ...err, field: `references[${i}]` }));
      results.push(refResult);
    });
  } else {
    results.push({ valid: true, errors: [], warnings: [{ code: ValidationWarningCodes.FEW_REFERENCES, message: 'Academic papers typically include references', suggestion: 'Consider adding relevant references to support your work' }] });
  }

  return mergeValidationResults(...results);
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

export const isValidRunningHead = (text: string): boolean => validateRunningHead(text).valid;
export const isValidAbstract = (text: string): boolean => validateAbstract(text).valid;
export const isValidTitle = (title: string): boolean => validateTitle(title).valid;
export const isValidPaper = (paper: PaperInput): boolean => validatePaper(paper).valid;
export const getErrorsOnly = (result: ValidationResult): ValidationError[] => result.errors;
export const getWarningsOnly = (result: ValidationResult): ValidationWarning[] => result.warnings;

/** Format validation result as a human-readable string. */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [`Validation: ${result.valid ? 'PASSED' : 'FAILED'}`];

  if (result.errors.length > 0) {
    lines.push(`\nErrors (${result.errors.length}):`);
    result.errors.forEach(e => lines.push(`  - [${e.code}] ${e.field}: ${e.message}`));
  }

  if (result.warnings.length > 0) {
    lines.push(`\nWarnings (${result.warnings.length}):`);
    result.warnings.forEach(w => {
      lines.push(`  - [${w.code}] ${w.message}`);
      if (w.suggestion) lines.push(`    Suggestion: ${w.suggestion}`);
    });
  }

  return lines.join('\n');
}
