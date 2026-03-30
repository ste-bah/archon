/**
 * Agent Loading System
 * Universal Subagent Integration - Agent Module Index
 *
 * DAI-001: Dynamic Agent Integration
 *
 * Exports all agent-related types and classes for:
 * - Loading agent definitions from .claude/agents/ markdown files
 * - Selecting appropriate agents for tasks
 * - Executing tasks with selected agents
 * - Handling agent-related errors
 */

// ==================== Types ====================

// Agent definition types
export type {
  IAgentHooks,
  IAgentFrontmatter,
  ILoadedAgentDefinition,
  ICategoryInfo,
  IAgentLoaderOptions,
  IRegistryValidationResult,
  IRegistryStats,
} from './agent-types.js';

// Agent selector types
export type {
  ITaskAnalysis,
  IScoredAgent,
  IAgentSelectionResult,
} from './agent-selector.js';

// Task executor types
export type {
  ITaskExecutionOptions,
  ITaskExecutionResult,
  TaskExecutionFunction,
  IStructuredTask,
} from './task-executor.js';

// ==================== Type Guards & Utilities ====================

export {
  hasHooks,
  hasPreHook,
  hasPostHook,
  DEFAULT_LOADER_OPTIONS,
  createDefaultFrontmatter,
} from './agent-types.js';

// ==================== Error Classes ====================

export {
  AgentError,
  AgentDirectoryNotFoundError,
  AgentLoadError,
  AgentSelectionError,
  AgentExecutionError,
  DuplicateAgentKeyError,
  AgentRegistryNotInitializedError,
  AgentNotFoundError,
  AgentCategoryError,
} from './agent-errors.js';

// ==================== Core Classes ====================

// Agent loading
export { AgentCategoryScanner } from './agent-category-scanner.js';
export { AgentDefinitionLoader, parseFrontmatter, parseYaml } from './agent-definition-loader.js';
export { AgentRegistry, createAgentRegistry } from './agent-registry.js';

// DAI-001: Dynamic agent selection and execution
export { AgentSelector } from './agent-selector.js';
export { TaskExecutor } from './task-executor.js';
