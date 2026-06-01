import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { run } from '../shared/process-runner.js';
import { logger } from '../shared/logger.js';
import { OctoError } from '../shared/errors.js';
import { createComposeSmartMerger } from './compose-smart-merger.js';
import { createComposeAggregator, type MergedCompose } from './compose-aggregator.js';

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

/** Write merged compose to a temp file and return its path */
async function writeTempCompose(merged: MergedCompose): Promise<string> {
  const tempPath = join(tmpdir(), `octo-compose-${Date.now()}.yml`);
  const content = stringify(merged);
  await writeFile(tempPath, content, 'utf-8');
  return tempPath;
}

/** Poll healthcheck for a container, returns true if healthy within timeout */
async function waitForHealthcheck(containerName: string): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < HEALTHCHECK_TIMEOUT_MS) {
    const result = await run('docker', [
      'inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', containerName,
    ]);
    const status = result.stdout.trim();
    if (status === 'healthy' || status === 'none') return true;
    if (status === 'unhealthy') return false;
    await new Promise((r) => setTimeout(r, HEALTHCHECK_POLL_MS));
  }
  return false;
}

/** Show last 20 lines of container log */
async function showContainerLogs(containerName: string): Promise<void> {
  const result = await run('docker', ['logs', '--tail', '20', containerName]);
  const output = result.stdout || result.stderr;
  if (output) logger.error(`Últimas 20 linhas de log (${containerName}):\n${output}`);
}

export function createInfraManager(servicePaths: string[]): InfraManager {
  const aggregator = createComposeAggregator();
  const smartMerger = createComposeSmartMerger();
  let composePath: string | undefined;

  return {
    async up(services?: string[]): Promise<InfraResult> {
      const paths = services && services.length > 0
        ? servicePaths.filter((p) => services.some((s) => p.endsWith(s)))
        : servicePaths;

      const discovered = aggregator.discover(paths);
      if (discovered.length === 0) {
        return { success: true, message: 'Nenhum docker-compose.yml encontrado.' };
      }

      logger.info(`Descobertos ${discovered.length} compose file(s). Merging...`);
      const merged = await smartMerger.deduplicate(discovered);
      composePath = await writeTempCompose(merged);

      logger.info('Subindo containers...');
      const result = await run('docker', ['compose', '-f', composePath, 'up', '-d']);
      if (result.exitCode !== 0) {
        return { success: false, message: `docker compose up falhou: ${result.stderr}` };
      }

      // Wait for healthchecks
      const serviceNames = Object.keys(merged.services);
      for (const svc of serviceNames) {
        const healthy = await waitForHealthcheck(svc);
        if (!healthy) {
          logger.error(`Healthcheck timeout para container "${svc}".`);
          await showContainerLogs(svc);
          // Stop dependents but don't tear down everything
          return { success: false, message: `Healthcheck timeout: ${svc}` };
        }
      }

      return { success: true, message: `${serviceNames.length} container(s) iniciado(s).` };
    },

    async down(options: { volumes?: boolean }): Promise<InfraResult> {
      // Discover and merge to get the compose file path
      if (!composePath) {
        const discovered = aggregator.discover(servicePaths);
        if (discovered.length === 0) {
          return { success: true, message: 'Nenhum container para parar.' };
        }
        const merged = await smartMerger.deduplicate(discovered);
        composePath = await writeTempCompose(merged);
      }

      const args = ['compose', '-f', composePath, 'down'];
      if (options.volumes) args.push('--volumes');

      const result = await run('docker', args);
      if (result.exitCode !== 0) {
        return { success: false, message: `docker compose down falhou: ${result.stderr}` };
      }

      return { success: true, message: 'Containers parados.' };
    },

    async status(): Promise<ContainerStatus[]> {
      if (!composePath) {
        const discovered = aggregator.discover(servicePaths);
        if (discovered.length === 0) return [];
        const merged = await smartMerger.deduplicate(discovered);
        composePath = await writeTempCompose(merged);
      }

      const result = await run('docker', ['compose', '-f', composePath, 'ps', '--format', 'json']);
      if (result.exitCode !== 0 || !result.stdout.trim()) return [];

      const containers: ContainerStatus[] = [];
      // docker compose ps --format json outputs one JSON object per line
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
        } catch { /* skip malformed lines */ }
      }
      return containers;
    },
  };
}
