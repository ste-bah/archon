#!/usr/bin/env npx tsx
/**
 * @deprecated Use mcp__leann-search__process_queue MCP tool instead.
 *
 * This standalone processor creates its own LEANNBackend instance in a
 * separate process, so vectors/metadata do NOT land in the running MCP
 * server's in-memory index. The process_queue MCP tool runs in-process
 * and correctly updates all 3 stores (HNSW, metadata, code).
 *
 * Kept as a fallback for environments where the MCP server is unavailable.
 *
 * Usage:
 *   npx tsx scripts/hooks/leann-process-queue.ts
 *   npx tsx scripts/hooks/leann-process-queue.ts --timeout 60
 */

import { parseCodeIntoChunks, detectLanguage, type CodeChunk } from
  '../../src/mcp-servers/leann-search/tools/index-repository.ts';
import { LEANNBackend } from
  '../../src/god-agent/core/vector-db/leann-backend.ts';
import { DualCodeEmbeddingProvider } from
  '../../src/god-agent/core/search/dual-code-embedding.ts';
import { DistanceMetric } from
  '../../src/god-agent/core/vector-db/types.ts';
import { VECTOR_DIM } from
  '../../src/god-agent/core/validation/index.ts';
import type { CodeMetadata } from
  '../../src/mcp-servers/leann-search/types.ts';

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Configuration
// ============================================================================

const QUEUE_FILE = '.claude/runtime/leann-index-queue.json';
const PERSIST_PATH = process.env.LEANN_PERSIST_PATH ?? './vector_db_leann';
const MAX_CHUNK_SIZE = 4000;
const BATCH_SIZE = 5;
const MAX_FILE_SIZE = 512 * 1024; // 512KB
const PAUSE_BETWEEN_BATCHES_MS = 2000;

// Parse optional --timeout arg (seconds); default 300s
const timeoutArg = process.argv.find(a => a.startsWith('--timeout'));
const TIMEOUT_MS = timeoutArg
  ? parseInt(timeoutArg.split('=')[1] ?? process.argv[process.argv.indexOf(timeoutArg) + 1] ?? '300', 10) * 1000
  : 300_000;

// ============================================================================
// Types
// ============================================================================

interface QueueData {
  files: string[];
  lastUpdated: string;
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg: string): void {
  console.log(`[LEANN] ${msg}`);
}

function logErr(msg: string, err?: unknown): void {
  console.error(`[LEANN] ${msg}`, err ?? '');
}

// ============================================================================
// Main
// ============================================================================

