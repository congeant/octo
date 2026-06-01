import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseManifest } from '../manifest/manifest-parser.js';
import { buildGraphFromManifest } from '../graph/build-graph.js';
import { createInfraManager } from '../infra/infra-manager.js';
import { logger } from '../shared/logger.js';
import { OctoError } from '../shared/errors.js';

export async function upCommand(service?: string): Promise<void> {
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

  // Resolve service paths from graph
  let targetServices: string[] | undefined;
  if (service) {
    const node = graph.getNode(service);
    if (!node) {
      const available = graph.getNodeNames().join(', ');
      throw new OctoError(`Serviço "${service}" não encontrado. Disponíveis: ${available}`);
    }
    // Include service + its dependencies
    const deps = graph.getDependencies(service);
    targetServices = [service, ...deps];
  }

  // Collect all service paths from graph nodes
  const allNames = targetServices ?? graph.getNodeNames();
  const servicePaths = allNames
    .map((name) => graph.getNode(name)?.path)
    .filter((p): p is string => !!p);

  const manager = createInfraManager(servicePaths);
  const result = await manager.up(targetServices);

  if (!result.success) {
    throw new OctoError(result.message);
  }

  logger.info(result.message);
}
