import { createInterface } from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import { run } from '../shared/process-runner.js';
import { logger } from '../shared/logger.js';
import { OctoError } from '../shared/errors.js';
import type { OctoManifest } from '../manifest/manifest-schema.js';
import { renderTemplate, getCommitTemplate, getTagTemplate } from './template-renderer.js';

export type BumpType = 'patch' | 'minor' | 'major';

export interface BumpOptions {
  push?: boolean;
  tag?: boolean;
  auto?: boolean;
  manifest?: OctoManifest;
}

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
  async bump(packageDir: string, packageName: string, type: BumpType = 'patch', options: BumpOptions = {}): Promise<BumpResult> {
    const pkgJsonPath = join(packageDir, 'package.json');
    const originalContent = await readFile(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(originalContent);
    const previousVersion: string = pkg.version;

    if (!semver.valid(previousVersion)) {
      throw new OctoError(`Invalid version in package.json: ${previousVersion}`);
    }

    const newVersion = semver.inc(previousVersion, type);
    if (!newVersion) {
      throw new OctoError(`Failed to increment version ${previousVersion} with type ${type}`);
    }

    // Check uncommitted changes (skip in auto mode)
    if (!options.auto) {
      const status = await run('git', ['status', '--porcelain'], { cwd: packageDir });
      if (status.stdout.trim().length > 0) {
        logger.warn(`Uncommitted changes detected in ${packageName}:`);
        logger.info(status.stdout.trim());
        const accepted = await confirm('Continue with bump? (y/n) ');
        if (!accepted) {
          throw new OctoError('Bump aborted by user');
        }
      }
    }

    // Write new version
    pkg.version = newVersion;
    await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    logger.info(`${packageName}: ${previousVersion} → ${newVersion}`);

    // Run build
    const buildResult = await run('pnpm', ['run', 'build'], { cwd: packageDir });
    if (buildResult.exitCode !== 0) {
      await writeFile(pkgJsonPath, originalContent, 'utf-8');
      logger.error(`Build failed for ${packageName}. Rollback applied.`);
      logger.error(buildResult.stderr || buildResult.stdout);
      throw new OctoError(`Build failed after bump of ${packageName}`);
    }

    // Template context
    const ctx = {
      name: packageName,
      version: newVersion,
      previousVersion,
      type,
      date: new Date().toISOString().slice(0, 10),
    };

    // Commit with template
    const commitTemplate = options.manifest ? getCommitTemplate(options.manifest) : 'chore({{name}}): bump version to {{version}}';
    const commitMsg = renderTemplate(commitTemplate, ctx);

    await run('git', ['add', pkgJsonPath], { cwd: packageDir });
    await run('git', ['commit', '-m', commitMsg], { cwd: packageDir });
    logger.info(`Commit: ${commitMsg}`);

    // Tag (if --tag or --auto)
    if (options.tag || options.auto) {
      const tagTemplate = options.manifest ? getTagTemplate(options.manifest) : '{{name}}@{{version}}';
      const tagName = renderTemplate(tagTemplate, ctx);

      await run('git', ['tag', '-a', tagName, '-m', `Release ${tagName}`], { cwd: packageDir });
      logger.info(`Tag created: ${tagName}`);
    }

    // Push (if --push or --auto)
    if (options.push || options.auto) {
      const pushResult = await run('git', ['push', '--follow-tags'], { cwd: packageDir });
      if (pushResult.exitCode !== 0) {
        logger.error(`Push failed: ${pushResult.stderr}`);
      } else {
        logger.info('Pushed to remote with tags.');
      }
    }

    return { package: packageName, previousVersion, newVersion, propagated: [] };
  }

  async rollback(packageDir: string, originalContent: string): Promise<void> {
    const pkgJsonPath = join(packageDir, 'package.json');
    await writeFile(pkgJsonPath, originalContent, 'utf-8');
    logger.info('Rollback of package.json complete.');
  }
}
