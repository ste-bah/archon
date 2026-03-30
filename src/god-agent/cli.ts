#!/usr/bin/env node
/**
 * God Agent CLI
 */

import { Command } from 'commander';
import { GodAgent } from './core/index.js';

const program = new Command();

program
  .name('god-agent')
  .description('God Agent - Neuro-Symbolic AI System')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize God Agent')
  .option('-v, --verbose', 'Enable verbose output')
  .action(async (options) => {
    const agent = new GodAgent({ verbose: options.verbose });
    const result = await agent.initialize();
    console.log(`God Agent initialized in ${result.initTimeMs.toFixed(2)}ms`);
    console.log(`Runtime: ${result.runtime.type}`);
    await agent.shutdown();
  });

program
  .command('status')
  .description('Show God Agent status')
  .action(async () => {
    const agent = new GodAgent();
    await agent.initialize();
    const status = agent.getStatus();
    console.log(JSON.stringify(status, null, 2));
    await agent.shutdown();
  });

program
  .command('benchmark')
  .description('Run performance benchmarks')
  .option('-i, --iterations <n>', 'Number of iterations', '100')
  .action(async (options) => {
    const agent = new GodAgent();
    await agent.initialize();

    const iterations = parseInt(options.iterations);
    console.log(`Running ${iterations} iterations...`);

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const embedding = new Float32Array(1536).fill(Math.random());
      await agent.store({ content: `item-${i}`, embedding });
    }
    const elapsed = performance.now() - start;

    console.log(`Stored ${iterations} items in ${elapsed.toFixed(2)}ms`);
    console.log(`Avg: ${(elapsed / iterations).toFixed(2)}ms/item`);

    await agent.shutdown();
  });

program.parse();
