import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import { DependencyGraph } from '../graph/dependency-graph.js';
import { logger } from '../shared/logger.js';
import { PropagationEntry } from './version-bumper.js';

export interface PropagationResult {
  entries: PropagationEntry[];
}

export class VersionPropagator {
  constructor(private graph: DependencyGraph) {}

  /**
   * Propagate a new version of `packageName` to all compatible dependents,
   * recursively updating dependents of dependents.
   */
  async propagate(packageName: string, newVersion: string): Promise<PropagationResult> {
    const entries: PropagationEntry[] = [];
    const visited = new Set<string>();

    await this.propagateRecursive(packageName, newVersion, entries, visited);

    if (entries.length === 0) {
      logger.info(`No consumers found for ${packageName}. Propagation skipped.`);
      return { entries };
    }

    // Display summary
    logger.info('--- Propagation Summary ---');
    for (const entry of entries) {
      if (entry.skipped) {
        logger.warn(`  ${entry.project}: SKIPPED — ${entry.reason}`);
      } else {
        logger.info(`  ${entry.project}: ${entry.previousVersion} → ${entry.newVersion}`);
      }
    }

    return { entries };
  }

  private async propagateRecursive(
    packageName: string,
    newVersion: string,
    entries: PropagationEntry[],
    visited: Set<string>,
  ): Promise<void> {
    const dependents = this.graph.getDependents(packageName);

    for (const dependent of dependents) {
      if (visited.has(dependent)) continue;
      visited.add(dependent);

      const node = this.graph.getNode(dependent);
      if (!node) continue;

      const pkgJsonPath = join(node.path, 'package.json');
      const content = await readFile(pkgJsonPath, 'utf-8');
      const pkg = JSON.parse(content);

      const updated = await this.updateDependency(pkg, pkgJsonPath, packageName, newVersion, dependent, entries);

      // If updated, propagate to dependents of this dependent
      if (updated) {
        await this.propagateRecursive(dependent, newVersion, entries, visited);
      }
    }
  }

  /**
   * Update the version of `packageName` in a dependent's package.json.
   * Returns true if updated, false if skipped.
   */
  private async updateDependency(
    pkg: Record<string, any>,
    pkgJsonPath: string,
    packageName: string,
    newVersion: string,
    dependentName: string,
    entries: PropagationEntry[],
  ): Promise<boolean> {
    const sections = ['dependencies', 'devDependencies'] as const;

    for (const section of sections) {
      const deps = pkg[section];
      if (!deps || !deps[packageName]) continue;

      const currentRange: string = deps[packageName];

      // Check compatibility: if the new version satisfies the existing range, update
      if (!semver.satisfies(newVersion, currentRange)) {
        entries.push({
          project: dependentName,
          previousVersion: currentRange,
          newVersion,
          skipped: true,
          reason: `Range ${currentRange} incompatível com ${newVersion}`,
        });
        return false;
      }

      // Compatible — update to the new version
      const previousVersion = currentRange;
      deps[packageName] = `^${newVersion}`;

      await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

      entries.push({
        project: dependentName,
        previousVersion,
        newVersion: `^${newVersion}`,
      });

      return true;
    }

    return false;
  }
}
