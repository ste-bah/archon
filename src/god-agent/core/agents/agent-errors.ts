/**
 * Agent Error Classes
 * TASK-001: DAI-001 Foundation Layer
 *
 * Custom error classes for agent operations with full context.
 * Per constitution.md RULE-003: All errors MUST include full context.
 *
 * NO fallbacks, NO generic messages, NO silent failures.
 */

/**
 * Base error class for all agent operations.
 * All agent errors MUST extend this class.
 */
export class AgentError extends Error {
  public readonly originalCause?: Error;

  constructor(message: string, options?: { cause?: Error }) {
    super(message);
    this.name = 'AgentError';
    this.originalCause = options?.cause;

    // Preserve stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Get the full error chain for debugging
   */
  getErrorChain(): string[] {
    const chain: string[] = [`${this.name}: ${this.message}`];
    let current: Error | undefined = this.originalCause;
    while (current) {
      chain.push(`  Caused by: ${current.name}: ${current.message}`);
      current = (current as AgentError).originalCause;
    }
    return chain;
  }
}

/**
 * Error thrown when the agent directory (.claude/agents/) does not exist.
 * This is a fatal error - cannot proceed without agent definitions.
 */
export class AgentDirectoryNotFoundError extends AgentError {
  public readonly path: string;

  constructor(path: string) {
    super(
      `[AgentDirectoryNotFoundError] Agent directory not found.\n` +
        `Path: ${path}\n` +
        `Expected: .claude/agents/ directory with agent .md files.\n` +
        `Action: Create the directory or verify the basePath configuration.`
    );
    this.name = 'AgentDirectoryNotFoundError';
    this.path = path;
  }
}

/**
 * Error thrown when an agent .md file fails to load or parse.
 * Includes file path, key, and original parsing error.
 */
export class AgentLoadError extends AgentError {
  public readonly agentKey: string;
  public readonly filePath: string;

  constructor(key: string, path: string, cause: Error) {
    super(
      `[AgentLoadError] Failed to load agent definition.\n` +
        `Agent key: ${key}\n` +
        `File path: ${path}\n` +
        `Parse error: ${cause.message}\n` +
        `Action: Check YAML frontmatter syntax in the agent file.`,
      { cause }
    );
    this.name = 'AgentLoadError';
    this.agentKey = key;
    this.filePath = path;
  }
}

/**
 * Error thrown when no suitable agent can be found for a task.
 * Includes task details, analysis results, and available agents.
 */
export class AgentSelectionError extends AgentError {
  public readonly task: string;
  public readonly availableAgents: string[];
  public readonly taskType?: string;
  public readonly requiredCapabilities?: string[];

  constructor(
    task: string,
    availableAgents: string[],
    analysis?: {
      taskType?: string;
      requiredCapabilities?: string[];
    }
  ) {
    const taskPreview = task.length > 100 ? `${task.substring(0, 100)}...` : task;
    const agentPreview =
      availableAgents.length > 10
        ? `${availableAgents.slice(0, 10).join(', ')}... (${availableAgents.length} total)`
        : availableAgents.join(', ') || 'none loaded';

    const analysisInfo = analysis
      ? `\nTask type detected: ${analysis.taskType ?? 'unknown'}\n` +
        `Required capabilities: ${analysis.requiredCapabilities?.join(', ') ?? 'none specified'}`
      : '';

    super(
      `[AgentSelectionError] No suitable agent found for task.\n` +
        `Task: "${taskPreview}"${analysisInfo}\n` +
        `Available agents: ${agentPreview}\n` +
        `Action: Refine task description or add a new agent to .claude/agents/.`
    );
    this.name = 'AgentSelectionError';
    this.task = task;
    this.availableAgents = availableAgents;
    this.taskType = analysis?.taskType;
    this.requiredCapabilities = analysis?.requiredCapabilities;
  }
}

/**
 * Error thrown when Task() execution fails.
 * Includes agent details, task, and original execution error.
 */
export class AgentExecutionError extends AgentError {
  public readonly agentKey: string;
  public readonly agentCategory: string;
  public readonly task: string;
  public readonly duration?: number;

