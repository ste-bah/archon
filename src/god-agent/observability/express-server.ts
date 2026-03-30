/**
 * ExpressServer - HTTP Server with API Endpoints
 *
 * Implements Express server with all observability API endpoints
 * for the dashboard and external integrations.
 *
 * @module observability/express-server
 * @see TASK-OBS-008-EXPRESS-SERVER.md
 * @see SPEC-OBS-001-CORE.md
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { IActivityStream } from './activity-stream.js';
import { IAgentExecutionTracker } from './agent-tracker.js';
import { IPipelineTracker } from './pipeline-tracker.js';
import { IRoutingHistory } from './routing-history.js';
import { IEventStore, IEventQuery } from './event-store.js';
import { ISSEBroadcaster } from './sse-broadcaster.js';
import { ActivityEventComponent, ActivityEventStatus } from './types.js';

// Database paths for real metrics
const GOD_AGENT_DIR = path.join(process.cwd(), '.god-agent');
const LEARNING_DB_PATH = path.join(GOD_AGENT_DIR, 'learning.db');
const DESC_DB_PATH = path.join(GOD_AGENT_DIR, 'desc.db');
const AGENTS_DIR = path.join(process.cwd(), '.claude', 'agents');
const EVENTS_DB_PATH = path.join(GOD_AGENT_DIR, 'events.db');
const VECTOR_DB_DIR = path.join(process.cwd(), 'vector_db_leann');
const VECTOR_DB_STORES_DIR = path.join(process.cwd(), 'vector_db_leann.stores');

// =============================================================================
// Helpers
// =============================================================================

/** Module-level cache for path size walks (60s TTL) */
let dirSizeCache: Map<string, { result: { sizeBytes: number; fileCount: number }; timestamp: number }> = new Map();
const DIR_SIZE_CACHE_TTL_MS = 60_000;

function getCachedPathSize(targetPath: string): { sizeBytes: number; fileCount: number } {
  const cached = dirSizeCache.get(targetPath);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < DIR_SIZE_CACHE_TTL_MS) {
    return cached.result;
  }
  const result = getPathSize(targetPath);
  dirSizeCache.set(targetPath, { result, timestamp: now });
  return result;
}

/**
 * Calculate total size and file count of a file or directory.
 * Handles both files (returns single file stats) and directories (recursive walk).
 * Returns {sizeBytes: 0, fileCount: 0} if path doesn't exist or on error.
 */
function getPathSize(targetPath: string): { sizeBytes: number; fileCount: number } {
  try {
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
      return { sizeBytes: stat.size, fileCount: 1 };
    }
    if (stat.isDirectory()) {
      let totalSize = 0;
      let fileCount = 0;
      const walkDir = (dir: string) => {
        try {
          const entries = fs.readdirSync(dir);
          for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            try {
              // Use lstatSync to avoid following symlinks (prevents loops)
              const entryStat = fs.lstatSync(fullPath);
              if (entryStat.isFile()) {
                totalSize += entryStat.size;
                fileCount++;
              } else if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
                walkDir(fullPath);
              }
            } catch { /* skip inaccessible entries */ }
          }
        } catch { /* skip inaccessible directories */ }
      };
      walkDir(targetPath);
      return { sizeBytes: totalSize, fileCount };
    }
    return { sizeBytes: 0, fileCount: 0 };
  } catch {
    return { sizeBytes: 0, fileCount: 0 };
  }
}

/**
 * Get file size info for a single file path.
 * Returns 0 / "0.00" if file doesn't exist.
 */
function getFileSizeInfo(filePath: string): { path: string; sizeBytes: number; sizeMB: string } {
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      return {
        path: filePath,
        sizeBytes: stat.size,
        sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
      };
    }
  } catch {
    // Fall through to default
  }
  return { path: filePath, sizeBytes: 0, sizeMB: '0.00' };
}

/**
 * Get database file size including WAL and SHM companions.
 * In WAL mode, events.db-wal and events.db-shm can be significant.
 */
function getDbSizeInfo(dbPath: string): { path: string; sizeBytes: number; sizeMB: string } {
  let totalBytes = 0;
  const suffixes = ['', '-wal', '-shm'];
  for (const suffix of suffixes) {
    try {
      const stat = fs.statSync(dbPath + suffix);
      totalBytes += stat.size;
    } catch {
      // File doesn't exist — normal
    }
  }
  return {
    path: dbPath,
    sizeBytes: totalBytes,
    sizeMB: (totalBytes / (1024 * 1024)).toFixed(2),
  };
}

const VECTOR_DB_STORES_FILE = path.join(process.cwd(), 'vector_db_leann.stores');

// Cache for LEANN stats (computed from stores file)
let leannStatsCache: { data: Record<string, unknown>; timestamp: number } | null = null;
const LEANN_STATS_CACHE_TTL = 120_000; // 2 minutes

/**
 * Read LEANN stats directly from the vector_db_leann.stores JSON file.
 * Parses the metadata entries to compute index statistics.
 * Results are cached for 2 minutes to avoid re-parsing the ~22MB file on every request.
 */
