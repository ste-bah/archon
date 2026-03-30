/**
 * DAI-003: Intelligent Task Routing - Confirmation Handler Tests
 *
 * TASK-010: Confirmation Handler Tests
 * Tests all confirmation levels and behaviors
 *
 * @module tests/god-agent/core/routing/confirmation-handler.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfirmationHandler } from '../../../../src/god-agent/core/routing/confirmation-handler.js';
import type {
  IRoutingResult,
  IRoutingAlternative,
  IRoutingFactor,
  IConfirmationRequest,
  IConfirmationResponse,
} from '../../../../src/god-agent/core/routing/routing-types.js';

// ==================== Test Helpers ====================

function createMockRoutingResult(
  confidence: number,
  confirmationLevel: 'auto' | 'show' | 'confirm' | 'select',
  alternatives: IRoutingAlternative[] = []
): IRoutingResult {
  const factors: IRoutingFactor[] = [
    {
      name: 'capability_match',
      weight: 0.6,
      score: confidence,
      description: 'Capability embedding match',
    },
    {
      name: 'keyword_score',
      weight: 0.4,
      score: confidence * 0.9,
      description: 'Keyword match score',
    },
  ];

  return {
    selectedAgent: 'researcher',
    selectedAgentName: 'Researcher',
    confidence,
    usedPreference: false,
    coldStartPhase: 'learned',
    isColdStart: false,
    factors,
    explanation: `Selected Researcher based on ${(confidence * 100).toFixed(0)}% confidence match`,
    alternatives,
    requiresConfirmation: confirmationLevel !== 'auto',
    confirmationLevel,
    routedAt: Date.now(),
    routingTimeMs: 120,
    routingId: `routing_${Date.now()}`,
  };
}

function createAlternatives(): IRoutingAlternative[] {
  return [
    {
      agentKey: 'coder',
      name: 'Coder',
      score: 0.6,
      reason: 'Alternative implementation match',
    },
    {
      agentKey: 'tester',
      name: 'Tester',
      score: 0.5,
      reason: 'Quality assurance alternative',
    },
    {
      agentKey: 'reviewer',
      name: 'Reviewer',
      score: 0.4,
      reason: 'Code review alternative',
    },
  ];
}

// ==================== Initialization Tests ====================

describe('ConfirmationHandler - Initialization', () => {
  it('should create with default config', () => {
    const handler = new ConfirmationHandler();
    expect(handler).toBeDefined();
    expect(handler.createConfirmationRequest).toBeDefined();
  });

  it('should create with custom config', () => {
    const handler = new ConfirmationHandler({
      showTimeoutMs: 3000,
      confirmTimeoutMs: 10000,
      selectTimeoutMs: 15000,
      verbose: true,
    });

    expect(handler).toBeDefined();
  });

  it('should accept custom timeout values', () => {
    const handler = new ConfirmationHandler({
      showTimeoutMs: 2000,
      confirmTimeoutMs: 5000,
      selectTimeoutMs: 10000,
    });

    const showRouting = createMockRoutingResult(0.8, 'show');
    const request = handler.createConfirmationRequest(showRouting);

    expect(request.timeoutMs).toBe(2000);
  });

  it('should set onUserOverride callback', () => {
    const mockCallback = vi.fn();
    const handler = new ConfirmationHandler({
      onUserOverride: mockCallback,
    });

    expect(handler).toBeDefined();
    // Callback will be tested in user override tests
  });
});

// ==================== Auto Level Tests ====================

describe('ConfirmationHandler - Auto Level (>= 0.9)', () => {
  let handler: ConfirmationHandler;

  beforeEach(() => {
    handler = new ConfirmationHandler();
  });

  it('should return immediately for auto level', async () => {
    const routing = createMockRoutingResult(0.95, 'auto');

    const startTime = Date.now();
    const response = await handler.requestConfirmation(routing);
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(100); // Should be instant
    expect(response.selectedKey).toBe('researcher');
    expect(response.wasTimeout).toBe(false);
    expect(response.wasCancelled).toBe(false);
  });

  it('should not trigger timeout for auto level', async () => {
    const routing = createMockRoutingResult(0.92, 'auto');

    const response = await handler.requestConfirmation(routing);

    expect(response.wasTimeout).toBe(false);
  });

  it('should return selected agent for auto level', async () => {
    const routing = createMockRoutingResult(0.91, 'auto');

    const response = await handler.requestConfirmation(routing);

    expect(response.selectedKey).toBe('researcher');
  });

  it('should set respondedAt timestamp for auto level', async () => {
    const routing = createMockRoutingResult(0.93, 'auto');

    const beforeTime = Date.now();
    const response = await handler.requestConfirmation(routing);
    const afterTime = Date.now();

    expect(response.respondedAt).toBeGreaterThanOrEqual(beforeTime);
    expect(response.respondedAt).toBeLessThanOrEqual(afterTime);
  });
});

// ==================== Show Level Tests ====================

describe('ConfirmationHandler - Show Level (0.7-0.9)', () => {
  let handler: ConfirmationHandler;

  beforeEach(() => {
    handler = new ConfirmationHandler({ showTimeoutMs: 100 }); // Short timeout for tests
  });

  it('should wait for timeout on show level', async () => {
    const routing = createMockRoutingResult(0.8, 'show');

    const startTime = Date.now();
    const response = await handler.requestConfirmation(routing);
    const duration = Date.now() - startTime;

    expect(duration).toBeGreaterThanOrEqual(90); // Allow some variance
    expect(response.wasTimeout).toBe(true);
  });

  it('should return selected agent on timeout', async () => {
    const routing = createMockRoutingResult(0.75, 'show');

    const response = await handler.requestConfirmation(routing);

    expect(response.selectedKey).toBe('researcher');
    expect(response.wasTimeout).toBe(true);
  });

  it('should set wasTimeout=true after timeout', async () => {
    const routing = createMockRoutingResult(0.82, 'show');

    const response = await handler.requestConfirmation(routing);

    expect(response.wasTimeout).toBe(true);
    expect(response.wasCancelled).toBe(false);
  });

  it('should use custom timeout value', async () => {
    const customHandler = new ConfirmationHandler({ showTimeoutMs: 150 });
    const routing = createMockRoutingResult(0.78, 'show');

    const startTime = Date.now();
    const response = await customHandler.requestConfirmation(routing);
    const duration = Date.now() - startTime;

    expect(duration).toBeGreaterThanOrEqual(140);
    expect(response.wasTimeout).toBe(true);
  });

  it('should format message correctly for show level', () => {
    const routing = createMockRoutingResult(0.77, 'show', createAlternatives());
    const request = handler.createConfirmationRequest(routing);

    expect(request.message).toContain('Routing to Researcher');
    expect(request.message).toContain('77% confident');
    expect(request.message).toContain('Proceeding in');
    expect(request.message).toContain(routing.explanation);
  });
});

// ==================== Confirm Level Tests ====================

describe('ConfirmationHandler - Confirm Level (0.5-0.7)', () => {
  let handler: ConfirmationHandler;

  beforeEach(() => {
    handler = new ConfirmationHandler();
  });

  it('should not auto-proceed for confirm level', async () => {
    const routing = createMockRoutingResult(0.65, 'confirm');

    // Create a timeout race to verify it doesn't auto-proceed
    const timeoutPromise = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(true), 100);
    });

    const confirmationPromise = handler.requestConfirmation(routing);

    // Timeout should win the race (confirmation should wait indefinitely)
    const timeoutWon = await Promise.race([
      timeoutPromise,
      confirmationPromise.then(() => false),
    ]);

    expect(timeoutWon).toBe(true);
  });

  it('should require explicit response for confirm level', () => {
    const routing = createMockRoutingResult(0.6, 'confirm');
    const request = handler.createConfirmationRequest(routing);

    expect(request.timeoutMs).toBe(0); // No timeout by default
    expect(request.defaultOption).toBe(''); // No default
  });

  it('should include cancel option for confirm level', () => {
    const routing = createMockRoutingResult(0.58, 'confirm', createAlternatives());
    const request = handler.createConfirmationRequest(routing);

    const cancelOption = request.options.find((opt) => opt.key === 'cancel');
    expect(cancelOption).toBeDefined();
    expect(cancelOption?.label).toBe('Cancel');
  });

  it('should call onUserOverride when user selects different agent', async () => {
    const mockCallback = vi.fn();
    const customHandler = new ConfirmationHandler({
      onUserOverride: mockCallback,
    });

    const routing = createMockRoutingResult(0.62, 'confirm', createAlternatives());
    const request = customHandler.createConfirmationRequest(routing);

    // Simulate user selecting alternative
    await customHandler.processUserResponse(request, 'coder');

    expect(mockCallback).toHaveBeenCalledWith(routing.routingId, 'researcher', 'coder');
  });

  it('should format message correctly for confirm level', () => {
    const routing = createMockRoutingResult(0.67, 'confirm', createAlternatives());
    const request = handler.createConfirmationRequest(routing);

    expect(request.message).toContain('Suggest: Researcher');
    expect(request.message).toContain('67% confident');
    expect(request.message).toContain('Please confirm or select alternative');
    expect(request.message).toContain(routing.explanation);
  });
});

// ==================== Select Level Tests ====================

describe('ConfirmationHandler - Select Level (< 0.5)', () => {
  let handler: ConfirmationHandler;

  beforeEach(() => {
    handler = new ConfirmationHandler();
  });

  it('should not have default option for select level', () => {
    const routing = createMockRoutingResult(0.45, 'select', createAlternatives());
    const request = handler.createConfirmationRequest(routing);

    expect(request.defaultOption).toBe('');
  });

  it('should require selection from list for select level', () => {
    const routing = createMockRoutingResult(0.4, 'select', createAlternatives());
    const request = handler.createConfirmationRequest(routing);

    expect(request.timeoutMs).toBe(0); // No timeout
    expect(request.options.length).toBeGreaterThan(1); // Multiple options
  });

  it('should show all alternatives for select level', () => {
    const alternatives = createAlternatives();
    const routing = createMockRoutingResult(0.35, 'select', alternatives);
    const request = handler.createConfirmationRequest(routing);

    // Should have: recommended + 3 alternatives + cancel = 5 options
    expect(request.options.length).toBe(5);

    // Verify all alternatives are included
    expect(request.options.some((opt) => opt.key === 'coder')).toBe(true);
    expect(request.options.some((opt) => opt.key === 'tester')).toBe(true);
    expect(request.options.some((opt) => opt.key === 'reviewer')).toBe(true);
  });

  it('should include cancel option for select level', () => {
    const routing = createMockRoutingResult(0.42, 'select', createAlternatives());
    const request = handler.createConfirmationRequest(routing);

    const cancelOption = request.options.find((opt) => opt.key === 'cancel');
    expect(cancelOption).toBeDefined();
  });

  it('should call onUserOverride when user selects from list', async () => {
    const mockCallback = vi.fn();
    const customHandler = new ConfirmationHandler({
      onUserOverride: mockCallback,
    });

    const routing = createMockRoutingResult(0.38, 'select', createAlternatives());
    const request = customHandler.createConfirmationRequest(routing);

    // Simulate user selecting option 3 (tester)
    await customHandler.processUserResponse(request, 'tester');

    expect(mockCallback).toHaveBeenCalledWith(routing.routingId, 'researcher', 'tester');
  });

  it('should format message with numbered options for select level', () => {
    const routing = createMockRoutingResult(0.32, 'select', createAlternatives());
    const request = handler.createConfirmationRequest(routing);

    expect(request.message).toContain('Low confidence (32%)');
    expect(request.message).toContain('Please select an agent');
    expect(request.message).toContain('Options:');
    expect(request.message).toContain('1. Researcher');
    expect(request.message).toContain('2. Coder');
    expect(request.message).toContain('3. Tester');
    expect(request.message).toContain('4. Reviewer');
    expect(request.message).toContain('5. Cancel');
  });
});

// ==================== Message Formatting Tests ====================

describe('ConfirmationHandler - Message Formatting', () => {
  let handler: ConfirmationHandler;

  beforeEach(() => {
    handler = new ConfirmationHandler();
  });

  it('should include cold start indicator when present', () => {
    const routing: IRoutingResult = {
      ...createMockRoutingResult(0.5, 'confirm'),
      isColdStart: true,
      coldStartPhase: 'keyword-only',
      coldStartIndicator: '🔵 Cold Start: Keyword-only matching (0-25 executions)',
    };

    const request = handler.createConfirmationRequest(routing);

    expect(request.message).toContain('🔵 Cold Start');
    expect(request.message).toContain('Keyword-only matching');
  });

  it('should include explanation in message', () => {
    const baseRouting = createMockRoutingResult(0.7, 'show');
    const routing = {
      ...baseRouting,
      explanation: 'Strong match on research capabilities and domain expertise',
    };

    const request = handler.createConfirmationRequest(routing);

    expect(request.message).toContain('Reason:');
    expect(request.message).toContain('Strong match on research capabilities');
  });

  it('should format score percentages correctly', () => {
    const routing = createMockRoutingResult(0.847, 'show', [
      { agentKey: 'coder', name: 'Coder', score: 0.723, reason: 'Alt' },
    ]);

    const request = handler.createConfirmationRequest(routing);

    expect(request.message).toContain('85% confident'); // Rounded from 84.7
  });

  it('should format options with scores correctly', () => {
    const alternatives = createAlternatives();
    const routing = createMockRoutingResult(0.48, 'select', alternatives);
    const request = handler.createConfirmationRequest(routing);

    // Check recommended option
    const recommendedOption = request.options.find((opt) => opt.recommended);
    expect(recommendedOption?.label).toBe('Researcher (recommended)');
    expect(recommendedOption?.score).toBe(0.48);

    // Check alternative options
    const coderOption = request.options.find((opt) => opt.key === 'coder');
    expect(coderOption?.label).toBe('Coder');
    expect(coderOption?.score).toBe(0.6);
  });
});

// ==================== User Override Tests ====================

describe('ConfirmationHandler - User Overrides', () => {
  it('should not call onUserOverride when user confirms recommendation', async () => {
    const mockCallback = vi.fn();
    const handler = new ConfirmationHandler({
      onUserOverride: mockCallback,
    });

    const routing = createMockRoutingResult(0.65, 'confirm');
    const request = handler.createConfirmationRequest(routing);

    // User confirms recommended agent
    await handler.processUserResponse(request, 'researcher');

    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('should not call onUserOverride when user cancels', async () => {
    const mockCallback = vi.fn();
    const handler = new ConfirmationHandler({
      onUserOverride: mockCallback,
    });

    const routing = createMockRoutingResult(0.5, 'confirm', createAlternatives());
    const request = handler.createConfirmationRequest(routing);

    // User cancels
    await handler.processUserResponse(request, 'cancel');

    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('should call onUserOverride with correct parameters', async () => {
    const mockCallback = vi.fn();
    const handler = new ConfirmationHandler({
      onUserOverride: mockCallback,
    });

    const routing = createMockRoutingResult(0.6, 'confirm', createAlternatives());
    const request = handler.createConfirmationRequest(routing);

    await handler.processUserResponse(request, 'tester');

    expect(mockCallback).toHaveBeenCalledTimes(1);
    expect(mockCallback).toHaveBeenCalledWith(
      routing.routingId,
      'researcher',
      'tester'
    );
  });

  it('should return wasCancelled=true when user cancels', async () => {
    const handler = new ConfirmationHandler();
    const routing = createMockRoutingResult(0.55, 'select', createAlternatives());
    const request = handler.createConfirmationRequest(routing);

    const response = await handler.processUserResponse(request, 'cancel');

    expect(response.wasCancelled).toBe(true);
    expect(response.selectedKey).toBe('cancel');
  });

  it('should return wasCancelled=false when user selects agent', async () => {
    const handler = new ConfirmationHandler();
    const routing = createMockRoutingResult(0.58, 'confirm', createAlternatives());
    const request = handler.createConfirmationRequest(routing);

    const response = await handler.processUserResponse(request, 'coder');

    expect(response.wasCancelled).toBe(false);
    expect(response.selectedKey).toBe('coder');
  });
});

// ==================== Confirmation Request Creation Tests ====================

describe('ConfirmationHandler - Confirmation Request Creation', () => {
  let handler: ConfirmationHandler;

  beforeEach(() => {
    handler = new ConfirmationHandler();
  });

  it('should create request with recommended option first', () => {
    const routing = createMockRoutingResult(0.7, 'show', createAlternatives());
    const request = handler.createConfirmationRequest(routing);

    expect(request.options[0].key).toBe('researcher');
    expect(request.options[0].recommended).toBe(true);
  });

  it('should include all routing alternatives in request', () => {
    const alternatives = createAlternatives();
    const routing = createMockRoutingResult(0.5, 'confirm', alternatives);
    const request = handler.createConfirmationRequest(routing);

    expect(request.options.some((opt) => opt.key === 'coder')).toBe(true);
    expect(request.options.some((opt) => opt.key === 'tester')).toBe(true);
    expect(request.options.some((opt) => opt.key === 'reviewer')).toBe(true);
  });

  it('should not include cancel for auto level', () => {
    const routing = createMockRoutingResult(0.95, 'auto');
    const request = handler.createConfirmationRequest(routing);

    const cancelOption = request.options.find((opt) => opt.key === 'cancel');
    expect(cancelOption).toBeUndefined();
  });

  it('should not include cancel for show level', () => {
    const routing = createMockRoutingResult(0.8, 'show');
    const request = handler.createConfirmationRequest(routing);

    const cancelOption = request.options.find((opt) => opt.key === 'cancel');
    expect(cancelOption).toBeUndefined();
  });

  it('should set correct timeout for each level', () => {
    const customHandler = new ConfirmationHandler({
      showTimeoutMs: 3000,
      confirmTimeoutMs: 5000,
      selectTimeoutMs: 10000,
    });

    const showRequest = customHandler.createConfirmationRequest(
      createMockRoutingResult(0.8, 'show')
    );
    expect(showRequest.timeoutMs).toBe(3000);

    const confirmRequest = customHandler.createConfirmationRequest(
      createMockRoutingResult(0.6, 'confirm')
    );
    expect(confirmRequest.timeoutMs).toBe(5000);

    const selectRequest = customHandler.createConfirmationRequest(
      createMockRoutingResult(0.4, 'select')
    );
    expect(selectRequest.timeoutMs).toBe(10000);
  });

  it('should set default option only for show level', () => {
    const showRequest = handler.createConfirmationRequest(
      createMockRoutingResult(0.8, 'show')
    );
    expect(showRequest.defaultOption).toBe('researcher');

    const confirmRequest = handler.createConfirmationRequest(
      createMockRoutingResult(0.6, 'confirm')
    );
    expect(confirmRequest.defaultOption).toBe('');

    const selectRequest = handler.createConfirmationRequest(
      createMockRoutingResult(0.4, 'select')
    );
    expect(selectRequest.defaultOption).toBe('');
  });
});
