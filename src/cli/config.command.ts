import { run } from '../shared/process-runner.js';
import { logger } from '../shared/logger.js';

/**
 * octo config git-cache
 *
 * Enables git credential cache locally.
 */
export async function configGitCacheCommand(value?: string): Promise<void> {
  const helper = value || 'cache';
  const result = await run('git', ['config', '--local', 'credential.helper', helper]);
  if (result.exitCode !== 0) {
    logger.error(`Failed to set credential.helper: ${result.stderr.trim()}`);
    return;
  }
  logger.info(`Git credential.helper set to "${helper}".`);
}
