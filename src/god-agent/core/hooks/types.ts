/**
 * Hook System Type Definitions
 * TASK-HOOK-001 - Hook Registration Service
 *
 * Defines interfaces for preToolUse and postToolUse hooks
 * as specified in TASKS-PHASE3.md and TECH-HOOK-001.md
 *
 * CONSTITUTION COMPLIANCE: RULE-032 (All hooks MUST be registered at daemon startup)
 */

// ============================================================================
// Hook Types
// ============================================================================

/**
 * Hook event types supported by the system
 * Maps to Claude Code hook events
 */
export type HookType = 'preToolUse' | 'postToolUse';

/**
 * Hook execution priority
 * Lower numbers execute first
 */
export type HookPriority = number;

// ============================================================================
// Hook Context Types
// ============================================================================

/**
 * Context provided to hook handlers
 * Contains information about the tool invocation
 */
export interface IHookContext {
  /** Name of the tool being invoked (e.g., 'Task', 'Bash', 'Read') */
  toolName: string;
  /** Input parameters passed to the tool */
  toolInput: unknown;
  /** Current session identifier */
  sessionId: string;
  /** Current trajectory ID if tracking is active */
  trajectoryId?: string;
  /** Timestamp when the hook was triggered */
  timestamp: number;
  /** Additional metadata for the invocation */
  metadata?: Record<string, unknown>;
}

/**
 * Extended context for postToolUse hooks
 * Includes the output from the tool execution
 */
export interface IPostToolUseContext extends IHookContext {
  /** Output returned from the tool execution */
  toolOutput: unknown;
  /** Duration of the tool execution in milliseconds */
  executionDurationMs?: number;
  /** Whether the tool execution was successful */
  executionSuccess?: boolean;
}

// ============================================================================
// Hook Result Types
// ============================================================================

/**
 * Result returned from a hook handler
 * Controls hook chain execution and input modification
 */
export interface IHookResult {
  /**
   * Whether to continue with subsequent hooks and tool execution
   * If false, the hook chain stops and tool may not execute (for preToolUse)
   */
  continue: boolean;
  /**
   * Modified input to pass to subsequent hooks/tool
   * Only applicable for preToolUse hooks
   */
  modifiedInput?: unknown;
  /**
   * Additional metadata to attach to the hook execution
   */
  metadata?: Record<string, unknown>;
  /**
   * Optional reason for stopping execution (when continue=false)
   */
  stopReason?: string;
}

// ============================================================================
// Hook Handler Types
// ============================================================================

/**
 * Handler function signature for hooks
 * Receives context and returns a result asynchronously
 */
export type HookHandler<T extends IHookContext = IHookContext> = (
  context: T
) => Promise<IHookResult>;

/**
 * Pre-tool-use hook handler
 */
export type PreToolUseHandler = HookHandler<IHookContext>;

/**
 * Post-tool-use hook handler
 */
export type PostToolUseHandler = HookHandler<IPostToolUseContext>;

// ============================================================================
// Hook Definition Types
// ============================================================================

/**
 * Complete hook definition
 * Contains all information needed to register and execute a hook
 *
 * CONSTITUTION: RULE-032 requires all hooks to be registered at daemon startup
 */
export interface IHook<T extends IHookContext = IHookContext> {
  /** Unique identifier for this hook */
  id: string;
  /** Type of hook (preToolUse or postToolUse) */
  type: HookType;
  /**
   * Optional: specific tool name to match
   * If undefined, matches all tools
   */
  toolName?: string;
  /** Handler function to execute */
  handler: HookHandler<T>;
  /**
   * Execution priority (lower = earlier)
   * Default: 50
   */
  priority: number;
  /** Whether this hook is currently enabled */
  enabled: boolean;
  /** Human-readable description of what this hook does */
  description?: string;
}

/**
 * Pre-tool-use hook definition
 */
export interface IPreToolUseHook extends IHook<IHookContext> {
  type: 'preToolUse';
}

/**
 * Post-tool-use hook definition
 */
export interface IPostToolUseHook extends IHook<IPostToolUseContext> {
  type: 'postToolUse';
}

// ============================================================================
// Hook Registration Types
// ============================================================================

/**
 * Options for registering a hook
 */
export interface IHookRegistrationOptions {
  /** Override priority (default: 50) */
  priority?: number;
  /** Start enabled/disabled (default: true) */
  enabled?: boolean;
  /** Human-readable description */
  description?: string;
}

/**
 * Hook registration input (without generated fields)
 */
export type IHookInput<T extends IHookContext = IHookContext> = Omit<
  IHook<T>,
  'priority' | 'enabled' | 'description'
> & IHookRegistrationOptions;

