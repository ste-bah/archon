/**
 * Hook Registry
 * TASK-HOOK-001 - Hook Registration Service
 *
 * Central registry for preToolUse and postToolUse hooks.
 * Implements singleton pattern for global access.
 *
 * CONSTITUTION COMPLIANCE:
 * - RULE-032: All hooks MUST be registered at daemon startup
 *
 * Per TASKS-PHASE3.md specification:
 * - HookRegistry class with registration methods
 * - IHook interface definition (see types.ts)
 * - preToolUse and postToolUse hook types
 * - Startup validation for required hooks
 * - Priority-based sorting
 */

import {
  IHook,
  IHookContext,
  IPostToolUseContext,
  IHookRegistry,
  AnyHook,
  REQUIRED_HOOKS,
  DEFAULT_PRIORITIES,
  HookError,
  HookErrorCode
} from './types.js';
import { createComponentLogger, type StructuredLogger } from '../observability/logger.js';

// ============================================================================
// Hook Registry Implementation
// ============================================================================

/**
 * HookRegistry
 *
 * Central registry for all hooks in the system.
 * Enforces RULE-032: hooks must be registered before initialization.
 *
 * Usage:
 * 1. Get singleton instance via getHookRegistry()
 * 2. Register hooks BEFORE calling initialize()
 * 3. Call initialize() during daemon startup
 * 4. Retrieve hooks via getPreToolUseHooks() / getPostToolUseHooks()
 */
export class HookRegistry implements IHookRegistry {
  /** Map of preToolUse hooks by ID */
  private readonly preToolUseHooks: Map<string, AnyHook> = new Map();

  /** Map of postToolUse hooks by ID */
  private readonly postToolUseHooks: Map<string, AnyHook> = new Map();

  /**
   * List of required hook IDs that MUST be registered before initialization
   * Per CONSTITUTION RULE-032
   */
  private readonly requiredHooks: readonly string[] = REQUIRED_HOOKS;

  /** Whether the registry has been initialized */
  private initialized: boolean = false;

  /** Logger instance */
  private readonly logger: StructuredLogger;

  constructor() {
    this.logger = createComponentLogger('HookRegistry');
  }

  // ==========================================================================
  // Registration Methods
  // ==========================================================================

  /**
   * Register a hook with the registry
   *
   * @param hook - Hook definition to register
   * @throws HookError if called after initialization (RULE-032)
   * @throws HookError if hook ID is already registered
   */
  register(hook: AnyHook): void {
    // RULE-032: Cannot register hooks after initialization
    if (this.initialized) {
      throw new HookError(
        HookErrorCode.REGISTRATION_AFTER_INIT,
        `Cannot register hook '${hook.id}' after initialization. ` +
        `Hooks must be registered at daemon startup per CONSTITUTION RULE-032.`,
        { hookId: hook.id, hookType: hook.type }
      );
    }

    // Determine target map based on hook type
    const targetMap = hook.type === 'preToolUse'
      ? this.preToolUseHooks
      : this.postToolUseHooks;

    // Check for duplicate registration
    if (targetMap.has(hook.id) || this.getOtherMap(hook.type).has(hook.id)) {
      throw new HookError(
        HookErrorCode.DUPLICATE_HOOK_ID,
        `Hook with ID '${hook.id}' is already registered.`,
        { hookId: hook.id, hookType: hook.type }
      );
    }

    // Apply defaults if not provided
    const normalizedHook: AnyHook = {
      ...hook,
      priority: hook.priority ?? DEFAULT_PRIORITIES.DEFAULT,
      enabled: hook.enabled ?? true
    };

    // Register the hook
    targetMap.set(normalizedHook.id, normalizedHook);

    this.logger.debug('Hook registered', {
      hookId: normalizedHook.id,
      hookType: normalizedHook.type,
      toolName: normalizedHook.toolName ?? 'all',
      priority: normalizedHook.priority,
      enabled: normalizedHook.enabled
    });
  }

