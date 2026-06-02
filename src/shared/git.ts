import { basename } from 'node:path';
import { run } from './process-runner.js';
import { logger } from './logger.js';
import { OctoError } from './errors.js';

/**
 * Extracts the repository name from a git URL or org/repo shorthand.
 * Supports HTTPS, SSH, and GitHub shorthand formats:
 *   https://github.com/user/repo.git → repo
 *   git@github.com:user/repo.git    → repo
 *   user/repo                        → repo
 *
 * @param url - Git URL or org/repo shorthand.
 * @returns The repository name (last segment without .git suffix).
 * @throws OctoError if the name cannot be extracted.
 */
export function extractRepoName(url: string): string {
  const cleaned = url.replace(/\.git$/, '').replace(/\/$/, '');
  const parts = cleaned.split(/[/:]/);
  const name = parts[parts.length - 1];
  if (!name) {
    throw new OctoError(`Could not extract repository name from: ${url}`);
  }
  return name;
}

/**
 * Checks if a manifest entry name is a git remote reference (org/repo format).
 *
 * @param name - The entry name from octo.yaml.
 * @returns true if the name matches org/repo pattern (contains exactly one slash, no @ prefix).
 */
export function isRemoteRepo(name: string): boolean {
  return /^[^@/]+\/[^/]+$/.test(name);
}

/**
 * Converts an org/repo shorthand to a full GitHub HTTPS URL.
 *
 * @param shorthand - The org/repo string (e.g. "vguerato/spectre-tasks").
 * @returns Full clone URL (e.g. "https://github.com/vguerato/spectre-tasks.git").
 */
export function resolveGitUrl(shorthand: string): string {
  return `https://github.com/${shorthand}.git`;
}

/**
 * Clones a git repository into the target directory.
 * Supports optional env vars for auth injection (GIT_ASKPASS).
 *
 * @param url - Full git URL to clone.
 * @param targetDir - Absolute path where the repo will be cloned.
 * @param env - Optional environment variables (e.g. GIT_ASKPASS for token auth).
 * @throws OctoError if clone exits with non-zero code.
 */
export async function cloneRepository(url: string, targetDir: string, env?: Record<string, string>): Promise<void> {
  logger.info(`Cloning ${url}...`);

  const result = await run('git', ['clone', url, targetDir], {
    timeout: 120_000,
    interactive: !env,
    env,
  });

  if (result.exitCode !== 0) {
    throw new OctoError(`Failed to clone repository: ${result.stderr.trim() || 'unknown error'}`);
  }

  logger.info(`Repository cloned to ./${basename(targetDir)}`);
}
