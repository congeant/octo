import { readdir, readFile, access, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { logger } from '../shared/logger.js';
import { printManifest } from '../manifest/manifest-printer.js';
import type { OctoManifest } from '../manifest/manifest-schema.js';

const EXCLUDED_DIRS = new Set(['node_modules', 'dist']);
const MAX_DEPTH = 5;

interface DiscoveredProject {
  name: string;
  relativePath: string;
  hasDockerfile: boolean;
}

function isExcluded(name: string): boolean {
  return EXCLUDED_DIRS.has(name) || name.startsWith('.');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function scanDirectory(
  dir: string,
  rootDir: string,
  depth: number,
  results: DiscoveredProject[],
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  const pkgPath = join(dir, 'package.json');
  if (await exists(pkgPath)) {
    try {
      const content = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      if (pkg.name) {
        const hasDockerfile = await exists(join(dir, 'Dockerfile'));
        results.push({
          name: pkg.name,
          relativePath: './' + relative(rootDir, dir),
          hasDockerfile,
        });
      }
    } catch {
      // Invalid JSON — skip
    }
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || isExcluded(entry.name)) continue;
    await scanDirectory(join(dir, entry.name), rootDir, depth + 1, results);
  }
}

export async function initCommand(opts: { standalone?: boolean }): Promise<void> {
  const rootDir = process.cwd();
  const results: DiscoveredProject[] = [];

  if (opts.standalone) {
    const pkgPath = join(rootDir, 'package.json');
    if (await exists(pkgPath)) {
      try {
        const content = await readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(content);
        if (pkg.name) {
          const hasDockerfile = await exists(join(rootDir, 'Dockerfile'));
          results.push({ name: pkg.name, relativePath: '.', hasDockerfile });
        }
      } catch {
        // Invalid JSON
      }
    }
  } else {
    await scanDirectory(rootDir, rootDir, 0, results);
  }

  if (results.length === 0) {
    logger.info('No package.json found. Creating empty octo.yaml.');
  }

  const services = results.filter((p) => p.hasDockerfile).map((p) => p.name);
  const packages = results.filter((p) => !p.hasDockerfile).map((p) => p.name);

  const manifest: OctoManifest = { services };
  if (packages.length > 0) {
    manifest.packages = packages;
  }

  const yaml = printManifest(manifest);
  const outputPath = join(rootDir, 'octo.yaml');
  await writeFile(outputPath, yaml, 'utf-8');

  logger.info(`octo.yaml generated with ${services.length} service(s)${packages.length > 0 ? ` and ${packages.length} package(s)` : ''}.`);
}
