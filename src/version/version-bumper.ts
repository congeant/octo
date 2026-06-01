import { createInterface } from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import { run } from '../shared/process-runner.js';
import { logger } from '../shared/logger.js';
import { OctoError } from '../shared/errors.js';

export type BumpType = 'patch' | 'minor' | 'major';

export interface BumpResult {
  package: string;
  previousVersion: string;
  newVersion: string;
  propagated: PropagationEntry[];
}

export interface PropagationEntry {
  project: string;
  previousVersion: string;
  newVersion: string;
  skipped?: boolean;
  reason?: string;
}

/** Prompts user for y/n confirmation via readline */
function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

export class VersionBumper {
  /**
   * Bump a package version following semver 2.0.0.
   * @param packageDir - Absolute path to the package directory
   * @param packageName - The package name (e.g. @spectre/events)
   * @param type - Bump type, defaults to 'patch'
   */
  async bump(packageDir: string, packageName: string, type: BumpType = 'patch'): Promise<BumpResult> {
    const pkgJsonPath = join(packageDir, 'package.json');

    // 1. Read original package.json (byte-for-byte backup for rollback)
    const originalContent = await readFile(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(originalContent);
    const previousVersion: string = pkg.version;

    if (!semver.valid(previousVersion)) {
      throw new OctoError(`Versão inválida no package.json: ${previousVersion}`);
    }

    // 2. Calculate new version
    const newVersion = semver.inc(previousVersion, type);
    if (!newVersion) {
      throw new OctoError(`Falha ao incrementar versão ${previousVersion} com tipo ${type}`);
    }

    // 3. Check for uncommitted changes
    const status = await run('git', ['status', '--porcelain'], { cwd: packageDir });
    if (status.stdout.trim().length > 0) {
      logger.warn(`Alterações não commitadas detectadas em ${packageName}:`);
      logger.info(status.stdout.trim());
      const accepted = await confirm('Continuar com o bump? (y/n) ');
      if (!accepted) {
        throw new OctoError('Bump abortado pelo usuário');
      }
    }

    // 4. Write new version to package.json
    pkg.version = newVersion;
    const newContent = JSON.stringify(pkg, null, 2) + '\n';
    await writeFile(pkgJsonPath, newContent, 'utf-8');

    logger.info(`${packageName}: ${previousVersion} → ${newVersion}`);

    // 5. Run build
    const buildResult = await run('pnpm', ['run', 'build'], { cwd: packageDir });

    if (buildResult.exitCode !== 0) {
      // Rollback: restore original package.json byte-for-byte
      await writeFile(pkgJsonPath, originalContent, 'utf-8');
      logger.error(`Build falhou para ${packageName}. Rollback aplicado.`);
      logger.error(buildResult.stderr || buildResult.stdout);
      throw new OctoError(`Build falhou após bump de ${packageName}`);
    }

    // 6. Build passed — commit
    await run('git', ['add', pkgJsonPath], { cwd: packageDir });
    await run('git', ['commit', '-m', `chore(${packageName}): bump version to ${newVersion}`], { cwd: packageDir });

    logger.info(`Commit criado: chore(${packageName}): bump version to ${newVersion}`);

    return {
      package: packageName,
      previousVersion,
      newVersion,
      propagated: [],
    };
  }

  /** Rollback package.json to a given content (byte-for-byte) */
  async rollback(packageDir: string, originalContent: string): Promise<void> {
    const pkgJsonPath = join(packageDir, 'package.json');
    await writeFile(pkgJsonPath, originalContent, 'utf-8');
    logger.info('Rollback do package.json concluído.');
  }
}
