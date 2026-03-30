import { describe, it, expect, beforeEach } from 'vitest';
import { RollingWindow } from '../../../../src/god-agent/core/ucm/context/rolling-window.js';

describe('RollingWindow', () => {
  let window: RollingWindow;

  beforeEach(() => {
    // Default: research phase with capacity 3
    window = new RollingWindow('research');
  });

  describe('constructor', () => {
    it('should initialize with default phase (research)', () => {
      const defaultWindow = new RollingWindow();
      expect(defaultWindow).toBeDefined();
      expect(defaultWindow.getPhase()).toBe('research');
      expect(defaultWindow.getCapacity()).toBe(3);
    });

    it('should accept custom phase', () => {
      const planningWindow = new RollingWindow('planning');
      expect(planningWindow.getPhase()).toBe('planning');
      expect(planningWindow.getCapacity()).toBe(2);
    });

    it('should accept custom capacity override', () => {
      const customWindow = new RollingWindow('research', 10);
      expect(customWindow.getCapacity()).toBe(10);
    });

    it('should normalize phase to lowercase', () => {
      const window = new RollingWindow('PLANNING');
      expect(window.getPhase()).toBe('planning');
    });

    it('should use default capacity for unknown phase', () => {
      const unknownWindow = new RollingWindow('unknown-phase');
      expect(unknownWindow.getCapacity()).toBe(3); // Falls back to research default
    });
  });

  describe('phase-specific capacities (RULE-010 to RULE-014)', () => {
    it('planning phase should have capacity 2', () => {
      const w = new RollingWindow('planning');
      expect(w.getCapacity()).toBe(2);
    });

    it('research phase should have capacity 3', () => {
      const w = new RollingWindow('research');
      expect(w.getCapacity()).toBe(3);
    });

    it('writing phase should have capacity 5', () => {
      const w = new RollingWindow('writing');
      expect(w.getCapacity()).toBe(5);
    });

    it('qa phase should have capacity 10', () => {
      const w = new RollingWindow('qa');
      expect(w.getCapacity()).toBe(10);
    });
  });

  describe('push', () => {
    it('should add entries to window', () => {
      window.push('agent-1', 'Test content', 100);

      const entries = window.getWindow();
      expect(entries).toHaveLength(1);
      expect(entries[0].agentId).toBe('agent-1');
      expect(entries[0].content).toBe('Test content');
      expect(entries[0].tokenCount).toBe(100);
    });

    it('should maintain insertion order', () => {
      window.push('agent-1', 'First', 100);
      window.push('agent-2', 'Second', 100);
      window.push('agent-3', 'Third', 100);

      const entries = window.getWindow();
      expect(entries.map(e => e.agentId)).toEqual(['agent-1', 'agent-2', 'agent-3']);
    });

    it('should return null when no eviction needed', () => {
      const result = window.push('agent-1', 'Content', 100);
      expect(result).toBeNull();
    });

    it('should set timestamp and phase on entry', () => {
      const before = Date.now();
      window.push('agent-1', 'Content', 100);
      const after = Date.now();

      const entry = window.getWindow()[0];
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(after);
      expect(entry.phase).toBe('research');
    });

    it('should update existing agent instead of duplicating', () => {
      window.push('agent-1', 'First content', 100);
      window.push('agent-1', 'Updated content', 200);

      const entries = window.getWindow();
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe('Updated content');
      expect(entries[0].tokenCount).toBe(200);
    });
  });

  describe('FIFO eviction', () => {
    it('should evict oldest entry when window is full', () => {
      // Research phase capacity is 3
      window.push('agent-0', 'Content 0', 100);
      window.push('agent-1', 'Content 1', 100);
      window.push('agent-2', 'Content 2', 100);

      // Add one more to trigger eviction
      const evicted = window.push('agent-3', 'Content 3', 100);

      expect(evicted).not.toBeNull();
      expect(evicted!.agentId).toBe('agent-0');

      const entries = window.getWindow();
      expect(entries).toHaveLength(3);
      expect(entries[0].agentId).toBe('agent-1');
      expect(entries[2].agentId).toBe('agent-3');
    });

    it('should maintain FIFO order during continuous additions', () => {
      for (let i = 0; i < 10; i++) {
        window.push(`agent-${i}`, `Content ${i}`, 100);
      }

      const entries = window.getWindow();
      expect(entries).toHaveLength(3);
      expect(entries.map(e => e.agentId)).toEqual(['agent-7', 'agent-8', 'agent-9']);
    });
  });

  describe('pop', () => {
    it('should remove and return oldest entry', () => {
      window.push('agent-1', 'First', 100);
      window.push('agent-2', 'Second', 100);

      const popped = window.pop();

      expect(popped).not.toBeNull();
      expect(popped!.agentId).toBe('agent-1');
      expect(window.size()).toBe(1);
    });

    it('should return null when window is empty', () => {
      expect(window.pop()).toBeNull();
    });
  });

  describe('getWindow', () => {
    it('should return all entries in order', () => {
      window.push('agent-1', 'First', 100);
      window.push('agent-2', 'Second', 200);

      const entries = window.getWindow();
      expect(entries).toHaveLength(2);
      expect(entries[0].agentId).toBe('agent-1');
      expect(entries[1].agentId).toBe('agent-2');
    });

    it('should return empty array when window is empty', () => {
      expect(window.getWindow()).toEqual([]);
    });

    it('should return copy to prevent external modification', () => {
      window.push('agent-1', 'Test', 100);

      const entries1 = window.getWindow();
      const entries2 = window.getWindow();

      expect(entries1).not.toBe(entries2); // Different array instances
      expect(entries1).toEqual(entries2); // Same content
    });
  });

  describe('getAgent', () => {
    it('should return agent if in window', () => {
      window.push('agent-1', 'Content', 100);

      const agent = window.getAgent('agent-1');
      expect(agent).not.toBeNull();
      expect(agent!.agentId).toBe('agent-1');
    });

    it('should return null if agent not in window', () => {
      expect(window.getAgent('non-existent')).toBeNull();
    });
  });

  describe('hasAgent', () => {
    it('should return true when agent is in window', () => {
      window.push('agent-1', 'Content', 100);
      expect(window.hasAgent('agent-1')).toBe(true);
    });

    it('should return false when agent is not in window', () => {
      expect(window.hasAgent('agent-1')).toBe(false);
    });
  });

  describe('remove', () => {
    it('should remove specific agent from window', () => {
      window.push('agent-1', 'First', 100);
      window.push('agent-2', 'Second', 100);

      const removed = window.remove('agent-1');

      expect(removed).not.toBeNull();
      expect(removed!.agentId).toBe('agent-1');
      expect(window.size()).toBe(1);
      expect(window.hasAgent('agent-1')).toBe(false);
    });

    it('should return null when agent not found', () => {
      expect(window.remove('non-existent')).toBeNull();
    });
  });

  describe('resize (phase transitions)', () => {
    it('should resize based on phase', () => {
      // Start in research (capacity 3)
      window.push('agent-1', 'A', 100);
      window.push('agent-2', 'B', 100);
      window.push('agent-3', 'C', 100);
      expect(window.size()).toBe(3);

      // Transition to planning (capacity 2)
      const evicted = window.resize('planning');

      expect(evicted).toHaveLength(1);
      expect(evicted[0].agentId).toBe('agent-1');
      expect(window.size()).toBe(2);
      expect(window.getCapacity()).toBe(2);
      expect(window.getPhase()).toBe('planning');
    });

    it('should expand when transitioning to larger phase', () => {
      // Start in planning (capacity 2)
      const planWindow = new RollingWindow('planning');
      planWindow.push('agent-1', 'A', 100);
      planWindow.push('agent-2', 'B', 100);

      // Transition to writing (capacity 5)
      const evicted = planWindow.resize('writing');

      expect(evicted).toHaveLength(0);
      expect(planWindow.getCapacity()).toBe(5);
    });

    it('should evict multiple entries when downsizing significantly', () => {
      // Use QA phase (capacity 10)
      const qaWindow = new RollingWindow('qa');
      for (let i = 0; i < 10; i++) {
        qaWindow.push(`agent-${i}`, `Content ${i}`, 100);
      }
      expect(qaWindow.size()).toBe(10);

      // Transition to planning (capacity 2)
      const evicted = qaWindow.resize('planning');

      expect(evicted).toHaveLength(8);
      expect(qaWindow.size()).toBe(2);
    });
  });

  describe('size', () => {
    it('should return current number of entries', () => {
      expect(window.size()).toBe(0);

      window.push('agent-1', 'A', 100);
      expect(window.size()).toBe(1);

      window.push('agent-2', 'B', 100);
      expect(window.size()).toBe(2);
    });

    it('should reflect capacity limits', () => {
      for (let i = 0; i < 10; i++) {
        window.push(`agent-${i}`, `Content ${i}`, 100);
      }

      expect(window.size()).toBe(3); // Research capacity
    });
  });

  describe('getTotalTokens', () => {
    it('should return sum of all token counts', () => {
      window.push('agent-1', 'A', 100);
      window.push('agent-2', 'B', 200);
      window.push('agent-3', 'C', 300);

      expect(window.getTotalTokens()).toBe(600);
    });

    it('should return 0 for empty window', () => {
      expect(window.getTotalTokens()).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      window.push('agent-1', 'A', 100);
      window.push('agent-2', 'B', 100);

      const cleared = window.clear();

      expect(cleared).toHaveLength(2);
      expect(window.size()).toBe(0);
    });

    it('should allow new additions after clear', () => {
      window.push('agent-1', 'Before', 100);
      window.clear();
      window.push('agent-2', 'After', 100);

      expect(window.size()).toBe(1);
      expect(window.getWindow()[0].agentId).toBe('agent-2');
    });
  });

  describe('getStats', () => {
    it('should return comprehensive statistics', () => {
      window.push('agent-1', 'Content 1', 100);
      window.push('agent-2', 'Content 2', 200);

      const stats = window.getStats();

      expect(stats.size).toBe(2);
      expect(stats.capacity).toBe(3);
      expect(stats.utilization).toBeCloseTo(2 / 3);
      expect(stats.totalTokens).toBe(300);
      expect(stats.phase).toBe('research');
      expect(stats.agents).toHaveLength(2);
      expect(stats.agents[0].agentId).toBe('agent-1');
      expect(stats.agents[0].tokenCount).toBe(100);
    });

    it('should handle empty window', () => {
      const stats = window.getStats();

      expect(stats.size).toBe(0);
      expect(stats.utilization).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.agents).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should handle very small window size (planning)', () => {
      const planWindow = new RollingWindow('planning'); // capacity 2

      planWindow.push('agent-1', 'A', 100);
      planWindow.push('agent-2', 'B', 100);
      planWindow.push('agent-3', 'C', 100);

      expect(planWindow.size()).toBe(2);
      expect(planWindow.getWindow()[0].agentId).toBe('agent-2');
    });

    it('should handle large window size (qa)', () => {
      const qaWindow = new RollingWindow('qa'); // capacity 10

      for (let i = 0; i < 8; i++) {
        qaWindow.push(`agent-${i}`, `Content ${i}`, 100);
      }

      expect(qaWindow.size()).toBe(8);
    });

    it('should handle custom large capacity', () => {
      const largeWindow = new RollingWindow('research', 1000);

      for (let i = 0; i < 500; i++) {
        largeWindow.push(`agent-${i}`, `Content ${i}`, 100);
      }

      expect(largeWindow.size()).toBe(500);
    });
  });

  describe('performance', () => {
    it('should handle rapid additions efficiently', () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        window.push(`agent-${i}`, `Content ${i}`, 100);
      }

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(100); // Should be fast
    });

    it('should retrieve entries quickly', () => {
      for (let i = 0; i < 3; i++) {
        window.push(`agent-${i}`, `Content ${i}`, 100);
      }

      const start = performance.now();
      const entries = window.getWindow();
      const duration = performance.now() - start;

      expect(entries).toHaveLength(3);
      expect(duration).toBeLessThan(1);
    });
  });

  describe('integration scenarios', () => {
    it('should support workflow phase transitions', () => {
      // Planning phase
      const workflow = new RollingWindow('planning');
      workflow.push('plan-1', 'Planning task 1', 100);
      workflow.push('plan-2', 'Planning task 2', 100);
      expect(workflow.size()).toBe(2);

      // Transition to research (expand)
      workflow.resize('research');
      workflow.push('research-1', 'Research task 1', 100);
      expect(workflow.size()).toBe(3);
      expect(workflow.getWindow()[0].agentId).toBe('plan-1');

      // Transition to writing (expand more)
      workflow.resize('writing');
      workflow.push('write-1', 'Writing task 1', 100);
      workflow.push('write-2', 'Writing task 2', 100);
      expect(workflow.size()).toBe(5);

      // Transition to QA (expand to 10)
      workflow.resize('qa');
      for (let i = 0; i < 5; i++) {
        workflow.push(`qa-${i}`, `QA task ${i}`, 100);
      }
      expect(workflow.size()).toBe(10);
    });
  });
});
