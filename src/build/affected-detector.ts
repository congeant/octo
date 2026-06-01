import fs from 'node:fs/promises';
import path from 'node:path';
import type { DependencyGraph } from '../graph/dependency-graph.js';

const CACHE_FILE = '.octo-cache.json';

interface CacheData {
  builds: Record<string, number>;
}

export interface AffectedDetector {
  detect(graph: DependencyGraph, rootDir: string): Promise<string[]>;
  recordBuild(names: string[], rootDir: string): Promise<void>;
}

async function readCache(rootDir: string): Promise<CacheData | null> {
  try {
    const content = await fs.readFile(path.join(rootDir, CACHE_FILE), 'utf-8');
    return JSON.parse(content) as CacheData;
  } catch {
    return null;
  }
}

async function writeCache(rootDir: string, data: CacheData): Promise<void> {
  await fs.writeFile(path.join(rootDir, CACHE_FILE), JSON.stringify(data, null, 2));
}

/** Get the latest mtime of any file in a directory (recursive, skipping node_modules/dist) */
async function getLatestMtime(dir: string): Promise<number> {
  let latest = 0;

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }

  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dir, name);
    const stat = await fs.stat(fullPath);

    if (stat.isDirectory()) {
      const sub = await getLatestMtime(fullPath);
      if (sub > latest) latest = sub;
    } else {
      if (stat.mtimeMs > latest) latest = stat.mtimeMs;
    }
  }

  return latest;
}

/** Calculate transitive closure of dependents for a set of modified nodes */
function getTransitiveDependents(modified: Set<string>, graph: DependencyGraph): Set<string> {
  const affected = new Set<string>(modified);
  const queue = [...modified];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dep of graph.getDependents(current)) {
      if (!affected.has(dep)) {
        affected.add(dep);
        queue.push(dep);
      }
    }
  }

  return affected;
}

export function createAffectedDetector(): AffectedDetector {
  return {
    async detect(graph, rootDir) {
      const cache = await readCache(rootDir);
      const allNames = graph.getNodeNames();

      // No previous build → all affected
      if (!cache || Object.keys(cache.builds).length === 0) {
        return allNames;
      }

      // Find directly modified nodes
      const modified = new Set<string>();

      for (const name of allNames) {
        const node = graph.getNode(name);
        if (!node) continue;

        const lastBuild = cache.builds[name];
        if (lastBuild === undefined) {
          // Never built → affected
          modified.add(name);
          continue;
        }

        const latestMtime = await getLatestMtime(node.path);
        if (latestMtime > lastBuild) {
          modified.add(name);
        }
      }

      if (modified.size === 0) return [];

      // Transitive closure
      const affected = getTransitiveDependents(modified, graph);
      return [...affected];
    },

    async recordBuild(names, rootDir) {
      const cache = await readCache(rootDir) ?? { builds: {} };
      const now = Date.now();

      for (const name of names) {
        cache.builds[name] = now;
      }

      await writeCache(rootDir, cache);
    },
  };
}
