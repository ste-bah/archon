/**
 * DAI-003: Intelligent Task Routing - Confirmation Handler
 *
 * TASK-010: Confirmation Handler
 * Constitution: RULE-DAI-003-003 (Low confidence MUST require confirmation with graduated thresholds)
 *
 * Handles low-confidence routing decisions with user confirmation flow.
 * Implements graduated thresholds:
 * - >= 0.9: Auto-execute (no confirmation)
 * - 0.7-0.9: Show decision, 5s timeout, proceed automatically
 * - 0.5-0.7: REQUIRE explicit confirmation
 * - < 0.5: REQUIRE user selection from top 5 agents
 *
 * @module src/god-agent/core/routing/confirmation-handler
 */

import type {
  IConfirmationHandler,
  IConfirmationRequest,
  IConfirmationOption,
  IConfirmationResponse,
  IRoutingResult,
  IRoutingConfig,
} from './routing-types.js';
import { DEFAULT_ROUTING_CONFIG } from './routing-types.js';

// ==================== Configuration ====================

/**
 * Confirmation handler configuration
 */
export interface IConfirmationHandlerConfig {
  /** Routing configuration (optional, uses defaults) */
  routingConfig?: Partial<IRoutingConfig>;

  /** Timeout for 'show' level in milliseconds (default: 5000) */
  showTimeoutMs?: number;

  /** Timeout for 'confirm' level in milliseconds (default: 0 = no timeout) */
  confirmTimeoutMs?: number;

  /** Timeout for 'select' level in milliseconds (default: 0 = no timeout) */
  selectTimeoutMs?: number;

  /** Callback when user overrides recommended agent */
  onUserOverride?: (routingId: string, originalAgent: string, selectedAgent: string) => void;

  /** Enable verbose logging */
  verbose?: boolean;
}

// ==================== Confirmation Handler ====================

/**
 * Confirmation handler implementation
 * Handles low-confidence routing decisions with user confirmation
 */
export class ConfirmationHandler implements IConfirmationHandler {
  private readonly config: Required<IConfirmationHandlerConfig>;
  private readonly routingConfig: IRoutingConfig;

  constructor(config: IConfirmationHandlerConfig = {}) {
    // Merge with defaults
    this.routingConfig = {
      ...DEFAULT_ROUTING_CONFIG,
      ...config.routingConfig,
    };

    this.config = {
      routingConfig: this.routingConfig,
      showTimeoutMs: config.showTimeoutMs ?? 5000,
      confirmTimeoutMs: config.confirmTimeoutMs ?? 0,
      selectTimeoutMs: config.selectTimeoutMs ?? 0,
      onUserOverride: config.onUserOverride ?? (() => {}),
      verbose: config.verbose ?? false,
    };

    if (this.config.verbose) {
      console.log('[ConfirmationHandler] Initialized with config:', {
        showTimeoutMs: this.config.showTimeoutMs,
        confirmTimeoutMs: this.config.confirmTimeoutMs,
        selectTimeoutMs: this.config.selectTimeoutMs,
        autoExecuteThreshold: this.routingConfig.autoExecuteThreshold,
        showDecisionThreshold: this.routingConfig.showDecisionThreshold,
        confirmationThreshold: this.routingConfig.confirmationThreshold,
      });
    }
  }

  /**
   * Request confirmation from user based on routing confidence
   */
  async requestConfirmation(routing: IRoutingResult): Promise<IConfirmationResponse> {
    const request = this.createConfirmationRequest(routing);

    if (this.config.verbose) {
      console.log(`[ConfirmationHandler] Processing ${routing.confirmationLevel} level confirmation`);
      console.log(`[ConfirmationHandler] Confidence: ${routing.confidence}, Agent: ${routing.selectedAgentName}`);
    }

    switch (routing.confirmationLevel) {
      case 'auto':
        return this.handleAutoLevel(routing);

      case 'show':
        return this.handleShowLevel(request);

      case 'confirm':
        return this.handleConfirmLevel(request);

      case 'select':
        return this.handleSelectLevel(request);

      default:
        throw new Error(`Unknown confirmation level: ${routing.confirmationLevel}`);
    }
  }

