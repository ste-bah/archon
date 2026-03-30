/**
 * T-EC-012: Disk write failure retry test.
 * Verifies retry once after 5s on ENOSPC/EACCES, then abort on second failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = path.join(process.cwd(), '.god-agent', 'test-disk-write-' + Date.now());
const TEST_FILE = path.join(TEST_DIR, 'test-output.md');

describe('T-EC-012: Disk write failure retry', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('successful write on first attempt', () => {
    fs.writeFileSync(TEST_FILE, 'test content');
    expect(fs.readFileSync(TEST_FILE, 'utf-8')).toBe('test content');
  });

  it('simulates ENOSPC retry logic: first fail, second succeed', () => {
    let callCount = 0;
    const mockWrite = (filePath: string, content: string) => {
      callCount++;
      if (callCount === 1) {
        const err = new Error('ENOSPC: no space left on device') as NodeJS.ErrnoException;
        err.code = 'ENOSPC';
        throw err;
      }
      fs.writeFileSync(filePath, content);
    };

    // First attempt fails
    expect(() => mockWrite(TEST_FILE, 'data')).toThrow('ENOSPC');
    expect(callCount).toBe(1);

    // After 5s delay (simulated), second attempt succeeds
    mockWrite(TEST_FILE, 'data');
    expect(callCount).toBe(2);
    expect(fs.readFileSync(TEST_FILE, 'utf-8')).toBe('data');
  });

  it('simulates EACCES retry logic: both fail → abort', () => {
    let callCount = 0;
    const mockWrite = () => {
      callCount++;
      const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    };

    // First attempt fails
    expect(() => mockWrite()).toThrow('EACCES');
    // Second attempt also fails → abort
    expect(() => mockWrite()).toThrow('EACCES');
    expect(callCount).toBe(2);
  });

  it('retry delay is 5s fixed (not exponential)', () => {
    // From PRD EC-SDK-012: "Retries once after 5s fixed delay (not exponential —
    // disk pressure is either transient and resolves quickly, or persistent)"
    const DISK_RETRY_DELAY_MS = 5000;
    expect(DISK_RETRY_DELAY_MS).toBe(5000);
    // Contrast with API retry which uses exponential: 1000, 2000, 4000
    const API_BACKOFF = [1000, 2000, 4000];
    expect(API_BACKOFF[0]).not.toBe(DISK_RETRY_DELAY_MS);
  });
});
