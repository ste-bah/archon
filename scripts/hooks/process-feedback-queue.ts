#!/usr/bin/env npx tsx
/**
 * Feedback Queue Processor
 *
 * Processes unprocessed feedback queue entries by submitting them to the
 * God Agent CLI code-feedback command, then archives and clears the queue.
 *
 * Usage:
 *   npx tsx scripts/hooks/process-feedback-queue.ts
 *   npx tsx scripts/hooks/process-feedback-queue.ts --dry-run
 *   npx tsx scripts/hooks/process-feedback-queue.ts --limit 10
 *
 * @module scripts/hooks/process-feedback-queue
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ====================  Configuration ====================

const PROJECT_ROOT = path.resolve(process.cwd());
const QUEUE_FILE = path.join(PROJECT_ROOT, '.claude/hooks/feedback-queue.json');
const ARCHIVE_DIR = path.join(PROJECT_ROOT, '.claude/hooks');
const CLI_PATH = path.join(PROJECT_ROOT, 'src/god-agent/universal/cli.ts');

// Timeout for CLI command execution (30 seconds per entry)
const CLI_TIMEOUT_MS = 30000;

// Maximum concurrent executions (to avoid overwhelming the system)
const MAX_CONCURRENT = 3;

// ====================  Types ====================

interface IFeedbackQueueEntry {
  trajectoryId: string;
  quality: number;
  outcome: 'positive' | 'neutral' | 'negative';
  metadata: {
    entryId: string;
    domain: string;
    tags: string[];
  };
  attempts: number;
  lastAttempt: number;
  createdAt: number;
}

interface ProcessingResult {
  trajectoryId: string;
  success: boolean;
  quality?: number;
  error?: string;
  duration: number;
}

interface ProcessingStats {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  avgDuration: number;
  archivePath?: string;
}

// ====================  CLI Argument Parsing ====================

function parseArgs(): { dryRun: boolean; limit: number; verbose: boolean } {
  const args = process.argv.slice(2);
  let dryRun = false;
  let limit = Infinity;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run' || arg === '-d') {
      dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--limit' || arg === '-l') {
      const val = args[++i];
      if (val && !isNaN(parseInt(val, 10))) {
        limit = parseInt(val, 10);
      }
    }
  }

  return { dryRun, limit, verbose };
}

// ====================  Queue Operations ====================

async function loadQueue(): Promise<IFeedbackQueueEntry[]> {
  try {
    const data = await fs.readFile(QUEUE_FILE, 'utf-8');
    return JSON.parse(data) as IFeedbackQueueEntry[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('Queue file does not exist. Nothing to process.');
      return [];
    }
    throw error;
  }
}

async function saveQueue(queue: IFeedbackQueueEntry[]): Promise<void> {
  await fs.writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf-8');
}

async function archiveQueue(
  queue: IFeedbackQueueEntry[],
  results: ProcessingResult[]
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(ARCHIVE_DIR, `feedback-queue.processed.${timestamp}.json`);

  const archive = {
    processedAt: new Date().toISOString(),
    entriesCount: queue.length,
    results: results,
    entries: queue,
  };

  await fs.writeFile(archivePath, JSON.stringify(archive, null, 2), 'utf-8');
  return archivePath;
}

// ====================  Feedback Submission ====================

async function submitFeedback(entry: IFeedbackQueueEntry, verbose: boolean): Promise<ProcessingResult> {
  const startTime = Date.now();
  const result: ProcessingResult = {
    trajectoryId: entry.trajectoryId,
    success: false,
    duration: 0,
  };

  try {
    // Build CLI command
    // code-feedback <trajectoryId> --output "<description>" --agent "feedback-processor" --phase 7
    const outputText = `Batch retry: quality=${entry.quality.toFixed(2)}, outcome=${entry.outcome}`;
    const cmd = `npx tsx "${CLI_PATH}" code-feedback "${entry.trajectoryId}" --output "${outputText}" --agent "feedback-processor" --phase 7 --json`;

    if (verbose) {
      console.log(`  Command: ${cmd}`);
    }

    const { stdout, stderr } = await execAsync(cmd, {
      cwd: PROJECT_ROOT,
      timeout: CLI_TIMEOUT_MS,
      encoding: 'utf-8',
    });

    // Parse JSON response
    if (stdout) {
      try {
        const response = JSON.parse(stdout.trim());
        if (response.success) {
          result.success = true;
          result.quality = response.qualityScore || response.result?.quality;
        } else {
          result.error = response.error || 'Unknown error from CLI';
        }
      } catch {
        // Non-JSON output - check if it looks successful
        if (stdout.includes('Feedback Recorded') || stdout.includes('quality')) {
          result.success = true;
        } else {
          result.error = `Non-JSON output: ${stdout.slice(0, 200)}`;
        }
      }
    }

    if (stderr && !result.success) {
      result.error = stderr.slice(0, 500);
    }
  } catch (error) {
    if ((error as { killed?: boolean }).killed) {
      result.error = `Timeout after ${CLI_TIMEOUT_MS}ms`;
    } else {
      result.error = (error as Error).message || String(error);
    }
  }

  result.duration = Date.now() - startTime;
  return result;
}

// ====================  Batch Processing ====================

async function processBatch(
  entries: IFeedbackQueueEntry[],
  verbose: boolean
): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];

  // Process in chunks to limit concurrency
  for (let i = 0; i < entries.length; i += MAX_CONCURRENT) {
    const chunk = entries.slice(i, i + MAX_CONCURRENT);
    const chunkResults = await Promise.all(
      chunk.map((entry) => submitFeedback(entry, verbose))
    );
    results.push(...chunkResults);

    // Progress update
    const processed = Math.min(i + MAX_CONCURRENT, entries.length);
    const succeeded = results.filter((r) => r.success).length;
    console.log(`  Progress: ${processed}/${entries.length} (${succeeded} succeeded)`);
  }

  return results;
}

// ====================  Main ====================

async function main(): Promise<void> {
  console.log('========================================');
  console.log('  Feedback Queue Processor');
  console.log('========================================\n');

  const { dryRun, limit, verbose } = parseArgs();

  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  // Load queue
  console.log(`Loading queue from: ${QUEUE_FILE}`);
  const queue = await loadQueue();

  if (queue.length === 0) {
    console.log('\nQueue is empty. Nothing to process.');
    return;
  }

  console.log(`Found ${queue.length} entries in queue\n`);

  // Sort by quality descending (process best first)
  const sorted = [...queue].sort((a, b) => b.quality - a.quality);

  // Apply limit
  const toProcess = sorted.slice(0, limit);
  const skipped = sorted.length - toProcess.length;

  if (skipped > 0) {
    console.log(`Processing ${toProcess.length} entries (skipping ${skipped} due to --limit)\n`);
  }

  // Show quality distribution
  const qualityDist = {
    excellent: toProcess.filter((e) => e.quality >= 0.9).length,
    good: toProcess.filter((e) => e.quality >= 0.75 && e.quality < 0.9).length,
    fair: toProcess.filter((e) => e.quality >= 0.5 && e.quality < 0.75).length,
    poor: toProcess.filter((e) => e.quality < 0.5).length,
  };
  console.log('Quality Distribution:');
  console.log(`  Excellent (>=0.9): ${qualityDist.excellent}`);
  console.log(`  Good (>=0.75):     ${qualityDist.good}`);
  console.log(`  Fair (>=0.5):      ${qualityDist.fair}`);
  console.log(`  Poor (<0.5):       ${qualityDist.poor}`);
  console.log();

  // Process entries
  let results: ProcessingResult[] = [];
  const stats: ProcessingStats = {
    total: queue.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: skipped,
    avgDuration: 0,
  };

  if (!dryRun) {
    console.log('Processing entries...\n');
    results = await processBatch(toProcess, verbose);

    stats.processed = results.length;
    stats.succeeded = results.filter((r) => r.success).length;
    stats.failed = results.filter((r) => !r.success).length;
    stats.avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length || 0;

    // Archive processed entries
    console.log('\nArchiving processed entries...');
    const archivePath = await archiveQueue(toProcess, results);
    stats.archivePath = archivePath;
    console.log(`  Archived to: ${archivePath}`);

    // Clear processed entries from queue
    // Keep only entries that weren't processed (skipped due to limit)
    const remaining = sorted.slice(limit);
    await saveQueue(remaining);
    console.log(`  Queue cleared. Remaining: ${remaining.length} entries`);

    // Log failures for debugging
    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      console.log('\n--- Failed Entries ---');
      for (const failure of failures.slice(0, 10)) {
        console.log(`  ${failure.trajectoryId}: ${failure.error}`);
      }
      if (failures.length > 10) {
        console.log(`  ... and ${failures.length - 10} more failures`);
      }
    }
  } else {
    console.log('Would process the following entries (dry run):');
    for (const entry of toProcess.slice(0, 10)) {
      console.log(`  - ${entry.trajectoryId} (quality: ${entry.quality.toFixed(2)}, outcome: ${entry.outcome})`);
    }
    if (toProcess.length > 10) {
      console.log(`  ... and ${toProcess.length - 10} more entries`);
    }
  }

  // Summary
  console.log('\n========================================');
  console.log('  Processing Summary');
  console.log('========================================');
  console.log(`  Total in queue:    ${stats.total}`);
  console.log(`  Processed:         ${stats.processed}`);
  console.log(`  Succeeded:         ${stats.succeeded}`);
  console.log(`  Failed:            ${stats.failed}`);
  console.log(`  Skipped:           ${stats.skipped}`);
  if (stats.avgDuration > 0) {
    console.log(`  Avg duration:      ${(stats.avgDuration / 1000).toFixed(2)}s`);
  }
  if (stats.archivePath) {
    console.log(`  Archive:           ${stats.archivePath}`);
  }
  console.log('========================================\n');

  // Exit with error code if there were failures
  if (stats.failed > 0 && !dryRun) {
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
