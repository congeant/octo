import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DependencyGraph, type GraphNode } from './dependency-graph.js';
import { isRemoteRepo, extractRepoName } from '../shared/git.js';
import { NodePackageReader } from '../manifest/adapters/node-package-reader.adapter.js';
import type { PackageReader } from '../manifest/ports/package-reader.port.js';
import type { OctoManifest, ServiceEntry, PackageEntry } from '../manifest/manifest-schema.js';

/**
 * Extracts the name and optional path override from a manifest entry.
 *
 * @param entry - A service or package entry (string or object with path config).
 * @returns Resolved name and optional explicit path.
 */
function resolveEntry(entry: ServiceEntry | PackageEntry): { name: string; path?: string } {
  if (typeof entry === 'string') return { name: entry };
  const key = Object.keys(entry)[0];
  const config = (entry as Record<string, { path?: string }>)[key];
  return { name: key, path: config?.path };
}

/**
 * Recursively searches for a directory whose package.json `name` matches targetName.
 * Skips node_modules, dist, and dot-prefixed directories. Max depth: 3.
 *
 * @param rootDir - Starting directory for the search.
 * @param targetName - The package name to find.
 * @param reader - PackageReader instance for reading package metadata.
 * @param maxDepth - Maximum recursion depth.
 * @returns Absolute path to the matching directory, or undefined.
 */
function findPackageDir(rootDir: string, targetName: string, reader: PackageReader, maxDepth = 3): string | undefined {
  function search(dir: string, depth: number): string | undefined {
    if (depth > maxDepth) return undefined;

    const pkg = reader.read(dir);
    if (pkg?.name === targetName) return dir;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return undefined;
    }

    for (const entry of entries) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) {
          const found = search(full, depth + 1);
          if (found) return found;
        }
      } catch { /* skip inaccessible */ }
    }
    return undefined;
  }

  return search(rootDir, 0);
}

/**
 * Builds a DependencyGraph from an OctoManifest.
 * Resolves project paths, reads package metadata via the PackageReader port,
 * and adds edges only for dependencies that reference other workspace projects.
 *
 * @param manifest - The parsed octo.yaml manifest.
 * @param rootDir - Workspace root directory.
 * @param reader - Optional PackageReader implementation (defaults to NodePackageReader).
 * @returns A populated DependencyGraph with nodes and internal dependency edges.
 */
export function buildGraphFromManifest(
  manifest: OctoManifest,
  rootDir: string,
  reader: PackageReader = new NodePackageReader(),
): DependencyGraph {
  const graph = new DependencyGraph();
  const resolvedPaths = new Map<string, string>();

  const allEntries: Array<{ name: string; path?: string; type: 'service' | 'package' }> = [];

  for (const entry of manifest.services) {
    const resolved = resolveEntry(entry);
    allEntries.push({ ...resolved, type: 'service' });
  }
  for (const entry of manifest.packages ?? []) {
    const resolved = resolveEntry(entry);
    allEntries.push({ ...resolved, type: 'package' });
  }

  for (const entry of allEntries) {
    let dir: string | undefined;

    if (entry.path) {
      dir = resolve(rootDir, entry.path);
    } else if (isRemoteRepo(entry.name)) {
      dir = resolve(rootDir, extractRepoName(entry.name));
    } else {
      dir = findPackageDir(rootDir, entry.name, reader);
    }

    if (!dir || !existsSync(dir)) continue;

    resolvedPaths.set(entry.name, dir);
    graph.addNode({ name: entry.name, type: entry.type, path: dir });
  }

  const internalNames = new Set(resolvedPaths.keys());

  for (const [name, dir] of resolvedPaths) {
    const pkg = reader.read(dir);
    if (!pkg) continue;

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const depName of Object.keys(allDeps)) {
      if (internalNames.has(depName)) {
        graph.addEdge(name, depName);
      }
    }
  }

  return graph;
}
