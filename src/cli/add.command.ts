import { pathExistsSync, readJsonSync } from 'fs-extra';
import { resolve, join } from 'node:path';
import { logger } from '../shared/logger.js';
import { OctoError } from '../shared/errors.js';
import { extractRepoName, cloneRepository } from '../shared/git.js';
import { detectProjectType, resolveProjectName } from '../manifest/manifest-discovery.js';
import { loadOrCreateManifest, addEntry, saveManifest } from '../manifest/manifest-mutator.js';

export interface AddCommandOptions {
  name?: string;
}

/**
 * Reads dependencies from a project's package.json.
 *
 * @param projectDir - Absolute path to the project directory.
 * @returns Combined dependency names from dependencies and devDependencies.
 */
function getProjectDeps(projectDir: string): string[] {
  const pkgPath = join(projectDir, 'package.json');
  if (!pathExistsSync(pkgPath)) return [];
  try {
    const pkg = readJsonSync(pkgPath);
    return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  } catch {
    return [];
  }
}

/**
 * Detects dependency relationships between the new project and existing workspace projects.
 * Reports which existing projects depend on the new one, and which the new one depends on.
 *
 * @param newProjectName - The package name of the newly added project.
 * @param newProjectDir - The directory of the newly cloned project.
 * @param existingEntries - Names of projects already in the manifest.
 * @param rootDir - Workspace root directory.
 */
function reportDependencies(
  newProjectName: string,
  newProjectDir: string,
  existingEntries: string[],
  rootDir: string,
): void {
  const newDeps = getProjectDeps(newProjectDir);
  const existingSet = new Set(existingEntries);

  // What does the new project depend on that's already in the workspace?
  const depsInWorkspace = newDeps.filter((d) => existingSet.has(d));
  if (depsInWorkspace.length > 0) {
    logger.info(`  → depends on: ${depsInWorkspace.join(', ')}`);
  }

  // Which existing projects depend on the new one?
  const dependents: string[] = [];
  for (const name of existingEntries) {
    const dir = resolve(rootDir, extractRepoName(name));
    if (!pathExistsSync(dir)) continue;
    const deps = getProjectDeps(dir);
    if (deps.includes(newProjectName)) {
      dependents.push(name);
    }
  }

  if (dependents.length > 0) {
    logger.info(`  → depended on by: ${dependents.join(', ')}`);
  }
}

/**
 * octo add <repo-url>
 *
 * Clones a repository and registers it in octo.yaml.
 * After registration, reports dependency relationships with existing workspace projects.
 */
export async function addCommand(repoUrl: string, opts: AddCommandOptions): Promise<void> {
  const rootDir = process.cwd();
  const dirName = opts.name || extractRepoName(repoUrl);
  const targetDir = resolve(rootDir, dirName);

  if (pathExistsSync(targetDir)) {
    throw new OctoError(`Directory already exists: ${dirName}. Use --name to specify another name.`);
  }

  await cloneRepository(repoUrl, targetDir);

  const type = detectProjectType(targetDir);
  const projectName = resolveProjectName(targetDir, dirName);

  const manifestPath = resolve(rootDir, 'octo.yaml');
  const { manifest, originalContent } = loadOrCreateManifest(manifestPath);

  // Collect existing entries before adding
  const existingEntries = [
    ...manifest.services.map((e) => typeof e === 'string' ? e : Object.keys(e)[0]),
    ...(manifest.packages ?? []).map((e) => typeof e === 'string' ? e : Object.keys(e)[0]),
  ];

  const added = addEntry(manifest, projectName, dirName, type);

  if (!added) {
    logger.info(`Project "${projectName}" is already registered in octo.yaml.`);
    return;
  }

  saveManifest(manifestPath, manifest, originalContent);
  logger.info(`Project "${projectName}" added as ${type} in octo.yaml.`);

  reportDependencies(projectName, targetDir, existingEntries, rootDir);
}
