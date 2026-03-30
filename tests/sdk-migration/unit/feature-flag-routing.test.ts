/**
 * T-PAR-016: Feature flag routing tests.
 * Verifies pipeline.engine setting controls routing behavior.
 * EC-SDK-015: Missing/corrupt flag defaults to CLI.
 * EC-SDK-016: Explicit command overrides flag.
 *
 * NOTE: This test verifies the routing LOGIC, not the full pipeline execution.
 * The actual routing implementation is in TASK-SDK-012 (Phase 5).
 * This test defines the contract that TASK-SDK-012 must satisfy.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Helper: read pipeline engine from settings.json.
 * This mirrors the routing logic that /god-code will use.
 */
function readPipelineEngine(settingsPath: string): 'cli' | 'sdk' {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    const engine = settings?.pipeline?.engine;
    if (engine === 'sdk') return 'sdk';
    return 'cli'; // default to CLI for any other value or missing key
  } catch {
    return 'cli'; // corrupt/missing file defaults to CLI (EC-SDK-015)
  }
}

describe('Feature flag routing', () => {
  const tempDir = path.join(process.cwd(), '.god-agent', 'test-settings-' + Date.now());
  const settingsPath = path.join(tempDir, 'settings.json');

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('defaults to CLI when flag is "cli"', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ pipeline: { engine: 'cli' } }));
    expect(readPipelineEngine(settingsPath)).toBe('cli');
  });

  it('routes to SDK when flag is "sdk"', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ pipeline: { engine: 'sdk' } }));
    expect(readPipelineEngine(settingsPath)).toBe('sdk');
  });

  it('EC-SDK-015: defaults to CLI when pipeline key is missing', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ other: 'stuff' }));
    expect(readPipelineEngine(settingsPath)).toBe('cli');
  });

  it('EC-SDK-015: defaults to CLI when file is corrupt JSON', () => {
    fs.writeFileSync(settingsPath, '{corrupt!!!');
    expect(readPipelineEngine(settingsPath)).toBe('cli');
  });

  it('EC-SDK-015: defaults to CLI when file does not exist', () => {
    expect(readPipelineEngine('/nonexistent/path/settings.json')).toBe('cli');
  });

  it('defaults to CLI for invalid engine value', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ pipeline: { engine: 'invalid' } }));
    expect(readPipelineEngine(settingsPath)).toBe('cli');
  });

  it('defaults to CLI when engine is null', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ pipeline: { engine: null } }));
    expect(readPipelineEngine(settingsPath)).toBe('cli');
  });
});
