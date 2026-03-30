/**
 * Writing Generator Interface (SPEC-WRT-001)
 *
 * Defines the contract for LLM-based writing generation.
 */

export interface IWriteRequest {
  /** Document title */
  title: string;

  /** Document description/requirements */
  description: string;

  /** Style profile name (optional) */
  style?: string;

  /** Section outline (optional) */
  outline?: string[];

  /** Additional context from InteractionStore (optional) */
  context?: string;

  /** Maximum word count (optional) */
  maxLength?: number;

  /** Output format */
  format?: 'markdown' | 'html' | 'plain';

  /** Writing tone */
  tone?: 'formal' | 'casual' | 'technical' | 'narrative';
}

/**
 * Regional transformation metadata
 */
export interface RegionalTransformationMetadata {
  /** Language variant applied */
  variant: 'en-US' | 'en-GB';
  /** Number of spelling changes made */
  spellingChanges: number;
  /** Number of grammar changes made */
  grammarChanges: number;
  /** Array of rule IDs that were applied */
  rulesApplied: string[];
}

export interface IWriteResult {
  /** Generated content */
  content: string;

  /** Structured sections (optional) */
  sections?: Array<{ heading: string; content: string }>;

  /** Actual word count */
  wordCount: number;

  /** Quality assessment score (0-1) */
  qualityScore: number;

  /** Generation metadata */
  metadata: {
    /** Model used for generation */
    model: string;

    /** Total tokens consumed */
    tokensUsed: number;

    /** Generation latency in milliseconds */
    latencyMs: number;

    /** Whether style profile was applied */
    styleApplied: boolean;

    /** Regional transformation metadata (optional) */
    regionalTransformations?: RegionalTransformationMetadata;
  };
}

export interface IWritingGenerator {
  /**
   * Generate complete document content
   */
  generate(request: IWriteRequest): Promise<IWriteResult>;

  /**
   * Generate a single section
   */
  generateSection(heading: string, context: string, style?: string): Promise<string>;

  /**
   * Get list of supported style profiles
   */
  getSupportedStyles(): string[];
}
