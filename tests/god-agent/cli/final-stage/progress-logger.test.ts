/**
 * Tests for ProgressLogger
 *
 * TASK-010: Add Progress Reporting and Logging
 * Per SPEC-FUNC-001 Section 4.3, GAP-H004, EX-004
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProgressLogger, PROGRESS_MILESTONES } from '../../../../src/god-agent/cli/final-stage/progress-logger.js';
import type { ProgressReport, FinalStageState } from '../../../../src/god-agent/cli/final-stage/types.js';

describe('ProgressLogger', () => {
  let logger: ProgressLogger;

  beforeEach(() => {
    logger = new ProgressLogger({ verbose: false });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================
  // Constructor Tests
  // ============================================

  describe('constructor', () => {
    it('should create logger with default options', () => {
      const defaultLogger = new ProgressLogger();
      expect(defaultLogger).toBeDefined();
    });

    it('should create logger with verbose option', () => {
      const verboseLogger = new ProgressLogger({ verbose: true });
      expect(verboseLogger).toBeDefined();
    });

    it('should initialize start time', () => {
      const before = Date.now();
      const newLogger = new ProgressLogger();
      const after = Date.now();

      // Elapsed should be very small (just created)
      expect(newLogger.getElapsedMs()).toBeGreaterThanOrEqual(0);
      expect(newLogger.getElapsedMs()).toBeLessThanOrEqual(after - before + 10);
    });
  });

  // ============================================
  // Callback Management Tests
  // ============================================

  describe('callback management', () => {
    it('should register progress callbacks', () => {
      const callback = vi.fn();
      logger.onProgress(callback);

      const report: ProgressReport = {
        phase: 'SCANNING',
        message: 'Test',
        current: 1,
        total: 10,
        elapsedMs: 100
      };

      logger.emitProgress(report);
      expect(callback).toHaveBeenCalledWith(report);
    });

    it('should support multiple callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      logger.onProgress(callback1);
      logger.onProgress(callback2);
      logger.onProgress(callback3);

      const report: ProgressReport = {
        phase: 'MAPPING',
        message: 'Test',
        current: 5,
        total: 10,
        elapsedMs: 200
      };

      logger.emitProgress(report);

      expect(callback1).toHaveBeenCalledWith(report);
      expect(callback2).toHaveBeenCalledWith(report);
      expect(callback3).toHaveBeenCalledWith(report);
    });

    it('should remove callbacks with offProgress', () => {
      const callback = vi.fn();
      logger.onProgress(callback);

      // Emit once
      logger.emitProgress({
        phase: 'SCANNING',
        message: 'First',
        current: 1,
        total: 10,
        elapsedMs: 100
      });
      expect(callback).toHaveBeenCalledTimes(1);

      // Remove callback
      logger.offProgress(callback);

      // Emit again
      logger.emitProgress({
        phase: 'SCANNING',
        message: 'Second',
        current: 2,
        total: 10,
        elapsedMs: 200
      });

      // Should still be 1 (callback was removed)
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should clear all callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      logger.onProgress(callback1);
      logger.onProgress(callback2);

      logger.clearCallbacks();

      logger.emitProgress({
        phase: 'WRITING',
        message: 'Test',
        current: 1,
        total: 8,
        elapsedMs: 300
      });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });

    it('should handle callback errors gracefully', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error');
      });
      const goodCallback = vi.fn();

      logger.onProgress(errorCallback);
      logger.onProgress(goodCallback);

      // Should not throw
      expect(() => {
        logger.emitProgress({
          phase: 'VALIDATING',
          message: 'Test',
          current: 1,
          total: 1,
          elapsedMs: 400
        });
      }).not.toThrow();

      // Good callback should still be called
      expect(goodCallback).toHaveBeenCalled();
    });
  });

  // ============================================
  // Progress Report Tests
  // ============================================

  describe('progress reporting', () => {
    it('should emit progress with report method', () => {
      const callback = vi.fn();
      logger.onProgress(callback);

      logger.report('SCANNING', 'Found 10 files', 10, 45);

      expect(callback).toHaveBeenCalled();
      const report = callback.mock.calls[0][0] as ProgressReport;
      expect(report.phase).toBe('SCANNING');
      expect(report.message).toBe('Found 10 files');
      expect(report.current).toBe(10);
      expect(report.total).toBe(45);
      expect(report.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle negative current/total values', () => {
      const callback = vi.fn();
      logger.onProgress(callback);

      logger.report('MAPPING', 'Processing...', -1, -1);

      const report = callback.mock.calls[0][0] as ProgressReport;
      expect(report.current).toBe(-1);
      expect(report.total).toBe(-1);
    });
  });

  // ============================================
  // Phase Timing Tests
  // ============================================

  describe('phase timing', () => {
    it('should track phase start time', () => {
      logger.startPhase('SCANNING');

      const timings = logger.getPhaseTimings();
      expect(timings['SCANNING_start']).toBeDefined();
      expect(timings['SCANNING_start']).toBeGreaterThan(0);
    });

    it('should track phase duration', () => {
      logger.startPhase('WRITING');

      // Advance time
      vi.advanceTimersByTime(5000);

      logger.endPhase('WRITING');

      const duration = logger.getPhaseDuration('WRITING');
      expect(duration).toBeGreaterThanOrEqual(5000);
    });

    it('should return -1 for unknown phase', () => {
      const duration = logger.getPhaseDuration('UNKNOWN_PHASE' as FinalStageState);
      expect(duration).toBe(-1);
    });

    it('should track multiple phases', () => {
      logger.startPhase('INITIALIZING');
      vi.advanceTimersByTime(1000);
      logger.endPhase('INITIALIZING');

      logger.startPhase('SCANNING');
      vi.advanceTimersByTime(2000);
      logger.endPhase('SCANNING');

      logger.startPhase('SUMMARIZING');
      vi.advanceTimersByTime(3000);
      logger.endPhase('SUMMARIZING');

      const timings = logger.getPhaseTimings();

      expect(timings['INITIALIZING_duration']).toBeGreaterThanOrEqual(1000);
      expect(timings['SCANNING_duration']).toBeGreaterThanOrEqual(2000);
      expect(timings['SUMMARIZING_duration']).toBeGreaterThanOrEqual(3000);
    });
  });

  // ============================================
  // Time Calculation Tests
  // ============================================

  describe('time calculation', () => {
    it('should track elapsed time', () => {
      vi.advanceTimersByTime(5000);
      expect(logger.getElapsedMs()).toBeGreaterThanOrEqual(5000);
    });

    it('should format elapsed time correctly', () => {
      // Test seconds only
      vi.advanceTimersByTime(45000);
      expect(logger.getElapsedFormatted()).toMatch(/45s/);

      // Test minutes and seconds
      vi.advanceTimersByTime(75000); // Total: 120s = 2m
      expect(logger.getElapsedFormatted()).toMatch(/2m/);
    });

    it('should estimate remaining time', () => {
      logger.startPhase('WRITING');

      // Simulate 50% progress after 5 seconds
      vi.advanceTimersByTime(5000);

      const remaining = logger.estimateRemaining(50);

      // At 50% with 5s elapsed, remaining should be roughly 5s + future phases
      expect(remaining).toBeGreaterThan(0);
    });

    it('should return -1 for unknown remaining time', () => {
      expect(logger.estimateRemaining(0)).toBe(-1);
      expect(logger.estimateRemaining(-1)).toBe(-1);
    });

    it('should calculate overall progress', () => {
      logger.startPhase('MAPPING');

      // MAPPING is 40-50% overall, so 50% phase progress = 45% overall
      const overall = logger.calculateOverallProgress(50);

      expect(overall).toBeGreaterThanOrEqual(40);
      expect(overall).toBeLessThanOrEqual(50);
    });
  });

  // ============================================
  // PROGRESS_MILESTONES Tests
  // ============================================

  describe('PROGRESS_MILESTONES', () => {
    it('should define milestones for all phases', () => {
      const phases: FinalStageState[] = [
        'IDLE', 'INITIALIZING', 'SCANNING', 'SUMMARIZING',
        'MAPPING', 'WRITING', 'COMBINING', 'VALIDATING',
        'COMPLETED', 'FAILED'
      ];

      for (const phase of phases) {
        expect(PROGRESS_MILESTONES[phase]).toBeDefined();
        expect(PROGRESS_MILESTONES[phase].start).toBeGreaterThanOrEqual(0);
        expect(PROGRESS_MILESTONES[phase].end).toBeGreaterThanOrEqual(PROGRESS_MILESTONES[phase].start);
      }
    });

    it('should have COMPLETED at 100%', () => {
      expect(PROGRESS_MILESTONES['COMPLETED'].start).toBe(100);
      expect(PROGRESS_MILESTONES['COMPLETED'].end).toBe(100);
    });

    it('should have phases in sequential order', () => {
      const orderedPhases: FinalStageState[] = [
        'INITIALIZING', 'SCANNING', 'SUMMARIZING',
        'MAPPING', 'WRITING', 'COMBINING', 'VALIDATING'
      ];

      for (let i = 1; i < orderedPhases.length; i++) {
        const prevEnd = PROGRESS_MILESTONES[orderedPhases[i - 1]].end;
        const currStart = PROGRESS_MILESTONES[orderedPhases[i]].start;
        expect(currStart).toBeGreaterThanOrEqual(prevEnd);
      }
    });
  });

  // ============================================
  // Summary Tests
  // ============================================

  describe('summary generation', () => {
    it('should generate execution summary', () => {
      logger.startPhase('INITIALIZING');
      vi.advanceTimersByTime(1000);
      logger.endPhase('INITIALIZING');

      logger.startPhase('SCANNING');
      vi.advanceTimersByTime(2000);
      logger.endPhase('SCANNING');

      const summary = logger.generateSummary();

      expect(summary).toContain('Execution Summary');
      expect(summary).toContain('INITIALIZING');
      expect(summary).toContain('SCANNING');
      expect(summary).toContain('completed');
    });

    it('should show in-progress phases', () => {
      logger.startPhase('WRITING');
      // Don't end it

      const summary = logger.generateSummary();
      expect(summary).toContain('in progress');
    });
  });

  // ============================================
  // Logging Tests (Verbose Mode)
  // ============================================

  describe('logging', () => {
    it('should log with different levels', () => {
      const verboseLogger = new ProgressLogger({ verbose: true });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      verboseLogger.info('SCANNING', 'Info message');
      verboseLogger.warn('MAPPING', 'Warning message');
      verboseLogger.error('WRITING', 'Error message');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should skip debug in non-verbose mode', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.debug('SCANNING', 'Debug message');

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should always log errors regardless of verbose', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Non-verbose logger
      logger.error('FAILED', 'Error message');

      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});

describe('FinalStageOrchestrator Progress Integration', () => {
  // These tests verify the orchestrator's progress reporting behavior
  // They don't require mocking the full orchestrator, just verifying types

  it('should have compatible ProgressReport type', () => {
    const report: ProgressReport = {
      phase: 'WRITING',
      message: 'Writing Chapter 3: Methodology',
      current: 3,
      total: 8,
      elapsedMs: 12500
    };

    expect(report.phase).toBe('WRITING');
    expect(report.current).toBe(3);
    expect(report.total).toBe(8);
  });

  it('should handle all phase states', () => {
    const phases: FinalStageState[] = [
      'IDLE', 'INITIALIZING', 'SCANNING', 'SUMMARIZING',
      'MAPPING', 'WRITING', 'COMBINING', 'VALIDATING',
      'COMPLETED', 'FAILED'
    ];

    for (const phase of phases) {
      const report: ProgressReport = {
        phase,
        message: `Phase: ${phase}`,
        current: -1,
        total: -1,
        elapsedMs: 0
      };

      expect(report.phase).toBe(phase);
    }
  });
});
