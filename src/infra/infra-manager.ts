import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { run } from '../shared/process-runner.js';
import { logger } from '../shared/logger.js';
import { createComposeSmartMerger } from './compose-smart-merger.js';
import { createComposeAggregator, type DiscoveredCompose, type MergedCompose } from './compose-aggregator.js';

export type ContainerState = 'running' | 'stopped' | 'unhealthy';

export interface ContainerStatus {
  name: string;
  image: string;
  state: ContainerState;
  port: string;
}

export interface InfraResult {
  success: boolean;
  message: string;
}

export interface InfraManager {
  up(services?: string[]): Promise<InfraResult>;
  down(options: { volumes?: boolean }): Promise<InfraResult>;
  status(): Promise<ContainerStatus[]>;
}

const HEALTHCHECK_TIMEOUT_MS = 60_000;
const HEALTHCHECK_POLL_MS = 2_000;
const CHECKSUM_FILE = '.octo-compose-checksum';

// --- Checksum ---

/**
 * Computes a SHA-256 checksum from the combined content of all discovered compose files.
 * Used to detect changes and trigger re-merge only when source files are modified.
 */
async function computeChecksum(discovered: DiscoveredCompose[]): Promise<string> {
  const hash = createHash('sha256');
  for (const entry of discovered.sort((a, b) => a.path.localeCompare(b.path))) {
    const content = await readFile(entry.path, 'utf-8');
    hash.update(content);
  }
  return hash.digest('hex');
}

async function readStoredChecksum(rootDir: string): Promise<string | null> {
  try {
    return (await readFile(join(rootDir, CHECKSUM_FILE), 'utf-8')).trim();
  } catch {
    return null;
  }
}

async function writeChecksum(rootDir: string, checksum: string): Promise<void> {
  await writeFile(join(rootDir, CHECKSUM_FILE), checksum, 'utf-8');
}

// --- Compose output ---

/**
 * Writes the merged docker-compose.yml to the project root.
 * This file is the unified compose used by `docker compose` commands.
 */
async function writeMergedCompose(merged: MergedCompose, rootDir: string): Promise<string> {
  const outputPath = join(rootDir, 'docker-compose.yml');
  const content = stringify(merged);
  await writeFile(outputPath, content, 'utf-8');
  logger.info(`Merged compose written to ${outputPath}`);
  return outputPath;
}

// --- Healthcheck ---

/**
 * Polls Docker inspect for a container's health status.
 * Returns true if healthy or if the container has no healthcheck defined.
 * Returns false if unhealthy or if the timeout is exceeded.
 */
async function waitForHealthcheck(containerName: string): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < HEALTHCHECK_TIMEOUT_MS) {
    const result = await run('docker', [
      'inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', containerName,
    ]);
    if (result.exitCode !== 0) return true;
    const status = result.stdout.trim();
    if (status === 'healthy' || status === 'none') return true;
    if (status === 'unhealthy') return false;
    await new Promise((r) => setTimeout(r, HEALTHCHECK_POLL_MS));
  }
  return false;
}

/** Prints the last 20 log lines for a container to help diagnose failures. */
async function showContainerLogs(containerName: string): Promise<void> {
  const result = await run('docker', ['logs', '--tail', '20', containerName]);
  const output = result.stdout || result.stderr;
  if (output) logger.error(`Container "${containerName}" recent logs:\n${output}`);
}

// --- Resolve compose path ---

/**
 * Resolves the compose file path to use.
 * - Single compose: uses it directly.
 * - Multiple composes: checks checksum. If changed (or first run), re-merges and writes docker-compose.yml.
 */
