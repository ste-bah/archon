/**
 * Claude Code Hooks - Output Extractor Service
 *
 * Implements: TECH-HKS-001 OutputExtractor contract
 * Constitution: REQ-HKS-005, REQ-HKS-006, FM-HKS-003
 *
 * Extracts structured data from Task() output including TASK COMPLETION SUMMARY.
 *
 * @module scripts/hooks/output-extractor
 */

import type { ITaskSummary, IStoreEntry, IFeedbackEntry, IHookConfig, IHookLogger } from './hook-types.js';
import type { KnowledgeEntry } from '../../src/god-agent/universal/universal-agent.js';
import { createHookLogger } from './hook-logger.js';

/**
 * OutputExtractor - Service for extracting structured data from Task() output
 *
 * Implements: TECH-HKS-001 OutputExtractor Service contract
 */
export class OutputExtractor {
  private readonly logger: IHookLogger;

  constructor(config: IHookConfig) {
    this.logger = createHookLogger('post-task', config.verbose);
  }

  /**
   * Extract TASK COMPLETION SUMMARY from output
   *
   * Implements: REQ-HKS-005, REQ-HKS-006
   *
   * @param output - Raw Task() output string
   * @returns Parsed ITaskSummary or null if extraction fails
   */
  extractSummary(output: string): ITaskSummary | null {
    if (!output || output.trim() === '') {
      this.logger.warn('Empty output received');
      return null;
    }

    this.logger.debug('Starting summary extraction', { outputLength: output.length });

    // Search for "## TASK COMPLETION SUMMARY" marker
    const summaryMarkerRegex = /## TASK COMPLETION SUMMARY/i;
    const summaryMatch = output.match(summaryMarkerRegex);

    if (!summaryMatch || summaryMatch.index === undefined) {
      this.logger.warn('TASK COMPLETION SUMMARY marker not found, using heuristic parser');
      return this.heuristicParse(output);
    }

    // Extract section until next "##" heading or end of output
    const startIndex = summaryMatch.index;
    const afterMarker = output.substring(startIndex);
    const nextHeadingMatch = afterMarker.substring(30).match(/\n## /); // Skip past current heading

    const endIndex = nextHeadingMatch && nextHeadingMatch.index !== undefined
      ? startIndex + 30 + nextHeadingMatch.index
      : output.length;

    const summarySection = output.substring(startIndex, endIndex);

    this.logger.debug('Summary section extracted', { sectionLength: summarySection.length });

    try {
      return this.parseSummarySection(summarySection);
    } catch (error) {
      this.logger.warn('Summary parsing failed, using heuristic parser', {
        error: (error as Error).message
      });
      return this.heuristicParse(output);
    }
  }

  /**
   * Parse the summary section into structured data
   */
  private parseSummarySection(section: string): ITaskSummary {
    const summary: ITaskSummary = {
      whatIDid: '',
      filesCreated: [],
      filesModified: [],
      interactionStoreEntries: [],
      reasoningBankFeedback: null,
      nextAgentGuidance: ''
    };

    // Extract "**What I Did**:" section
    const whatIDidMatch = section.match(/\*\*What I Did\*\*:?\s*([^\n*]+)/i);
    if (whatIDidMatch) {
      summary.whatIDid = whatIDidMatch[1].trim();
    }

    // Extract "**Files Created/Modified**:" section
    const filesMatch = section.match(/\*\*Files (Created\/Modified|Created|Modified)\*\*:?\s*([\s\S]*?)(?=\n\*\*|\n##|$)/i);
    if (filesMatch) {
      const filesList = filesMatch[2];
      // Parse file paths from bullet points
      const fileRegex = /[-*]\s*`?([^`\n]+)`?\s*-?/g;
      let match;
      while ((match = fileRegex.exec(filesList)) !== null) {
        const filePath = match[1].trim();
        if (filePath.startsWith('./') || filePath.includes('/')) {
          // Categorize as created or modified based on context
          if (section.toLowerCase().includes('created') && section.indexOf(filePath) < section.toLowerCase().indexOf('modified')) {
            summary.filesCreated.push(filePath);
          } else {
            summary.filesModified.push(filePath);
          }
        }
      }
    }

    // Extract "**InteractionStore Entries**" section
    const storeEntriesMatch = section.match(/\*\*InteractionStore Entries\*\*[^:]*:?\s*([\s\S]*?)(?=\n\*\*|\n##|$)/i);
    if (storeEntriesMatch) {
      const entriesText = storeEntriesMatch[1];
      // Parse entries like: "- Domain: `project/api`, Tags: `['tag1', 'tag2']` - Description"
      const entryRegex = /[-*]\s*Domain:\s*`?([^`\n,]+)`?,?\s*Tags:\s*`?\[?([^\]`\n]+)\]?`?\s*-?\s*(.+)/gi;
      let match;
      while ((match = entryRegex.exec(entriesText)) !== null) {
        const domain = match[1].trim();
        const tagsStr = match[2].trim();
        const description = match[3].trim();

        // Parse tags array from string like "'tag1', 'tag2'" or "tag1, tag2"
        const tags = tagsStr
          .replace(/['"]/g, '')
          .split(/,\s*/)
          .map(t => t.trim())
          .filter(t => t.length > 0);

        summary.interactionStoreEntries.push({ domain, tags, description });
      }
    }

    // Extract "**ReasoningBank Feedback**" section
    const feedbackMatch = section.match(/\*\*ReasoningBank Feedback\*\*:?\s*([\s\S]*?)(?=\n\*\*|\n##|$)/i);
    if (feedbackMatch) {
      const feedbackText = feedbackMatch[1];
      // Parse: "- Trajectory: `trj_xxx` - Quality: `0.95`, Outcome: `positive`"
      const trajectoryMatch = feedbackText.match(/Trajectory:\s*`?([^`\n,]+)`?/i);
      const qualityMatch = feedbackText.match(/Quality:\s*`?([0-9.]+)`?/i);
      const outcomeMatch = feedbackText.match(/Outcome:\s*`?(positive|negative)`?/i);

      if (trajectoryMatch && qualityMatch && outcomeMatch) {
        summary.reasoningBankFeedback = {
          trajectoryId: trajectoryMatch[1].trim(),
          quality: parseFloat(qualityMatch[1]),
          outcome: outcomeMatch[1].toLowerCase() as 'positive' | 'negative'
        };
      }
    }

    // Extract "**Next Agent Guidance**" section
    const guidanceMatch = section.match(/\*\*Next Agent Guidance\*\*:?\s*([^\n]+)/i);
    if (guidanceMatch) {
      summary.nextAgentGuidance = guidanceMatch[1].trim();
    }

    return summary;
  }

  /**
   * Heuristic parser for outputs without TASK COMPLETION SUMMARY
   *
   * Implements: FM-HKS-003 fallback behavior
   */
  private heuristicParse(output: string): ITaskSummary | null {
    this.logger.debug('Using heuristic parser', { outputLength: output.length });

    const summary: ITaskSummary = {
      whatIDid: '',
      filesCreated: [],
      filesModified: [],
      interactionStoreEntries: [],
      reasoningBankFeedback: null,
      nextAgentGuidance: ''
    };

    // Extract "what I did" from common patterns
    const implementedMatch = output.match(/(?:I |I've |I have )(implemented|created|added|built|developed|fixed|updated|modified)([^.]+)/i);
    if (implementedMatch) {
      summary.whatIDid = `${implementedMatch[1]} ${implementedMatch[2].trim()}`;
    }

    // Extract file paths from output (*.ts, *.js, *.md, etc.)
    const filePathRegex = /(?:^|[`'\s])([./][\w./\-]+\.(ts|js|tsx|jsx|md|json|yml|yaml|sh|py))/gm;
    let match;
    while ((match = filePathRegex.exec(output)) !== null) {
      const filePath = match[1].trim();
      // Skip test patterns that aren't real files
      if (!filePath.includes('example') && !filePath.includes('test-') && filePath.length < 200) {
        summary.filesModified.push(filePath);
      }
    }

    // Deduplicate files
    summary.filesModified = [...new Set(summary.filesModified)];

    // Default domain and tags for heuristic output
    if (summary.whatIDid || summary.filesModified.length > 0) {
      summary.interactionStoreEntries.push({
        domain: 'project/general',
        tags: ['task-output', 'heuristic-parsed'],
        description: summary.whatIDid || 'Task output (heuristic parsed)'
      });

      summary.nextAgentGuidance = 'Query domain `project/general` with tag `task-output` to retrieve this task\'s findings.';
    }

    // If we found nothing useful, return null
    if (!summary.whatIDid && summary.filesModified.length === 0) {
      this.logger.warn('Heuristic parser found no useful data', {
        outputSample: output.substring(0, 500)
      });
      return null;
    }

    return summary;
  }

  /**
   * Parse domain and tags from task summary
   *
   * Implements: REQ-HKS-006
   *
   * @param summary - Parsed task summary
   * @returns Domain and tags for storage
   */
  parseDomainTags(summary: ITaskSummary): { domain: string; tags: string[] } {
    // Extract from first InteractionStore entry
    if (summary.interactionStoreEntries.length > 0) {
      const firstEntry = summary.interactionStoreEntries[0];
      return {
        domain: this.sanitizeDomain(firstEntry.domain),
        tags: firstEntry.tags.map(t => this.sanitizeTag(t))
      };
    }

    // Default if no entries
    return {
      domain: 'project/general',
      tags: []
    };
  }

  /**
   * Parse findings into knowledge entry format
   *
   * Implements: REQ-HKS-007
   *
   * @param summary - Parsed task summary
   * @param rawOutput - Raw task output
   * @returns Knowledge entry ready for storage
   */
  parseFindings(summary: ITaskSummary, rawOutput: string): Omit<KnowledgeEntry, 'id' | 'usageCount' | 'lastUsed' | 'createdAt'> {
    const { domain, tags } = this.parseDomainTags(summary);

    // Determine category based on domain
    let category = 'general';
    if (domain.includes('api')) category = 'api-schema';
    else if (domain.includes('frontend')) category = 'frontend';
    else if (domain.includes('database')) category = 'database';
    else if (domain.includes('test')) category = 'testing';

    // Build content object
    const content = JSON.stringify({
      whatIDid: summary.whatIDid,
      filesCreated: summary.filesCreated,
      filesModified: summary.filesModified,
      nextAgentGuidance: summary.nextAgentGuidance,
      rawOutputLength: rawOutput.length
    });

    return {
      domain,
      category,
      content,
      tags,
      quality: 0.8 // Default quality for successful tasks
    };
  }

  /**
   * Validate summary format
   *
   * @param summary - Task summary to validate
   * @returns true if valid, false otherwise
   */
  validateSummaryFormat(summary: ITaskSummary): boolean {
    // Required: whatIDid is non-empty string
    if (!summary.whatIDid || summary.whatIDid.trim() === '') {
      return false;
    }

    // Required: at least 1 InteractionStore entry with domain and tags
    if (summary.interactionStoreEntries.length === 0) {
      return false;
    }

    const firstEntry = summary.interactionStoreEntries[0];
    if (!firstEntry.domain || firstEntry.domain.trim() === '') {
      return false;
    }

    // Required: nextAgentGuidance is non-empty string
    if (!summary.nextAgentGuidance || summary.nextAgentGuidance.trim() === '') {
      return false;
    }

    return true;
  }

  /**
   * Sanitize domain string
   */
  private sanitizeDomain(domain: string): string {
    // Remove dangerous characters, validate format
    const sanitized = domain
      .replace(/[;'"\\]/g, '')
      .replace(/--/g, '')
      .trim();

    // Ensure project/* format
    if (!sanitized.startsWith('project/')) {
      return `project/${sanitized}`;
    }

    return sanitized;
  }

  /**
   * Sanitize tag string
   */
  private sanitizeTag(tag: string): string {
    // Alphanumeric + hyphens only
    return tag
      .replace(/[^a-zA-Z0-9-]/g, '')
      .toLowerCase()
      .substring(0, 50);
  }
}