  /**
   * Create confirmation request from routing result
   * Public for testing
   */
  createConfirmationRequest(routing: IRoutingResult): IConfirmationRequest {
    const options: IConfirmationOption[] = [];

    // Add selected agent as first option (recommended)
    options.push({
      key: routing.selectedAgent,
      label: `${routing.selectedAgentName} (recommended)`,
      score: routing.confidence,
      recommended: true,
    });

    // Add alternatives
    for (const alt of routing.alternatives) {
      options.push({
        key: alt.agentKey,
        label: alt.name,
        score: alt.score,
        recommended: false,
      });
    }

    // Add cancel option for confirm/select levels
    if (routing.confirmationLevel !== 'auto' && routing.confirmationLevel !== 'show') {
      options.push({
        key: 'cancel',
        label: 'Cancel',
        recommended: false,
      });
    }

    return {
      routingResult: routing,
      message: this.formatConfirmationMessage(routing),
      options,
      timeoutMs: this.getTimeoutForLevel(routing.confirmationLevel),
      defaultOption: routing.confirmationLevel === 'show' ? routing.selectedAgent : '',
    };
  }

  // ==================== Private Methods ====================

  /**
   * Handle auto-execute level (confidence >= 0.9)
   * Execute immediately, no confirmation
   */
  private handleAutoLevel(routing: IRoutingResult): IConfirmationResponse {
    if (this.config.verbose) {
      console.log('[ConfirmationHandler] Auto-executing without confirmation');
    }

    return {
      selectedKey: routing.selectedAgent,
      wasTimeout: false,
      wasCancelled: false,
      respondedAt: Date.now(),
    };
  }

  /**
   * Handle show level (confidence 0.7-0.9)
   * Show message, wait for timeout, proceed automatically
   */
  private async handleShowLevel(request: IConfirmationRequest): Promise<IConfirmationResponse> {
    if (this.config.verbose) {
      console.log(`[ConfirmationHandler] Showing decision, timeout in ${request.timeoutMs}ms`);
      console.log(request.message);
    }

    // In production, this would show UI and wait for user response
    // For now, simulate timeout behavior
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.config.verbose) {
          console.log('[ConfirmationHandler] Timeout reached, proceeding with default');
        }

