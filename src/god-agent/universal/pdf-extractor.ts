/**
 * PDF Text Extractor for Style Learning
 *
 * Extracts text from PDF files for style analysis.
 * Supports multiple extraction methods:
 * 1. Direct file reading (for pre-extracted text)
 * 2. External tool invocation (pdftotext if available)
 * 3. Fallback to basic extraction
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface PDFExtractionResult {
  filename: string;
  text: string;
  pageCount?: number;
  wordCount: number;
  extractionMethod: 'pdftotext' | 'node' | 'cached' | 'manual';
  success: boolean;
  error?: string;
}

export interface BatchExtractionResult {
  successful: PDFExtractionResult[];
  failed: PDFExtractionResult[];
  totalFiles: number;
  totalWords: number;
}

export class PDFExtractor {
  private cacheDir: string;
  private hasPoppler: boolean | null = null;

  constructor(basePath: string = process.cwd()) {
    this.cacheDir = path.join(basePath, '.agentdb/universal/pdf-cache');
    this.ensureCacheDir();
  }

  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Check if pdftotext (poppler-utils) is available
   */
  private async checkPoppler(): Promise<boolean> {
    if (this.hasPoppler !== null) return this.hasPoppler;

    try {
      await execAsync('which pdftotext');
      this.hasPoppler = true;
    } catch {
      // INTENTIONAL: pdftotext not installed is a valid state - fallback extraction will be used
      this.hasPoppler = false;
    }
    return this.hasPoppler;
  }

  /**
   * Get cached text for a PDF if available
   */
  private getCachedText(pdfPath: string): string | null {
    const cacheKey = this.getCacheKey(pdfPath);
    const cachePath = path.join(this.cacheDir, `${cacheKey}.txt`);

    if (fs.existsSync(cachePath)) {
      const stats = fs.statSync(pdfPath);
      const cacheStats = fs.statSync(cachePath);

      // Use cache if PDF hasn't been modified since caching
      if (cacheStats.mtime > stats.mtime) {
        return fs.readFileSync(cachePath, 'utf-8');
      }
    }
    return null;
  }

  /**
   * Cache extracted text
   */
  private cacheText(pdfPath: string, text: string): void {
    const cacheKey = this.getCacheKey(pdfPath);
    const cachePath = path.join(this.cacheDir, `${cacheKey}.txt`);
    fs.writeFileSync(cachePath, text);
  }

  /**
   * Generate cache key from file path
   */
  private getCacheKey(pdfPath: string): string {
    const absPath = path.resolve(pdfPath);
    // Simple hash: use base64 of path (truncated)
    return Buffer.from(absPath).toString('base64').replace(/[/+=]/g, '_').slice(0, 50);
  }

  /**
   * Extract text from a single PDF
   */
  async extractText(pdfPath: string): Promise<PDFExtractionResult> {
    const filename = path.basename(pdfPath);

    // Check if file exists
    if (!fs.existsSync(pdfPath)) {
      return {
        filename,
        text: '',
        wordCount: 0,
        extractionMethod: 'manual',
        success: false,
        error: `File not found: ${pdfPath}`,
      };
    }

    // Check cache first
    const cachedText = this.getCachedText(pdfPath);
    if (cachedText) {
      return {
        filename,
        text: cachedText,
        wordCount: cachedText.split(/\s+/).length,
        extractionMethod: 'cached',
        success: true,
      };
    }

    // Try pdftotext if available
    if (await this.checkPoppler()) {
      try {
        const { stdout } = await execAsync(`pdftotext -layout "${pdfPath}" -`);
        const text = this.cleanExtractedText(stdout);
        this.cacheText(pdfPath, text);

        return {
          filename,
          text,
          wordCount: text.split(/\s+/).length,
          extractionMethod: 'pdftotext',
          success: true,
        };
      } catch (error) {
        // Fall through to other methods
      }
    }

    // Fallback: Try to read as if it were a text file (for OCR'd PDFs or text-based PDFs)
    try {
      const buffer = fs.readFileSync(pdfPath);
      const text = this.extractTextFromBuffer(buffer);

      if (text.length > 100) {
        this.cacheText(pdfPath, text);
        return {
          filename,
          text,
          wordCount: text.split(/\s+/).length,
          extractionMethod: 'node',
          success: true,
        };
      }
    } catch {
      // INTENTIONAL: Node PDF extraction failure is expected - falls through to return failure result
    }

    // Return failure - suggest manual extraction
    return {
      filename,
      text: '',
      wordCount: 0,
      extractionMethod: 'manual',
      success: false,
      error: 'Could not extract text. Please provide pre-extracted text or install poppler-utils (pdftotext).',
    };
  }

  /**
   * Basic text extraction from PDF buffer (extracts visible text strings)
   */
  private extractTextFromBuffer(buffer: Buffer): string {
    const content = buffer.toString('latin1');
    const textChunks: string[] = [];

    // Extract text between BT and ET markers (text blocks in PDF)
    const btPattern = /BT[\s\S]*?ET/g;
    const matches = content.match(btPattern);

    if (matches) {
      for (const match of matches) {
        // Extract text from Tj and TJ operators
        const tjPattern = /\(([^)]+)\)\s*Tj/g;
        let tjMatch;
        while ((tjMatch = tjPattern.exec(match)) !== null) {
          textChunks.push(this.decodePDFString(tjMatch[1]));
        }

        // Extract from TJ arrays
        const tjArrayPattern = /\[([^\]]+)\]\s*TJ/g;
        let tjArrayMatch;
        while ((tjArrayMatch = tjArrayPattern.exec(match)) !== null) {
          const items = tjArrayMatch[1].match(/\(([^)]*)\)/g);
          if (items) {
            for (const item of items) {
              const text = item.slice(1, -1);
              textChunks.push(this.decodePDFString(text));
            }
          }
        }
      }
    }

    // Also try to find stream content
    const streamPattern = /stream\s*([\s\S]*?)\s*endstream/g;
    let streamMatch;
    while ((streamMatch = streamPattern.exec(content)) !== null) {
      const streamContent = streamMatch[1];
      // Look for readable text in streams
      const readableText = streamContent.replace(/[^\x20-\x7E\n\r]/g, ' ');
      if (readableText.length > 50) {
        const words = readableText.match(/[a-zA-Z]{3,}/g);
        if (words && words.length > 10) {
          textChunks.push(words.join(' '));
        }
      }
    }

    return this.cleanExtractedText(textChunks.join(' '));
  }

  /**
   * Decode PDF string escape sequences
   */
  private decodePDFString(str: string): string {
    return str
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
      .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
  }

  /**
   * Clean extracted text for analysis
   */
  private cleanExtractedText(text: string): string {
    return text
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove page numbers
      .replace(/\b\d+\s*\|\s*/g, '')
      // Remove common PDF artifacts
      .replace(/[\x00-\x1F]/g, ' ')
      // Fix common ligatures
      .replace(/ﬁ/g, 'fi')
      .replace(/ﬂ/g, 'fl')
      .replace(/ﬀ/g, 'ff')
      // Remove excessive punctuation
      .replace(/\.{3,}/g, '...')
      // Normalize quotes
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      // Clean up spaces
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract text from multiple PDFs in a directory
   */
  async extractFromDirectory(dirPath: string, options: {
    recursive?: boolean;
    maxFiles?: number;
  } = {}): Promise<BatchExtractionResult> {
    const { recursive = false, maxFiles = 100 } = options;

    const pdfFiles = this.findPDFs(dirPath, recursive).slice(0, maxFiles);
    const successful: PDFExtractionResult[] = [];
    const failed: PDFExtractionResult[] = [];
    let totalWords = 0;

    for (const pdfPath of pdfFiles) {
      const result = await this.extractText(pdfPath);
      if (result.success) {
        successful.push(result);
        totalWords += result.wordCount;
      } else {
        failed.push(result);
      }
    }

    return {
      successful,
      failed,
      totalFiles: pdfFiles.length,
      totalWords,
    };
  }

  /**
   * Find PDF files in directory
   */
  private findPDFs(dirPath: string, recursive: boolean): string[] {
    const pdfs: string[] = [];

    const scan = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
            pdfs.push(fullPath);
          } else if (entry.isDirectory() && recursive) {
            scan(fullPath);
          }
        }
      } catch {
        // INTENTIONAL: Skip directories we can't read - permission errors are expected in system directories
      }
    };

    scan(dirPath);
    return pdfs.sort();
  }

  /**
   * Store manually provided text for a PDF (for when extraction fails)
   */
  storeManualText(pdfPath: string, text: string): void {
    this.cacheText(pdfPath, text);
  }

  /**
   * Get extraction statistics
   */
  getStats(): { cachedFiles: number; cacheSize: number } {
    try {
      const files = fs.readdirSync(this.cacheDir);
      let totalSize = 0;
      for (const file of files) {
        const stats = fs.statSync(path.join(this.cacheDir, file));
        totalSize += stats.size;
      }
      return {
        cachedFiles: files.length,
        cacheSize: totalSize,
      };
    } catch {
      // INTENTIONAL: Cache directory may not exist yet - return empty stats as valid state
      return { cachedFiles: 0, cacheSize: 0 };
    }
  }
}

// Export singleton
let defaultExtractor: PDFExtractor | null = null;

export function getPDFExtractor(basePath?: string): PDFExtractor {
  if (!defaultExtractor) {
    defaultExtractor = new PDFExtractor(basePath);
  }
  return defaultExtractor;
}
