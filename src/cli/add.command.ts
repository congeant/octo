import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../shared/logger.js';
import { OctoError } from '../shared/errors.js';
import { extractRepoName, cloneRepository } from '../shared/git.js';
import { detectProjectType, resolveProjectName } from '../manifest/manifest-discovery.js';
import { loadOrCreateManifest, addEntry, saveManifest } from '../manifest/manifest-mutator.js';

export interface AddCommandOptions {
  name?: string;
}

/**
 * octo add <repo-url>
 *
 * Clones a repository and registers it in octo.yaml.
 * The directory is resolved automatically from the repo name (or --name override).
 */
export async function addCommand(repoUrl: string, opts: AddCommandOptions): Promise<void> {
  const rootDir = process.cwd();
  const dirName = opts.name || extractRepoName(repoUrl);
  const targetDir = resolve(rootDir, dirName);

  if (existsSync(targetDir)) {
    throw new OctoError(`Directory already exists: ${dirName}. Use --name to specify another name.`);
  }

  await cloneRepository(repoUrl, targetDir);

  const type = detectProjectType(targetDir);
  const projectName = resolveProjectName(targetDir, dirName);

  const manifestPath = resolve(rootDir, 'octo.yaml');
  const { manifest, originalContent } = loadOrCreateManifest(manifestPath);

  const added = addEntry(manifest, projectName, dirName, type);

  if (!added) {
    logger.info(`Project "${projectName}" is already registered in octo.yaml.`);
    return;
  }

  saveManifest(manifestPath, manifest, originalContent);
  logger.info(`Project "${projectName}" added as ${type} in octo.yaml.`);
}
