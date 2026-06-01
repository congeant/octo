import os from 'node:os';
import type { DependencyGraph } from '../graph/dependency-graph.js';
import type { BuildEngine, BuildTarget, BuildEngineResult } from './ports/build-engine.port.js';
import { isShuttingDown } from '../shared/shutdown.js';

export type BuildStatus = 'pending' | 'building' | 'success' | 'failure' | 'cancelled';

export interface BuildPlan {
  levels: string[][];
}

export interface BuildNodeResult {
  status: BuildStatus;
  duration: number;
  error?: string;
}

export interface BuildResult {
  success: boolean;
  results: Map<string, BuildNodeResult>;
}

export type ProgressCallback = (progress: BuildProgress[]) => void;

export interface BuildProgress {
  service: string;
  status: BuildStatus;
  durationSeconds: number;
}

export interface BuildScheduler {
  schedule(graph: DependencyGraph, targets: string[]): BuildPlan;
  execute(
    plan: BuildPlan,
    graph: DependencyGraph,
    buildFn: (name: string) => Promise<BuildEngineResult>,
    onProgress: ProgressCallback,
    maxWorkers?: number,
  ): Promise<BuildResult>;
}

/** Collects all transitive dependents of a node in the graph */
function getTransitiveDependents(graph: DependencyGraph, node: string): Set<string> {
  const result = new Set<string>();
  const queue = [node];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const dep of graph.getDependents(current)) {
      if (!result.has(dep)) {
        result.add(dep);
        queue.push(dep);
      }
    }
  }
  return result;
}

export function createBuildScheduler(): BuildScheduler {
  return {
    schedule(graph: DependencyGraph, targets: string[]): BuildPlan {
      const allLevels = graph.getIndependentGroups();
      if (targets.length === 0) return { levels: allLevels };

      // Filter levels to only include requested targets
      const targetSet = new Set(targets);
      const filtered = allLevels
        .map((level) => level.filter((n) => targetSet.has(n)))
        .filter((level) => level.length > 0);

      return { levels: filtered };
    },

    async execute(
      plan: BuildPlan,
      graph: DependencyGraph,
      buildFn: (name: string) => Promise<BuildEngineResult>,
      onProgress: ProgressCallback,
      maxWorkers?: number,
    ): Promise<BuildResult> {
      const concurrency = maxWorkers ?? os.cpus().length;
      const results = new Map<string, BuildNodeResult>();
      const cancelled = new Set<string>();
      const startTimes = new Map<string, number>();

      // Initialize all nodes as pending
      for (const level of plan.levels) {
        for (const node of level) {
          results.set(node, { status: 'pending', duration: 0 });
        }
      }

      // Progress reporting interval
      const progressInterval = setInterval(() => {
        const progress: BuildProgress[] = [];
        for (const [name, result] of results) {
          const start = startTimes.get(name);
          const elapsed = start ? (Date.now() - start) / 1000 : 0;
          progress.push({
            service: name,
            status: result.status,
            durationSeconds: result.status === 'building' ? elapsed : result.duration / 1000,
          });
        }
        onProgress(progress);
      }, 1000);

      try {
        for (const level of plan.levels) {
          if (isShuttingDown()) break;

          const activeNodes = level.filter((n) => !cancelled.has(n));

          // Execute level in parallel, limited by concurrency
          const chunks: string[][] = [];
          for (let i = 0; i < activeNodes.length; i += concurrency) {
            chunks.push(activeNodes.slice(i, i + concurrency));
          }

          for (const chunk of chunks) {
            const promises = chunk.map(async (node) => {
              if (cancelled.has(node) || isShuttingDown()) {
                results.set(node, { status: 'cancelled', duration: 0 });
                return;
              }

              startTimes.set(node, Date.now());
              results.set(node, { status: 'building', duration: 0 });

              try {
                const engineResult = await buildFn(node);
                const duration = Date.now() - startTimes.get(node)!;

                if (engineResult.success) {
                  results.set(node, { status: 'success', duration });
                } else {
                  results.set(node, { status: 'failure', duration, error: engineResult.output });
                  // Cancel all transitive dependents
                  const dependents = getTransitiveDependents(graph, node);
                  for (const dep of dependents) {
                    cancelled.add(dep);
                    results.set(dep, { status: 'cancelled', duration: 0 });
                  }
                }
              } catch (err) {
                const duration = Date.now() - startTimes.get(node)!;
                const error = err instanceof Error ? err.message : String(err);
                results.set(node, { status: 'failure', duration, error });
                // Cancel all transitive dependents
                const dependents = getTransitiveDependents(graph, node);
                for (const dep of dependents) {
                  cancelled.add(dep);
                  results.set(dep, { status: 'cancelled', duration: 0 });
                }
              }
            });

            await Promise.all(promises);
          }
        }
      } finally {
        clearInterval(progressInterval);
      }

      const success = [...results.values()].every(
        (r) => r.status === 'success' || r.status === 'cancelled',
      ) && [...results.values()].some((r) => r.status === 'success');

      // Overall success: no failures
      const hasFailure = [...results.values()].some((r) => r.status === 'failure');

      return { success: !hasFailure, results };
    },
  };
}