        resolve({
          selectedKey: request.defaultOption,
          wasTimeout: true,
          wasCancelled: false,
          respondedAt: Date.now(),
        });
      }, request.timeoutMs);

      // In real implementation, user response would:
      // 1. clearTimeout(timeout)
      // 2. resolve with selectedKey
      // 3. Call onUserOverride if different from recommendation
    });
  }

  /**
   * Handle confirm level (confidence 0.5-0.7)
   * REQUIRE explicit confirmation or alternative selection
   */
  private async handleConfirmLevel(request: IConfirmationRequest): Promise<IConfirmationResponse> {
    if (this.config.verbose) {
      console.log('[ConfirmationHandler] Requiring explicit confirmation');
      console.log(request.message);
    }

    // In production, this would:
    // 1. Show confirmation dialog
    // 2. Wait for explicit "yes" or alternative selection
    // 3. No timeout (must respond)
    // 4. Call onUserOverride if user selects different agent

    // For testing/simulation, return a promise that never resolves
    // (tests will inject response via mock)
    return new Promise((resolve) => {
      // Test injection point: tests can call resolve() with response
      if (this.config.verbose) {
        console.log('[ConfirmationHandler] Waiting for user confirmation...');
      }

      // In real implementation, this would be handled by UI callback
      // For now, provide a way for tests to inject response
      if (request.timeoutMs > 0) {
        setTimeout(() => {
          resolve({
            selectedKey: 'cancel',
            wasTimeout: true,
            wasCancelled: true,
            respondedAt: Date.now(),
          });
        }, request.timeoutMs);
      }
    });
  }

  /**
   * Handle select level (confidence < 0.5)
   * REQUIRE user to select from numbered list of options
   */
  private async handleSelectLevel(request: IConfirmationRequest): Promise<IConfirmationResponse> {
    if (this.config.verbose) {
      console.log('[ConfirmationHandler] Requiring agent selection from list');
      console.log(request.message);
    }

    // In production, this would:
    // 1. Show numbered list of agents
    // 2. Wait for user to select number or cancel
    // 3. No timeout (must respond)
    // 4. Call onUserOverride since user must choose

    // For testing/simulation, return a promise that never resolves
    // (tests will inject response via mock)
    return new Promise((resolve) => {
      if (this.config.verbose) {
        console.log('[ConfirmationHandler] Waiting for user selection...');
      }

      // In real implementation, this would be handled by UI callback
      // For now, provide a way for tests to inject response
      if (request.timeoutMs > 0) {
        setTimeout(() => {
          resolve({
            selectedKey: 'cancel',
            wasTimeout: true,
            wasCancelled: true,
            respondedAt: Date.now(),
          });
        }, request.timeoutMs);
      }
    });
  }

  /**
   * Format confirmation message based on routing result
   */
  private formatConfirmationMessage(routing: IRoutingResult): string {
    const lines: string[] = [];

    // Header with cold start indicator if applicable
    if (routing.isColdStart && routing.coldStartIndicator) {
      lines.push(routing.coldStartIndicator);
      lines.push('');
    }

    // Level-specific message
    const confidencePercent = (routing.confidence * 100).toFixed(0);

    switch (routing.confirmationLevel) {
      case 'show':
        lines.push(`Routing to ${routing.selectedAgentName} (${confidencePercent}% confident)`);
        lines.push(`Proceeding in ${this.config.showTimeoutMs / 1000} seconds...`);
        break;

      case 'confirm':
        lines.push(`Suggest: ${routing.selectedAgentName} (${confidencePercent}% confident)`);
        lines.push('Please confirm or select alternative:');
        break;

      case 'select':
        lines.push(`Low confidence (${confidencePercent}%)`);
        lines.push('Please select an agent:');
        break;
    }

    // Add explanation
    lines.push('');
    lines.push(`Reason: ${routing.explanation}`);

    // Add alternatives for select level
    if (routing.confirmationLevel === 'select') {
      lines.push('');
      lines.push('Options:');
      lines.push(`  1. ${routing.selectedAgentName} (${(routing.confidence * 100).toFixed(0)}%)`);

      routing.alternatives.forEach((alt, i) => {
        lines.push(`  ${i + 2}. ${alt.name} (${(alt.score * 100).toFixed(0)}%)`);
      });

      lines.push(`  ${routing.alternatives.length + 2}. Cancel`);
    }

    return lines.join('\n');
  }

  /**
   * Get timeout duration for confirmation level
   */
  private getTimeoutForLevel(level: 'auto' | 'show' | 'confirm' | 'select'): number {
    switch (level) {
      case 'auto':
        return 0; // No timeout, immediate

      case 'show':
        return this.config.showTimeoutMs;

      case 'confirm':
        return this.config.confirmTimeoutMs;

      case 'select':
        return this.config.selectTimeoutMs;

      default:
        return 0;
    }
  }

  /**
   * Log user override for learning
   */
  private logUserOverride(routingId: string, originalAgent: string, selectedAgent: string): void {
    if (selectedAgent !== originalAgent && selectedAgent !== 'cancel') {
      if (this.config.verbose) {
        console.log(`[ConfirmationHandler] User override: ${originalAgent} → ${selectedAgent}`);
      }

      this.config.onUserOverride(routingId, originalAgent, selectedAgent);
    }
  }

  /**
   * Process user response and return confirmation response
   * Public for testing - allows tests to simulate user input
   */
  async processUserResponse(
    request: IConfirmationRequest,
    selectedKey: string
  ): Promise<IConfirmationResponse> {
    // Log override if user selected different agent
    this.logUserOverride(
      request.routingResult.routingId,
      request.routingResult.selectedAgent,
      selectedKey
    );

    return {
      selectedKey,
      wasTimeout: false,
      wasCancelled: selectedKey === 'cancel',
      respondedAt: Date.now(),
    };
  }
}
