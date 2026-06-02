import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from './logger.js';
import { isRemoteRepo, resolveGitUrl, extractRepoName, cloneRepository } from './git.js';
import type { OctoManifest, ServiceEntry, PackageEntry } from '../manifest/manifest-schema.js';

/**
 * Ensures all repositories declared in the manifest are present locally.
 * Entries matching the org/repo pattern are treated as remote GitHub repositories.
 * Missing repos are cloned in sequence without user interaction (uses credential cache).
 *
 * @param manifest - The parsed octo.yaml manifest.
 * @param rootDir - Workspace root directory where repos are cloned.
 * @returns Number of repositories that were cloned.
 */
export async function ensureRepositories(manifest: OctoManifest, rootDir: string): Promise<number> {
  const entries = collectEntries(manifest);
  let cloned = 0;

  for (const entry of entries) {
    const { name, path: explicitPath } = entry;

    // Only process remote repos (org/repo format)
    if (!isRemoteRepo(name)) continue;

    const repoName = extractRepoName(name);
    const targetDir = resolve(rootDir, explicitPath ?? repoName);

    if (existsSync(targetDir)) continue;

    const url = resolveGitUrl(name);
    await cloneRepository(url, targetDir);
    cloned++;
  }

  if (cloned > 0) {
    logger.info(`Synced ${cloned} repository(ies).`);
  }

  return cloned;
}

/**
 * Extracts all entry names and paths from the manifest (services + packages).
 */
function collectEntries(manifest: OctoManifest): Array<{ name: string; path?: string }> {
  const results: Array<{ name: string; path?: string }> = [];

  for (const entry of manifest.services) {
    results.push(resolveEntry(entry));
  }
  for (const entry of manifest.packages ?? []) {
    results.push(resolveEntry(entry));
  }

  return results;
}

function resolveEntry(entry: ServiceEntry | PackageEntry): { name: string; path?: string } {
  if (typeof entry === 'string') return { name: entry };
  const key = Object.keys(entry)[0];
  const config = (entry as Record<string, { path?: string }>)[key];
  return { name: key, path: config?.path };
}
