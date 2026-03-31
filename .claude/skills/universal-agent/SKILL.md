---
name: universal-agent
description: Universal Self-Learning God Agent for coding, research, writing, and everything else. Self-learns from every interaction.
tags:
  - ai
  - learning
  - coding
  - research
  - writing
---

# Universal Self-Learning God Agent

A unified AI interface that does EVERYTHING and learns continuously.

## Quick Start

```typescript
import { UniversalAgent } from './src/god-agent/universal';

const agent = new UniversalAgent({ verbose: true });
await agent.initialize();

// Ask anything - auto-detects mode
const result = await agent.ask("How do I implement a binary search tree?");

// Explicit modes
const code = await agent.code("Implement REST API with auth");
const research = await agent.research("Latest transformer architectures", { depth: 'deep' });
const doc = await agent.write("Machine Learning", { style: 'academic', format: 'paper' });

// Provide feedback for better learning
await agent.feedback(interactionId, 0.95);
```

## CLI Usage

```bash
# Ask anything
npx tsx src/god-agent/universal/cli.ts ask "Your question here"

# Code generation
npx tsx src/god-agent/universal/cli.ts code "Implement quicksort"

# Research
npx tsx src/god-agent/universal/cli.ts research "Quantum computing basics"

# Writing
npx tsx src/god-agent/universal/cli.ts write "AI Ethics" --style academic

# Status
npx tsx src/god-agent/universal/cli.ts status
```

## Modes

| Mode | Triggers | What It Does |
|------|----------|--------------|
| **code** | "implement", "code", "function", "debug" | Generate code with pattern learning |
| **research** | "research", "find", "investigate", "analyze" | Deep knowledge gathering |
| **write** | "write", "essay", "article", "paper" | Document generation |
| **general** | default | Smart response with context |

## Self-Learning Features

1. **Auto-Learn**: Every interaction is analyzed and useful patterns are stored
2. **Feedback Loop**: Explicit feedback reinforces or weakens patterns
3. **Domain Expertise**: Tracks knowledge accumulation by domain
4. **Pattern Matching**: Uses successful patterns for similar future queries

## API Reference

### UniversalAgent

```typescript
class UniversalAgent {
  // Initialize the agent
  async initialize(): Promise<void>

  // Universal interface - auto-detects mode
  async ask(input: string, options?: { mode?: AgentMode; context?: string }): Promise<string>

  // Mode-specific methods
  async code(task: string, options?: { language?: string; context?: string }): Promise<CodeResult>
  async research(query: string, options?: { depth?: 'quick' | 'standard' | 'deep' }): Promise<ResearchResult>
  async write(topic: string, options?: { style?: string; format?: string }): Promise<WriteResult>

  // Learning
  async feedback(interactionId: string, rating: number): Promise<void>
  async storeKnowledge(entry: KnowledgeEntry): Promise<string>

  // Stats
  getStats(): LearningStats
  getStatus(): AgentStatus

  // Cleanup
  async shutdown(): Promise<void>
}
```

## Integration with Claude Code

When chatting with Claude Code, you can:

1. **Store patterns**: "Store this code pattern in the God Agent"
2. **Query knowledge**: "Search the God Agent for React patterns"
3. **Research topics**: "Use the God Agent to research GraphQL best practices"
4. **Generate code**: "Use the God Agent to generate a REST API"
5. **Write documents**: "Use the God Agent to write a technical report on..."
6. **Check status**: "Show me the God Agent learning stats"

## Example Session

```typescript
// Initialize
const agent = new UniversalAgent();
await agent.initialize();

// Store some knowledge
await agent.storeKnowledge({
  content: "Always use dependency injection for testability",
  type: 'pattern',
  domain: 'architecture',
  tags: ['di', 'testing', 'best-practice'],
});

// Ask questions - agent uses stored knowledge
const answer = await agent.ask("How should I structure my classes for testing?");
// Returns answer incorporating DI pattern

// Code generation - uses learned patterns
const code = await agent.code("Create a UserService class");
// Code includes DI patterns

// Provide feedback
await agent.feedback(answer.interactionId, 0.9); // Reinforce good pattern

// Check learning progress
console.log(agent.getStats());
// { domainExpertise: { architecture: 5 }, topPatterns: [...] }
```

## Files

| File | Purpose |
|------|---------|
| `src/god-agent/universal/universal-agent.ts` | Main implementation |
| `src/god-agent/universal/index.ts` | Public exports |
| `src/god-agent/universal/cli.ts` | Command-line interface |
| `tests/god-agent/universal/universal-agent.test.ts` | Tests |
