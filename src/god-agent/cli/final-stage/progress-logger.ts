/**
 * ProgressLogger - Comprehensive progress reporting and logging for Phase 8
 *
 * Implements SPEC-FUNC-001 Section 4.3 (GAP-H004)
 * Constitution: EX-004 (Progress Reporting Requirement)
 *
 * Features:
 * - Multiple callback support
 * - Structured logging with levels (DEBUG, INFO, WARN, ERROR)
 * - Phase timing tracking
 * - Elapsed/remaining time estimation
 * - File-based logging (optional)
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { ProgressReport, FinalStageState } from './types.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel as ObsLogLevel } from '../../core/observability/index.js';

const internalLogger = createComponentLogger('ProgressLogger', {
  minLevel: ObsLogLevel.WARN,
  handlers: [new ConsoleLogHandler({ useStderr: true })]
});

// ============================================
// Types
// ============================================

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  elapsed: string;
  level: LogLevel;
  phase: FinalStageState;
  message: string;
  data?: Record<string, unknown>;
}

export type ProgressCallback = (report: ProgressReport) => void;

/**
 * Progress milestones for overall progress calculation
 * Per SPEC-FUNC-001 Section 4.3
 */
export const PROGRESS_MILESTONES: Record<FinalStageState, { start: number; end: number }> = {
  'IDLE': { start: 0, end: 0 },
  'INITIALIZING': { start: 0, end: 5 },
  'SCANNING': { start: 5, end: 15 },
  'SUMMARIZING': { start: 15, end: 40 },
  'MAPPING': { start: 40, end: 50 },
  'WRITING': { start: 50, end: 90 },
  'COMBINING': { start: 90, end: 95 },
  'VALIDATING': { start: 95, end: 100 },
  'COMPLETED': { start: 100, end: 100 },
  'FAILED': { start: 0, end: 0 }
};

// ============================================
// ProgressLogger Class
// ============================================

/**
 * ProgressLogger manages progress reporting and structured logging
 *
 * Usage:
 *   const logger = new ProgressLogger({ verbose: true, outputDir: _outputDir: './final' });
 *   logger.onProgress((report) => console.log(report));
 *   logger.log('INFO', 'SCANNING', 'Found 45 files');
 *   logger.emitProgress({ phase: 'SCANNING', message: 'Found 45 files', ... });
 */
export class ProgressLogger {
  // ============================================
  // Private Fields
  // ============================================

  private readonly verbose: boolean;
  private readonly _outputDir: string | null;
  private readonly startTime: number;
  private readonly progressCallbacks: ProgressCallback[] = [];
  private readonly phaseTimings: Map<string, { start: number; end?: number }> = new Map();
  private logFileHandle: fs.FileHandle | null = null;
  private currentPhase: FinalStageState = 'IDLE';
  private lastPhaseProgress: number = 0;

  // ============================================
  // Constructor
  // ============================================

  /**
   * Create a new ProgressLogger
   *
   * @param options - Configuration options
   * @param options.verbose - Enable verbose console output
   * @param options.outputDir - Directory for log file (null to disable file logging)
   */
  constructor(options: { verbose?: boolean; outputDir?: string | null } = {}) {
    this.verbose = options.verbose ?? false;
    // outputDir is stored for potential future use (file logging path)
    this._outputDir = options.outputDir ?? null;
    this.startTime = Date.now();
  }

  // ============================================
  // Public Methods: Callback Management
  // ============================================

  /**
   * Register a progress callback
   * Multiple callbacks can be registered
   *
   * @param callback - Function to receive progress reports
   */
  onProgress(callback: ProgressCallback): void {
    this.progressCallbacks.push(callback);
  }

  /**
   * Remove a progress callback
   *
   * @param callback - Callback to remove
   */
  offProgress(callback: ProgressCallback): void {
    const index = this.progressCallbacks.indexOf(callback);
    if (index !== -1) {
      this.progressCallbacks.splice(index, 1);
    }
  }

  /**
   * Clear all progress callbacks
   */
  clearCallbacks(): void {
    this.progressCallbacks.length = 0;
  }

  // ============================================
  // Public Methods: Progress Emission
  // ============================================

  /**
   * Emit progress to all registered callbacks
   * Per EX-004: Progress reporting hooks
   *
   * @param report - Progress report to emit
   */
  emitProgress(report: ProgressReport): void {
    // Update internal state
    this.currentPhase = report.phase as FinalStageState;
    if (report.current >= 0 && report.total > 0) {
      this.lastPhaseProgress = (report.current / report.total) * 100;
    }

    // Emit to all callbacks
    for (const callback of this.progressCallbacks) {
      try {
        callback(report);
      } catch (error) {
        // Don't let callback errors break execution
        // Log to internal logger if verbose, but don't throw
        if (this.verbose) {
          internalLogger.error('Callback error', error instanceof Error ? error : new Error(String(error)));
        }
      }
    }

    // Also log to file if enabled
    if (this.logFileHandle) {
      this.writeToLogFile('INFO', report.phase as FinalStageState, report.message);
    }
  }

