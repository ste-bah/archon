/**
 * T-EC-003: Session JSON corrupt file recovery with .bak fallback
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = path.join(process.cwd(), '.god-agent', 'coding-sessions');
const TEST_SESSION_ID = 'test-corrupt-session-' + Date.now();
const SESSION_PATH = path.join(TEST_DIR, `${TEST_SESSION_ID}.json`);
const BAK_PATH = SESSION_PATH + '.bak';

describe('PipelinePromptFacade — readSessionJson .bak fallback', () => {
  let facade: InstanceType<typeof import('../../../src/god-agent/cli/sdk-prompt-facade.js').PipelinePromptFacade>;

  beforeEach(async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    const { PipelinePromptFacade } = await import('../../../src/god-agent/cli/sdk-prompt-facade.js');
    facade = new PipelinePromptFacade();
    // Set projectRoot to cwd so paths resolve
    (facade as unknown as { projectRoot: string }).projectRoot = process.cwd();
  });

  afterEach(() => {
    try { fs.unlinkSync(SESSION_PATH); } catch { /* ok */ }
    try { fs.unlinkSync(BAK_PATH); } catch { /* ok */ }
  });

  it('reads primary session file when valid', async () => {
    const data = { completedAgents: ['task-analyzer'], currentPhaseIndex: 0 };
    fs.writeFileSync(SESSION_PATH, JSON.stringify(data));

    const result = await facade.readSessionJson(TEST_SESSION_ID);
    expect(result).not.toBeNull();
    expect((result!.completedAgents as string[])[0]).toBe('task-analyzer');
  });

  it('falls back to .bak when primary is corrupt', async () => {
    fs.writeFileSync(SESSION_PATH, '{corrupt json!!!');
    const bakData = { completedAgents: ['task-analyzer'], currentPhaseIndex: 0, fromBak: true };
    fs.writeFileSync(BAK_PATH, JSON.stringify(bakData));

    const result = await facade.readSessionJson(TEST_SESSION_ID);
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).fromBak).toBe(true);
  });

  it('returns null when both primary and .bak are corrupt', async () => {
    fs.writeFileSync(SESSION_PATH, '{corrupt}');
    fs.writeFileSync(BAK_PATH, '{also corrupt}');

    const result = await facade.readSessionJson(TEST_SESSION_ID);
    expect(result).toBeNull();
  });

  it('returns null when session file does not exist', async () => {
    const result = await facade.readSessionJson('nonexistent-session-id');
    expect(result).toBeNull();
  });

  it('returns null when primary missing and no .bak', async () => {
    // Don't create any files
    const result = await facade.readSessionJson(TEST_SESSION_ID);
    expect(result).toBeNull();
  });
});
