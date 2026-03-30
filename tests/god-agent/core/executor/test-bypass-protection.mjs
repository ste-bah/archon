/**
 * Test script to verify shell-quote bypass protection (TASK-SEC-002)
 * Run with: node tests/god-agent/core/executor/test-bypass-protection.mjs
 */

import { parse } from 'shell-quote';

const bypassAttempts = [
  'rm  -rf /',           // Extra space bypass
  'rm "-rf" /',          // Quoted flags
  '/usr/bin/rm -rf /',   // Full path
  'sudo    apt-get',     // Extra spaces with sudo
  'kill -9 1234',        // kill command
  'chmod 777 /etc',      // chmod command
  'dd if=/dev/zero',     // dd command
  'echo "safe command"', // Should pass
  'npx claude-flow hooks pre-task', // Should pass
];

const BLOCKED_COMMANDS = ['rm', 'sudo', 'chmod', 'chown', 'dd', 'mkfs', 'fdisk', 'kill', 'killall'];
const DANGEROUS_FLAG_PATTERNS = ['-rf', '-fr', '--recursive', '--force', '-f', '-r'];
const DANGEROUS_PATH_PATTERNS = ['/*', '../'];

console.log('Testing shell-quote bypass protection:\n');

let allPassed = true;

for (const script of bypassAttempts) {
  const tokens = parse(script);
  const warnings = [];

  for (const token of tokens) {
    if (typeof token !== 'string') continue;
    const normalized = token.toLowerCase();

    for (const cmd of BLOCKED_COMMANDS) {
      if (normalized === cmd || normalized.endsWith('/' + cmd)) {
        warnings.push('Blocked: ' + token);
      }
    }
    // Check flags (exact match)
    for (const flag of DANGEROUS_FLAG_PATTERNS) {
      if (token === flag) {
        warnings.push('Dangerous flag: ' + flag);
      }
    }
    // Check path patterns (substring)
    for (const pathPattern of DANGEROUS_PATH_PATTERNS) {
      if (token.includes(pathPattern)) {
        warnings.push('Dangerous path: ' + pathPattern);
      }
    }
  }

  const shouldBlock = !script.includes('echo') && !script.includes('claude-flow');
  const isBlocked = warnings.length > 0;
  const testPassed = shouldBlock === isBlocked;

  if (!testPassed) allPassed = false;

  console.log(`Script: "${script}"`);
  console.log(`  Tokens: ${JSON.stringify(tokens)}`);
  console.log(`  Detected: ${warnings.length > 0 ? warnings.join(', ') : 'NONE'}`);
  console.log(`  Result: ${testPassed ? 'PASS' : 'FAIL'}`);
  console.log('');
}

console.log('='.repeat(50));
console.log(`Overall: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
process.exit(allPassed ? 0 : 1);
