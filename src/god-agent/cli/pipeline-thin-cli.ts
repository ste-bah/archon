#!/usr/bin/env node --import tsx/esm
/**
 * Pipeline Thin CLI
 *
 * Lightweight entry point that delegates to the pipeline daemon.
 * Replaces direct invocation of coding-pipeline-cli.ts in god-code.md.
 *
 * Usage (same interface as coding-pipeline-cli.ts):
 *   npx tsx src/god-agent/cli/pipeline-thin-cli.ts init "<task>"
 *   npx tsx src/god-agent/cli/pipeline-thin-cli.ts next <sessionId>
 *   npx tsx src/god-agent/cli/pipeline-thin-cli.ts complete <sessionId> <agentKey> [--file <path>]
 *   npx tsx src/god-agent/cli/pipeline-thin-cli.ts complete-and-next <sessionId> <agentKey> [--file <path>]
 *   npx tsx src/god-agent/cli/pipeline-thin-cli.ts status <sessionId>
 *   npx tsx src/god-agent/cli/pipeline-thin-cli.ts resume <sessionId>
 */

import { getPipelineDaemonClient } from './pipeline-daemon-client.js';

const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

const fail = (msg: string) => { console.error(msg); process.exit(1); };

const parseFileFlag = (): string | undefined => {
  const args = process.argv.slice(5);
  const idx = args.indexOf('--file');
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
};

async function main(): Promise<void> {
  const client = getPipelineDaemonClient();
  let result: Record<string, unknown>;

  switch (command) {
    case 'init':
      if (!arg1) fail('Usage: pipeline-thin-cli.ts init "<task>"');
      result = await client.init(arg1);
      break;

    case 'next':
      if (!arg1) fail('Usage: pipeline-thin-cli.ts next <sessionId>');
      result = await client.next(arg1);
      break;

    case 'complete':
      if (!arg1 || !arg2) fail('Usage: pipeline-thin-cli.ts complete <sessionId> <agentKey> [--file <path>]');
      result = await client.complete(arg1, arg2, parseFileFlag());
      break;

    case 'complete-and-next':
      if (!arg1 || !arg2) fail('Usage: pipeline-thin-cli.ts complete-and-next <sessionId> <agentKey> [--file <path>]');
      result = await client.completeAndNext(arg1, arg2, parseFileFlag());
      break;

    case 'status':
      if (!arg1) fail('Usage: pipeline-thin-cli.ts status <sessionId>');
      result = await client.status(arg1);
      break;

    case 'resume':
      if (!arg1) fail('Usage: pipeline-thin-cli.ts resume <sessionId>');
      result = await client.resume(arg1);
      break;

    default:
      fail('Usage: pipeline-thin-cli.ts init|next|complete|complete-and-next|status|resume "<arg>"');
      return; // unreachable but satisfies TS
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => {
  console.error(`Error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