async function processQueue(): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  const cwd = process.cwd();
  const repoName = path.basename(cwd);
  const queuePath = path.join(cwd, QUEUE_FILE);

  // --- Read queue ---
  let queue: QueueData;
  try {
    const raw = await fs.readFile(queuePath, 'utf8');
    queue = JSON.parse(raw);
  } catch {
    log('No queue file or empty queue');
    return;
  }

  if (!queue.files || queue.files.length === 0) {
    log('Queue is empty');
    return;
  }

  log(`Processing ${queue.files.length} files (timeout ${TIMEOUT_MS / 1000}s)`);

  // --- Initialize LEANN backend + embedder ---
  let backend: LEANNBackend;
  let embedder: DualCodeEmbeddingProvider;

  try {
    embedder = new DualCodeEmbeddingProvider({
      dimension: VECTOR_DIM,
      cacheEnabled: true,
      cacheMaxSize: 500,
    });

    backend = new LEANNBackend(
      VECTOR_DIM,
      DistanceMetric.COSINE,
      {
        hubCacheRatio: 0.1,
        graphPruningRatio: 0.7,
        batchSize: 100,
        maxRecomputeLatencyMs: 50,
        efSearch: 50,
        hubDegreeThreshold: 10,
      }
    );

    // Load existing index if present
    const persistDir = path.resolve(cwd, PERSIST_PATH);
    try {
      const loaded = await backend.load(persistDir);
      if (loaded) {
        log(`Loaded existing index from ${persistDir} (${backend.count()} vectors)`);
      } else {
        log('No existing index — starting fresh');
      }
    } catch {
      log('Could not load existing index — starting fresh');
    }
  } catch (err) {
    logErr('Failed to initialize LEANN backend/embedder:', err);
    return;
  }

  // --- Metadata + code stores (in-memory, same pattern as MCP server) ---
  const metadataStore = new Map<string, CodeMetadata>();
  const codeStore = new Map<string, string>();

  let totalIndexed = 0;
  let totalFailed = 0;
  let processedFiles = 0;

  for (let i = 0; i < queue.files.length; i++) {
    // Timeout check
    if (Date.now() > deadline) {
      log(`Timeout reached after ${processedFiles} files`);
      break;
    }

    const filePath = queue.files[i];

    // Check file exists
    try {
      await fs.access(filePath);
    } catch {
      log(`Skip (not found): ${filePath}`);
      continue;
    }

    // Check file size
    try {
      const stats = await fs.stat(filePath);
      if (stats.size > MAX_FILE_SIZE) {
        log(`Skip (>${MAX_FILE_SIZE / 1024}KB): ${path.basename(filePath)}`);
        continue;
      }
    } catch {
      continue;
    }

    // Read + chunk + embed
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const language = detectLanguage(filePath);
      const chunks = parseCodeIntoChunks(content, language, MAX_CHUNK_SIZE);

      let fileIndexed = 0;

      for (const chunk of chunks) {
        try {
          // Generate embedding via the same provider the MCP server uses
          const embedding = await embedder.embedCode(chunk.content);

          const vectorId = crypto.randomUUID();

          const metadata: CodeMetadata = {
            filePath,
            language,
            symbolType: chunk.symbolType,
            symbolName: chunk.symbolName,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            repository: repoName,
            indexedAt: Date.now(),
            contentHash: crypto.createHash('sha256')
              .update(chunk.content)
              .digest('hex')
              .slice(0, 16),
          };

          // Insert directly into the LEANN HNSW index
          backend.insert(vectorId, embedding);
          metadataStore.set(vectorId, metadata);
          codeStore.set(vectorId, chunk.content);

          fileIndexed++;
          totalIndexed++;
        } catch (chunkErr) {
          totalFailed++;
          logErr(`Chunk error in ${path.basename(filePath)}:`, chunkErr);
        }
      }

      processedFiles++;
      log(`[${processedFiles}/${queue.files.length}] ${fileIndexed > 0 ? 'OK' : 'SKIP'} (${fileIndexed} chunks): ${path.basename(filePath)}`);
    } catch (fileErr) {
      totalFailed++;
      logErr(`Error processing ${path.basename(filePath)}:`, fileErr);
    }

    // Pause between batches
    if ((i + 1) % BATCH_SIZE === 0 && i < queue.files.length - 1) {
      log(`Batch ${Math.floor(i / BATCH_SIZE) + 1} done, pausing...`);
      await sleep(PAUSE_BETWEEN_BATCHES_MS);
    }
  }

  // --- Persist the updated index ---
  if (totalIndexed > 0) {
    try {
      const persistDir = path.resolve(cwd, PERSIST_PATH);
      await backend.save(persistDir);
      log(`Saved index to ${persistDir} (${backend.count()} total vectors)`);
    } catch (saveErr) {
      logErr('Failed to save index:', saveErr);
    }
  }

  log(`Complete: ${totalIndexed} chunks indexed, ${totalFailed} failed from ${processedFiles} files`);

  // Clear queue on success (keep files that weren't processed due to timeout)
  if (totalFailed === 0 && processedFiles >= queue.files.length) {
    await fs.writeFile(queuePath, JSON.stringify({
      files: [],
      lastUpdated: new Date().toISOString(),
    }, null, 2));
    log('Queue cleared');
  } else if (processedFiles < queue.files.length) {
    // Keep unprocessed files in queue
    const remaining = queue.files.slice(processedFiles);
    await fs.writeFile(queuePath, JSON.stringify({
      files: remaining,
      lastUpdated: new Date().toISOString(),
    }, null, 2));
    log(`${remaining.length} files kept in queue for next run`);
  }
}

// Run
processQueue().catch(err => {
  logErr('Fatal error:', err);
  process.exit(1);
});
