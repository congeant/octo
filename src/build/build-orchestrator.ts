import os from 'node:os';
import { logger } from '../shared/logger.js';
import { onShutdown } from '../shared/shutdown.js';
import { runHooks } from '../hooks/hook-runner.js';
import type { HookContext } from '../hooks/hook-runner.js';
import type { DependencyGraph } from '../graph/dependency-graph.js';
import type { BuildEngine, BuildEngineRegistry, BuildTarget } from './ports/build-engine.port.js';
import type { OctoManifest } from '../manifest/manifest-schema.js';
import {
  createBuildScheduler,
  type BuildResult,
  type BuildProgress,
  type BuildStatus,
} from './build-scheduler.js';

export interface BuildOptions {
  maxWorkers?: number;
  workingDir: string;
  manifest: OctoManifest;
}

export interface BuildOrchestrator {
  buildAll(graph: DependencyGraph, registry: BuildEngineRegistry, options: BuildOptions): Promise<BuildResult>;
  buildService(name: string, graph: DependencyGraph, registry: BuildEngineRegistry, options: BuildOptions): Promise<BuildResult>;
  buildTargets(targets: string[], graph: DependencyGraph, registry: BuildEngineRegistry, options: BuildOptions): Promise<BuildResult>;
}

function formatDuration(seconds: number): string {
  return seconds < 1 ? '<1s' : `${Math.round(seconds)}s`;
}

function renderProgressFn(progress: BuildProgress[]): void {
  const lines = progress.map((p) => {
    const icon = p.status === 'success' ? '✓' : p.status === 'failure' ? '✗' : p.status === 'building' ? '⟳' : p.status === 'cancelled' ? '⊘' : '○';
    return `  ${icon} ${p.service} [${p.status}] ${formatDuration(p.durationSeconds)}`;
  });
  logger.info(`Build progress:\n${lines.join('\n')}`);
}

export function createBuildOrchestrator(): BuildOrchestrator {
  const scheduler = createBuildScheduler();
  let lastProgress: BuildProgress[] = [];

  // Report partial state on shutdown
  onShutdown(() => {
    if (lastProgress.length > 0) {
      const completed = lastProgress.filter((p) => p.status === 'success');
      const inProgress = lastProgress.filter((p) => p.status === 'building');
      const pending = lastProgress.filter((p) => p.status === 'pending');
      logger.info(
        `Estado parcial: ${completed.length} concluídos, ${inProgress.length} em andamento, ${pending.length} pendentes`,
      );
      if (completed.length > 0) {
        logger.info(`  Concluídos: ${completed.map((p) => p.service).join(', ')}`);
      }
      if (inProgress.length > 0) {
        logger.info(`  Em andamento: ${inProgress.map((p) => p.service).join(', ')}`);
      }
    }
  });

  function renderProgress(progress: BuildProgress[]): void {
    lastProgress = progress;
    renderProgressFn(progress);
  }

  async function runPreBuildHooks(options: BuildOptions): Promise<void> {
    const hookContext: HookContext = {
      target: 'all',
      workingDir: options.workingDir,
      manifest: options.manifest,
    };
    await runHooks('pre-build', hookContext);
  }

  function makeBuildFn(graph: DependencyGraph, registry: BuildEngineRegistry) {
    return async (name: string) => {
      const node = graph.getNode(name);
      if (!node) {
        return { success: false, output: `Node "${name}" not found in graph`, durationMs: 0 };
      }

      // Detect build file (Dockerfile by default for services)
      const buildFile = 'Dockerfile';
      const engine = registry.resolve(buildFile);

      if (!engine) {
        return { success: false, output: `No build engine found for "${buildFile}"`, durationMs: 0 };
      }

      const target: BuildTarget = {
        name: node.name,
        path: node.path,
        buildFile,
      };

      return engine.build(target);
    };
  }

  return {
    async buildAll(graph, registry, options): Promise<BuildResult> {
      await runPreBuildHooks(options);

      const targets = graph.getNodeNames();
      const plan = scheduler.schedule(graph, targets);
      const maxWorkers = options.maxWorkers ?? os.cpus().length;

      logger.info(`Building ${targets.length} targets (max ${maxWorkers} workers)...`);

      const result = await scheduler.execute(
        plan,
        graph,
        makeBuildFn(graph, registry),
        renderProgress,
        maxWorkers,
      );

      if (result.success) {
        logger.info('All builds completed successfully.');
      } else {
        const failures = [...result.results.entries()]
          .filter(([, r]) => r.status === 'failure')
          .map(([name]) => name);
        logger.error(`Build failed for: ${failures.join(', ')}`);
      }

      return result;
    },

    async buildService(name, graph, registry, options): Promise<BuildResult> {
      await runPreBuildHooks(options);

      const plan = scheduler.schedule(graph, [name]);
      const maxWorkers = options.maxWorkers ?? os.cpus().length;

      logger.info(`Building service "${name}"...`);

      const result = await scheduler.execute(
        plan,
        graph,
        makeBuildFn(graph, registry),
        renderProgress,
        maxWorkers,
      );

      return result;
    },

    async buildTargets(targets, graph, registry, options): Promise<BuildResult> {
      await runPreBuildHooks(options);

      const plan = scheduler.schedule(graph, targets);
      const maxWorkers = options.maxWorkers ?? os.cpus().length;

      logger.info(`Building ${targets.length} targets...`);

      const result = await scheduler.execute(
        plan,
        graph,
        makeBuildFn(graph, registry),
        renderProgress,
        maxWorkers,
      );

      return result;
    },
  };
}
