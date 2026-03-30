import type { ICodeExecutionRequest } from './executor-types.js';

/**
 * Build user prompt for code generation
 */
export function buildPrompt(
  task: string,
  language: string,
  request: ICodeExecutionRequest
): string {
  const parts: string[] = [
    `## Code Generation Task`,
    ``,
    `**Language**: ${language}`,
    ``,
    `**Task**: ${task}`
  ];

  // Add pattern context if available
  if (request.patternContext) {
    parts.push('', '## Relevant Patterns', request.patternContext);
  }

  // Add user context if available
  if (request.userContext) {
    parts.push('', '## Additional Context', request.userContext);
  }

  // Add examples if available
  if (request.examples && request.examples.length > 0) {
    parts.push('', '## Examples');
    request.examples.forEach((ex, i) => {
      parts.push(`### Example ${i + 1}:`, ex);
    });
  }

  // Add constraints if available
  if (request.constraints && request.constraints.length > 0) {
    parts.push('', '## Constraints');
    request.constraints.forEach(c => {
      parts.push(`- ${c}`);
    });
  }

  // Add standard requirements
  parts.push(
    '',
    '## Requirements',
    '1. Generate clean, production-ready code',
    `2. Follow best practices for ${language}`,
    '3. Include necessary imports',
    '4. Add documentation for public APIs',
    '5. Handle edge cases appropriately',
    '',
    '## Output Format',
    'Return ONLY the code in markdown code blocks.'
  );

  return parts.join('\n');
}

/**
 * Build system prompt for code generation
 */
export function buildSystemPrompt(language: string): string {
  return `You are a code generation expert specializing in ${language}.
Generate clean, well-documented, production-ready code.
Focus on: correctness, readability, best practices, proper error handling.
Return ONLY code in markdown code blocks - no explanations unless within code comments.`;
}
