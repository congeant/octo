import { readJsonSync, pathExistsSync } from 'fs-extra';
import { join } from 'node:path';
import type { PackageReader, PackageMetadata } from '../ports/package-reader.port.js';

/**
 * Adapter — reads Node.js package.json files from the filesystem.
 * Implements the PackageReader port using fs-extra for robust file handling.
 */
export class NodePackageReader implements PackageReader {
  /**
   * Reads and parses a package.json from the given directory.
   *
   * @param dir - Absolute path to the project directory.
   * @returns Parsed package metadata, or undefined if package.json is missing or invalid.
   */
  read(dir: string): PackageMetadata | undefined {
    const pkgPath = join(dir, 'package.json');
    if (!pathExistsSync(pkgPath)) return undefined;

    try {
      const raw = readJsonSync(pkgPath);
      return {
        name: raw.name,
        version: raw.version,
        dependencies: raw.dependencies ?? {},
        devDependencies: raw.devDependencies ?? {},
      };
    } catch {
      return undefined;
    }
  }
}