  constructor(
    agentKey: string,
    agentCategory: string,
    task: string,
    cause: Error,
    duration?: number
  ) {
    const taskPreview = task.length > 100 ? `${task.substring(0, 100)}...` : task;
    const durationInfo = duration !== undefined ? `\nDuration before failure: ${duration}ms` : '';

    super(
      `[AgentExecutionError] Agent failed to execute task.\n` +
        `Agent: ${agentKey} (category: ${agentCategory})\n` +
        `Task: "${taskPreview}"${durationInfo}\n` +
        `Error: ${cause.message}\n` +
        `Action: Check agent prompt content and task compatibility.`,
      { cause }
    );
    this.name = 'AgentExecutionError';
    this.agentKey = agentKey;
    this.agentCategory = agentCategory;
    this.task = task;
    this.duration = duration;
  }
}

/**
 * Error thrown when duplicate agent keys are detected across categories.
 * This is a warning-level error - first agent is kept, duplicate is skipped.
 */
export class DuplicateAgentKeyError extends AgentError {
  public readonly agentKey: string;
  public readonly firstPath: string;
  public readonly duplicatePath: string;

  constructor(key: string, firstPath: string, duplicatePath: string) {
    super(
      `[DuplicateAgentKeyError] Duplicate agent key detected.\n` +
        `Agent key: ${key}\n` +
        `First occurrence: ${firstPath} (kept)\n` +
        `Duplicate: ${duplicatePath} (skipped)\n` +
        `Action: Rename one of the agent files to have a unique key.`
    );
    this.name = 'DuplicateAgentKeyError';
    this.agentKey = key;
    this.firstPath = firstPath;
    this.duplicatePath = duplicatePath;
  }
}

/**
 * Error thrown when AgentRegistry is not initialized before use.
 */
export class AgentRegistryNotInitializedError extends AgentError {
  constructor(operation: string) {
    super(
      `[AgentRegistryNotInitializedError] Registry not initialized.\n` +
        `Attempted operation: ${operation}\n` +
        `Action: Call AgentRegistry.initialize() before using the registry.`
    );
    this.name = 'AgentRegistryNotInitializedError';
  }
}

/**
 * Error thrown when a required agent is not found in the registry.
 */
export class AgentNotFoundError extends AgentError {
  public readonly agentKey: string;
  public readonly availableKeys: string[];

  constructor(key: string, availableKeys: string[]) {
    const keysPreview =
      availableKeys.length > 20
        ? `${availableKeys.slice(0, 20).join(', ')}... (${availableKeys.length} total)`
        : availableKeys.join(', ') || 'none';

    super(
      `[AgentNotFoundError] Agent not found in registry.\n` +
        `Requested key: ${key}\n` +
        `Available agents: ${keysPreview}\n` +
        `Action: Verify the agent key or add the agent to .claude/agents/.`
    );
    this.name = 'AgentNotFoundError';
    this.agentKey = key;
    this.availableKeys = availableKeys;
  }
}

/**
 * Error thrown when a category is not found or is empty.
 */
export class AgentCategoryError extends AgentError {
  public readonly category: string;
  public readonly availableCategories: string[];

  constructor(category: string, availableCategories: string[], isEmpty = false) {
    const categoriesPreview = availableCategories.join(', ') || 'none';

    super(
      `[AgentCategoryError] ${isEmpty ? 'Category is empty' : 'Category not found'}.\n` +
        `Requested category: ${category}\n` +
        `Available categories: ${categoriesPreview}\n` +
        `Action: ${isEmpty ? 'Add agent files to the category directory.' : 'Use an existing category or create a new one.'}`
    );
    this.name = 'AgentCategoryError';
    this.category = category;
    this.availableCategories = availableCategories;
  }
}