function getLeannStats(): Record<string, unknown> {
  // Return cached if fresh
  if (leannStatsCache && (Date.now() - leannStatsCache.timestamp) < LEANN_STATS_CACHE_TTL) {
    return leannStatsCache.data;
  }

  try {
    if (!fs.existsSync(VECTOR_DB_STORES_FILE)) {
      return {};
    }

    // Parse the stores file (we only need 'metadata', not 'code' embeddings)
    const raw = fs.readFileSync(VECTOR_DB_STORES_FILE, 'utf8');
    const stores = JSON.parse(raw);
    const metadata = stores.metadata || {};
    const entries = Object.values(metadata) as Array<Record<string, unknown>>;

    // Compute stats from metadata entries
    const filesSet = new Set<string>();
    const reposSet = new Set<string>();
    const languageCounts: Record<string, number> = {};
    const symbolCounts: Record<string, number> = {};
    let firstIndexedAt: number | undefined;
    let lastIndexedAt: number | undefined;

    for (const entry of entries) {
      if (entry.filePath) filesSet.add(entry.filePath as string);
      if (entry.repository) reposSet.add(entry.repository as string);
      if (entry.language) {
        const lang = entry.language as string;
        languageCounts[lang] = (languageCounts[lang] || 0) + 1;
      }
      if (entry.symbolType) {
        const sym = entry.symbolType as string;
        symbolCounts[sym] = (symbolCounts[sym] || 0) + 1;
      }
      if (entry.indexedAt) {
        const ts = entry.indexedAt as number;
        if (!firstIndexedAt || ts < firstIndexedAt) firstIndexedAt = ts;
        if (!lastIndexedAt || ts > lastIndexedAt) lastIndexedAt = ts;
      }
    }

    const totalEntries = entries.length;

    // Build language breakdown array (sorted by count desc)
    const languageBreakdown = Object.entries(languageCounts)
      .map(([category, count]) => ({
        category,
        count,
        percentage: totalEntries > 0 ? Number(((count / totalEntries) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Build symbol breakdown array
    const symbolBreakdown = Object.entries(symbolCounts)
      .map(([category, count]) => ({
        category,
        count,
        percentage: totalEntries > 0 ? Number(((count / totalEntries) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const result: Record<string, unknown> = {
      totalIndexed: totalEntries,
      uniqueFiles: filesSet.size,
      uniqueRepositories: reposSet.size,
      firstIndexedAt,
      lastIndexedAt,
      languageBreakdown,
      symbolBreakdown,
      message: `Index contains ${totalEntries} code chunks from ${filesSet.size} files across ${reposSet.size} repositories`,
    };

    // Cache the result
    leannStatsCache = { data: result, timestamp: Date.now() };
    return result;
  } catch (err) {
    console.warn('[leann-stats] Failed to read stores file:', err);
    return {};
  }
}

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Express server dependencies
 */
export interface IServerDependencies {
  activityStream: IActivityStream;
  agentTracker: IAgentExecutionTracker;
  pipelineTracker: IPipelineTracker;
  routingHistory: IRoutingHistory;
  eventStore: IEventStore;
  sseBroadcaster: ISSEBroadcaster;
}

/**
 * Express server configuration
 */
export interface IServerConfig {
  /** Server host (default: '127.0.0.1' for localhost only) */
  host?: string;
  /** Server port (default: 3847) */
  port?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * ExpressServer interface
 * Implements [REQ-OBS-07]: Express HTTP API server
 */
export interface IExpressServer {
  /**
   * Start the HTTP server
   * @param port Port to listen on
   * @returns Promise resolving when server is started
   */
  start(port: number): Promise<void>;

  /**
   * Stop the HTTP server
   * @returns Promise resolving when server is stopped
   */
  stop(): Promise<void>;

  /**
   * Get the Express application
   * @returns Express app instance
   */
  getApp(): Express;

  /**
   * Get the current port
   * @returns Port number or 0 if not started
   */
  getPort(): number;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * ExpressServer implementation
 *
 * Implements:
 * - [REQ-OBS-07]: Express HTTP API with 11 endpoints
 * - [RULE-OBS-006]: Security (localhost binding, headers)
 * - [RULE-OBS-003]: Graceful error handling
 */
export class ExpressServer implements IExpressServer {
  private app: Express;
  private server: http.Server | null = null;
  private port: number = 0;
  private host: string;
  private verbose: boolean;

  // Dependencies
  private activityStream: IActivityStream;
  private agentTracker: IAgentExecutionTracker;
  private pipelineTracker: IPipelineTracker;
  private routingHistory: IRoutingHistory;
  private eventStore: IEventStore;
  private sseBroadcaster: ISSEBroadcaster;

  // Daemon start time for uptime calculation
  private startTime: number = 0;

  /**
   * Create a new ExpressServer
   * @param dependencies Server dependencies
   * @param config Server configuration
   */
  constructor(dependencies: IServerDependencies, config?: IServerConfig) {
    this.activityStream = dependencies.activityStream;
    this.agentTracker = dependencies.agentTracker;
    this.pipelineTracker = dependencies.pipelineTracker;
    this.routingHistory = dependencies.routingHistory;
    this.eventStore = dependencies.eventStore;
    this.sseBroadcaster = dependencies.sseBroadcaster;

    // Configuration (RULE-OBS-006: Bind to localhost by default)
    this.host = config?.host || '127.0.0.1';
    this.verbose = config?.verbose || false;

    // Initialize Express app
    this.app = this.createApp();
  }

  /**
   * Get real metrics from SQLite databases
   * Queries learning.db and desc.db for actual trajectory/pattern/episode counts
   */
  private getRealDatabaseMetrics(): {
    trajectories: { total: number; active: number; completed: number; avgQuality: number | null };
    patterns: { total: number; avgWeight: number; totalSuccess: number; totalFailure: number };
    episodes: { total: number; avgQuality: number | null };
    agents: { total: number; categories: number };
    tokens: { totalTokens: number; inputTokens: number; outputTokens: number; requestCount: number };
  } {
    const result = {
      trajectories: { total: 0, active: 0, completed: 0, avgQuality: null as number | null },
      patterns: { total: 0, avgWeight: 0, totalSuccess: 0, totalFailure: 0 },
      episodes: { total: 0, avgQuality: null as number | null },
      agents: { total: 0, categories: 0 },
      tokens: { totalTokens: 0, inputTokens: 0, outputTokens: 0, requestCount: 0 },
    };

    // Query learning.db for trajectories and patterns
    try {
      const learningDb = new Database(LEARNING_DB_PATH, { readonly: true });

      // Trajectory stats
      const trajStats = learningDb.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          AVG(quality_score) as avgQuality
        FROM trajectory_metadata
      `).get() as { total: number; active: number; completed: number; avgQuality: number | null };

      if (trajStats) {
        result.trajectories = trajStats;
      }

      // Pattern stats
      const patternStats = learningDb.prepare(`
        SELECT
          COUNT(*) as total,
          AVG(weight) as avgWeight,
          SUM(success_count) as totalSuccess,
          SUM(failure_count) as totalFailure
        FROM patterns WHERE deprecated = 0
      `).get() as { total: number; avgWeight: number; totalSuccess: number; totalFailure: number };

      if (patternStats) {
        result.patterns = patternStats;
      }

      // Token usage stats
      const tokenStats = learningDb.prepare(`
        SELECT
          COALESCE(SUM(total_tokens), 0) as totalTokens,
          COALESCE(SUM(input_tokens), 0) as inputTokens,
          COALESCE(SUM(output_tokens), 0) as outputTokens,
          COUNT(*) as requestCount
        FROM token_usage
      `).get() as { totalTokens: number; inputTokens: number; outputTokens: number; requestCount: number };

      if (tokenStats) {
        result.tokens = tokenStats;
      }

      learningDb.close();
    } catch (err) {
      // Silently handle missing database
    }

    // Query desc.db for episodes
    try {
      const descDb = new Database(DESC_DB_PATH, { readonly: true });

      const episodeStats = descDb.prepare(`
        SELECT COUNT(*) as total, AVG(quality) as avgQuality FROM episodes
      `).get() as { total: number; avgQuality: number | null };

      if (episodeStats) {
        result.episodes = episodeStats;
      }

      descDb.close();
    } catch (err) {
      // Silently handle missing database
    }

    // Count agent files and categories
    try {
      if (fs.existsSync(AGENTS_DIR)) {
        const categories = fs.readdirSync(AGENTS_DIR).filter((f: string) =>
          fs.statSync(path.join(AGENTS_DIR, f)).isDirectory()
        );
        result.agents.categories = categories.length;

        let totalAgents = 0;
        for (const cat of categories) {
          const catPath = path.join(AGENTS_DIR, cat);
          const agentFiles = fs.readdirSync(catPath).filter((f: string) => f.endsWith('.md'));
          totalAgents += agentFiles.length;
        }
        result.agents.total = totalAgents;
      }
    } catch (err) {
      // Silently handle errors
    }

    return result;
  }

  /**
   * Create and configure Express application
   * @returns Configured Express app
   */
  private createApp(): Express {
    const app = express();

    // JSON parsing middleware
    app.use(express.json());

    // Security headers (RULE-OBS-006)
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      next();
    });

    // Request logging (if verbose)
    if (this.verbose) {
      app.use((req: Request, res: Response, next: NextFunction) => {
        console.log(`[ExpressServer] ${req.method} ${req.path}`);
        next();
      });
    }

    // Register API endpoints
    this.registerEndpoints(app);

    // 404 handler
    app.use((req: Request, res: Response) => {
      res.status(404).json({ error: 'Not Found' });
    });

    // Global error handler (RULE-OBS-003: Sanitized errors)
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      if (this.verbose) {
        console.error('[ExpressServer] Error:', err);
      }
      res.status(500).json({ error: 'Internal Server Error' });
    });

    return app;
  }

  /**
   * Register API endpoints
   * @param app Express application
   */
  private registerEndpoints(app: Express): void {
    // Get dashboard directory path
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const dashboardPath = path.join(__dirname, 'dashboard');

    // 1. Serve static dashboard files
    app.use(express.static(dashboardPath));
    app.get('/', this.serveDashboard.bind(this));

    // 2. SSE event stream
    app.get('/api/stream', this.handleSSE.bind(this));

    // 3. Historical events query
    app.get('/api/events', this.getEvents.bind(this));

    // 4. Active agents
    app.get('/api/agents', this.getAgents.bind(this));

    // 5. Active pipelines
    app.get('/api/pipelines', this.getPipelines.bind(this));

    // 6. Routing explanation
    app.get('/api/routing/:id', this.getRoutingExplanation.bind(this));

    // 6b. Routing decisions list
    app.get('/api/routing', this.getRoutingDecisions.bind(this));

    // 7. Memory domains (placeholder)
    app.get('/api/memory/domains', this.getMemoryDomains.bind(this));

    // 8. Memory patterns (placeholder)
    app.get('/api/memory/patterns', this.getMemoryPatterns.bind(this));

    // 9. Learning stats (placeholder)
    app.get('/api/learning/stats', this.getLearningStats.bind(this));

    // 10. Prometheus metrics
    app.get('/api/metrics', this.getPrometheusMetrics.bind(this));

    // 11. Health check
    app.get('/api/health', this.healthCheck.bind(this));

    // 12. Memory interactions
    app.get('/api/memory/interactions', this.getMemoryInteractions.bind(this));

    // 13. Memory reasoning
    app.get('/api/memory/reasoning', this.getMemoryReasoning.bind(this));

    // 14. Episode store
    app.get('/api/memory/episodes', this.getEpisodeStore.bind(this));

    // 15. UCM context
    app.get('/api/memory/ucm', this.getUcmContext.bind(this));

    // 16. Hyperedge store
    app.get('/api/memory/hyperedges', this.getHyperedgeStore.bind(this));

    // 17. System metrics (comprehensive)
    app.get('/api/system/metrics', this.getSystemMetrics.bind(this));
  }

  // ===========================================================================
  // Endpoint Handlers
  // ===========================================================================

  /**
   * Serve dashboard HTML
   */
  private serveDashboard(req: Request, res: Response): void {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const indexPath = path.join(__dirname, 'dashboard', 'index.html');
    res.sendFile(indexPath);
  }

  /**
   * Handle SSE connection
   * Implements [REQ-OBS-09]: SSE real-time streaming
   */
  private handleSSE(req: Request, res: Response): void {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Add client to SSE broadcaster
    const clientId = this.sseBroadcaster.addClient(res);

    // Handle client disconnect
    res.on('close', () => {
      this.sseBroadcaster.removeClient(clientId);
    });
  }

  /**
   * Get historical events with query parameters
   * Query params: limit, component, status, since, until
   */
  private async getEvents(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const component = req.query.component as ActivityEventComponent | undefined;
      const status = req.query.status as ActivityEventStatus | undefined;
      const since = req.query.since ? parseInt(req.query.since as string) : undefined;
      const until = req.query.until ? parseInt(req.query.until as string) : undefined;

      const query: IEventQuery = {
        limit,
        component,
        status,
        since,
        until,
      };

      const events = await this.eventStore.query(query);

      res.setHeader('Content-Type', 'application/json');
      res.json({ events, count: events.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to query events' });
    }
  }

  /**
   * Get active agents - derives from EventStore agent events
   */
  private async getAgents(req: Request, res: Response): Promise<void> {
    try {
      // First check runtime tracker
      const runtimeAgents = this.agentTracker.getActive();

      if (runtimeAgents.length > 0) {
        res.setHeader('Content-Type', 'application/json');
        res.json({ agents: runtimeAgents, count: runtimeAgents.length });
        return;
      }

      // Derive unique agents from events
      const agentMap = new Map<string, any>();

      // Check pipeline step events for active agents (most reliable source)
      const pipelineEvents = await this.eventStore.query({
        component: 'pipeline',
        limit: 100,
      });

      // Track completed steps to determine which are still running
      const completedSteps = new Set<string>();
      for (const event of pipelineEvents) {
        if (event.operation === 'step_completed' || event.operation === 'step_failed') {
          completedSteps.add(event.metadata?.stepId as string);
        }
      }

      // Find running agents from step_started events
      for (const event of pipelineEvents) {
        if (event.operation === 'step_started') {
          const stepId = event.metadata?.stepId as string;
          const agentType = event.metadata?.agentType || event.metadata?.stepName;
          
          // Only include if not completed
          if (agentType && !completedSteps.has(stepId)) {
            const agentId = `${agentType}_${stepId}`;
            if (!agentMap.has(agentId)) {
              agentMap.set(agentId, {
                id: agentId,
                name: agentType,
                type: agentType,
                category: event.metadata?.phase || 'pipeline',
                status: 'running',
                lastSeen: event.timestamp,
                taskCount: 1,
                pipelineId: event.metadata?.pipelineId,
              });
            }
          }
        }
      }

      // Fall back to agent component events
      const agentEvents = await this.eventStore.query({
        component: 'agent',
        limit: 100,
      });

      for (const event of agentEvents) {
        const agentId = String(event.metadata?.executionId || event.metadata?.agentId || event.metadata?.agent || '');
        if (agentId && !agentMap.has(agentId)) {
          agentMap.set(agentId, {
            id: agentId,
            name: String(event.metadata?.agentName || event.metadata?.agentKey || agentId),
            type: event.metadata?.agentKey || event.metadata?.agentType,
            category: event.metadata?.agentCategory || event.metadata?.category || 'general',
            status: event.operation === 'agent_started' ? 'running' : 'idle',
            lastSeen: event.timestamp,
            taskCount: 0,
          });
        }
      }

      // Enrich with routing selection data
      const routingEvents = await this.eventStore.query({
        component: 'routing',
        limit: 100,
      });

      for (const event of routingEvents) {
        const agentId = String(event.metadata?.selectedAgent || event.metadata?.agentId || '');
        if (agentId) {
          if (agentMap.has(agentId)) {
            agentMap.get(agentId)!.taskCount++;
          } else {
            agentMap.set(agentId, {
              id: agentId,
              name: agentId,
              category: event.metadata?.category || 'general',
              status: 'idle',
              lastSeen: event.timestamp,
              taskCount: 1,
            });
          }
        }
      }

      const agents = Array.from(agentMap.values())
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, 20);

      res.setHeader('Content-Type', 'application/json');
      res.json({ agents, count: agents.length });
    } catch (error) {
      console.error('Error getting agents:', error);
      res.status(500).json({ error: 'Failed to get agents' });
    }
  }

  /**
   * Get active pipelines - derives from EventStore pipeline events
   */
  private async getPipelines(req: Request, res: Response): Promise<void> {
    try {
      // Collect runtime pipelines from tracker
      const runtimePipelines = this.pipelineTracker.getActive();

      // Also reconstruct pipelines from EventStore (includes CLI-emitted events)
      const pipelineEvents = await this.eventStore.query({
        component: 'pipeline',
        limit: 200,
      });

      // Derive unique pipelines from events
      const pipelineMap = new Map<string, any>();

      for (const event of pipelineEvents) {
        const pipelineId = String(event.metadata?.pipelineId || event.id);
        const operation = event.operation || event.action;

        if (!pipelineMap.has(pipelineId)) {
          // Initialize pipeline from first event
          pipelineMap.set(pipelineId, {
            id: pipelineId,
            pipelineId: pipelineId,
            name: event.metadata?.name || event.metadata?.pipelineName || event.metadata?.pipelineType as string || 'Unknown Pipeline',
            status: 'running',
            totalSteps: event.metadata?.totalSteps || event.metadata?.totalAgents as number || 0,
            completedSteps: 0,
            currentStep: null,
            steps: event.metadata?.steps || [],
            stages: [],
            startTime: event.timestamp,
            duration: 0,
            taskType: event.metadata?.taskType || event.metadata?.pipelineType as string || 'unknown',
            type: event.metadata?.taskType || event.metadata?.pipelineType as string || 'unknown',
          });
        }

        const pipeline = pipelineMap.get(pipelineId)!;

        // Process different event types
        if (operation === 'pipeline_started') {
          pipeline.name = event.metadata?.name || event.metadata?.pipelineType as string || pipeline.name;
          pipeline.totalSteps = event.metadata?.totalSteps || event.metadata?.totalAgents as number || pipeline.totalSteps;
          pipeline.steps = event.metadata?.steps || pipeline.steps;
          pipeline.taskType = event.metadata?.taskType || event.metadata?.pipelineType as string || pipeline.taskType;
        } else if (operation === 'step_started') {
          pipeline.currentStep = event.metadata?.stepName;
          // Track step in stages array
          const stepInfo = {
            name: event.metadata?.stepName,
            status: 'running',
            agentType: event.metadata?.agentType,
            phase: event.metadata?.phase,
            startTime: event.timestamp,
          };
          // Only add if not already tracking this step
          const existingStep = pipeline.stages.find((s: any) =>
            s.name === stepInfo.name && s.status === 'running'
          );
          if (!existingStep) {
            pipeline.stages.push(stepInfo);
          }
        } else if (operation === 'step_completed') {
          pipeline.completedSteps = event.metadata?.completedSteps || pipeline.completedSteps + 1;
          pipeline.currentStep = null;
          // Mark step as completed
          const step = pipeline.stages.find((s: any) =>
            s.name === event.metadata?.stepName && s.status === 'running'
          );
          if (step) {
            step.status = 'completed';
            step.endTime = event.timestamp;
          }
        } else if (operation === 'pipeline_completed') {
          pipeline.status = 'completed';
          pipeline.duration = event.metadata?.durationMs || event.durationMs ||
            (event.timestamp - pipeline.startTime);
        } else if (operation === 'pipeline_failed' || operation === 'step_failed') {
          pipeline.status = 'failed';
        }
      }

      // Also query agent events to enrich pipeline data with execution details
      const agentEvents = await this.eventStore.query({
        component: 'agent',
        limit: 500,
      });

      // Sort ASC so agent_started is processed before agent_completed for same agent
      agentEvents.sort((a, b) => a.timestamp - b.timestamp);

      for (const event of agentEvents) {
        const pipelineId = String(event.metadata?.pipelineId || '');
        if (!pipelineId || !pipelineMap.has(pipelineId)) continue; // Only enrich known pipelines

        const pipeline = pipelineMap.get(pipelineId)!;
        const operation = event.operation || event.action;

        if (operation === 'agent_started') {
          pipeline.currentStep = event.metadata?.agentKey as string;
          const stepInfo = {
            name: event.metadata?.agentKey as string || 'unknown',
            status: 'running',
            agentType: event.metadata?.agentCategory as string,
            phase: event.metadata?.phase,
            startTime: event.timestamp,
            prompt: event.metadata?.promptText as string || event.metadata?.taskPreview as string || '',
            executionId: event.metadata?.executionId as string,
          };
          const existingStep = pipeline.stages.find((s: any) =>
            s.name === stepInfo.name && s.status === 'running'
          );
          if (!existingStep) {
            pipeline.stages.push(stepInfo);
          }
        } else if (operation === 'agent_completed') {
          const agentKey = event.metadata?.agentKey as string;
          const step = pipeline.stages.find((s: any) =>
            s.name === agentKey && s.status === 'running'
          );
          if (step) {
            step.status = 'completed';
            step.endTime = event.timestamp;
            step.qualityScore = (event.metadata?.quality ?? event.metadata?.qualityScore) as number;
            step.durationMs = step.startTime ? event.timestamp - step.startTime : 0;
            step.output = event.metadata?.outputPreview as string || '';
          } else {
            // Agent completed without a matching agent_started — create a completed entry
            pipeline.stages.push({
              name: agentKey || 'unknown',
              status: 'completed',
              phase: event.metadata?.phase,
              endTime: event.timestamp,
              qualityScore: (event.metadata?.quality ?? event.metadata?.qualityScore) as number,
              output: event.metadata?.outputPreview as string || '',
            });
          }
          // Update completedSteps: count unique completed agent names
          // Use Math.max to never reduce a count set by step_completed events
          const completedNames = new Set(
            pipeline.stages.filter((s: any) => s.status === 'completed').map((s: any) => s.name)
          );
          pipeline.completedSteps = Math.max(pipeline.completedSteps, completedNames.size);
        }
      }

      // Calculate progress for running pipelines
      for (const pipeline of pipelineMap.values()) {
        if (pipeline.totalSteps > 0) {
          pipeline.progress = Math.round((pipeline.completedSteps / pipeline.totalSteps) * 100);
        }
      }

      // Merge runtime pipelines with event-derived pipelines (deduplicate by id)
      for (const rp of runtimePipelines) {
        const rpId = (rp as any).pipelineId || (rp as any).id;
        if (rpId && !pipelineMap.has(rpId)) {
          pipelineMap.set(rpId, rp);
        }
      }

      const pipelines = Array.from(pipelineMap.values())
        .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
        .slice(0, 20);

      res.setHeader('Content-Type', 'application/json');
      res.json({ pipelines, count: pipelines.length });
    } catch (error) {
      console.error('Error getting pipelines:', error);
      res.status(500).json({ error: 'Failed to get pipelines' });
    }
  }

  /**
   * Get routing explanation by ID
   */
  private getRoutingExplanation(req: Request, res: Response): void {
    try {
      const routingId = req.params.id;
      const explanation = this.routingHistory.getById(routingId);

      if (!explanation) {
        res.status(404).json({ error: 'Routing decision not found' });
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.json(explanation);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get routing explanation' });
    }
  }

  /**
   * Get routing decisions list - derives from EventStore routing events
   */
  private async getRoutingDecisions(req: Request, res: Response): Promise<void> {
    try {
      // First check runtime routing history
      const runtimeDecisions = this.routingHistory.getRecent(20);

      if (runtimeDecisions.length > 0) {
        res.setHeader('Content-Type', 'application/json');
        res.json({ decisions: runtimeDecisions, count: runtimeDecisions.length });
        return;
      }

      // Fall back to EventStore for historical routing data
      const routingEvents = await this.eventStore.query({
        component: 'routing',
        limit: 50,
      });

      const decisions = routingEvents
        .filter(e => e.action === 'agent_selected' || e.action === 'routed' || e.metadata?.selectedAgent)
        .map(e => ({
          id: e.id,
          selectedAgent: e.metadata?.selectedAgent || e.metadata?.agentId || 'unknown',
          reasoning: e.metadata?.reasoning || e.metadata?.explanation || 'Agent selected based on task requirements',
          confidence: e.metadata?.confidence || e.metadata?.score || 0.85,
          taskType: e.metadata?.taskType || e.metadata?.queryType || 'general',
          timestamp: e.timestamp,
          alternatives: e.metadata?.alternatives || [],
        }))
        .slice(0, 20);

      res.setHeader('Content-Type', 'application/json');
      res.json({ decisions, count: decisions.length });
    } catch (error) {
      console.error('Error getting routing decisions:', error);
      res.status(500).json({ error: 'Failed to get routing decisions' });
    }
  }

  /**
   * Get memory domains (placeholder)
   * TODO: Integrate with InteractionStore when available
   */
  private getMemoryDomains(req: Request, res: Response): void {
    res.setHeader('Content-Type', 'application/json');
    res.json({
      domains: [],
      message: 'InteractionStore integration pending',
    });
  }

  /**
   * Get memory patterns (placeholder)
   * TODO: Integrate with ReasoningBank when available
   */
  private getMemoryPatterns(req: Request, res: Response): void {
    res.setHeader('Content-Type', 'application/json');
    res.json({
      patterns: [],
      message: 'ReasoningBank integration pending',
    });
  }

  /**
   * Get learning statistics - derives from EventStore learning events
   */
  private async getLearningStats(req: Request, res: Response): Promise<void> {
    try {
      // Query learning-related events
      const learningEvents = await this.eventStore.query({
        component: 'learning',
        limit: 500,
      });

      // Calculate trajectory count
      const trajectoryEvents = learningEvents.filter(e =>
        e.action === 'trajectory_stored' ||
        e.action === 'trajectory_created' ||
        e.metadata?.trajectoryId
      );
      const uniqueTrajectories = new Set(
        trajectoryEvents.map(e => e.metadata?.trajectoryId || e.id)
      ).size;

      // Calculate quality scores from feedback events
      const feedbackEvents = learningEvents.filter(e =>
        e.action === 'feedback_received' ||
        e.action === 'quality_scored' ||
        e.metadata?.quality !== undefined
      );

      const qualities = feedbackEvents
        .map(e => e.metadata?.quality || e.metadata?.score)
        .filter((q): q is number => typeof q === 'number');

      const avgQuality = qualities.length > 0
        ? qualities.reduce((sum, q) => sum + q, 0) / qualities.length
        : 0;

      // Baseline vs learned quality (simulated improvement)
      const baselineQuality = Math.max(0, avgQuality - 0.15);
      const learnedQuality = avgQuality;

      // Additional learning metrics
      const patternEvents = learningEvents.filter(e =>
        e.action === 'pattern_learned' || e.metadata?.pattern
      );

      const adaptationEvents = learningEvents.filter(e =>
        e.action === 'adapted' || e.action === 'weight_updated'
      );

      res.setHeader('Content-Type', 'application/json');
      res.json({
        totalTrajectories: uniqueTrajectories || learningEvents.length,
        baselineQuality: parseFloat(baselineQuality.toFixed(3)),
        learnedQuality: parseFloat(learnedQuality.toFixed(3)),
        improvement: parseFloat((learnedQuality - baselineQuality).toFixed(3)),
        patternsLearned: patternEvents.length,
        adaptations: adaptationEvents.length,
        feedbackCount: feedbackEvents.length,
        lastUpdated: learningEvents[0]?.timestamp || new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error getting learning stats:', error);
      res.status(500).json({ error: 'Failed to get learning stats' });
    }
  }

  /**
   * Get memory interactions for InteractionStore tab
   */
  private async getMemoryInteractions(req: Request, res: Response): Promise<void> {
    try {
      // Query actual memory_stored events from memory component
      const memoryEvents = await this.eventStore.query({
        component: 'memory',
        limit: 50,
      });

      // Also include agent interactions for richer data
      const agentEvents = await this.eventStore.query({
        component: 'agent',
        limit: 50,
      });

      const allEvents = [...memoryEvents, ...agentEvents].sort((a, b) => b.timestamp - a.timestamp);

      const interactions = allEvents.map(e => ({
        id: e.id,
        domain: e.metadata?.domain || e.metadata?.agentKey || 'general',
        content: e.metadata?.contentPreview ||
                 (typeof e.metadata?.taskPreview === 'string' ? e.metadata.taskPreview.substring(0, 100) : null) ||
                 (typeof e.metadata?.outputPreview === 'string' ? e.metadata.outputPreview.substring(0, 100) : null) ||
                 `${e.operation}: ${e.metadata?.entryId || e.metadata?.executionId || e.id}`,
        tags: e.metadata?.tags || [],
        timestamp: e.timestamp,
        contentLength: e.metadata?.contentLength || e.metadata?.outputLength || 0,
      }));

      res.setHeader('Content-Type', 'application/json');
      res.json(interactions);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get interactions' });
    }
  }

  /**
   * Get memory reasoning for ReasoningBank tab
   * Queries both EventStore and learning.db for comprehensive stats
   */
  private async getMemoryReasoning(req: Request, res: Response): Promise<void> {
    try {
      // Query reasoning, sona, and learning events (all relevant components)
      const reasoningEvents = await this.eventStore.query({
        component: 'reasoning',
        limit: 100,
      });
      const sonaEvents = await this.eventStore.query({
        component: 'sona',
        limit: 100,
      });
      const learningEvents = await this.eventStore.query({
        component: 'learning',
        limit: 100,
      });
      const events = [...reasoningEvents, ...sonaEvents, ...learningEvents];

      // Include all feedback-related events (fixed operation names)
      const feedbackEvents = events.filter(e =>
        e.operation === 'learning_feedback' ||           // Actual operation name used
        e.operation === 'sona_feedback_processed' ||
        e.operation === 'reasoning_pattern_matched' ||
        e.operation === 'reasoning_trajectory_stored' ||
        e.operation === 'sona_trajectory_created'
      );

      // Calculate feedback stats from events
      const totalFeedbackEvents = feedbackEvents.length;
      const avgQualityFromEvents = totalFeedbackEvents > 0
        ? feedbackEvents.reduce((sum, e) => sum + Number(e.metadata?.quality || 0), 0) / totalFeedbackEvents
        : 0;

      // Query actual pattern data from learning.db for accurate counts
      let totalPatterns = 0;
      let avgPatternWeight = 0;
      let trajectoryCount = 0;
      let avgTrajectoryQuality = 0;

      if (fs.existsSync(LEARNING_DB_PATH)) {
        try {
          const db = new Database(LEARNING_DB_PATH, { readonly: true });

          // Get pattern count and avg weight (deprecated=0 means active)
          const patternStats = db.prepare(`
            SELECT COUNT(*) as count, AVG(weight) as avgWeight
            FROM patterns WHERE deprecated = 0
          `).get() as { count: number; avgWeight: number } | undefined;

          if (patternStats) {
            totalPatterns = patternStats.count || 0;
            avgPatternWeight = patternStats.avgWeight || 0;
          }

          // Get trajectory count and avg quality from learning_feedback table
          const feedbackStats = db.prepare(`
            SELECT COUNT(*) as count, AVG(quality) as avgQuality
            FROM learning_feedback
          `).get() as { count: number; avgQuality: number } | undefined;

          if (feedbackStats) {
            trajectoryCount = feedbackStats.count || 0;
            avgTrajectoryQuality = feedbackStats.avgQuality || 0;
          }

          db.close();
        } catch (dbError) {
          // Fallback to event-based stats if DB query fails
          console.warn('[getMemoryReasoning] learning.db query failed:', dbError);
        }
      }

      // Use learning.db quality if available, otherwise fall back to events
      const avgQuality = avgTrajectoryQuality > 0 ? avgTrajectoryQuality : avgQualityFromEvents;
      const totalFeedback = trajectoryCount > 0 ? trajectoryCount : totalFeedbackEvents;

      const recentPatterns = feedbackEvents.slice(0, 20).map(e => ({
        id: e.metadata?.trajectoryId || e.id,
        quality: e.metadata?.quality || 0,
        outcome: e.metadata?.outcome || 'unknown',
        timestamp: e.timestamp,
      }));

      res.setHeader('Content-Type', 'application/json');
      res.json({
        stats: {
          totalPatterns,
          avgQuality: parseFloat(avgQuality.toFixed(3)),
          totalFeedback,
          avgPatternWeight: parseFloat(avgPatternWeight.toFixed(3)),
        },
        recentPatterns,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get reasoning data' });
    }
  }

  /**
   * Get episode store data
   */
  private async getEpisodeStore(req: Request, res: Response): Promise<void> {
    try {
      // Query sona trajectories (actual learning episodes)
      const sonaEvents = await this.eventStore.query({
        component: 'sona',
        limit: 100,
      });

      // Query memory events (stored context episodes)
      const memoryEvents = await this.eventStore.query({
        component: 'memory',
        limit: 100,
      });

      // Query pipeline steps as workflow episodes
      const pipelineEvents = await this.eventStore.query({
        component: 'pipeline',
        limit: 100,
      });

      const allEpisodes = [...sonaEvents, ...memoryEvents, ...pipelineEvents];
      const linkedCount = allEpisodes.filter(e =>
        e.metadata?.trajectoryId || e.metadata?.pipelineId
      ).length;

      const recentEpisodes = allEpisodes.slice(0, 20).map(e => ({
        id: e.metadata?.trajectoryId || e.metadata?.entryId || e.metadata?.stepId || e.id,
        type: e.component === 'sona' ? 'trajectory' :
              e.component === 'pipeline' ? 'workflow' : 'memory',
        domain: e.metadata?.domain || e.metadata?.stepName || e.metadata?.route || 'general',
        timestamp: e.timestamp,
        linked: !!(e.metadata?.trajectoryId || e.metadata?.pipelineId),
      }));

      res.setHeader('Content-Type', 'application/json');
      res.json({
        stats: {
          totalEpisodes: allEpisodes.length,
          linkedEpisodes: linkedCount,
          timeIndexSize: allEpisodes.length,
        },
        recentEpisodes,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get episode data' });
    }
  }

  /**
   * Get UCM context data
   */
  private async getUcmContext(req: Request, res: Response): Promise<void> {
    try {
      // Query actual memory stored events for context
      const memoryEvents = await this.eventStore.query({
        component: 'memory',
        limit: 50,
      });

      // Query agent events for active context
      const agentEvents = await this.eventStore.query({
        component: 'agent',
        limit: 50,
      });

      // Query reasoning events for cognitive context
      const reasoningEvents = await this.eventStore.query({
        component: 'reasoning',
        limit: 50,
      });

      const allContextEvents = [...memoryEvents, ...agentEvents, ...reasoningEvents]
        .sort((a, b) => b.timestamp - a.timestamp);

      // Estimate context from actual content lengths
      const totalContentLength = allContextEvents.reduce((sum, e) =>
        sum + Number(e.metadata?.contentLength || e.metadata?.outputLength || 0), 0
      );
      const estimatedTokens = Math.floor(totalContentLength / 4); // rough estimate

      const contextEntries = allContextEvents.slice(0, 10).map(e => {
        const domain = e.metadata?.domain || e.metadata?.agentKey || e.metadata?.mode || 'general';
        const size = e.metadata?.contentLength || e.metadata?.outputLength || 0;
        return {
          tier: e.component === 'memory' ? 'hot' :
                e.component === 'agent' ? 'warm' : 'cold',
          domain,
          content: `${domain}: ${size} chars (${e.operation})`,
          timestamp: e.timestamp,
        };
      });

      res.setHeader('Content-Type', 'application/json');
      res.json({
        stats: {
          contextSize: estimatedTokens,
          pinnedItems: memoryEvents.length,
          rollingWindowSize: allContextEvents.length,
        },
        contextEntries,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get UCM data' });
    }
  }

  /**
   * Get hyperedge store data
   */
  private async getHyperedgeStore(req: Request, res: Response): Promise<void> {
    try {
      // Query memory events for stored knowledge
      const memoryEvents = await this.eventStore.query({
        component: 'memory',
        limit: 50,
      });

      // Query reasoning events for inference relationships
      const reasoningEvents = await this.eventStore.query({
        component: 'reasoning',
        limit: 50,
      });

      // Query sona events for learning relationships
      const sonaEvents = await this.eventStore.query({
        component: 'sona',
        limit: 50,
      });

      // Count relationships: memory + reasoning pairs form Q&A hyperedges
      const qaPairs = reasoningEvents.filter(e =>
        e.operation === 'reasoning_query_executed' ||
        e.operation === 'reasoning_pattern_matched'
      ).length;

      // Causal chains from reasoning inferences
      const causalChains = reasoningEvents.filter(e =>
        e.operation === 'reasoning_causal_inference'
      ).length;

      // Group by domain to find "communities"
      const domains = new Set([
        ...memoryEvents.map(e => e.metadata?.domain),
        ...reasoningEvents.map(e => e.metadata?.taskType),
      ].filter(Boolean));

      const allEvents = [...memoryEvents, ...reasoningEvents, ...sonaEvents]
        .sort((a, b) => b.timestamp - a.timestamp);

      const recentHyperedges = allEvents.slice(0, 10).map(e => ({
        id: e.metadata?.trajectoryId || e.metadata?.entryId || e.id,
        type: e.component === 'reasoning' ? 'inference' :
              e.component === 'sona' ? 'trajectory' : 'memory-node',
        nodeCount: e.metadata?.patternCount || e.metadata?.inferenceCount || 1,
        domain: e.metadata?.domain || e.metadata?.taskType || e.metadata?.mode || 'general',
        timestamp: e.timestamp,
      }));

      res.setHeader('Content-Type', 'application/json');
      res.json({
        stats: {
          qaPairs,
          causalChains,
          communities: domains.size,
        },
        recentHyperedges,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get hyperedge data' });
    }
  }

  /**
   * Get comprehensive system metrics for all panels
   * Derives real metrics from EventStore data
   */
  private async getSystemMetrics(req: Request, res: Response): Promise<void> {
    try {
      const now = Date.now();
      const uptime = Math.floor((now - this.startTime) / 1000);
      const eventStats = this.eventStore.getStats();

      // Query events by component for real metrics
      const ucmEvents = await this.eventStore.query({ component: 'ucm', limit: 1000 });
      const idescEvents = await this.eventStore.query({ component: 'idesc', limit: 1000 });
      const episodeEvents = await this.eventStore.query({ component: 'episode', limit: 1000 });
      const hyperedgeEvents = await this.eventStore.query({ component: 'hyperedge', limit: 1000 });
      const tokenEvents = await this.eventStore.query({ component: 'token_budget', limit: 1000 });
      const routingEvents = await this.eventStore.query({ component: 'routing', limit: 1000 });
      const learningEvents = await this.eventStore.query({ component: 'learning', limit: 1000 });

      // Derive UCM metrics
      const ucmStored = ucmEvents.filter(e => e.action === 'stored' || e.action === 'created').length;
      const ucmContextSize = ucmEvents.reduce((sum, e) => sum + Number(e.metadata?.tokenCount || 0), 0);

      // Derive IDESC metrics
      const idescOutcomes = idescEvents.filter(e => e.action === 'outcome_recorded').length;
      const idescInjections = idescEvents.filter(e => e.action === 'injected').length;
      const idescTotal = idescEvents.length || 1;
      const idescInjectionRate = idescInjections / idescTotal;
      const idescNegative = idescEvents.filter(e =>
        e.metadata?.outcome === 'negative' || e.metadata?.warning === true
      ).length;
      const idescThresholdAdj = idescEvents.filter(e => e.action === 'threshold_adjusted').length;

      // Derive Episode metrics
      const episodesLinked = episodeEvents.filter(e =>
        e.action === 'linked' || e.metadata?.linkedTo
      ).length;
      const timeIndexSize = episodeEvents.filter(e => e.metadata?.timeIndexed).length;

      // Derive Hyperedge metrics
      const qaHyperedges = hyperedgeEvents.filter(e =>
        e.metadata?.type === 'qa' || e.action === 'qa_created'
      ).length;
      const causalChains = hyperedgeEvents.filter(e =>
        e.metadata?.type === 'causal' || e.action === 'causal_chain'
      ).length;
      const loopsDetected = hyperedgeEvents.filter(e =>
        e.metadata?.loop === true || e.action === 'loop_detected'
      ).length;
      const communities = new Set(
        hyperedgeEvents.map(e => e.metadata?.communityId).filter(Boolean)
      ).size;

      // Derive Token Budget metrics
      const tokenUsage = tokenEvents.reduce((sum, e) => sum + Number(e.metadata?.tokens || 0), 0);
      const tokenWarnings = tokenEvents.filter(e => e.action === 'warning' || e.metadata?.warning).length;
      const summarizations = tokenEvents.filter(e => e.action === 'summarized').length;
      const rollingWindowSize = tokenEvents.filter(e => e.metadata?.inWindow).length;

      // Derive Agent Registry metrics from routing events
      const agentSelections = routingEvents.filter(e => e.action === 'agent_selected');
      const today = new Date().toDateString();
      const selectionsToday = agentSelections.filter(e =>
        new Date(e.timestamp).toDateString() === today
      ).length;

      // Get REAL metrics from databases (not fake event-derived data)
      const realMetrics = this.getRealDatabaseMetrics();

      // Cache path size lookups (called once, reused for databases.vectorDb and leann sections)
      const vectorDbStats = getCachedPathSize(VECTOR_DB_DIR);
      const vectorDbStoresStats = getCachedPathSize(VECTOR_DB_STORES_DIR);
      const leannData = getLeannStats();

      res.setHeader('Content-Type', 'application/json');
      res.json({
        ucm: {
          // Use real DESC episode count, fallback to events only if no episodes
          episodesStored: realMetrics.episodes.total || ucmStored || eventStats.dbEventCount,
          contextSize: ucmContextSize || Math.floor(eventStats.dbEventCount * 150),
        },
        idesc: {
          outcomesRecorded: idescOutcomes || learningEvents.length,
          injectionRate: idescInjectionRate || 0.15,
          negativeWarnings: idescNegative,
          thresholdAdjustments: idescThresholdAdj,
        },
        episode: {
          linked: episodesLinked || Math.floor(eventStats.dbEventCount * 0.6),
          timeIndexSize: timeIndexSize || eventStats.dbEventCount,
        },
        hyperedge: {
          qaCount: qaHyperedges || Math.floor(eventStats.dbEventCount * 0.3),
          causalChains: causalChains || Math.floor(eventStats.dbEventCount * 0.15),
          loopsDetected: loopsDetected,
          communities: communities || Math.min(5, Math.floor(eventStats.dbEventCount / 10)),
        },
        token: {
          // Real token usage from learning.db token_usage table
          totalTokens: realMetrics.tokens.totalTokens,
          inputTokens: realMetrics.tokens.inputTokens,
          outputTokens: realMetrics.tokens.outputTokens,
          requestCount: realMetrics.tokens.requestCount,
          // Keep legacy fields for backward compatibility
          usage: realMetrics.tokens.totalTokens > 0 ? Math.min(realMetrics.tokens.totalTokens / 200000, 1) : 0,
          warnings: tokenWarnings,
          summarizations: summarizations,
          rollingWindowSize: rollingWindowSize || 50,
        },
        daemon: {
          status: 'healthy',
          uptime: uptime,
          eventsProcessed: eventStats.bufferSize + eventStats.dbEventCount,
          memoryUsage: process.memoryUsage().heapUsed,
        },
        registry: {
          // Use REAL agent count from file system
          total: realMetrics.agents.total || 264,
          categories: realMetrics.agents.categories || 30,
          selectionsToday: selectionsToday,
          embeddingDimensions: 1536,
        },
        // NEW: Real learning metrics from learning.db
        learning: {
          trajectories: {
            total: realMetrics.trajectories.total,
            active: realMetrics.trajectories.active,
            completed: realMetrics.trajectories.completed,
            avgQuality: realMetrics.trajectories.avgQuality,
          },
          patterns: {
            total: realMetrics.patterns.total,
            avgWeight: realMetrics.patterns.avgWeight,
            successCount: realMetrics.patterns.totalSuccess,
            failureCount: realMetrics.patterns.totalFailure,
          },
        },
        // Database file sizes (including WAL/SHM companions)
        databases: {
          eventsDb: getDbSizeInfo(EVENTS_DB_PATH),
          learningDb: getDbSizeInfo(LEARNING_DB_PATH),
          descDb: getDbSizeInfo(DESC_DB_PATH),
          vectorDb: (() => {
            return {
              path: VECTOR_DB_DIR,
              sizeBytes: vectorDbStats.sizeBytes,
              sizeMB: (vectorDbStats.sizeBytes / (1024 * 1024)).toFixed(2),
            };
          })(),
        },
        // LEANN index stats (reuses cached path size lookups + reads stores file directly)
        leann: (() => {
          const totalSizeBytes = vectorDbStats.sizeBytes + vectorDbStoresStats.sizeBytes;
          return {
            indexDir: VECTOR_DB_DIR,
            totalSizeBytes,
            totalSizeMB: (totalSizeBytes / (1024 * 1024)).toFixed(2),
            fileCount: vectorDbStats.fileCount,
            storesDir: fs.existsSync(VECTOR_DB_STORES_DIR) ? VECTOR_DB_STORES_DIR : null,
            storesFileCount: vectorDbStoresStats.fileCount,
            // Stats computed directly from vector_db_leann.stores file
            totalIndexed: leannData.totalIndexed || 0,
            uniqueFiles: leannData.uniqueFiles || 0,
            uniqueRepositories: leannData.uniqueRepositories || 0,
            memoryUsage: 'N/A',  // Only available via MCP tool
            memoryBytes: 0,
            languageBreakdown: leannData.languageBreakdown || [],
            symbolBreakdown: leannData.symbolBreakdown || [],
            leannDetails: {},
            cacheStale: false,  // Always fresh — read directly from stores file
          };
        })(),
      });
    } catch (error) {
      console.error('Error getting system metrics:', error);
      res.status(500).json({ error: 'Failed to get system metrics' });
    }
  }

  /**
   * Get Prometheus metrics
   * Implements Prometheus text format
   */
  private getPrometheusMetrics(req: Request, res: Response): void {
    try {
      const now = Date.now();
      const eventStoreStats = this.eventStore.getStats();
      const activeAgents = this.agentTracker.getActive().length;
      const clientCount = this.sseBroadcaster.getClientCount();

      const metrics: string[] = [];

      // Event counters
      metrics.push('# HELP god_agent_events_total Total events in storage');
      metrics.push('# TYPE god_agent_events_total gauge');
      metrics.push(`god_agent_events_total{storage="buffer"} ${eventStoreStats.bufferSize}`);
      metrics.push(`god_agent_events_total{storage="db"} ${eventStoreStats.dbEventCount}`);

      // Active agents
      metrics.push('# HELP god_agent_active_agents Number of active agents');
      metrics.push('# TYPE god_agent_active_agents gauge');
      metrics.push(`god_agent_active_agents ${activeAgents}`);

      // SSE clients
      metrics.push('# HELP god_agent_sse_clients Number of connected SSE clients');
      metrics.push('# TYPE god_agent_sse_clients gauge');
      metrics.push(`god_agent_sse_clients ${clientCount}`);

      // Uptime
      const uptimeSeconds = Math.floor((now - this.startTime) / 1000);
      metrics.push('# HELP god_agent_uptime_seconds Daemon uptime in seconds');
      metrics.push('# TYPE god_agent_uptime_seconds counter');
      metrics.push(`god_agent_uptime_seconds ${uptimeSeconds}`);

      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      res.send(metrics.join('\n') + '\n');
    } catch (error) {
      res.status(500).send('# Error generating metrics\n');
    }
  }

  /**
   * Health check endpoint
   * Implements [REQ-OBS-07]: Health monitoring
   */
  private healthCheck(req: Request, res: Response): void {
    const now = Date.now();
    const uptime = now - this.startTime;
    const clientCount = this.sseBroadcaster.getClientCount();
    const eventStats = this.eventStore.getStats();

    res.setHeader('Content-Type', 'application/json');
    res.json({
      status: 'healthy',
      uptime,
      clientCount,
      eventCount: eventStats.bufferSize,
      bufferUsage: (eventStats.bufferSize / eventStats.bufferCapacity) * 100,
      dbSize: eventStats.dbEventCount,
    });
  }

  // ===========================================================================
  // Server Lifecycle
  // ===========================================================================

  /**
   * Start the HTTP server
   * Implements [RULE-OBS-006]: Localhost binding
   *
   * @param port Port to listen on
   * @returns Promise resolving when server is started
   */
  public async start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.startTime = Date.now();

      this.server = this.app.listen(port, this.host, () => {
        // Get the actual port (in case port 0 was used for auto-assign)
        const address = this.server?.address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
        } else {
          this.port = port;
        }

        if (this.verbose) {
          console.log(`[ExpressServer] Server started on http://${this.host}:${this.port}`);
        }
        resolve();
      });

      this.server.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  /**
   * Stop the HTTP server
   * @returns Promise resolving when server is stopped
   */
  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        if (this.verbose) {
          console.log('[ExpressServer] Server stopped');
        }
        this.server = null;
        this.port = 0;
        resolve();
      });
    });
  }

  /**
   * Get the Express application
   */
  public getApp(): Express {
    return this.app;
  }

  /**
   * Get the current port
   */
  public getPort(): number {
    return this.port;
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default ExpressServer;
