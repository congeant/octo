#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '..', 'src', 'cli', 'index.ts');

try {
  execFileSync('node', ['--import', 'tsx', entry, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  });
} catch (err) {
  process.exit(err.status ?? 1);
}
