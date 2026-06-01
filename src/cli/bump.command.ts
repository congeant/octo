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

/** Resolve entry name from a ServiceEntry or PackageEntry */
function entryName(entry: string | Record<string, unknown>): string {
  if (typeof entry === 'string') return entry;
  return Object.keys(entry)[0];
}

export async function bumpCommand(pkg: string, type: string, opts: { install?: boolean }): Promise<void> {
  const rootDir = process.cwd();
  const manifestPath = resolve(rootDir, 'octo.yaml');

  // 1. Read and parse manifest
  let content: string;
  try {
    content = readFileSync(manifestPath, 'utf-8');
  } catch {
    throw new OctoError('octo.yaml não encontrado. Execute `octo init` primeiro.');
  }

  const parsed = parseManifest(content, manifestPath);
  if (!parsed.ok) throw parsed.error;

  const manifest = parsed.value;

  // 2. Validate package name against manifest
  const allNames = [
    ...manifest.services.map(entryName),
    ...manifest.packages.map(entryName),
  ];

  if (!allNames.includes(pkg)) {
    throw new OctoError(
      `Pacote "${pkg}" não encontrado no manifesto.\nDisponíveis: ${allNames.join(', ')}`,
    );
  }

  // 3. Build dependency graph
  const graph = buildGraphFromManifest(manifest, rootDir);
  const node = graph.getNode(pkg);

  if (!node) {
    throw new OctoError(`Não foi possível resolver o diretório do pacote "${pkg}".`);
  }

  // 4. Run pre-bump hooks
  await runHooks('pre-bump', { target: pkg, workingDir: node.path, manifest });

  // 5. Generate changelog
  const changelog = new ChangelogGenerator();
  const bumpType = (type || 'patch') as BumpType;

  // We need the new version for changelog — compute it first
  const bumper = new VersionBumper();
  const bumpResult = await bumper.bump(node.path, pkg, bumpType);

  // 6. Generate changelog entry after bump
  await changelog.generate(node.path, bumpResult.newVersion);

  // 7. Propagate version to dependents
  const propagator = new VersionPropagator(graph);
  const propagation = await propagator.propagate(pkg, bumpResult.newVersion);

  // 8. --install: run pnpm install in updated projects
  if (opts.install) {
    const updatedProjects = propagation.entries
      .filter((e) => !e.skipped)
      .map((e) => e.project);

    for (const project of updatedProjects) {
      const projectNode = graph.getNode(project);
      if (!projectNode) continue;

      logger.info(`Executando pnpm install em ${project}...`);
      const result = await run('pnpm', ['install'], { cwd: projectNode.path });

      if (result.exitCode !== 0) {
        logger.error(`pnpm install falhou em ${project}: ${(result.stderr || result.stdout).trim()}`);
      }
    }
  }

  logger.info(`Bump concluído: ${pkg} ${bumpResult.previousVersion} → ${bumpResult.newVersion}`);
}
