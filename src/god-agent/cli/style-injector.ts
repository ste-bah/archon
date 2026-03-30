/**
 * StyleInjector - Injects style profile into Phase 6 agent prompts
 * Implements REQ-PIPE-010, REQ-PIPE-012, REQ-PIPE-013, REQ-PIPE-014, REQ-PIPE-015, REQ-PIPE-016
 */

import { StyleProfileManager } from '../universal/style-profile.js';
import { StyleAnalyzer, StyleCharacteristics } from '../universal/style-analyzer.js';
import type { AgentConfig } from './pipeline-loader.js';

// Default style prompt when no profile is available
const DEFAULT_STYLE_PROMPT = `Regional Language Settings:
- Use American English spelling conventions
- Examples: color, organization, analyze, center, behavior
- Use APA citation style
- Formality: Academic, formal tone`;

/**
 * StyleInjector class for building style-injected prompts
 */
export class StyleInjector {
  private styleManager: StyleProfileManager;
  private styleAnalyzer: StyleAnalyzer;

  constructor(basePath: string = process.cwd()) {
    this.styleManager = new StyleProfileManager(basePath);
    this.styleAnalyzer = new StyleAnalyzer();
  }

  /**
   * Build agent prompt with conditional style injection
   * [REQ-PIPE-010, REQ-PIPE-016, REQ-PIPE-030]
   *
   * NOTE: Uses StyleProfileManager.generateStylePrompt() which internally uses
   * StyleAnalyzer.generateStylePrompt() - the same method PhDPipelineBridge uses.
   * This ensures format consistency (REQ-PIPE-016) without requiring access to
   * PhDPipelineBridge private methods.
   */
  async buildAgentPrompt(
    agent: AgentConfig,
    styleProfileId?: string,
    query?: string,
    outputContext?: { researchDir: string; agentIndex: number; agentKey: string }
  ): Promise<string> {
    // Check if Phase 6 agent
    const isPhase6 = agent.phase === 6;

    // Inject query into prompt if provided
    let basePrompt = agent.description;
    if (query) {
      basePrompt = `## RESEARCH QUERY\n\"${query}\"\n\n${basePrompt}`;
    }

    // [REQ-PIPE-027] Inject output directory and expected file path
    if (outputContext) {
      const paddedIndex = String(outputContext.agentIndex).padStart(2, '0');
      const expectedFileName = `${paddedIndex}-${outputContext.agentKey}.md`;
      const expectedPath = `${outputContext.researchDir}/${expectedFileName}`;

      basePrompt = `## OUTPUT REQUIREMENTS
**Research Directory**: ${outputContext.researchDir}
**Expected Output File**: ${expectedFileName}
**Full Path**: ${expectedPath}

CRITICAL: Write your output to the exact path specified above. Do NOT create subdirectories or use different file names.

${basePrompt}`;
    }

    if (!isPhase6) {
      // No style injection for non-writing agents
      return basePrompt;
    }

    // [REQ-PIPE-010] Phase 6 agents get style injection
    return this.buildStyledPrompt({ ...agent, description: basePrompt }, styleProfileId);
  }

  /**
   * Build prompt with style injection using StyleProfileManager
   * [REQ-PIPE-030, REQ-PIPE-016]
   *
   * Uses StyleProfileManager.generateStylePrompt(profileId) which is PUBLIC
   * and produces identical output to PhDPipelineBridge.getStylePromptSync()
   * since both use StyleAnalyzer.generateStylePrompt() internally.
   */
  private buildStyledPrompt(
    agent: AgentConfig,
    styleProfileId?: string
  ): string {
    // Get base description
    const basePrompt = agent.description;

    // [REQ-PIPE-031] Use StyleProfileManager for profile loading and prompt generation
    // Try specified profile first, then active profile, then default
    let stylePrompt = this.styleManager.generateStylePrompt(styleProfileId);

    if (!stylePrompt) {
      // Try active profile
      stylePrompt = this.styleManager.generateStylePrompt();
    }

    if (!stylePrompt) {
      // Use default style
      stylePrompt = DEFAULT_STYLE_PROMPT;
    }

    // Concatenate base prompt + style injection
    return `${basePrompt}\n\n## STYLE GUIDELINES\n${stylePrompt}`;
  }

  /**
   * Generate style prompt from characteristics directly
   * Used for dynamic Phase 6 agents with custom chapter context
   */
  generateStylePromptFromCharacteristics(characteristics: StyleCharacteristics): string {
    return this.styleAnalyzer.generateStylePrompt(characteristics);
  }

  /**
   * Get style characteristics for a profile
   * [REQ-PIPE-031]
   */
  getStyleCharacteristics(profileId?: string): StyleCharacteristics | null {
    return this.styleManager.getStyleCharacteristics(profileId);
  }

  /**
   * Get the raw style prompt for a profile
   */
  getStylePrompt(profileId?: string): string | null {
    return this.styleManager.generateStylePrompt(profileId);
  }

  /**
   * Validate style injection includes required components
   * [REQ-PIPE-012, REQ-PIPE-013, REQ-PIPE-014, REQ-PIPE-015]
   */
  validateStyleInjection(prompt: string): {
    valid: boolean;
    missing: string[];
  } {
    const required: { marker: string; requirement: string }[] = [
      { marker: 'English', requirement: 'REQ-PIPE-015 (Language Variant)' },
      { marker: 'spell', requirement: 'REQ-PIPE-012 (Spelling Rules)' },
    ];

    const missing: string[] = [];

    for (const { marker, requirement } of required) {
      if (!prompt.toLowerCase().includes(marker.toLowerCase())) {
        missing.push(requirement);
      }
    }

    return {
      valid: missing.length === 0,
      missing
    };
  }

  /**
   * Check if a prompt contains style injection
   */
  hasStyleInjection(prompt: string): boolean {
    return prompt.includes('## STYLE GUIDELINES') ||
           prompt.includes('Regional Language Settings') ||
           prompt.includes('Sentence Structure:');
  }

  /**
   * Get default style prompt for fallback
   */
  getDefaultStylePrompt(): string {
    return DEFAULT_STYLE_PROMPT;
  }
}
