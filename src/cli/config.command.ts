import { run } from '../shared/process-runner.js';
import { logger } from '../shared/logger.js';
import { confirm } from '../shared/prompt.js';

export interface ConfigCommandOptions {
  credentialCache?: string;
}

/**
 * octo config
 *
 * Configures octo and git settings interactively or via flags.
 */
export async function configCommand(opts: ConfigCommandOptions): Promise<void> {
  if (opts.credentialCache) {
    await setCredentialCache(opts.credentialCache);
    return;
  }

  // Interactive mode
  const shouldConfigure = await confirm('Enable git credential cache? (y/n) ');
  if (shouldConfigure) {
    await setCredentialCache('cache');
  }
}

async function setCredentialCache(value: string): Promise<void> {
  const result = await run('git', ['config', '--local', 'credential.helper', value]);
  if (result.exitCode !== 0) {
    logger.error(`Failed to set credential.helper: ${result.stderr.trim()}`);
    return;
  }
  logger.info(`Git credential.helper set to "${value}".`);
}
