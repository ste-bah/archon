/**
 * LEANN Search MCP Server - Process Queue Tool
 *
 * Reads queued file paths from a JSON file and indexes each file individually
 * via indexCode() per chunk. Avoids the directory-walk amplification of
 * indexRepository() and correctly supports replaceExisting semantics.
 *
 * @module mcp-servers/leann-search/tools/process-queue
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import type { ToolExecutionContext } from './semantic-code-search.js';
import { indexCode, parseCodeIntoChunks, detectLanguage, isExcludedPath } from './index-repository.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_CWD = process.cwd();
const MAX_FILE_SIZE = 524_288; // 512 KB

/** Walk up from startDir to find the nearest .git directory. */
function findGitRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.parse(dir).root) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return startDir; // fallback to CWD
}

const PROJECT_ROOT = findGitRoot(SERVER_CWD);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueFile {
  files: string[];
  lastUpdated: string;
}

export interface ProcessQueueInput {
  queuePath?: string;
  maxFiles?: number;
  timeoutMs?: number;
}

export interface ProcessQueueOutput {
  success: boolean;
  partialSuccess: boolean;
  filesProcessed: number;
  chunksIndexed: number;
  errors: Array<{ file: string; error: string }>;
  queueRemaining: number;
  timeMs: number;
}

// ---------------------------------------------------------------------------
// Queue I/O
// ---------------------------------------------------------------------------

async function readQueue(queuePath: string): Promise<QueueFile | null> {
  try {
    const raw = await fs.readFile(queuePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const files = Array.isArray(parsed) ? parsed : parsed?.files;
    if (!Array.isArray(files)) return null;
    return {
      files: files.filter((f: unknown) => typeof f === 'string'),
      lastUpdated: parsed?.lastUpdated ?? '',
    };
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { files: [], lastUpdated: '' };
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-file indexing
// ---------------------------------------------------------------------------

async function processFile(
  filePath: string,
  repoName: string,
  context: ToolExecutionContext,
): Promise<{ chunksIndexed: number; error?: string }> {
  // Reject non-project paths (venvs, third-party, build artifacts)
  if (isExcludedPath(filePath)) {
    return { chunksIndexed: 0 }; // silently skip, not an error
  }

  // Check existence and size
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { chunksIndexed: 0, error: 'File not found' };
  }
  if (stat.size > MAX_FILE_SIZE) {
    return { chunksIndexed: 0, error: `File too large (${stat.size} bytes)` };
  }

  // Read content
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Read error';
    return { chunksIndexed: 0, error: msg };
  }
  if (content.trim().length === 0) {
    return { chunksIndexed: 0 }; // empty file, nothing to index
  }

  // Chunk and index
  const language = detectLanguage(filePath);
  const chunks = parseCodeIntoChunks(content, language, 2000);
  let indexed = 0;

  for (const chunk of chunks) {
    try {
      const result = await indexCode(
        {
          code: chunk.content,
          filePath,
          language,
          symbolType: chunk.symbolType,
          symbolName: chunk.symbolName,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          repository: repoName,
          replaceExisting: true,
        },
        context,
      );
      if (result.success) indexed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Embedding error';
      console.error(`[LEANN:process_queue] Chunk error in ${filePath}:${chunk.startLine}: ${msg}`);
      // Continue with remaining chunks
    }
  }

  return { chunksIndexed: indexed };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function processQueue(
  input: ProcessQueueInput,
  context: ToolExecutionContext,
): Promise<ProcessQueueOutput> {
  const startTime = Date.now();
  const queuePath = input.queuePath
    ? path.resolve(input.queuePath)
    : path.resolve(PROJECT_ROOT, '.claude/runtime/leann-index-queue.json');
  const maxFiles = input.maxFiles ?? 200;
  const timeoutMs = input.timeoutMs ?? 300_000;

  const queue = await readQueue(queuePath);
  if (queue === null) {
    return {
      success: false, partialSuccess: false, filesProcessed: 0, chunksIndexed: 0,
      errors: [{ file: queuePath, error: 'Malformed or unreadable queue file' }],
      queueRemaining: -1, timeMs: Date.now() - startTime,
    };
  }
  if (queue.files.length === 0) {
    return {
      success: true, partialSuccess: false, filesProcessed: 0, chunksIndexed: 0,
      errors: [], queueRemaining: 0, timeMs: Date.now() - startTime,
    };
  }

  const repoName = path.basename(PROJECT_ROOT);
  const originalFiles = new Set(queue.files);
  const processedFiles = new Set<string>();
  const errors: Array<{ file: string; error: string }> = [];
  let totalChunks = 0;
  let filesHandled = 0;

  for (const filePath of queue.files) {
    if (filesHandled >= maxFiles) break;
    if (Date.now() - startTime > timeoutMs) {
      errors.push({ file: filePath, error: 'Skipped: overall timeout reached' });
      continue;
    }

    const result = await processFile(filePath, repoName, context);
    filesHandled++;

    if (result.error) {
      console.error(`[LEANN:process_queue] ${filePath}: ${result.error}`);
      errors.push({ file: filePath, error: result.error });
    }
    totalChunks += result.chunksIndexed;
    // Always mark processed — failed files are removed from queue (don't retry forever)
    processedFiles.add(filePath);
  }

  // TOCTOU-safe clear: re-read queue, keep files that weren't in our original set
  // (newly added while we were processing) or that we didn't attempt.
  let queueRemaining = 0;
  try {
    const freshQueue = await readQueue(queuePath);
    if (freshQueue === null) {
      // Queue became unreadable — leave it untouched
      console.error('[LEANN:process_queue] Queue unreadable on re-read; skipping clear');
      queueRemaining = -1;
    } else {
      const remaining = freshQueue.files.filter(
        (f) => !processedFiles.has(f) || !originalFiles.has(f),
      );
      queueRemaining = remaining.length;
      const queueData = { files: remaining, lastUpdated: new Date().toISOString() };
      await fs.writeFile(queuePath, JSON.stringify(queueData, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error(`[LEANN:process_queue] Failed to clear queue: ${err}`);
  }

  const allSucceeded = errors.length === 0;
  return {
    success: allSucceeded,
    partialSuccess: !allSucceeded && totalChunks > 0,
    filesProcessed: filesHandled,
    chunksIndexed: totalChunks,
    errors,
    queueRemaining,
    timeMs: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const PROCESS_QUEUE_DEFINITION = {
  name: 'process_queue',
  description:
    'Process the file index queue. Reads queued files from .claude/runtime/leann-index-queue.json and indexes each file via indexCode() per chunk with replaceExisting. This ensures all vectors, metadata, and code content land in the live in-memory index.',
  inputSchema: {
    type: 'object',
    properties: {
      queuePath: {
        type: 'string',
        description:
          'Absolute path to queue file. Defaults to .claude/runtime/leann-index-queue.json relative to git root.',
      },
      maxFiles: {
        type: 'number',
        description: 'Maximum number of files to process per call (default: 200). For large queues, use maxFiles: 50 to stay within MCP client timeout limits.',
        default: 200,
      },
      timeoutMs: {
        type: 'number',
        description: 'Overall timeout in milliseconds (default: 300000 = 5 min)',
        default: 300000,
      },
    },
    required: [],
  },
};
