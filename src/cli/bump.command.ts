import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseManifest } from '../manifest/manifest-parser.js';
import { buildGraphFromManifest } from '../graph/build-graph.js';
import { runHooks } from '../hooks/hook-runner.js';
import { VersionBumper, type BumpType } from '../version/version-bumper.js';
import { VersionPropagator } from '../version/version-propagator.js';
import { ChangelogGenerator } from '../version/changelog-generator.js';
import { run } from '../shared/process-runner.js';
import { OctoError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

function entryName(entry: string | Record<string, unknown>): string {
  if (typeof entry === 'string') return entry;
  return Object.keys(entry)[0];
}

export interface BumpCommandOpts {
  install?: boolean;
  push?: boolean;
  tag?: boolean;
  auto?: boolean;
}

export async function bumpCommand(pkg: string, type: string, opts: BumpCommandOpts): Promise<void> {
  const rootDir = process.cwd();
  const manifestPath = resolve(rootDir, 'octo.yaml');

  let content: string;
  try {
    content = readFileSync(manifestPath, 'utf-8');
  } catch {
    throw new OctoError('octo.yaml not found. Run `octo init` first.');
  }

  const parsed = parseManifest(content, manifestPath);
  if (!parsed.ok) throw parsed.error;

  const manifest = parsed.value;

  const allNames = [
    ...manifest.services.map(entryName),
    ...manifest.packages.map(entryName),
  ];

  if (!allNames.includes(pkg)) {
    throw new OctoError(
      `Package "${pkg}" not found in manifest.\nAvailable: ${allNames.join(', ')}`,
    );
  }

  const graph = buildGraphFromManifest(manifest, rootDir);
  const node = graph.getNode(pkg);

  if (!node) {
    throw new OctoError(`Could not resolve directory for package "${pkg}".`);
  }

  // Pre-bump hooks
  await runHooks('pre-bump', { target: pkg, workingDir: node.path, manifest });

  const bumpType = (type || 'patch') as BumpType;
  const bumper = new VersionBumper();
  const bumpResult = await bumper.bump(node.path, pkg, bumpType, {
    push: opts.push,
    tag: opts.tag,
    auto: opts.auto,
  });

  // Generate changelog (uses LLM when available)
  const changelog = new ChangelogGenerator();
  await changelog.generate(node.path, bumpResult.newVersion);

  // Propagate version to dependents
  const propagator = new VersionPropagator(graph);
  const propagation = await propagator.propagate(pkg, bumpResult.newVersion);

  // --install: run pnpm install in updated projects
  if (opts.install) {
    const updatedProjects = propagation.entries
      .filter((e) => !e.skipped)
      .map((e) => e.project);

    for (const project of updatedProjects) {
      const projectNode = graph.getNode(project);
      if (!projectNode) continue;

      logger.info(`Running pnpm install in ${project}...`);
      const result = await run('pnpm', ['install'], { cwd: projectNode.path });

      if (result.exitCode !== 0) {
        logger.error(`pnpm install failed in ${project}: ${(result.stderr || result.stdout).trim()}`);
      }
    }
  }

  logger.info(`Done: ${pkg} ${bumpResult.previousVersion} → ${bumpResult.newVersion}`);
}
