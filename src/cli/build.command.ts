import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseManifest } from '../manifest/manifest-parser.js';
import { buildGraphFromManifest } from '../graph/build-graph.js';
import { createBuildOrchestrator } from '../build/build-orchestrator.js';
import { createAffectedDetector } from '../build/affected-detector.js';
import { DefaultBuildEngineRegistry } from '../build/ports/build-engine.port.js';
import { DockerBuildEngine } from '../build/adapters/docker-build-engine.adapter.js';
import { OctoError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import type { BuildResult } from '../build/build-scheduler.js';

/** Resolve entry name from a ServiceEntry or PackageEntry */
function entryName(entry: string | Record<string, unknown>): string {
  if (typeof entry === 'string') return entry;
  return Object.keys(entry)[0];
}

export async function buildCommand(service?: string, opts?: { affected?: boolean }): Promise<void> {
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

  const manifest = parsed.value;
  const graph = buildGraphFromManifest(manifest, rootDir);

  // Set up build engine registry
  const registry = new DefaultBuildEngineRegistry();
  registry.register(new DockerBuildEngine());

  const orchestrator = createBuildOrchestrator();
  const buildOptions = { workingDir: rootDir, manifest };

  let result: BuildResult | undefined;

  if (opts?.affected) {
    // --affected: build only modified services
    const detector = createAffectedDetector();
    const affected = await detector.detect(graph, rootDir);

    if (affected.length === 0) {
      logger.info('Nenhum serviço afetado detectado.');
      return;
    }

    logger.info(`Serviços afetados: ${affected.join(', ')}`);
    result = await orchestrator.buildTargets(affected, graph, registry, buildOptions);

    if (result.success) {
      await detector.recordBuild(affected, rootDir);
    }
  } else if (service) {
    // Validate service name against manifest
    const allNames = [
      ...manifest.services.map(entryName),
      ...(manifest.packages ?? []).map(entryName),
    ];

    if (!allNames.includes(service)) {
      throw new OctoError(
        `Serviço "${service}" não encontrado no manifesto.\nDisponíveis: ${allNames.join(', ')}`,
      );
    }

    result = await orchestrator.buildService(service, graph, registry, buildOptions);

    if (result.success) {
      const detector = createAffectedDetector();
      const r = result;
      const builtNames = [...r.results.keys()].filter(
        (n) => r.results.get(n)?.status === 'success',
      );
      await detector.recordBuild(builtNames, rootDir);
    }
  } else {
    // No args: build all
    result = await orchestrator.buildAll(graph, registry, buildOptions);

    if (result.success) {
      const detector = createAffectedDetector();
      const r = result;
      const builtNames = [...r.results.keys()].filter(
        (n) => r.results.get(n)?.status === 'success',
      );
      await detector.recordBuild(builtNames, rootDir);
    }
  }

  if (result && !result.success) {
    process.exitCode = 1;
  }
}
