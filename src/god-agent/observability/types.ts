/**
 * Observability System Types
 * 
 * Shared type definitions for the God Agent Observability System.
 * 
 * @module observability/types
 * @see SPEC-OBS-001-CORE.md#data_models
 * @see constitution.md#event_schema
 */

// =============================================================================
// Event Types
// =============================================================================

/**
 * Activity event component types
 * Implements [REQ-OBS-03]: Events MUST have component field
 */
export type ActivityEventComponent =
  | 'routing'
  | 'pipeline'
  | 'memory'
  | 'learning'
  | 'agent'
  | 'search'
  | 'quality_monitor'
  | 'general'
  | 'ucm'
  | 'idesc'
  | 'episode'
  | 'hyperedge'
  | 'embedding'
  | 'daemon'
  | 'token_budget'
  | 'vectordb'
  | 'sona'
  | 'reasoning';

/**
 * Activity event status types
 * Implements [REQ-OBS-03]: Events MUST have status field
 */
export type ActivityEventStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'warning';

/**
 * Core activity event interface
 * Implements [REQ-OBS-03]: Events MUST have unique IDs, timestamps, component, operation, and status
 * @see constitution.md#event_schema
 */
export interface IActivityEvent {
  /** Unique event ID (format: evt_{timestamp}_{random}) */
  id: string;
  /** Unix epoch milliseconds */
  timestamp: number;
  /** Component that generated the event */
  component: ActivityEventComponent;
  /** Operation name (e.g., agent_selected, step_completed) */
  operation: string;
  /** Action name (alias for operation, for backwards compatibility) */
  action?: string;
  /** Current status of the operation */
  status: ActivityEventStatus;
  /** Duration in milliseconds (optional, for completed operations) */
  durationMs?: number;
  /** Operation-specific metadata */
  metadata: Record<string, unknown>;
  /** Trace correlation ID (optional) */
  traceId?: string;
  /** Span ID within trace (optional) */
  spanId?: string;
}

/**
 * Event without auto-generated fields (for emission)
 */
export type IActivityEventInput = Omit<IActivityEvent, 'id' | 'timestamp'>;

// =============================================================================
// Agent Execution Types
// =============================================================================

/**
 * Agent execution status
 */
export type AgentStatus = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

/**
 * Memory entry reference
 */
export interface IMemoryRef {
  domain: string;
  category: string;
  tags: string[];
}

/**
 * Memory entry details
 */
export interface IMemoryEntry extends IMemoryRef {
  id: string;
  contentPreview: string;
  timestamp: number;
}

/**
 * Agent execution tracking
 * Implements [REQ-OBS-04]: AgentExecutionTracker MUST track agent lifecycle
 * Implements [REQ-OBS-05]: AgentExecutionTracker MUST capture output summary, quality score, and memory stored
 */
