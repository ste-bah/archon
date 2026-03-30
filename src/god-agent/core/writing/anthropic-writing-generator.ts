/**
 * Anthropic Writing Generator (SPEC-WRT-001)
 *
 * LLM-based writing generation using Anthropic's Claude API.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { IWritingGenerator, IWriteRequest, IWriteResult, RegionalTransformationMetadata } from './writing-generator.js';
import type { StyleProfileManager } from '../../universal/style-profile.js';
import { SpellingTransformer } from '../../universal/spelling-transformer.js';
import { GrammarTransformer } from '../../universal/grammar-transformer.js';
import type { RegionalSettings } from '../../universal/style-analyzer.js';

export class AnthropicWritingGenerator implements IWritingGenerator {
  private client: Anthropic;
  private styleManager?: StyleProfileManager;
  private model = 'claude-3-5-sonnet-20241022';

  constructor(apiKey?: string, styleManager?: StyleProfileManager) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        'ANTHROPIC_API_KEY not configured. Set environment variable or pass to constructor.'
      );
    }
    this.client = new Anthropic({ apiKey: key });
    this.styleManager = styleManager;
  }

  async generate(request: IWriteRequest): Promise<IWriteResult> {
    const startTime = Date.now();

    // Build system prompt with style
    const systemPrompt = await this.buildSystemPrompt(request);

    // Build user prompt
    const userPrompt = this.buildUserPrompt(request);

    // Generate content
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.estimateTokens(request.maxLength || 2000),
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    let content = this.extractContent(response);
    const latencyMs = Date.now() - startTime;

    // Apply regional transformations if style profile has regional settings
    let regionalTransformations: RegionalTransformationMetadata | undefined;
    if (request.style && this.styleManager) {
      const profile = await this.styleManager.getProfile(request.style);
      if (profile?.characteristics.regional) {
        const transformResult = this.applyRegionalTransformations(
          content,
          profile.characteristics.regional
        );
        content = transformResult.transformed;
        regionalTransformations = transformResult.metadata;
      }
    }

    return {
      content,
      wordCount: this.countWords(content),
      qualityScore: await this.assessQuality(content, request),
      metadata: {
        model: this.model,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        latencyMs,
        styleApplied: !!request.style,
        regionalTransformations,
      },
    };
  }

  async generateSection(heading: string, context: string, style?: string): Promise<string> {
    let systemPrompt = `You are a professional writer. Generate complete, coherent section content.`;

    // Apply style if provided
    if (style && this.styleManager) {
      const profile = await this.styleManager.getProfile(style);
      if (profile) {
        systemPrompt += this.buildStylePromptAddition(profile);
      }
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Write a complete section for: ${heading}\n\nContext: ${context}\n\nWrite only the section content, no placeholder text.`,
        },
      ],
    });

    return this.extractContent(response);
  }

  getSupportedStyles(): string[] {
    return this.styleManager?.listProfiles().map(p => p.name) ?? [];
  }

  /**
   * Build system prompt with style profile integration
   */
  private async buildSystemPrompt(request: IWriteRequest): Promise<string> {
    let prompt = `You are a professional writer creating high-quality content.
Your task is to generate complete, coherent, well-structured content.

Guidelines:
- Write complete paragraphs, not outlines or placeholders
- Use clear transitions between sections
- Maintain consistent tone throughout
- Support claims with reasoning
- Use markdown formatting appropriately`;

    // Apply style profile if specified
    if (request.style && this.styleManager) {
      const profile = await this.styleManager.getProfile(request.style);
      if (profile) {
        prompt += this.buildStylePromptAddition(profile);
      }
    }

    return prompt;
  }

  /**
   * Build style prompt addition from profile characteristics
   */
  private buildStylePromptAddition(profile: any): string {
    let addition = `\n\nStyle Profile: ${profile.metadata.name}`;

    const chars = profile.characteristics;
    const characteristics: string[] = [];

    // Sentence metrics
    if (chars.sentences && chars.sentences.averageLength) {
      characteristics.push(
        `Sentence length: avg ${chars.sentences.averageLength.toFixed(1)} words`
      );
    }

    // Vocabulary metrics
    if (chars.vocabulary) {
      characteristics.push(
        `Vocabulary complexity: ${chars.vocabulary.uniqueWordRatio.toFixed(2)}`
      );
    }

    // Tone metrics
    if (chars.tone) {
      const formality = chars.tone.formalityScore > 0.6 ? 'formal' : 'casual';
      characteristics.push(`Tone: ${formality}`);
    }

    // Common transitions
    if (chars.commonTransitions && chars.commonTransitions.length > 0) {
      characteristics.push(
        `Common transitions: ${chars.commonTransitions.slice(0, 5).join(', ')}`
      );
    }

    if (characteristics.length > 0) {
      addition += `\n\nWriting characteristics to emulate:\n${characteristics.map(c => `- ${c}`).join('\n')}`;
    }

    return addition;
  }

  /**
   * Build user prompt from request
   */
  private buildUserPrompt(request: IWriteRequest): string {
    let prompt = `Write a complete document with the following specifications:

Title: ${request.title}
Description: ${request.description}`;

    if (request.outline && request.outline.length > 0) {
      prompt += `\n\nStructure (follow this outline):
${request.outline.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    }

    if (request.context) {
      prompt += `\n\nRelevant Context:
${request.context}`;
    }

    if (request.maxLength) {
      prompt += `\n\nTarget length: approximately ${request.maxLength} words`;
    }

    if (request.tone) {
      prompt += `\n\nTone: ${request.tone}`;
    }

    prompt += `\n\nIMPORTANT: Generate complete, publication-ready content. Do not use placeholders like "[content here]" or "TODO".`;

    return prompt;
  }

  /**
   * Extract text content from Anthropic message response
   */
  private extractContent(response: Anthropic.Message): string {
    return response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as Anthropic.TextBlock).text)
      .join('\n');
  }

  /**
   * Estimate token count from word count
   */
  private estimateTokens(words: number): number {
    // Rough estimate: 1 word ≈ 1.5 tokens
    // Cap at 8000 tokens for safety
    return Math.min(Math.ceil(words * 1.5), 8000);
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.split(/\s+/).filter((w) => w.length > 0).length;
  }

  /**
   * Assess quality of generated content
   */
  private async assessQuality(content: string, request: IWriteRequest): Promise<number> {
    let score = 0;
    const words = this.countWords(content);

    // 1. Length appropriateness (0.2)
    const targetWords = request.maxLength || 1000;
    const lengthRatio = words / targetWords;
    if (lengthRatio >= 0.8 && lengthRatio <= 1.2) {
      score += 0.2;
    } else if (lengthRatio >= 0.5 && lengthRatio <= 1.5) {
      score += 0.1;
    }

    // 2. No placeholder text (0.3) - CRITICAL
    const placeholderPatterns = /\[.*?here\]|\[.*?content\]|TODO|PLACEHOLDER|\[Generated.*?\]/gi;
    if (!placeholderPatterns.test(content)) {
      score += 0.3;
    }

    // 3. Has proper structure (0.2)
    // Check for headers
    if (content.includes('# ') || content.includes('## ')) {
      score += 0.1;
    }
    // Check for multiple paragraphs
    if (content.split('\n\n').length >= 3) {
      score += 0.1;
    }

    // 4. Coherent paragraphs (0.2)
    const paragraphs = content.split('\n\n').filter((p) => p.trim().length > 50);
    if (paragraphs.length >= 2) {
      score += 0.2;
    }

    // 5. Title present (0.1)
    if (content.toLowerCase().includes(request.title.toLowerCase().substring(0, 20))) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Apply regional transformations (UK/US English spelling and grammar)
   * @param text - Text to transform
   * @param regional - Regional settings from style profile
   * @returns Transformed text and metadata
   */
  private applyRegionalTransformations(
    text: string,
    regional: RegionalSettings
  ): { transformed: string; metadata: RegionalTransformationMetadata } {
    const variant = regional.languageVariant === 'auto' ? 'en-GB' : regional.languageVariant;

    if (variant === 'en-US') {
      return {
        transformed: text,
        metadata: { variant: 'en-US', spellingChanges: 0, grammarChanges: 0, rulesApplied: [] }
      };
    }

    // Apply spelling transformation
    const spellingTransformer = new SpellingTransformer(variant);
    const spellingResult = spellingTransformer.transform(text);
    const spellingChanges = this.countSpellingChanges(text, spellingResult);

    // Apply grammar transformation (preserving quotes)
    const grammarTransformer = new GrammarTransformer(variant);
    const grammarResult = grammarTransformer.transform(spellingResult, {
      preserveQuotes: true,
      categories: ['past-participle', 'preposition']
    });

    console.log(`[WritingGenerator] Applied UK transformations: ${spellingChanges} spelling, ${grammarResult.changeCount} grammar`);

    return {
      transformed: grammarResult.transformed,
      metadata: {
        variant,
        spellingChanges,
        grammarChanges: grammarResult.changeCount,
        rulesApplied: grammarResult.rulesApplied
      }
    };
  }

  /**
   * Count spelling changes between original and transformed text
   * @param original - Original text
   * @param transformed - Transformed text
   * @returns Number of words that changed
   */
  private countSpellingChanges(original: string, transformed: string): number {
    const originalWords = original.toLowerCase().split(/\s+/);
    const transformedWords = transformed.toLowerCase().split(/\s+/);
    let changes = 0;
    for (let i = 0; i < originalWords.length && i < transformedWords.length; i++) {
      if (originalWords[i] !== transformedWords[i]) changes++;
    }
    return changes;
  }
}
