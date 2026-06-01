import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DependencyGraph, type GraphNode } from './dependency-graph.js';
import type { OctoManifest, ServiceEntry, PackageEntry } from '../manifest/manifest-schema.js';

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Extract the name and optional path override from a manifest entry */
function resolveEntry(entry: ServiceEntry | PackageEntry): { name: string; path?: string } {
  if (typeof entry === 'string') return { name: entry };
  // Object format: { "auth": { path?: "./custom" } }
  const key = Object.keys(entry)[0];
  const config = (entry as Record<string, { path?: string }>)[key];
  return { name: key, path: config?.path };
}

/**
 * Recursively search for a directory containing a package.json whose `name` matches `targetName`.
 * Searches up to depth 3 from rootDir.
 */
function findPackageDir(rootDir: string, targetName: string, maxDepth = 3): string | undefined {
  function search(dir: string, depth: number): string | undefined {
    if (depth > maxDepth) return undefined;

    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
        if (pkg.name === targetName) return dir;
      } catch { /* skip invalid json */ }
    }

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

/** Read a package.json from a directory, returning undefined if not found */
function readPackageJson(dir: string): PackageJson | undefined {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return undefined;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
  } catch {
    return undefined;
  }
}

/**
 * Build a DependencyGraph from an OctoManifest.
 * Reads each service/package's package.json and adds edges only for internal dependencies.
 */
export function buildGraphFromManifest(manifest: OctoManifest, rootDir: string): DependencyGraph {
  const graph = new DependencyGraph();
  const resolvedPaths = new Map<string, string>();

  // Collect all declared names (services + packages)
  const allEntries: Array<{ name: string; path?: string; type: 'service' | 'package' }> = [];

  for (const entry of manifest.services) {
    const resolved = resolveEntry(entry);
    allEntries.push({ ...resolved, type: 'service' });
  }
  for (const entry of manifest.packages) {
    const resolved = resolveEntry(entry);
    allEntries.push({ ...resolved, type: 'package' });
  }

  // Resolve paths and add nodes
  for (const entry of allEntries) {
    let dir: string | undefined;

    if (entry.path) {
      dir = resolve(rootDir, entry.path);
    } else {
      dir = findPackageDir(rootDir, entry.name);
    }

    if (!dir) continue;

    resolvedPaths.set(entry.name, dir);
    const node: GraphNode = { name: entry.name, type: entry.type, path: dir };
    graph.addNode(node);
  }

  // Set of all internal package names for quick lookup
  const internalNames = new Set(resolvedPaths.keys());

  // Add edges based on package.json dependencies
  for (const [name, dir] of resolvedPaths) {
    const pkg = readPackageJson(dir);
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
