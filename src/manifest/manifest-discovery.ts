import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ManifestError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

const MANIFEST_FILENAME = 'octo.yaml';
const MAX_DEPTH = 5;
const SKIP_DIRS = new Set(['node_modules', 'dist']);

export interface DiscoveredManifest {
  name: string;
  path: string;
  isRoot: boolean;
}

/** Checks if a directory name should be skipped during scan */
function shouldSkip(dirName: string): boolean {
  return dirName.startsWith('.') || SKIP_DIRS.has(dirName);
}

/**
 * Recursively scans directories for octo.yaml files.
 * Skips node_modules, dist, and dot-prefixed directories.
 * Max scan depth: 5 levels.
 */
function scanForManifests(dir: string, rootDir: string, depth: number): DiscoveredManifest[] {
  if (depth > MAX_DEPTH) return [];

  const results: DiscoveredManifest[] = [];
  const manifestPath = join(dir, MANIFEST_FILENAME);

  if (existsSync(manifestPath)) {
    const dirName = relative(rootDir, dir) || '.';
    results.push({
      name: dirName === '.' ? 'root' : dirName,
      path: manifestPath,
      isRoot: dir === rootDir,
    });
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (shouldSkip(entry)) continue;
    const fullPath = join(dir, entry);
    try {
      if (statSync(fullPath).isDirectory()) {
        results.push(...scanForManifests(fullPath, rootDir, depth + 1));
      }
    } catch {
      // Skip inaccessible entries
    }
  }

  return results;
}

/**
 * Discovers all octo.yaml manifests starting from rootDir.
 * If a root manifest exists alongside sub-manifests, prioritizes root.
 */
export function discoverManifests(rootDir: string): DiscoveredManifest[] {
  const all = scanForManifests(rootDir, rootDir, 0);

  // If root manifest exists, filter out sub-manifests already referenced
  const rootManifest = all.find((m) => m.isRoot);
  if (rootManifest && all.length > 1) {
    // Prioritize root — return only root manifest
    return [rootManifest];
  }

  return all;
}

/**
 * Resolves execution mode based on manifest discovery.
 * - standalone: exactly one octo.yaml in execution dir, no sub-manifests
 * - aggregated: multiple octo.yaml files in subdirectories
 */
export function resolveMode(rootDir: string): 'standalone' | 'aggregated' {
  const all = scanForManifests(rootDir, rootDir, 0);
  const rootManifest = all.find((m) => m.isRoot);
  const subManifests = all.filter((m) => !m.isRoot);

  // Root manifest with sub-manifests → standalone (root takes priority)
  if (rootManifest && subManifests.length > 0) {
    return 'standalone';
  }

  // Exactly one manifest in execution dir → standalone
  if (rootManifest && subManifests.length === 0) {
    return 'standalone';
  }

  // Multiple sub-manifests without root → aggregated
  if (subManifests.length > 1) {
    return 'aggregated';
  }

  // Single sub-manifest → standalone
  return 'standalone';
}

/**
 * Detects name collisions across discovered manifests.
 * Throws ManifestError if two manifests declare the same service/package name.
 */
export function detectNameCollisions(manifests: DiscoveredManifest[]): void {
  const seen = new Map<string, string>(); // name → path

  for (const manifest of manifests) {
    if (seen.has(manifest.name)) {
      const existing = seen.get(manifest.name)!;
      throw new ManifestError(
        `Name collision detected: "${manifest.name}" declared in both "${existing}" and "${manifest.path}"`,
      );
    }
    seen.set(manifest.name, manifest.path);
  }
}

/**
 * Displays discovered projects in aggregated mode.
 * Called at the beginning of execution when in aggregated mode.
 */
export function displayDiscoveredProjects(rootDir: string): DiscoveredManifest[] {
  const manifests = discoverManifests(rootDir);
  const mode = resolveMode(rootDir);

  if (mode === 'aggregated') {
    logger.info(`Modo agregado: ${manifests.length} projetos descobertos`);
    for (const m of manifests) {
      logger.info(`  → ${m.name} (${relative(rootDir, m.path)})`);
    }
  }

  detectNameCollisions(manifests);
  return manifests;
}
