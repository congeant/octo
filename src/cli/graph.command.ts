import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseManifest } from '../manifest/manifest-parser.js';
import { buildGraphFromManifest } from '../graph/build-graph.js';
import { OctoError } from '../shared/errors.js';

/**
 * `octo graph` — exibe grafo de dependências no stdout em formato de lista de adjacência indentada.
 */
export async function graphCommand(): Promise<void> {
  const cwd = process.cwd();
  const manifestPath = join(cwd, 'octo.yaml');

  let content: string;
  try {
    content = readFileSync(manifestPath, 'utf-8');
  } catch {
    throw new OctoError(`Não foi possível ler ${manifestPath}. Execute "octo init" primeiro.`);
  }

  const result = parseManifest(content, manifestPath);
  if (!result.ok) {
    throw result.error;
  }

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