/**
 * Required hooks that MUST be registered before initialization
 * Per CONSTITUTION RULE-032
 */
export const REQUIRED_HOOKS: readonly string[] = [
  'task-result-capture',
  'quality-assessment-trigger'
] as const;

/**
 * Default hook priorities by category
 */
export const DEFAULT_PRIORITIES = {
  /** Validation and safety hooks */
  VALIDATION: 10,
  /** Context injection hooks */
  INJECTION: 20,
  /** Logging and metrics hooks */
  LOGGING: 30,
  /** Result capture hooks */
  CAPTURE: 40,
  /** Default priority */
  DEFAULT: 50,
  /** Post-processing hooks */
  POST_PROCESS: 60,
  /** Cleanup hooks */
  CLEANUP: 90
} as const;

// ============================================================================
// Hook Execution Types
// ============================================================================

/**
 * Result of a single hook execution
 */
export interface IHookExecutionResult {
  /** ID of the hook that was executed */
  hookId: string;
  /** Whether execution was successful */
  success: boolean;
  /** Duration of execution in milliseconds */
  durationMs: number;
  /** Result returned by the hook (if successful) */
  result?: IHookResult;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Summary of hook chain execution
 */
export interface IHookChainResult {
  /** Individual results from each hook */
  results: IHookExecutionResult[];
  /** Whether all hooks succeeded */
  allSucceeded: boolean;
  /** Whether execution was stopped by a hook */
  chainStopped: boolean;
  /** ID of hook that stopped the chain (if applicable) */
  stoppedByHook?: string;
  /** Total duration of all hook executions */
  totalDurationMs: number;
  /** Final modified input (for preToolUse chains) */
  finalInput?: unknown;
}

// ============================================================================
// Hook Registry Types
// ============================================================================

/**
 * Any hook type (for registry storage)
 * Uses 'any' for handler to allow storage of both preToolUse and postToolUse hooks
 */
export type AnyHook = {
  id: string;
  type: HookType;
  toolName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: HookHandler<any>;
  priority: number;
  enabled: boolean;
  description?: string;
};

/**
 * Hook registry interface
 * Manages registration and retrieval of hooks
 */
export interface IHookRegistry {
  /**
   * Register a hook
   * @throws Error if called after initialization (RULE-032)
   */
  register(hook: AnyHook): void;

  /**
   * Initialize the registry and validate required hooks
   * @throws Error if required hooks are missing (RULE-032)
   */
  initialize(): void;

  /** Check if registry has been initialized */
  isInitialized(): boolean;

  /** Get all pre-tool-use hooks for a specific tool (or all tools) */
  getPreToolUseHooks(toolName?: string): AnyHook[];

  /** Get all post-tool-use hooks for a specific tool (or all tools) */
  getPostToolUseHooks(toolName?: string): AnyHook[];

  /** Get a specific hook by ID */
  getHook(id: string): AnyHook | undefined;

  /** Enable or disable a hook */
  setHookEnabled(id: string, enabled: boolean): boolean;

  /** Get count of registered hooks */
  getHookCount(): { preToolUse: number; postToolUse: number; total: number };
}

// ============================================================================
// Hook Executor Types
// ============================================================================

/**
 * Hook executor interface
 * Executes hooks in priority order
 */
export interface IHookExecutor {
  /**
   * Execute pre-tool-use hooks
   * @returns Chain execution result
   */
  executePreToolUseHooks(context: IHookContext): Promise<IHookChainResult>;

  /**
   * Execute post-tool-use hooks
   * @returns Chain execution result
   */
  executePostToolUseHooks(context: IPostToolUseContext): Promise<IHookChainResult>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for hook system
 */
export enum HookErrorCode {
  /** Hook registration attempted after initialization */
  REGISTRATION_AFTER_INIT = 'HOOK_REG_AFTER_INIT',
  /** Duplicate hook ID */
  DUPLICATE_HOOK_ID = 'HOOK_DUPLICATE_ID',
  /** Required hook not registered */
  REQUIRED_HOOK_MISSING = 'HOOK_REQUIRED_MISSING',
  /** Hook not found */
  HOOK_NOT_FOUND = 'HOOK_NOT_FOUND',
  /** Hook execution failed */
  HOOK_EXECUTION_FAILED = 'HOOK_EXEC_FAILED',
  /** Hook timeout */
  HOOK_TIMEOUT = 'HOOK_TIMEOUT',
  /** Registry not initialized */
  REGISTRY_NOT_INITIALIZED = 'HOOK_REG_NOT_INIT'
}

/**
 * Hook-specific error class
 */
export class HookError extends Error {
  constructor(
    public readonly code: HookErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HookError';
    Object.setPrototypeOf(this, HookError.prototype);
  }
}