  /**
   * Create and emit a progress report with calculated values
   *
   * @param phase - Current phase
   * @param message - Human-readable message
   * @param current - Current item index (-1 if not applicable)
   * @param total - Total items (-1 if not applicable)
   */
  report(
    phase: FinalStageState,
    message: string,
    current: number = -1,
    total: number = -1
  ): void {
    const report: ProgressReport = {
      phase,
      message,
      current,
      total,
      elapsedMs: this.getElapsedMs()
    };

    this.emitProgress(report);
  }

  // ============================================
  // Public Methods: Logging
  // ============================================

  /**
   * Log a structured message
   * Per EX-003: Log all state transitions
   *
   * @param level - Log level
   * @param phase - Current phase
   * @param message - Log message
   * @param data - Additional structured data
   */
  log(
    level: LogLevel,
    phase: FinalStageState,
    message: string,
    data?: Record<string, unknown>
  ): void {
    // Skip DEBUG in non-verbose mode
    if (!this.verbose && level === 'DEBUG') {
      return;
    }

    const entry = this.createLogEntry(level, phase, message, data);

    // Console output
    this.writeToConsole(entry);

    // File output (async, fire-and-forget)
    if (this.logFileHandle) {
      this.writeToLogFile(level, phase, message, data);
    }
  }

  /**
   * Convenience method for DEBUG level
   */
  debug(phase: FinalStageState, message: string, data?: Record<string, unknown>): void {
    this.log('DEBUG', phase, message, data);
  }

  /**
   * Convenience method for INFO level
   */
  info(phase: FinalStageState, message: string, data?: Record<string, unknown>): void {
    this.log('INFO', phase, message, data);
  }

  /**
   * Convenience method for WARN level
   */
  warn(phase: FinalStageState, message: string, data?: Record<string, unknown>): void {
    this.log('WARN', phase, message, data);
  }

  /**
   * Convenience method for ERROR level
   */
  error(phase: FinalStageState, message: string, data?: Record<string, unknown>): void {
    this.log('ERROR', phase, message, data);
  }

  // ============================================
  // Public Methods: Phase Timing
  // ============================================

  /**
   * Start timing a phase
   *
   * @param phase - Phase name
   */
  startPhase(phase: FinalStageState): void {
    this.phaseTimings.set(phase, { start: Date.now() });
    this.currentPhase = phase;
    this.lastPhaseProgress = 0;

    // Log state transition per EX-003
    this.log('INFO', phase, `Phase started: ${phase}`);
  }

  /**
   * End timing for a phase
   *
   * @param phase - Phase name
   */
  endPhase(phase: FinalStageState): void {
    const timing = this.phaseTimings.get(phase);
    if (timing) {
      timing.end = Date.now();
      const duration = timing.end - timing.start;
      this.log('INFO', phase, `Phase completed: ${phase}`, { durationMs: duration });
    }
  }

  /**
   * Get timing for a specific phase
   *
   * @param phase - Phase name
   * @returns Duration in milliseconds, or -1 if not available
   */
  getPhaseDuration(phase: FinalStageState): number {
    const timing = this.phaseTimings.get(phase);
    if (!timing) return -1;
    const end = timing.end ?? Date.now();
    return end - timing.start;
  }

  /**
   * Get all phase timings
   *
   * @returns Record of phase names to duration in milliseconds
   */
  getPhaseTimings(): Record<string, number> {
    const result: Record<string, number> = {};
    const entries = Array.from(this.phaseTimings.entries());
    for (const [phase, timing] of entries) {
      const end = timing.end ?? Date.now();
      result[`${phase}_duration`] = end - timing.start;
      result[`${phase}_start`] = timing.start;
      if (timing.end) {
        result[`${phase}_end`] = timing.end;
      }
    }
    return result;
  }

  // ============================================
  // Public Methods: Time Calculation
  // ============================================

  /**
   * Get elapsed time in milliseconds since logger creation
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get elapsed time formatted as human-readable string
   */
  getElapsedFormatted(): string {
    return this.formatDuration(this.getElapsedMs());
  }

