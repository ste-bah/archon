/**
 * Shutdown Module
 * TASK-ERR-005 - Graceful shutdown handlers
 *
 * Constitution: RULE-073 (All components MUST register graceful shutdown handlers)
 *
 * Exports:
 * - GracefulShutdown class
 * - Signal handler registration
 * - Component shutdown factories
 * - Priority constants
 */

// ============================================================================
// Main Exports
// ============================================================================

export {
  // Main class
  GracefulShutdown,

  // Priority enum
  ShutdownPriority,

  // Types
  type ShutdownHandlerFn,
  type IShutdownHandler,
  type IShutdownHandlerResult,
  type ShutdownReason,
  type IShutdownEvent,
  type IGracefulShutdownConfig,
  type IShutdownable,

  // Errors
  ShutdownTimeoutError,
  ShutdownInProgressError,

  // Constants
  DEFAULT_HANDLER_TIMEOUT_MS,
  MAX_SHUTDOWN_TIME_MS,
  SHUTDOWN_DEBOUNCE_MS,

  // Singleton functions
  getGracefulShutdown,
  registerShutdownHandler,
  initiateShutdown,
  resetGracefulShutdown,

  // Component registration helpers
  registerComponentShutdown,
  registerDatabaseShutdown,
  registerSonaEngineShutdown,
  registerGraphDBShutdown,
  registerEmbeddingStoreShutdown,
  registerServerShutdown,
} from './graceful-shutdown.js';
