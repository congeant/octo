import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import treeify from 'treeify';
import { parseManifest } from '../manifest/manifest-parser.js';
import { buildGraphFromManifest } from '../graph/build-graph.js';
import { OctoError } from '../shared/errors.js';

/**
 * `octo graph` — displays the dependency graph as a tree in the terminal using treeify.
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
  const totalEdges = allNames.reduce((sum, n) => sum + graph.getDependencies(n).length, 0);

  // Build treeify-compatible object
  const tree: Record<string, any> = {};

  for (const name of allNames) {
    const deps = graph.getDependencies(name);
    const node = graph.getNode(name);
    const icon = node?.type === 'service' ? '●' : '○';
    const label = `${icon} ${name}`;

    if (deps.length === 0) {
      tree[label] = null;
    } else {
      const children: Record<string, null> = {};
      for (const dep of deps) {
        children[`→ ${dep}`] = null;
      }
      tree[label] = children;
    }
  }

  console.log(`\n  Dependency Graph (${allNames.length} nodes, ${totalEdges} edges)\n`);
  console.log(treeify.asTree(tree, true, true));
  console.log('  ● service  ○ package  → depends on\n');
}
