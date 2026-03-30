/**
 * DatabaseConnection - Unified SQLite connection for god-agent learning system
 *
 * Implements: REQ-DESC-007, GAP-DESC-007
 * Constitution: RULE-008, RULE-046, RULE-085
 *
 * Key features:
 * - WAL mode for concurrent access (RULE-046)
 * - Automatic schema initialization
 * - Singleton pattern with environment variable support (RULE-085)
 * - Health check and graceful shutdown
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Get directory of current module for schema resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Interface for database connection (RULE-067)
 */
export interface IDatabaseConnection {
  readonly db: Database.Database;
  prepare<BindParams extends unknown[] | {} = unknown[], Result = unknown>(
    sql: string
  ): Database.Statement<BindParams, Result>;
  transaction<T>(fn: () => T): T;
  close(): void;
  isHealthy(): boolean;
  checkpoint(): void;
}

/**
 * Database configuration options
 */
export interface DatabaseConfig {
  /** Path to SQLite database file */
  dbPath: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Memory limit for cache in bytes */
  cacheSize?: number;
}

/**
 * DatabaseConnection - Core database service
 *
 * Provides:
 * - Automatic schema initialization on first connection
 * - WAL mode for better concurrency
 * - Prepared statement caching via better-sqlite3
 * - Transaction support with automatic rollback on error
 */
export class DatabaseConnection implements IDatabaseConnection {
  public readonly db: Database.Database;
  private readonly schemaDir: string;
  private initialized: boolean = false;

  constructor(config: DatabaseConfig) {
    // Implements RULE-085: Use environment variables for paths
    const dbPath = config.dbPath ||
      process.env.GOD_AGENT_DB_PATH ||
      '.god-agent/learning.db';

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Open database with WAL mode (RULE-046)
    this.db = new Database(dbPath, {
      verbose: config.verbose ? console.log : undefined
    });

    // Configure for performance and reliability
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('cache_size = -64000'); // 64MB cache

    // Set schema directory
    this.schemaDir = join(__dirname, 'schemas');

    // Initialize schemas
    this.initializeSchemas();
  }

  /**
   * Initialize all database schemas
   * Implements: RULE-011, RULE-013, RULE-014 (SQLite storage)
   */
  private initializeSchemas(): void {
    if (this.initialized) return;

    const schemas = ['episodes.sql', 'patterns.sql', 'outcomes.sql'];

    for (const schemaFile of schemas) {
      const schemaPath = join(this.schemaDir, schemaFile);
      if (existsSync(schemaPath)) {
        const sql = readFileSync(schemaPath, 'utf-8');
        this.db.exec(sql);
      } else {
        console.warn(`Schema file not found: ${schemaPath}`);
      }
    }

    this.initialized = true;
  }

  /**
   * Prepare a SQL statement for execution
   */
  prepare<BindParams extends unknown[] | {} = unknown[], Result = unknown>(
    sql: string
  ): Database.Statement<BindParams, Result> {
    return this.db.prepare<BindParams, Result>(sql);
  }

  /**
   * Execute a function within a transaction
   * Implements: RULE-046 (atomic operations)
   */
  transaction<T>(fn: () => T): T {
    const txn = this.db.transaction(fn);
    return txn();
  }

  /**
   * Check if database connection is healthy
   */
  isHealthy(): boolean {
    try {
      const result = this.db.prepare('SELECT 1 as health').get() as { health: number };
      return result?.health === 1;
    } catch {
      return false;
    }
  }

  /**
   * Force WAL checkpoint (for flush operations)
   */
  checkpoint(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  /**
   * Close database connection gracefully
   */
  close(): void {
    if (this.db) {
      // Checkpoint before close
      this.checkpoint();
      this.db.close();
    }
  }

  /**
   * Get database statistics
   */
  getStats(): {
    episodeCount: number;
    patternCount: number;
    outcomeCount: number;
    feedbackCount: number;
  } {
    try {
      const episodeCount = (this.db.prepare('SELECT COUNT(*) as count FROM episodes').get() as { count: number })?.count || 0;
      const patternCount = (this.db.prepare('SELECT COUNT(*) as count FROM patterns').get() as { count: number })?.count || 0;
      const outcomeCount = (this.db.prepare('SELECT COUNT(*) as count FROM episode_outcomes').get() as { count: number })?.count || 0;
      const feedbackCount = (this.db.prepare('SELECT COUNT(*) as count FROM learning_feedback').get() as { count: number })?.count || 0;

      return { episodeCount, patternCount, outcomeCount, feedbackCount };
    } catch {
      return { episodeCount: 0, patternCount: 0, outcomeCount: 0, feedbackCount: 0 };
    }
  }
}

// ============================================================
// SINGLETON MANAGEMENT (RULE-008)
// ============================================================

let connectionInstance: DatabaseConnection | null = null;

/**
 * Get or create the singleton database connection
 * Implements: RULE-085 (environment variable support)
 *
 * @param dbPath - Optional path override (uses env or default if not provided)
 * @returns DatabaseConnection instance
 */
export function getDatabaseConnection(dbPath?: string): DatabaseConnection {
  if (!connectionInstance) {
    const path = dbPath ||
      process.env.GOD_AGENT_DB_PATH ||
      join(process.cwd(), '.god-agent', 'learning.db');

    connectionInstance = new DatabaseConnection({ dbPath: path });
  }
  return connectionInstance;
}

/**
 * Close and clear the singleton connection
 */
export function closeDatabaseConnection(): void {
  if (connectionInstance) {
    connectionInstance.close();
    connectionInstance = null;
  }
}

/**
 * Check if a connection exists
 */
export function hasConnection(): boolean {
  return connectionInstance !== null;
}

/**
 * Create a new connection (for testing, bypasses singleton)
 */
export function createConnection(config: DatabaseConfig): DatabaseConnection {
  return new DatabaseConnection(config);
}
