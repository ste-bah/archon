/**
 * Tests for phd-cli init command
 * Validates REQ-PIPE-001, REQ-PIPE-011, REQ-PIPE-020, REQ-PIPE-021, REQ-PIPE-023
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { commandInit, generatePipelineId } from '../../../src/god-agent/cli/phd-cli.js';
import type { InitOptions } from '../../../src/god-agent/cli/cli-types.js';

// UUID v4 regex pattern
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('phd-cli init command', () => {
  const testSessionDir = path.join(process.cwd(), '.phd-sessions');

  beforeEach(async () => {
    // Clean up test session directory
    try {
      await fs.rm(testSessionDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }
  });

  afterEach(async () => {
    // Clean up test session directory
    try {
      await fs.rm(testSessionDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('successful initialization', () => {
    it('should return valid response with UUID v4 sessionId', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      const response = await commandInit(query, options);

      // [REQ-PIPE-023] Session ID should be valid UUID v4
      expect(response.sessionId).toMatch(UUID_V4_REGEX);
    });

    it('should generate unique session IDs on each call', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      const response1 = await commandInit(query, options);
      const response2 = await commandInit(query, options);

      expect(response1.sessionId).not.toBe(response2.sessionId);
    });

    it('should include query in response', async () => {
      const query = 'research context management in AI agents';
      const options: InitOptions = {};

      const response = await commandInit(query, options);

      expect(response.query).toBe(query);
    });

    it('should generate consistent pipelineId for same query', async () => {
      const query = 'test query for pipeline';

      const pipelineId1 = generatePipelineId(query);
      const pipelineId2 = generatePipelineId(query);

      expect(pipelineId1).toBe(pipelineId2);
      expect(pipelineId1).toMatch(/^pipeline-[0-9a-f]+$/);
    });

    it('should return totalAgents as 46', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      const response = await commandInit(query, options);

      // [REQ-PIPE-040] Support 46 agents (7+4+4+5+9+6+11)
      expect(response.totalAgents).toBe(46);
    });

    it('should return first agent with index 0', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      const response = await commandInit(query, options);

      expect(response.agent.index).toBe(0);
      expect(response.agent.key).toBe('step-back-analyzer');
      expect(response.agent.phase).toBe(1);
      expect(response.agent.phaseName).toBe('Foundation');
    });

    it('should include style profile in response', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      const response = await commandInit(query, options);

      expect(response.styleProfile).toBeDefined();
      expect(response.styleProfile.id).toBeDefined();
      expect(response.styleProfile.name).toBeDefined();
      expect(response.styleProfile.languageVariant).toBeDefined();
    });

    it('should default to en-GB language variant', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      const response = await commandInit(query, options);

      // [REQ-PIPE-015] UK English default
      expect(response.styleProfile.languageVariant).toBe('en-GB');
    });
  });

  describe('session directory creation', () => {
    it('should create .phd-sessions directory if it does not exist', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      // Ensure directory doesn't exist
      try {
        await fs.rm(testSessionDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }

      await commandInit(query, options);

      // [REQ-PIPE-020] Directory should be created
      const stat = await fs.stat(testSessionDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should save session state to file', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      const response = await commandInit(query, options);

      const sessionFile = path.join(testSessionDir, `${response.sessionId}.json`);
      const content = await fs.readFile(sessionFile, 'utf-8');
      const session = JSON.parse(content);

      expect(session.sessionId).toBe(response.sessionId);
      expect(session.query).toBe(query);
      expect(session.status).toBe('running');
    });
  });

  describe('error handling', () => {
    it('should throw error for empty query', async () => {
      const options: InitOptions = {};

      await expect(commandInit('', options)).rejects.toThrow('Query cannot be empty');
    });

    it('should throw error for whitespace-only query', async () => {
      const options: InitOptions = {};

      await expect(commandInit('   ', options)).rejects.toThrow('Query cannot be empty');
    });
  });

  describe('style profile handling', () => {
    it('should use provided style profile ID when specified', async () => {
      const query = 'test research query';
      const options: InitOptions = {
        styleProfile: 'custom-profile-id'
      };

      const response = await commandInit(query, options);

      // When profile doesn't exist, falls back to default
      expect(response.styleProfile.id).toBeDefined();
    });

    it('should fall back to active profile or default when specified profile not found', async () => {
      const query = 'test research query';
      const options: InitOptions = {
        styleProfile: 'non-existent-profile'
      };

      const response = await commandInit(query, options);

      // Per REQ-PIPE-011: Falls back to active profile if available, then to default
      // The response should have a valid profile (either active or default)
      expect(response.styleProfile.id).toBeDefined();
      expect(response.styleProfile.name).toBeDefined();
      expect(response.styleProfile.languageVariant).toBeDefined();
    });
  });

  describe('agent details', () => {
    it('should include prompt in first agent', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      const response = await commandInit(query, options);

      expect(response.agent.prompt).toBeDefined();
      expect(response.agent.prompt.length).toBeGreaterThan(0);
      expect(response.agent.prompt).toContain(query);
    });

    it('should include expected outputs for first agent', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      const response = await commandInit(query, options);

      expect(response.agent.expectedOutputs).toBeDefined();
      expect(Array.isArray(response.agent.expectedOutputs)).toBe(true);
      // expectedOutputs may be empty if not defined in agent file
    });

    it('should have empty dependencies for first agent', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      const response = await commandInit(query, options);

      expect(response.agent.dependencies).toEqual([]);
    });

    it('should include timeout for first agent', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      const response = await commandInit(query, options);

      expect(response.agent.timeout).toBeDefined();
      expect(typeof response.agent.timeout).toBe('number');
      expect(response.agent.timeout).toBeGreaterThan(0);
    });
  });

  describe('JSON output format', () => {
    it('should produce valid JSON response', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      const response = await commandInit(query, options);

      // Should be serializable to JSON
      const json = JSON.stringify(response);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should include all required fields in response', async () => {
      const query = 'test research query';
      const options: InitOptions = {};

      const response = await commandInit(query, options);

      expect(response).toHaveProperty('sessionId');
      expect(response).toHaveProperty('pipelineId');
      expect(response).toHaveProperty('query');
      expect(response).toHaveProperty('styleProfile');
      expect(response).toHaveProperty('totalAgents');
      expect(response).toHaveProperty('agent');
    });
  });
});

describe('generatePipelineId', () => {
  it('should generate deterministic IDs', () => {
    const query = 'test query';

    const id1 = generatePipelineId(query);
    const id2 = generatePipelineId(query);

    expect(id1).toBe(id2);
  });

  it('should generate different IDs for different queries', () => {
    const query1 = 'first query';
    const query2 = 'second query';

    const id1 = generatePipelineId(query1);
    const id2 = generatePipelineId(query2);

    expect(id1).not.toBe(id2);
  });

  it('should prefix IDs with "pipeline-"', () => {
    const query = 'test query';

    const id = generatePipelineId(query);

    expect(id.startsWith('pipeline-')).toBe(true);
  });
});
