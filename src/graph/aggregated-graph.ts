import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DependencyGraph } from './dependency-graph.js';
import { buildGraphFromManifest } from './build-graph.js';
import { parseManifest } from '../manifest/manifest-parser.js';
import type { DiscoveredManifest } from '../manifest/manifest-discovery.js';
import { logger } from '../shared/logger.js';

/**
 * Builds a unified DependencyGraph from multiple discovered manifests (aggregated mode).
 * Resolves cross-project dependencies: if service S in manifest B depends on package P
 * declared in manifest A, adds an edge from S to P in the unified graph.
 */
export function buildAggregatedGraph(manifests: DiscoveredManifest[]): DependencyGraph {
  const unified = new DependencyGraph();
  const localGraphs: DependencyGraph[] = [];

  for (const manifest of manifests) {
    let content: string;
    try {
      content = readFileSync(manifest.path, 'utf-8');
    } catch {
      logger.warn(`Could not read manifest: ${manifest.path}`);
      continue;
    }

    const result = parseManifest(content, manifest.path);
    if (!result.ok) {
      logger.warn(`Failed to parse manifest ${manifest.path}: ${result.error.message}`);
      continue;
    }

    const rootDir = dirname(manifest.path);
    const graph = buildGraphFromManifest(result.value, rootDir);
    localGraphs.push(graph);

    // Merge nodes into unified graph
    for (const name of graph.getNodeNames()) {
      const node = graph.getNode(name)!;
      unified.addNode(node);
    }

    // Merge local edges
    for (const name of graph.getNodeNames()) {
      for (const dep of graph.getDependencies(name)) {
        unified.addEdge(name, dep);
      }
    }
  }

  // Resolve cross-project edges: for each node, check if its package.json
  // dependencies reference a node from another manifest's graph
  const allNodeNames = new Set(unified.getNodeNames());

  for (const name of unified.getNodeNames()) {
    const node = unified.getNode(name)!;
    // Read package.json to find all dependencies
    const pkgPath = `${node.path}/package.json`;
    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
      continue;
    }

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const depName of Object.keys(allDeps)) {
      // Only add edge if the dependency is an internal node and not already connected
      if (allNodeNames.has(depName) && !unified.getDependencies(name).includes(depName)) {
        unified.addEdge(name, depName);
        logger.info(`Cross-project edge: ${name} → ${depName}`);
      }
    }
  }

  return unified;
}
