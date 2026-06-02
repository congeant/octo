import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseManifest } from '../manifest/manifest-parser.js';
import { ensureRepositories } from '../shared/sync.js';
import { OctoError } from '../shared/errors.js';

/**
 * octo sync
 *
 * Clones all missing repositories declared in octo.yaml.
 * Repos using org/repo format are cloned from GitHub into ./repo-name.
 */
export async function syncCommand(): Promise<void> {
  const rootDir = process.cwd();
  const manifestPath = resolve(rootDir, 'octo.yaml');

  let content: string;
  try {
    content = readFileSync(manifestPath, 'utf-8');
  } catch {
    throw new OctoError('octo.yaml not found. Run `octo init` first.');
  }

  const parsed = parseManifest(content, manifestPath);
  if (!parsed.ok) throw parsed.error;

  await ensureRepositories(parsed.value, rootDir);
}
