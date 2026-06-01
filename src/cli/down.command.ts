import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseManifest } from '../manifest/manifest-parser.js';
import { buildGraphFromManifest } from '../graph/build-graph.js';
import { createInfraManager } from '../infra/infra-manager.js';
import { logger } from '../shared/logger.js';
import { OctoError } from '../shared/errors.js';

export async function downCommand(opts: { volumes?: boolean }): Promise<void> {
  const rootDir = process.cwd();
  const manifestPath = resolve(rootDir, 'octo.yaml');

  let content: string;
  try {
    content = readFileSync(manifestPath, 'utf-8');
  } catch {
    throw new OctoError('octo.yaml não encontrado. Execute `octo init` primeiro.');
  }

  const parsed = parseManifest(content, manifestPath);
  if (!parsed.ok) throw parsed.error;

  const graph = buildGraphFromManifest(parsed.value, rootDir);
  const servicePaths = graph.getNodeNames()
    .map((name) => graph.getNode(name)?.path)
    .filter((p): p is string => !!p);

  const manager = createInfraManager(servicePaths);
  const result = await manager.down({ volumes: opts.volumes });

  if (!result.success) {
    throw new OctoError(result.message);
  }

  logger.info(result.message);
}
