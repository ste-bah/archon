/**
 * UCM Compaction Detector
 * RULE-059: Detect Claude Code compaction events
 *
 * Detects when Claude Code has compacted the conversation context,
 * triggering recovery mechanisms to reconstruct lost state.
 */

import type { ICompactionDetector } from '../types.js';
import { CompactionDetectionError } from '../errors.js';

/**
 * Detection markers that indicate compaction has occurred
 */
const COMPACTION_MARKERS = [
  'This session is being continued from a previous conversation',
  'conversation is summarized below',
  'ran out of context',
  'context window limit',
  'conversation has been compacted',
  'previous messages have been summarized',
  'continuing from a previous session',
  'context has been compressed',
  'earlier conversation history',
  'session continuation detected'
] as const;

/**
 * Compaction detection state
 */
interface ICompactionState {
  detected: boolean;
  timestamp: number;
  marker: string | null;
  confidence: number;
  recoveryMode: boolean;
}

/**
 * CompactionDetector Implementation
 *
 * Monitors system messages and user inputs for compaction indicators.
 * Maintains detection state and triggers recovery workflows.
 */
export class CompactionDetector implements ICompactionDetector {
  private state: ICompactionState = {
    detected: false,
    timestamp: 0,
    marker: null,
    confidence: 0,
    recoveryMode: false
  };

  private detectionHistory: Array<{
    timestamp: number;
    marker: string;
    confidence: number;
  }> = [];

  /**
   * Detect compaction in a message
   *
   * @param message - Message to analyze
   * @returns True if compaction detected
   */
  public detectCompaction(message: string): boolean {
    try {
      const normalizedMessage = message.toLowerCase();

      // Check for exact marker matches
      for (const marker of COMPACTION_MARKERS) {
        if (normalizedMessage.includes(marker.toLowerCase())) {
          this.recordDetection(marker, 1.0);
          return true;
        }
      }

      // Check for partial matches with lower confidence
      const partialMatches = this.detectPartialMatches(normalizedMessage);
      if (partialMatches.confidence > 0.7) {
        this.recordDetection(partialMatches.marker, partialMatches.confidence);
        return true;
      }

      return false;
    } catch (error) {
      throw new CompactionDetectionError(error as Error);
    }
  }

  /**
   * Get timestamp of last compaction detection
   *
   * @returns Timestamp in milliseconds, or 0 if never detected
   */
  public getCompactionTimestamp(): number {
    return this.state.timestamp;
  }

  /**
   * Check if currently in recovery mode
   *
   * @returns True if in recovery mode
   */
  public isInRecoveryMode(): boolean {
    return this.state.recoveryMode;
  }

  /**
   * Set recovery mode state
   *
   * @param enabled - Enable or disable recovery mode
   */
  public setRecoveryMode(enabled: boolean): void {
    this.state.recoveryMode = enabled;
  }

  /**
   * Get current detection state
   *
   * @returns Current compaction state
   */
  public getState(): Readonly<ICompactionState> {
    return { ...this.state };
  }

  /**
   * Get detection history
   *
   * @returns Array of past detections
   */
  public getHistory(): ReadonlyArray<Readonly<typeof this.detectionHistory[0]>> {
    return [...this.detectionHistory];
  }

  /**
   * Reset detection state
   */
  public reset(): void {
    this.state = {
      detected: false,
      timestamp: 0,
      marker: null,
      confidence: 0,
      recoveryMode: false
    };
  }

  /**
   * Record a compaction detection
   */
  private recordDetection(marker: string, confidence: number): void {
    const timestamp = Date.now();

    this.state = {
      detected: true,
      timestamp,
      marker,
      confidence,
      recoveryMode: true
    };

    this.detectionHistory.push({
      timestamp,
      marker,
      confidence
    });

    // Keep only last 10 detections
    if (this.detectionHistory.length > 10) {
      this.detectionHistory.shift();
    }
  }

  /**
   * Detect partial matches with confidence scoring
   */
  private detectPartialMatches(message: string): { marker: string; confidence: number } {
    const keywords = [
      'session',
      'continued',
      'previous',
      'conversation',
      'summarized',
      'context',
      'compacted',
      'compressed'
    ];

    let matchCount = 0;
    for (const keyword of keywords) {
      if (message.includes(keyword)) {
        matchCount++;
      }
    }

    const confidence = matchCount / keywords.length;
    const marker = `Partial match: ${matchCount}/${keywords.length} keywords`;

    return { marker, confidence };
  }

  /**
   * Check if detection is recent (within threshold)
   *
   * @param thresholdMs - Threshold in milliseconds (default: 5 minutes)
   * @returns True if detection is recent
   */
  public isRecentDetection(thresholdMs: number = 5 * 60 * 1000): boolean {
    if (!this.state.detected) {
      return false;
    }

    const elapsed = Date.now() - this.state.timestamp;
    return elapsed <= thresholdMs;
  }

  /**
   * Get detection confidence
   *
   * @returns Confidence score (0-1)
   */
  public getConfidence(): number {
    return this.state.confidence;
  }
}

/**
 * Create a new CompactionDetector instance
 */
export function createCompactionDetector(): ICompactionDetector {
  return new CompactionDetector();
}
