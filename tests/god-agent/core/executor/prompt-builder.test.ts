import { describe, it, expect } from 'vitest';
import { buildPrompt, buildSystemPrompt } from '../../../../src/god-agent/core/executor/prompt-builder.js';
import type { ICodeExecutionRequest } from '../../../../src/god-agent/core/executor/executor-types.js';

describe('prompt-builder', () => {
  describe('buildPrompt', () => {
    it('builds minimal prompt with task and language', () => {
      const task = 'Create a function to add two numbers';
      const language = 'typescript';
      const request: ICodeExecutionRequest = { task };

      const prompt = buildPrompt(task, language, request);

      expect(prompt).toContain('## Code Generation Task');
      expect(prompt).toContain(`**Language**: ${language}`);
      expect(prompt).toContain(`**Task**: ${task}`);
      expect(prompt).toContain('## Requirements');
      expect(prompt).toContain('## Output Format');
    });

    it('includes pattern context when provided', () => {
      const task = 'Sort an array';
      const language = 'javascript';
      const patternContext = '## Existing patterns:\n- Use quicksort for large datasets';
      const request: ICodeExecutionRequest = {
        task,
        patternContext
      };

      const prompt = buildPrompt(task, language, request);

      expect(prompt).toContain('## Relevant Patterns');
      expect(prompt).toContain(patternContext);
    });

    it('includes user context when provided', () => {
      const task = 'Create a REST API endpoint';
      const language = 'typescript';
      const userContext = 'Use Express framework and async/await';
      const request: ICodeExecutionRequest = {
        task,
        userContext
      };

      const prompt = buildPrompt(task, language, request);

      expect(prompt).toContain('## Additional Context');
      expect(prompt).toContain(userContext);
    });

    it('includes examples when provided', () => {
      const task = 'Create a validation function';
      const language = 'typescript';
      const examples = [
        'Example 1: validate({ email: "test@example.com" })',
        'Example 2: validate({ email: "invalid" }) // throws error'
      ];
      const request: ICodeExecutionRequest = {
        task,
        examples
      };

      const prompt = buildPrompt(task, language, request);

      expect(prompt).toContain('## Examples');
      expect(prompt).toContain('### Example 1:');
      expect(prompt).toContain(examples[0]);
      expect(prompt).toContain('### Example 2:');
      expect(prompt).toContain(examples[1]);
    });

    it('includes constraints when provided', () => {
      const task = 'Create a database query';
      const language = 'typescript';
      const constraints = [
        'Must use parameterized queries',
        'Must handle SQL injection',
        'Must validate input'
      ];
      const request: ICodeExecutionRequest = {
        task,
        constraints
      };

      const prompt = buildPrompt(task, language, request);

      expect(prompt).toContain('## Constraints');
      for (const constraint of constraints) {
        expect(prompt).toContain(`- ${constraint}`);
      }
    });

    it('includes all optional sections when provided', () => {
      const task = 'Create a complex service';
      const language = 'python';
      const request: ICodeExecutionRequest = {
        task,
        patternContext: 'Pattern: Use dependency injection',
        userContext: 'Context: Follows SOLID principles',
        examples: ['Example: service.execute()'],
        constraints: ['Constraint: Type hints required']
      };

      const prompt = buildPrompt(task, language, request);

      expect(prompt).toContain('## Relevant Patterns');
      expect(prompt).toContain('## Additional Context');
      expect(prompt).toContain('## Examples');
      expect(prompt).toContain('## Constraints');
    });

    it('includes standard requirements in all prompts', () => {
      const task = 'Any task';
      const language = 'typescript';
      const request: ICodeExecutionRequest = { task };

      const prompt = buildPrompt(task, language, request);

      expect(prompt).toContain('Generate clean, production-ready code');
      expect(prompt).toContain(`Follow best practices for ${language}`);
      expect(prompt).toContain('Include necessary imports');
      expect(prompt).toContain('Add documentation for public APIs');
      expect(prompt).toContain('Handle edge cases appropriately');
    });

    it('includes output format instructions', () => {
      const task = 'Any task';
      const language = 'typescript';
      const request: ICodeExecutionRequest = { task };

      const prompt = buildPrompt(task, language, request);

      expect(prompt).toContain('## Output Format');
      expect(prompt).toContain('Return ONLY the code in markdown code blocks');
    });

    it('respects language in requirements section', () => {
      const languages = ['typescript', 'python', 'rust', 'go'];

      for (const language of languages) {
        const request: ICodeExecutionRequest = { task: 'Test task' };
        const prompt = buildPrompt('Test', language, request);

        expect(prompt).toContain(`**Language**: ${language}`);
        expect(prompt).toContain(`Follow best practices for ${language}`);
      }
    });
  });

  describe('buildSystemPrompt', () => {
    it('includes language specialization', () => {
      const language = 'typescript';
      const systemPrompt = buildSystemPrompt(language);

      expect(systemPrompt).toContain(`specializing in ${language}`);
    });

    it('mentions production-ready code', () => {
      const systemPrompt = buildSystemPrompt('python');

      expect(systemPrompt).toContain('production-ready code');
    });

    it('emphasizes key quality factors', () => {
      const systemPrompt = buildSystemPrompt('javascript');

      expect(systemPrompt).toContain('correctness');
      expect(systemPrompt).toContain('readability');
      expect(systemPrompt).toContain('best practices');
      expect(systemPrompt).toContain('error handling');
    });

    it('specifies output format expectations', () => {
      const systemPrompt = buildSystemPrompt('rust');

      expect(systemPrompt).toContain('Return ONLY code in markdown code blocks');
      expect(systemPrompt).toContain('no explanations unless within code comments');
    });

    it('generates consistent prompt structure', () => {
      const languages = ['typescript', 'python', 'javascript', 'go'];

      for (const language of languages) {
        const systemPrompt = buildSystemPrompt(language);

        expect(systemPrompt).toBeTruthy();
        expect(typeof systemPrompt).toBe('string');
        expect(systemPrompt.length).toBeGreaterThan(50);
        expect(systemPrompt).toContain(language);
      }
    });

    it('is concise and focused', () => {
      const systemPrompt = buildSystemPrompt('typescript');

      // System prompt should be concise (< 500 chars)
      expect(systemPrompt.length).toBeLessThan(500);

      // Should be multi-line
      expect(systemPrompt.split('\n').length).toBeGreaterThan(1);
    });
  });
});
