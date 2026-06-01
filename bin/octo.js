#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Resolve tsx ESM loader relative to this package's node_modules
const tsxEsmPath = require.resolve('tsx/esm');
const tsxImportUrl = pathToFileURL(tsxEsmPath).href;

const entry = resolve(__dirname, '..', 'src', 'cli', 'index.ts');

try {
  execFileSync('node', ['--import', tsxImportUrl, entry, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  });
} catch (err) {
  process.exit(err.status ?? 1);
}