  /**
   * Unregister a hook (only allowed before initialization)
   *
   * @param hookId - ID of the hook to remove
   * @throws HookError if called after initialization
   */
  unregister(hookId: string): boolean {
    if (this.initialized) {
      throw new HookError(
        HookErrorCode.REGISTRATION_AFTER_INIT,
        `Cannot unregister hook '${hookId}' after initialization.`,
        { hookId }
      );
    }

    const deletedPre = this.preToolUseHooks.delete(hookId);
    const deletedPost = this.postToolUseHooks.delete(hookId);

    if (deletedPre || deletedPost) {
      this.logger.debug('Hook unregistered', { hookId });
      return true;
    }

    return false;
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the registry
   *
   * Validates that all required hooks are registered.
   * Must be called during daemon startup after all hooks are registered.
   *
   * CONSTITUTION RULE-032: All required hooks must be registered at startup.
   *
   * @throws HookError if required hooks are missing
   */
  initialize(): void {
    if (this.initialized) {
      this.logger.warn('HookRegistry already initialized');
      return;
    }

    // Validate required hooks are registered
    const missingHooks: string[] = [];

    for (const requiredId of this.requiredHooks) {
      const found =
        this.preToolUseHooks.has(requiredId) ||
        this.postToolUseHooks.has(requiredId);

      if (!found) {
        missingHooks.push(requiredId);
      }
    }

    if (missingHooks.length > 0) {
      throw new HookError(
        HookErrorCode.REQUIRED_HOOK_MISSING,
        `Required hooks not registered: [${missingHooks.join(', ')}]. ` +
        `All required hooks must be registered at daemon startup per CONSTITUTION RULE-032.`,
        { missingHooks, requiredHooks: [...this.requiredHooks] }
      );
    }

    // Mark as initialized
    this.initialized = true;

    this.logger.info('HookRegistry initialized', {
      preToolUseCount: this.preToolUseHooks.size,
      postToolUseCount: this.postToolUseHooks.size,
      totalHooks: this.preToolUseHooks.size + this.postToolUseHooks.size,
      requiredHooksValidated: this.requiredHooks.length
    });
  }

  /**
   * Check if the registry has been initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ==========================================================================
  // Retrieval Methods
  // ==========================================================================

  /**
   * Get all pre-tool-use hooks for a specific tool
   *
   * @param toolName - Optional tool name to filter by
   * @returns Array of hooks sorted by priority (ascending)
   */
  getPreToolUseHooks(toolName?: string): AnyHook[] {
    return this.getHooksForTool(this.preToolUseHooks, toolName);
  }

  /**
   * Get all post-tool-use hooks for a specific tool
   *
   * @param toolName - Optional tool name to filter by
   * @returns Array of hooks sorted by priority (ascending)
   */
  getPostToolUseHooks(toolName?: string): AnyHook[] {
    return this.getHooksForTool(this.postToolUseHooks, toolName);
  }

  /**
   * Get a specific hook by ID
   *
   * @param id - Hook ID to find
   * @returns Hook if found, undefined otherwise
   */
  getHook(id: string): AnyHook | undefined {
    return this.preToolUseHooks.get(id) ?? this.postToolUseHooks.get(id);
  }

  /**
   * Get count of registered hooks
   */
  getHookCount(): { preToolUse: number; postToolUse: number; total: number } {
    return {
      preToolUse: this.preToolUseHooks.size,
      postToolUse: this.postToolUseHooks.size,
      total: this.preToolUseHooks.size + this.postToolUseHooks.size
    };
  }

  /**
   * Get all registered hook IDs
   */
  getAllHookIds(): string[] {
    return [
      ...this.preToolUseHooks.keys(),
      ...this.postToolUseHooks.keys()
    ];
  }

  /**
   * Get required hooks configuration
   */
  getRequiredHooks(): readonly string[] {
    return this.requiredHooks;
  }

  // ==========================================================================
  // Hook State Management
  // ==========================================================================

  /**
   * Enable or disable a hook
   *
   * @param id - Hook ID
   * @param enabled - Whether to enable or disable
   * @returns true if hook was found and updated, false otherwise
   */
  setHookEnabled(id: string, enabled: boolean): boolean {
    const hook = this.getHook(id);
    if (!hook) {
      return false;
    }

    // Update in the appropriate map
    if (hook.type === 'preToolUse') {
      const existing = this.preToolUseHooks.get(id)!;
      this.preToolUseHooks.set(id, { ...existing, enabled });
    } else {
      const existing = this.postToolUseHooks.get(id)!;
      this.postToolUseHooks.set(id, { ...existing, enabled });
    }

    this.logger.debug('Hook enabled state changed', {
      hookId: id,
      enabled
    });

    return true;
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Get hooks for a specific tool, filtered and sorted by priority
   */
  private getHooksForTool(
    hooks: Map<string, AnyHook>,
    toolName?: string
  ): AnyHook[] {
    return Array.from(hooks.values())
      .filter(hook => {
        // Must be enabled
        if (!hook.enabled) return false;
        // If hook specifies a tool, it must match
        if (hook.toolName && toolName && hook.toolName !== toolName) return false;
        return true;
      })
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get the other hook map (opposite of the given type)
   */
  private getOtherMap(type: 'preToolUse' | 'postToolUse'): Map<string, AnyHook> {
    return type === 'preToolUse'
      ? this.postToolUseHooks
      : this.preToolUseHooks;
  }

  // ==========================================================================
  // Reset (for testing)
  // ==========================================================================

  /**
   * Reset the registry to initial state
   * WARNING: Only for testing purposes
   */
  _resetForTesting(): void {
    this.preToolUseHooks.clear();
    this.postToolUseHooks.clear();
    this.initialized = false;
    this.logger.warn('HookRegistry reset for testing');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/** Singleton instance of HookRegistry */
let instance: HookRegistry | null = null;

/**
 * Get the singleton HookRegistry instance
 *
 * @returns HookRegistry singleton
 */
export function getHookRegistry(): HookRegistry {
  if (!instance) {
    instance = new HookRegistry();
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing only)
 */
export function _resetHookRegistryForTesting(): void {
  if (instance) {
    instance._resetForTesting();
  }
  instance = null;
}

// ============================================================================
// Registration Helper Functions
// ============================================================================

/**
 * Helper to create and register a preToolUse hook
 */
export function registerPreToolUseHook(config: {
  id: string;
  handler: IHook<IHookContext>['handler'];
  toolName?: string;
  priority?: number;
  enabled?: boolean;
  description?: string;
}): void {
  getHookRegistry().register({
    id: config.id,
    type: 'preToolUse',
    handler: config.handler,
    toolName: config.toolName,
    priority: config.priority ?? DEFAULT_PRIORITIES.DEFAULT,
    enabled: config.enabled ?? true,
    description: config.description
  });
}

/**
 * Helper to create and register a postToolUse hook
 */
export function registerPostToolUseHook(config: {
  id: string;
  handler: IHook<IPostToolUseContext>['handler'];
  toolName?: string;
  priority?: number;
  enabled?: boolean;
  description?: string;
}): void {
  getHookRegistry().register({
    id: config.id,
    type: 'postToolUse',
    handler: config.handler as IHook['handler'],
    toolName: config.toolName,
    priority: config.priority ?? DEFAULT_PRIORITIES.DEFAULT,
    enabled: config.enabled ?? true,
    description: config.description
  });
}