async function resolveComposePath(
  discovered: DiscoveredCompose[],
  rootDir: string,
  smartMerger: ReturnType<typeof createComposeSmartMerger>,
): Promise<string> {
  if (discovered.length === 1) {
    return discovered[0].path;
  }

  const currentChecksum = await computeChecksum(discovered);
  const storedChecksum = await readStoredChecksum(rootDir);
  const mergedPath = join(rootDir, 'docker-compose.yml');

  if (currentChecksum === storedChecksum) {
    try {
      await readFile(mergedPath, 'utf-8');
      logger.info('Compose files unchanged — using cached docker-compose.yml');
      return mergedPath;
    } catch {
      // Merged file missing, re-merge below
    }
  }

  logger.info(`Found ${discovered.length} compose files with changes — merging into unified docker-compose.yml`);
  const merged = await smartMerger.deduplicate(discovered);
  const outputPath = await writeMergedCompose(merged, rootDir);
  await writeChecksum(rootDir, currentChecksum);
  return outputPath;
}

// --- Manager ---

export function createInfraManager(servicePaths: string[], rootDir: string): InfraManager {
  const aggregator = createComposeAggregator();
  const smartMerger = createComposeSmartMerger();

  return {
    async up(services?: string[]): Promise<InfraResult> {
      const paths = services && services.length > 0
        ? servicePaths.filter((p) => services.some((s) => p.endsWith(s)))
        : servicePaths;

      const discovered = aggregator.discover(paths);
      if (discovered.length === 0) {
        return { success: true, message: 'No docker-compose.yml found in any service directory.' };
      }

      const composePath = await resolveComposePath(discovered, rootDir, smartMerger);

      logger.info('Starting containers with docker compose...');
      const result = await run('docker', ['compose', '-f', composePath, 'up', '-d']);
      if (result.exitCode !== 0) {
        return {
          success: false,
          message: `Failed to start containers. docker compose exited with code ${result.exitCode}:\n${result.stderr.trim()}`,
        };
      }

      // Wait for healthchecks on all running containers
      const psResult = await run('docker', ['compose', '-f', composePath, 'ps', '--format', '{{.Name}}']);
      const containerNames = psResult.stdout.trim().split('\n').filter(Boolean);

      for (const container of containerNames) {
        const healthy = await waitForHealthcheck(container);
        if (!healthy) {
          logger.error(`Container "${container}" failed healthcheck after ${HEALTHCHECK_TIMEOUT_MS / 1000}s.`);
          await showContainerLogs(container);
          return { success: false, message: `Healthcheck failed for "${container}". Check logs above for details.` };
        }
      }

      return { success: true, message: `All ${containerNames.length} container(s) are up and healthy.` };
    },

    async down(options: { volumes?: boolean }): Promise<InfraResult> {
      const discovered = aggregator.discover(servicePaths);
      if (discovered.length === 0) {
        return { success: true, message: 'No compose files found — nothing to stop.' };
      }

      const composePath = await resolveComposePath(discovered, rootDir, smartMerger);
      const args = ['compose', '-f', composePath, 'down'];
      if (options.volumes) args.push('--volumes');

      const result = await run('docker', args);
      if (result.exitCode !== 0) {
        return {
          success: false,
          message: `Failed to stop containers. docker compose exited with code ${result.exitCode}:\n${result.stderr.trim()}`,
        };
      }

      return { success: true, message: options.volumes ? 'All containers stopped and volumes removed.' : 'All containers stopped.' };
    },

    async status(): Promise<ContainerStatus[]> {
      const discovered = aggregator.discover(servicePaths);
      if (discovered.length === 0) return [];

      const composePath = await resolveComposePath(discovered, rootDir, smartMerger);
      const result = await run('docker', ['compose', '-f', composePath, 'ps', '--format', 'json']);
      if (result.exitCode !== 0 || !result.stdout.trim()) return [];

      const containers: ContainerStatus[] = [];
      for (const line of result.stdout.trim().split('\n')) {
        try {
          const entry = JSON.parse(line);
          const state: ContainerState =
            entry.Health === 'unhealthy' ? 'unhealthy' :
            entry.State === 'running' ? 'running' : 'stopped';
          containers.push({
            name: entry.Name ?? entry.Service ?? '',
            image: entry.Image ?? '',
            state,
            port: entry.Publishers?.map((p: any) => `${p.PublishedPort}:${p.TargetPort}`).join(', ') ?? '',
          });
        } catch { /* skip malformed JSON lines */ }
      }
      return containers;
    },
  };
}
