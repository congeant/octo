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
 * Files are sorted by path to ensure deterministic output regardless of discovery order.
 *
 * @param discovered - Array of discovered compose file entries with path and content.
 * @returns Hex-encoded SHA-256 hash string.
 */
async function computeChecksum(discovered: DiscoveredCompose[]): Promise<string> {
  const hash = createHash('sha256');
  for (const entry of discovered.sort((a, b) => a.path.localeCompare(b.path))) {
    const content = await readFile(entry.path, 'utf-8');
    hash.update(content);
  }
  return hash.digest('hex');
}

/**
 * Reads the previously stored checksum from disk.
 *
 * @param rootDir - Workspace root directory containing the checksum file.
 * @returns The stored checksum string, or null if the file does not exist.
 */
async function readStoredChecksum(rootDir: string): Promise<string | null> {
  try {
    return (await readFile(join(rootDir, CHECKSUM_FILE), 'utf-8')).trim();
  } catch {
    return null;
  }
}

/**
 * Persists the current checksum to disk for future comparison.
 *
 * @param rootDir - Workspace root directory where the checksum file is stored.
 * @param checksum - The SHA-256 hex string to persist.
 */
async function writeChecksum(rootDir: string, checksum: string): Promise<void> {
  await writeFile(join(rootDir, CHECKSUM_FILE), checksum, 'utf-8');
}

// --- Compose output ---

/**
 * Serializes a merged compose object to YAML and writes it to `docker-compose.yml` in the project root.
 *
 * @param merged - The unified compose structure (services, networks, volumes).
 * @param rootDir - Workspace root directory where the file is written.
 * @returns Absolute path to the written `docker-compose.yml`.
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
 * Polls a container's health status via `docker inspect` until healthy, unhealthy, or timeout.
 * Containers without a healthcheck defined are considered healthy immediately.
 *
 * @param containerName - Full Docker container name (e.g. "project-db-1").
 * @returns `true` if container is healthy or has no healthcheck; `false` if unhealthy or timed out.
 */
async function waitForHealthcheck(containerName: string): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < HEALTHCHECK_TIMEOUT_MS) {
    const result = await run('docker', [
      'inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', containerName,
    ]);
    if (result.exitCode !== 0) return true;
    const status = result.stdout.trim();
    if (status.includes('unhealthy')) return false;
    if (status === 'healthy' || status === 'none') return true;
    await new Promise((r) => setTimeout(r, HEALTHCHECK_POLL_MS));
  }
  return false;
}

/**
 * Outputs the last 20 log lines of a container to stderr for debugging failed healthchecks.
 *
 * @param containerName - Full Docker container name to retrieve logs from.
 */
async function showContainerLogs(containerName: string): Promise<void> {
  const result = await run('docker', ['logs', '--tail', '20', containerName]);
  const output = result.stdout || result.stderr;
  if (output) logger.error(`Container "${containerName}" recent logs:\n${output}`);
}

// --- Resolve compose path ---

/**
 * Determines which compose file to use for docker operations.
 *
 * - Single compose file: returns its path directly (no merge needed).
 * - Multiple compose files: compares SHA-256 checksum against stored value.
 *   If checksums match and the merged file exists, reuses it (cache hit).
 *   If checksums differ or merged file is missing, triggers a re-merge.
 *
 * @param discovered - Array of discovered compose files from service directories.
 * @param rootDir - Workspace root where merged output and checksum are stored.
 * @param smartMerger - Smart merger instance for deduplication and LLM-assisted merge.
 * @returns Absolute path to the compose file to use with `docker compose -f`.
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
      // Merged file missing despite matching checksum — re-merge below
    }
  }

  logger.info(`Found ${discovered.length} compose files with changes — merging into unified docker-compose.yml`);
  const merged = await smartMerger.deduplicate(discovered, rootDir);
  const outputPath = await writeMergedCompose(merged, rootDir);
  await writeChecksum(rootDir, currentChecksum);
  return outputPath;
}

// --- Manager ---

/**
 * Creates an infrastructure manager that handles docker compose operations for the workspace.
 *
 * @param servicePaths - Array of absolute paths to service directories (each may contain a docker-compose.yml).
 * @param rootDir - Workspace root directory for merged compose output and checksum storage.
 * @returns An InfraManager instance with `up`, `down`, and `status` methods.
 */
export function createInfraManager(servicePaths: string[], rootDir: string): InfraManager {
  const aggregator = createComposeAggregator();
  const smartMerger = createComposeSmartMerger();

  return {
    /**
     * Starts containers defined in the workspace's compose file(s).
     * Discovers compose files, resolves/merges if needed, runs `docker compose up -d`,
     * and waits for all container healthchecks to pass.
     *
     * @param services - Optional list of service names to filter. If empty, starts all.
     * @returns Result indicating success/failure with a descriptive message.
     */
    async up(services?: string[]): Promise<InfraResult> {
      const paths = services?.length
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

    /**
     * Stops all containers managed by the workspace's compose file.
     * Optionally removes associated volumes.
     *
     * @param options - `{ volumes: true }` to also remove Docker volumes on teardown.
     * @returns Result indicating success/failure with a descriptive message.
     */
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

    /**
     * Retrieves the current status of all containers managed by the workspace's compose file.
     * Parses `docker compose ps --format json` output into structured ContainerStatus objects.
     *
     * @returns Array of container statuses. Empty array if no compose files exist or command fails.
     */
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
            entry.State !== 'running' ? 'stopped' :
            entry.Health === 'unhealthy' ? 'unhealthy' : 'running';
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