  /**
   * Estimate remaining time based on current progress
   *
   * @param phaseProgress - Progress within current phase (0-100)
   * @returns Estimated remaining milliseconds, or -1 if unknown
   */
  estimateRemaining(phaseProgress: number = this.lastPhaseProgress): number {
    if (phaseProgress <= 0) return -1;

    const milestone = PROGRESS_MILESTONES[this.currentPhase];
    if (!milestone) return -1;

    // Calculate overall progress
    const phaseRange = milestone.end - milestone.start;
    const overallProgress = milestone.start + (phaseRange * (phaseProgress / 100));

    if (overallProgress <= 0) return -1;

    // Linear extrapolation
    const elapsed = this.getElapsedMs();
    const estimated = (elapsed / overallProgress) * (100 - overallProgress);

    return Math.round(estimated);
  }

  /**
   * Calculate overall progress percentage
   *
   * @param phaseProgress - Progress within current phase (0-100)
   * @returns Overall progress (0-100)
   */
  calculateOverallProgress(phaseProgress: number = this.lastPhaseProgress): number {
    const milestone = PROGRESS_MILESTONES[this.currentPhase];
    if (!milestone) return 0;

    const phaseRange = milestone.end - milestone.start;
    return milestone.start + (phaseRange * (phaseProgress / 100));
  }

  // ============================================
  // Public Methods: File Logging
  // ============================================

  /**
   * Initialize file logging
   *
   * @param outputDir - Directory for log file
   */
  async initFileLogging(outputDir: string): Promise<void> {
    try {
      await fs.mkdir(outputDir, { recursive: true });
      const logPath = path.join(outputDir, 'execution.log');
      this.logFileHandle = await fs.open(logPath, 'a');

      // Write header
      const header = `\n${'='.repeat(60)}\nPhase 8 Execution Log - ${new Date().toISOString()}\n${'='.repeat(60)}\n\n`;
      await this.logFileHandle.write(header);
    } catch (error) {
      // Non-fatal - continue without file logging
      if (this.verbose) {
        internalLogger.error('Could not initialize file logging', error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Close file logging handle
   */
  async close(): Promise<void> {
    if (this.logFileHandle) {
      try {
        // Write summary before closing
        const summary = this.generateSummary();
        await this.logFileHandle.write(`\n${summary}\n`);
        await this.logFileHandle.close();
      } catch {
        // INTENTIONAL: Log file close errors are non-critical during shutdown
      }
      this.logFileHandle = null;
    }
  }

  // ============================================
  // Public Methods: Summary
  // ============================================

  /**
   * Generate execution summary
   *
   * @returns Formatted summary string
   */
  generateSummary(): string {
    const lines: string[] = [
      '='.repeat(60),
      'Execution Summary',
      '='.repeat(60),
      '',
      `Total elapsed: ${this.getElapsedFormatted()}`,
      '',
      'Phase Timings:'
    ];

    const entries = Array.from(this.phaseTimings.entries());
    for (const [phase, timing] of entries) {
      const duration = timing.end ? timing.end - timing.start : Date.now() - timing.start;
      const status = timing.end ? 'completed' : 'in progress';
      lines.push(`  ${phase}: ${this.formatDuration(duration)} (${status})`);
    }

    lines.push('');
    lines.push('='.repeat(60));

    return lines.join('\n');
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Create a structured log entry
   */
  private createLogEntry(
    level: LogLevel,
    phase: FinalStageState,
    message: string,
    data?: Record<string, unknown>
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      elapsed: this.getElapsedFormatted(),
      level,
      phase,
      message,
      data
    };
  }

  /**
   * Write log entry to console
   */
  private writeToConsole(entry: LogEntry): void {
    const prefix = `[${entry.timestamp}] [${entry.elapsed}] [${entry.level}] [${entry.phase}]`;
    const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';

    if (entry.level === 'ERROR') {
      console.error(`${prefix} ${entry.message}${dataStr}`);
    } else if (entry.level === 'WARN') {
      console.warn(`${prefix} ${entry.message}${dataStr}`);
    } else {
      console.log(`${prefix} ${entry.message}${dataStr}`);
    }
  }

  /**
   * Write to log file (async)
   */
  private async writeToLogFile(
    level: LogLevel,
    phase: FinalStageState,
    message: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    if (!this.logFileHandle) return;

    try {
      const entry = this.createLogEntry(level, phase, message, data);
      const line = JSON.stringify(entry) + '\n';
      await this.logFileHandle.write(line);
    } catch {
      // INTENTIONAL: Log file write errors are non-critical - logging is best-effort
    }
  }

  /**
   * Format duration as human-readable string
   */
  private formatDuration(ms: number): string {
    if (ms < 0) return 'unknown';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else if (seconds > 0) {
      return `${seconds}s`;
    } else {
      return `${ms}ms`;
    }
  }
}

// ============================================
// Default Export
// ============================================

export default ProgressLogger;
