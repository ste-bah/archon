/**
 * Document Structure Validator
 *
 * Prevents inconsistencies in multi-chapter documents by:
 * 1. Locking structure before writing begins
 * 2. Validating cross-references against actual structure
 * 3. Detecting orphan references to non-existent chapters
 */

export interface ChapterDefinition {
  number: number;
  title: string;
  description?: string;
}

export interface DocumentStructure {
  title: string;
  chapters: ChapterDefinition[];
  createdAt: string;
  locked: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: 'orphan_reference' | 'missing_chapter' | 'wrong_title';
  location: string;
  message: string;
  line?: number;
}

export interface ValidationWarning {
  type: 'inconsistent_numbering' | 'missing_reference';
  location: string;
  message: string;
}

export class DocumentValidator {
  private structure: DocumentStructure | null = null;

  /**
   * Define and lock the document structure BEFORE any writing begins
   */
  defineStructure(title: string, chapters: ChapterDefinition[]): DocumentStructure {
    this.structure = {
      title,
      chapters,
      createdAt: new Date().toISOString(),
      locked: true,
    };
    return this.structure;
  }

  /**
   * Get the locked structure for agents to reference
   */
  getStructure(): DocumentStructure | null {
    return this.structure;
  }

  /**
   * Get valid chapter numbers
   */
  getValidChapterNumbers(): number[] {
    if (!this.structure) return [];
    return this.structure.chapters.map(c => c.number);
  }

  /**
   * Check if a chapter reference is valid
   */
  isValidChapter(chapterNum: number): boolean {
    return this.getValidChapterNumbers().includes(chapterNum);
  }

  /**
   * Validate content for invalid chapter references
   */
  validateContent(content: string, sourceFile: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!this.structure) {
      errors.push({
        type: 'missing_chapter',
        location: sourceFile,
        message: 'No document structure defined. Call defineStructure() first.',
      });
      return { valid: false, errors, warnings };
    }

    const validChapters = this.getValidChapterNumbers();
    const maxChapter = Math.max(...validChapters);

    // Find all chapter references in content
    const chapterRefs = this.extractChapterReferences(content);

    for (const ref of chapterRefs) {
      if (!this.isValidChapter(ref.number)) {
        errors.push({
          type: 'orphan_reference',
          location: sourceFile,
          line: ref.line,
          message: `Reference to Chapter ${ref.number} is invalid. Valid chapters: ${validChapters.join(', ')}`,
        });
      }
    }

    // Check for references beyond the max chapter
    const orphanRefs = chapterRefs.filter(r => r.number > maxChapter);
    if (orphanRefs.length > 0) {
      errors.push({
        type: 'orphan_reference',
        location: sourceFile,
        message: `Found ${orphanRefs.length} references to chapters beyond Chapter ${maxChapter}: ${orphanRefs.map(r => r.number).join(', ')}`,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Extract chapter references from content
   */
  private extractChapterReferences(content: string): Array<{ number: number; line: number; context: string }> {
    const refs: Array<{ number: number; line: number; context: string }> = [];
    const lines = content.split('\n');

    // Patterns to match chapter references
    const patterns = [
      /Chapter\s+(\d+)/gi,
      /see\s+Chapter\s+(\d+)/gi,
      /\(Chapter\s+(\d+)\)/gi,
      /Chapter\s+(\d+)[,:\s]/gi,
    ];

    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          const chapterNum = parseInt(match[1], 10);
          if (!refs.some(r => r.line === index + 1 && r.number === chapterNum)) {
            refs.push({
              number: chapterNum,
              line: index + 1,
              context: line.trim().slice(0, 100),
            });
          }
        }
      }
    });

    return refs;
  }

  /**
   * Generate structure prompt for agents
   */
  generateStructurePrompt(): string {
    if (!this.structure) {
      return 'ERROR: No document structure defined.';
    }

    const chapterList = this.structure.chapters
      .map(c => `- Chapter ${c.number}: ${c.title}${c.description ? ` - ${c.description}` : ''}`)
      .join('\n');

    return `## DOCUMENT STRUCTURE CONTRACT (LOCKED)

**Title**: ${this.structure.title}

**Chapters**:
${chapterList}

**RULES**:
1. ONLY reference chapters listed above
2. Use EXACT chapter numbers (1-${this.structure.chapters.length})
3. NO references to Chapter ${this.structure.chapters.length + 1} or beyond
4. When referencing other chapters, use format: "see Chapter X" or "(Chapter X)"

**INVALID**: "Chapter 6", "Chapter 7", "Chapter 8", "Chapter 9", "Chapter 10"
`;
  }

  /**
   * Validate all files in a directory
   */
  async validateDirectory(dirPath: string): Promise<ValidationResult> {
    const { readdir, readFile } = await import('fs/promises');
    const { join } = await import('path');

    const allErrors: ValidationError[] = [];
    const allWarnings: ValidationWarning[] = [];

    try {
      const files = await readdir(dirPath);
      const mdFiles = files.filter(f => f.endsWith('.md'));

      for (const file of mdFiles) {
        const content = await readFile(join(dirPath, file), 'utf-8');
        const result = this.validateContent(content, file);
        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);
      }
    } catch (error) {
      allErrors.push({
        type: 'missing_chapter',
        location: dirPath,
        message: `Failed to read directory: ${error}`,
      });
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
    };
  }
}

// Default 5-chapter PhD structure
export const PHD_DISSERTATION_STRUCTURE: ChapterDefinition[] = [
  { number: 1, title: 'Introduction', description: 'Research problem, questions, and framework' },
  { number: 2, title: 'Literature Review', description: 'Theoretical frameworks and prior research' },
  { number: 3, title: 'Results', description: 'Empirical findings and case studies' },
  { number: 4, title: 'Discussion', description: 'Analysis, interpretation, and synthesis' },
  { number: 5, title: 'Conclusion', description: 'Summary, limitations, and future research' },
];

// Export singleton for easy use
export const documentValidator = new DocumentValidator();
