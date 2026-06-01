import { basename } from 'node:path';
import { run } from './process-runner.js';
import { logger } from './logger.js';
import { OctoError } from './errors.js';

/**
 * Extracts the repository name from a git URL.
 * Supports HTTPS and SSH formats:
 *   https://github.com/user/repo.git → repo
 *   git@github.com:user/repo.git    → repo
 *   https://github.com/user/repo    → repo
 */
export function extractRepoName(url: string): string {
  const cleaned = url.replace(/\.git$/, '').replace(/\/$/, '');
  const parts = cleaned.split(/[/:]/);
  const name = parts[parts.length - 1];
  if (!name) {
    throw new OctoError(`Não foi possível extrair o nome do repositório de: ${url}`);
  }
  return name;
}

/**
 * Clones a git repository into the target directory.
 */
export async function cloneRepository(url: string, targetDir: string): Promise<void> {
  logger.info(`Clonando ${url}...`);

  const result = await run('git', ['clone', url, targetDir], {
    timeout: 120_000,
    interactive: true,
  });

  if (result.exitCode !== 0) {
    throw new OctoError(`Falha ao clonar repositório.`);
  }

  logger.info(`Repositório clonado em ./${basename(targetDir)}`);
}
