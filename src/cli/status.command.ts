import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseManifest } from '../manifest/manifest-parser.js';
import { buildGraphFromManifest } from '../graph/build-graph.js';
import { createInfraManager } from '../infra/infra-manager.js';
import { logger } from '../shared/logger.js';
import { OctoError } from '../shared/errors.js';

export async function statusCommand(): Promise<void> {
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

  const graph = buildGraphFromManifest(parsed.value, rootDir);
  const servicePaths = graph.getNodeNames()
    .map((name) => graph.getNode(name)?.path)
    .filter((p): p is string => !!p);

  const manager = createInfraManager(servicePaths, rootDir);
  const containers = await manager.status();

  if (containers.length === 0) {
    logger.info('No containers running.');
    return;
  }

  // Print table header
  const header = `${'NOME'.padEnd(30)} ${'IMAGEM'.padEnd(35)} ${'ESTADO'.padEnd(12)} PORTA`;
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const c of containers) {
    console.log(
      `${c.name.padEnd(30)} ${c.image.padEnd(35)} ${c.state.padEnd(12)} ${c.port}`,
    );
  }
}
