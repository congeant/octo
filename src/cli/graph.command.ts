import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseManifest } from '../manifest/manifest-parser.js';
import { buildGraphFromManifest } from '../graph/build-graph.js';
import { ensureRepositories } from '../shared/sync.js';
import { OctoError } from '../shared/errors.js';

/**
 * `octo graph` — displays the dependency graph on stdout as an indented adjacency list.
 */
export async function graphCommand(): Promise<void> {
  const cwd = process.cwd();
  const manifestPath = join(cwd, 'octo.yaml');

  let content: string;
  try {
    content = readFileSync(manifestPath, 'utf-8');
  } catch {
    throw new OctoError(`Could not read ${manifestPath}. Run "octo init" first.`);
  }

  const result = parseManifest(content, manifestPath);
  if (!result.ok) {
    throw result.error;
  }

  await ensureRepositories(result.value, cwd);
  const graph = buildGraphFromManifest(result.value, cwd);
  const sortResult = graph.topologicalSort();

  if (!sortResult.ok) {
    throw sortResult.error;
  }

  // Print each node followed by its dependencies indented with 2 spaces
  for (const name of sortResult.value) {
    process.stdout.write(`${name}\n`);
    for (const dep of graph.getDependencies(name)) {
      process.stdout.write(`  ${dep}\n`);
    }
  }
}
