import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseManifest } from '../manifest/manifest-parser.js';
import { buildGraphFromManifest } from '../graph/build-graph.js';
import { OctoError } from '../shared/errors.js';

/**
 * `octo graph` — displays the dependency graph as a visual tree in the terminal.
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
  if (!result.ok) throw result.error;

  const graph = buildGraphFromManifest(result.value, cwd);
  const sortResult = graph.topologicalSort();

  if (!sortResult.ok) throw sortResult.error;

  const allNames = sortResult.value;
  const totalNodes = allNames.length;
  const totalEdges = allNames.reduce((sum, n) => sum + graph.getDependencies(n).length, 0);

  console.log(`\n  Dependency Graph (${totalNodes} nodes, ${totalEdges} edges)\n`);

  for (const name of allNames) {
    const deps = graph.getDependencies(name);
    const dependents = graph.getDependents(name);
    const node = graph.getNode(name);
    const type = node?.type === 'service' ? '●' : '○';

    if (deps.length === 0 && dependents.length === 0) {
      console.log(`  ${type} ${name}`);
      continue;
    }

    console.log(`  ${type} ${name}`);

    for (let i = 0; i < deps.length; i++) {
      const isLast = i === deps.length - 1;
      const connector = isLast ? '└──' : '├──';
      console.log(`    ${connector} → ${deps[i]}`);
    }
  }

  console.log(`\n  ● service  ○ package  → depends on\n`);
}