export interface IAgentExecution {
  /** Unique execution ID (format: agent_{timestamp}_{random}) */
  id: string;
  /** Agent key/identifier */
  agentKey: string;
  /** Human-readable agent name */
  agentName: string;
  /** Agent category */
  category: string;
  /** Associated pipeline ID (optional) */
  pipelineId?: string;
  /** Current execution status */
  status: AgentStatus;
  /** Start time (Unix epoch ms) */
  startTime: number;
  /** End time (Unix epoch ms, optional) */
  endTime?: number;
  /** Duration in milliseconds (calculated) */
  durationMs?: number;
  /** Task description/input */
  input: string;
  /** Result summary (optional) */
  output?: string;
  /** Quality score 0-1 (optional) */
  qualityScore?: number;
  /** Memory entries stored by this agent */
  memoryStored?: IMemoryEntry[];
  /** Full agent prompt text (optional, untruncated) */
  promptText?: string;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Pipeline Types
// =============================================================================

/**
 * Pipeline execution status
 */
export type PipelineStatus = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Pipeline step status
 */
export type StepStatus = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

/**
 * Pipeline step tracking
 * Implements [REQ-OBS-11]: Pipeline steps MUST show memory retrieval and storage
 */
export interface IPipelineStep {
  /** Agent key for this step */
  agentKey: string;
  /** Step execution status */
  status: StepStatus;
  /** Start time (Unix epoch ms) */
  startTime?: number;
  /** End time (Unix epoch ms) */
  endTime?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Quality score 0-1 */
  qualityScore?: number;
  /** Memory domains retrieved */
  memoryRetrieved?: IMemoryRef[];
  /** Memory entries stored */
  memoryStored?: IMemoryRef[];
  /** Error message if failed */
  error?: string;
}

/**
 * Pipeline execution tracking
 * Implements [REQ-OBS-10]: PipelineTracker MUST track pipeline status and per-step execution
 */
export interface IPipelineStatus {
  /** Unique pipeline ID */
  id: string;
  /** Pipeline name */
  name: string;
  /** Current pipeline status */
  status: PipelineStatus;
  /** Pipeline steps */
  steps: IPipelineStep[];
  /** Overall quality score 0-1 */
  overallQuality?: number;
  /** Total duration in milliseconds */
  totalDuration?: number;
  /** Start time (Unix epoch ms) */
  startTime: number;
  /** End time (Unix epoch ms) */
  endTime?: number;
}

// =============================================================================
// Routing Types
// =============================================================================

/**
 * Cold start phase
 */
export type ColdStartPhase = 
  | 'exploration'
  | 'learning'
  | 'exploitation'
  | 'mature';

/**
 * Routing decision factor
 */
export interface IRoutingFactor {
  name: string;
  score: number;
  weight: number;
  description?: string;
}

/**
 * Routing alternative candidate
 */
export interface IRoutingAlternative {
  agentKey: string;
  agentName: string;
  score: number;
  rejected_reason?: string;
}

/**
 * Routing explanation
 * Implements [REQ-OBS-09]: Routing explanation MUST include confidence, factors, and alternatives
 */
export interface IRoutingExplanation {
  /** Unique routing decision ID */
  routingId: string;
  /** Original task description */
  task: string;
  /** Selected agent key */
  selectedAgent: string;
  /** Selected agent name */
  selectedAgentName: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Decision factors */
  factors: IRoutingFactor[];
  /** Alternative candidates considered */
  alternatives: IRoutingAlternative[];
  /** Current cold start phase */
  coldStartPhase: ColdStartPhase;
  /** Whether in cold start mode */
  isColdStart: boolean;
  /** Whether user confirmation was required */
  confirmationRequired: boolean;
  /** Decision timestamp (Unix epoch ms) */
  timestamp: number;
}

// =============================================================================
// Learning Types
// =============================================================================

/**
 * Trend direction
 */
export type TrendDirection = 
  | 'improving'
  | 'stable'
  | 'declining';

/**
 * Route-specific statistics
 */
export interface IRouteStats {
  routeType: string;
  count: number;
  averageQuality: number;
  successRate: number;
}

/**
 * Learning statistics
 * Implements [REQ-OBS-12]: Learning metrics MUST show baseline vs learned quality comparison
 * Implements [REQ-OBS-13]: Learning metrics MUST show quality breakdown by route type
 */
export interface ILearningStats {
  /** Total trajectories recorded */
  totalTrajectories: number;
  /** Total unique routes */
  totalRoutes: number;
  /** Baseline quality score 0-1 (before learning) */
  baselineQuality?: number;
  /** Learned quality score 0-1 (after learning) */
  learnedQuality?: number;
  /** Improvement percentage */
  improvementPercent?: number;
  /** Quality breakdown by route type */
  qualityByRoute: Record<string, IRouteStats>;
  /** Recent quality scores (for trend analysis) */
  recentTrend?: number[];
  /** Trend direction */
  trendDirection?: TrendDirection;
}

// =============================================================================
// Filter Types
// =============================================================================

/**
 * Event filter criteria
 */
export interface IFilterCriteria {
  /** Filter by component */
  component?: ActivityEventComponent;
  /** Filter by status */
  status?: ActivityEventStatus;
  /** Filter events after this timestamp */
  since?: number;
  /** Filter events before this timestamp */
  until?: number;
}

// =============================================================================
// SSE Types
// =============================================================================

/**
 * Server-Sent Event payload
 */
export interface ISSEEvent {
  /** Event type */
  type: string;
  /** Event data */
  data: unknown;
  /** Event ID for reconnection */
  id?: string;
}

// =============================================================================
// Daemon Types
// =============================================================================

/**
 * Daemon configuration
 */
export interface IDaemonConfig {
  /** HTTP port (default: 3847) */
  port: number;
  /** Bind address (default: 'localhost') */
  host: string;
  /** Unix socket path (default: '~/.god-agent/daemon.sock') */
  socketPath: string;
  /** SQLite database path (default: '~/.god-agent/events.db') */
  dbPath: string;
  /** Max events in memory buffer (default: 10000) */
  maxEvents: number;
  /** SQLite retention in hours (default: 24) */
  eventRetentionHours: number;
  /** Verbose logging (default: false) */
  verbose: boolean;
}

/**
 * Daemon health status
 */
export interface IDaemonHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  clientCount: number;
  eventCount: number;
  bufferUsage: number;
  dbSize?: number;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Buffer size limits per RULE-OBS-004
 */
export const BUFFER_LIMITS = {
  /** ActivityStream buffer max size */
  ACTIVITY_STREAM: 1000,
  /** RoutingHistory buffer max size */
  ROUTING_HISTORY: 100,
  /** EventStore buffer max size */
  EVENT_STORE: 10000,
  /** ObservabilityBus queue max size */
  BUS_QUEUE: 100,
} as const;

/**
 * Default daemon configuration
 */
export const DEFAULT_DAEMON_CONFIG: IDaemonConfig = {
  port: 3847,
  host: 'localhost',
  socketPath: '/tmp/god-agent.sock',
  dbPath: '.god-agent/events.db',
  maxEvents: BUFFER_LIMITS.EVENT_STORE,
  eventRetentionHours: 24,
  verbose: false,
};

/**
 * Performance budgets per constitution.md
 */
export const PERFORMANCE_BUDGETS = {
  /** Max time for event emit */
  EVENT_EMIT_MS: 1,
  /** Max time for socket send */
  SOCKET_SEND_MS: 0.5,
  /** Max time for buffer insert */
  BUFFER_INSERT_MS: 0.1,
  /** Max time for SSE broadcast */
  SSE_BROADCAST_MS: 1,
  /** Max time for SQLite write (async) */
  SQLITE_WRITE_MS: 5,
  /** Max API response time p95 */
  API_RESPONSE_MS: 100,
  /** Max dashboard load time */
  DASHBOARD_LOAD_MS: 1000,
  /** Max daemon startup time */
  DAEMON_STARTUP_MS: 2000,
  /** Max God Agent overhead */
  OVERHEAD_PERCENT: 5,
} as const;
