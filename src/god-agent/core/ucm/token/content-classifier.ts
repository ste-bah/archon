/**
 * Content Classifier Service
 * Detects content type and provides detailed breakdown
 *
 * CONSTITUTION RULES: RULE-001 to RULE-006
 */

import type { IContentClassifier, ITokenBreakdown } from '../types.js';
import { ContentType } from '../types.js';
import { WordCounter } from './word-counter.js';

/**
 * Content type classification for accurate token estimation
 */
export class ContentClassifier implements IContentClassifier {
  private wordCounter: WordCounter;

  constructor() {
    this.wordCounter = new WordCounter();
  }

  /**
   * Classify content type based on dominant content
   * @param text - Input text to classify
   * @returns Primary content type
   */
  classify(text: string): ContentType {
    if (!text || text.trim().length === 0) {
      return ContentType.PROSE;
    }

    const breakdown = this.classifyDetailed(text);

    // Return dominant type by percentage
    const dominant = breakdown.reduce((max, current) =>
      current.percentage > max.percentage ? current : max
    );

    // If no clear dominant type (all < 50%), return MIXED
    if (dominant.percentage < 0.5 && breakdown.length > 1) {
      return ContentType.MIXED;
    }

    return dominant.contentType;
  }

  /**
   * Classify content with detailed breakdown by type
   * @param text - Input text to classify
   * @returns Array of token breakdowns by content type
   */
  classifyDetailed(text: string): ITokenBreakdown[] {
    if (!text || text.trim().length === 0) {
      return [{
        contentType: ContentType.PROSE,
        wordCount: 0,
        tokenCount: 0,
        percentage: 1.0
      }];
    }

    const breakdown: Map<ContentType, { words: number; chars: number }> = new Map();
    let totalChars = 0;

    // Initialize all types
    for (const type of Object.values(ContentType)) {
      breakdown.set(type, { words: 0, chars: 0 });
    }

    let processedText = text;

    // Extract and count code blocks
    const codeBlockPattern = /```[\s\S]*?```/g;
    let match: RegExpExecArray | null;
    while ((match = codeBlockPattern.exec(text)) !== null) {
      const codeBlock = match[0];
      const code = codeBlock.replace(/```[\w]*\n?/g, '').trim();
      const words = code.split(/[\s+\-*/=<>(){}[\];,.]+/)
        .filter(word => word.length > 0).length;

      const entry = breakdown.get(ContentType.CODE)!;
      entry.words += words;
      entry.chars += codeBlock.length;
      totalChars += codeBlock.length;

      // Remove from processed text
      processedText = processedText.replace(codeBlock, '');
    }

    // Extract and count tables
    const tablePattern = /\|[^\n]+\|(\n\|[^\n]+\|)+/g;
    while ((match = tablePattern.exec(text)) !== null) {
      const table = match[0];
      const cells = table.split(/[\|\n]+/)
        .map(cell => cell.trim())
        .filter(cell => cell.length > 0 && !cell.match(/^-+$/));

      const entry = breakdown.get(ContentType.TABLE)!;
      entry.words += cells.length;
      entry.chars += table.length;
      totalChars += table.length;

      // Remove from processed text
      processedText = processedText.replace(table, '');
    }

    // Extract and count citations (Author, Year) pattern
    const citationPattern = /\([A-Z][a-z]+(?:\s+(?:et al\.|&|and)\s+[A-Z][a-z]+)?,\s*\d{4}\)/g;
    while ((match = citationPattern.exec(text)) !== null) {
      const citation = match[0];
      const words = citation.split(/\s+/).filter(w => w.length > 0).length;

      const entry = breakdown.get(ContentType.CITATION)!;
      entry.words += words;
      entry.chars += citation.length;
      totalChars += citation.length;

      // Remove from processed text
      processedText = processedText.replace(citation, '');
    }

    // Count remaining prose
    const proseWords = this.wordCounter.count(processedText);
    const proseEntry = breakdown.get(ContentType.PROSE)!;
    proseEntry.words = proseWords;
    proseEntry.chars = processedText.length;
    totalChars += processedText.length;

    // Build result array with percentages
    const result: ITokenBreakdown[] = [];
    let totalWords = 0;

    // Calculate total words first
    for (const [, data] of breakdown) {
      totalWords += data.words;
    }

    // Prevent division by zero
    if (totalWords === 0) {
      return [{
        contentType: ContentType.PROSE,
        wordCount: 0,
        tokenCount: 0,
        percentage: 1.0
      }];
    }

    // Build breakdown with percentages
    for (const [type, data] of breakdown) {
      if (data.words > 0) {
        result.push({
          contentType: type,
          wordCount: data.words,
          tokenCount: 0, // Will be calculated by TokenEstimationService
          percentage: data.words / totalWords
        });
      }
    }

    // Sort by percentage descending
    result.sort((a, b) => b.percentage - a.percentage);

    return result;
  }

  /**
   * Check if text contains code blocks
   */
  hasCodeBlocks(text: string): boolean {
    return /```[\s\S]*?```/.test(text);
  }

  /**
   * Check if text contains tables
   */
  hasTables(text: string): boolean {
    return /\|[^\n]+\|(\n\|[^\n]+\|)+/.test(text);
  }

  /**
   * Check if text contains citations
   */
  hasCitations(text: string): boolean {
    return /\([A-Z][a-z]+(?:\s+(?:et al\.|&|and)\s+[A-Z][a-z]+)?,\s*\d{4}\)/.test(text);
  }
}
