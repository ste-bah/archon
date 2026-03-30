/**
 * Writing Generation Module (SPEC-WRT-001)
 *
 * LLM-based writing generation with style profile support.
 */

export type {
  IWriteRequest,
  IWriteResult,
  IWritingGenerator,
} from './writing-generator.js';

export { AnthropicWritingGenerator } from './anthropic-writing-generator.js';
