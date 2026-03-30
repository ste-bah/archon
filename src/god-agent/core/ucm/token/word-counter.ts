/**
 * Word Counter Service
 * Accurate word counting with special handling for code blocks, tables, and citations
 *
 * CONSTITUTION RULES: RULE-020 (accuracy)
 */

import type { IWordCounter } from '../types.js';

/**
 * Word counting utility for token estimation
 * Handles special content types appropriately
 */
export class WordCounter implements IWordCounter {
  /**
   * Count words in text with accurate handling of special content
   * @param text - Input text to count words
   * @returns Number of words
   */
  count(text: string): number {
    if (!text || text.trim().length === 0) {
      return 0;
    }

    // Remove code blocks temporarily (they have different token characteristics)
    const codeBlockPattern = /```[\s\S]*?```/g;
    const codeBlocks: string[] = [];
    let processedText = text.replace(codeBlockPattern, (match) => {
      codeBlocks.push(match);
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    // Remove tables temporarily (they have higher token density)
    const tablePattern = /\|[^\n]+\|(\n\|[^\n]+\|)+/g;
    const tables: string[] = [];
    processedText = processedText.replace(tablePattern, (match) => {
      tables.push(match);
      return `__TABLE_${tables.length - 1}__`;
    });

    // Count words in main text
    // Split on whitespace and filter out empty strings
    const words = processedText
      .trim()
      .split(/\s+/)
      .filter(word => word.length > 0);

    let totalWords = words.length;

    // Count words in code blocks (different tokenization)
    for (const codeBlock of codeBlocks) {
      // Remove backticks and language specifier
      const code = codeBlock.replace(/```[\w]*\n?/g, '').trim();
      // Split on whitespace and operators for code
      const codeWords = code.split(/[\s+\-*/=<>(){}[\];,.]+/)
        .filter(word => word.length > 0);
      totalWords += codeWords.length;
    }

    // Count words in tables (cells count as separate units)
    for (const table of tables) {
      // Split by pipe and newline, count non-empty cells
      const cells = table.split(/[\|\n]+/)
        .map(cell => cell.trim())
        .filter(cell => cell.length > 0 && !cell.match(/^-+$/));
      totalWords += cells.length;
    }

    return totalWords;
  }

  /**
   * Count words by splitting text into segments
   * Useful for validation and debugging
   */
  countDetailed(text: string): {
    total: number;
    prose: number;
    code: number;
    tables: number;
  } {
    if (!text || text.trim().length === 0) {
      return { total: 0, prose: 0, code: 0, tables: 0 };
    }

    let proseWords = 0;
    let codeWords = 0;
    let tableWords = 0;

    // Extract and count code blocks
    const codeBlockPattern = /```[\s\S]*?```/g;
    const codeBlocks: string[] = [];
    let processedText = text.replace(codeBlockPattern, (match) => {
      codeBlocks.push(match);
      const code = match.replace(/```[\w]*\n?/g, '').trim();
      const words = code.split(/[\s+\-*/=<>(){}[\];,.]+/)
        .filter(word => word.length > 0);
      codeWords += words.length;
      return '';
    });

    // Extract and count tables
    const tablePattern = /\|[^\n]+\|(\n\|[^\n]+\|)+/g;
    processedText = processedText.replace(tablePattern, (match) => {
      const cells = match.split(/[\|\n]+/)
        .map(cell => cell.trim())
        .filter(cell => cell.length > 0 && !cell.match(/^-+$/));
      tableWords += cells.length;
      return '';
    });

    // Count remaining prose words
    proseWords = processedText
      .trim()
      .split(/\s+/)
      .filter(word => word.length > 0)
      .length;

    return {
      total: proseWords + codeWords + tableWords,
      prose: proseWords,
      code: codeWords,
      tables: tableWords
    };
  }
}
