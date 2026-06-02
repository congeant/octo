import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from './logger.js';
import { isRemoteRepo, resolveGitUrl, extractRepoName, cloneRepository } from './git.js';
import { acquireGitToken, embedTokenInUrl, clearCachedToken } from './git-auth.js';
import type { OctoManifest, ServiceEntry, PackageEntry } from '../manifest/manifest-schema.js';

/**
 * Ensures all repositories declared in the manifest are present locally.
 * Prompts for a GitHub token once, embeds it in clone URLs (in-memory only).
 * Token is cleared from memory after all clones complete.
 *
 * @param manifest - The parsed octo.yaml manifest.
 * @param rootDir - Workspace root directory where repos are cloned.
 * @returns Number of repositories that were cloned.
 */
export async function ensureRepositories(manifest: OctoManifest, rootDir: string): Promise<number> {
  const entries = collectEntries(manifest);
  const pending = entries.filter(({ name, path: explicitPath }) => {
    if (!isRemoteRepo(name)) return false;
    const repoName = extractRepoName(name);
    const targetDir = resolve(rootDir, explicitPath ?? repoName);
    return !existsSync(targetDir);
  });

  if (pending.length === 0) return 0;

  logger.info(`${pending.length} repository(ies) to clone.`);

  const token = await acquireGitToken();

  try {
    let cloned = 0;
    for (const { name, path: explicitPath } of pending) {
      const repoName = extractRepoName(name);
      const targetDir = resolve(rootDir, explicitPath ?? repoName);
      const baseUrl = resolveGitUrl(name);
      const url = token ? embedTokenInUrl(baseUrl, token) : baseUrl;
      await cloneRepository(url, targetDir);
      cloned++;
    }

    logger.info(`Synced ${cloned} repository(ies).`);
    return cloned;
  } finally {
    clearCachedToken();
  }
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
