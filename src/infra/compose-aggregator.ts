import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/** A discovered docker-compose.yml from a service directory */
export interface DiscoveredCompose {
  serviceName: string;
  path: string;
  content: DockerComposeDocument;
}

/** Parsed docker-compose document structure */
export interface DockerComposeDocument {
  services?: Record<string, any>;
  networks?: Record<string, any>;
  volumes?: Record<string, any>;
  [key: string]: any;
}

/** Merged compose output */
export interface MergedCompose {
  services: Record<string, any>;
  networks: Record<string, any>;
  volumes: Record<string, any>;
}

/** Conflict detected during merge */
export interface ComposeConflict {
  type: 'port' | 'volume_name' | 'service_name';
  sources: string[];
  description: string;
}

/** Result of a merge operation */
export interface MergeResult {
  merged: MergedCompose;
  conflicts: ComposeConflict[];
}

export interface ComposeAggregator {
  discover(servicePaths: string[]): DiscoveredCompose[];
  merge(composes: DiscoveredCompose[]): MergeResult;
}

/** Extract host ports from a compose service ports definition */
function extractHostPorts(ports: any[]): string[] {
  const result: string[] = [];
  for (const p of ports) {
    const portStr = typeof p === 'object' && p.published != null
      ? String(p.published)
      : String(p);
    // Match host port from formats like "8080:80", "127.0.0.1:8080:80", "8080:80/tcp"
    const match = portStr.match(/(?:[\d.]+:)?(\d+):\d+/);
    if (match) result.push(match[1]);
  }
  return result;
}

export function createComposeAggregator(): ComposeAggregator {
  return {
    discover(servicePaths: string[]): DiscoveredCompose[] {
      const results: DiscoveredCompose[] = [];
      for (const svcPath of servicePaths) {
        const composePath = join(svcPath, 'docker-compose.yml');
        if (!existsSync(composePath)) continue;
        const raw = readFileSync(composePath, 'utf-8');
        const content = (parse(raw) ?? {}) as DockerComposeDocument;
        const serviceName = svcPath.split('/').pop() ?? svcPath;
        results.push({ serviceName, path: composePath, content });
      }
      return results;
    },

    merge(composes: DiscoveredCompose[]): MergeResult {
      const merged: MergedCompose = { services: {}, networks: {}, volumes: {} };
      const conflicts: ComposeConflict[] = [];

      // Track origins for conflict detection
      const serviceOrigins = new Map<string, string[]>();
      const portOrigins = new Map<string, string[]>();

      for (const compose of composes) {
        const { content, path: sourcePath } = compose;
        if (!content) continue;

        // Merge services
        if (content.services) {
          for (const [name, def] of Object.entries(content.services)) {
            if (!serviceOrigins.has(name)) serviceOrigins.set(name, []);
            serviceOrigins.get(name)!.push(sourcePath);

            // Detect port conflicts
            if (def?.ports && Array.isArray(def.ports)) {
              for (const hostPort of extractHostPorts(def.ports)) {
                const key = hostPort;
                if (!portOrigins.has(key)) portOrigins.set(key, []);
                portOrigins.get(key)!.push(sourcePath);
              }
            }

            // First definition wins (deterministic)
            if (!merged.services[name]) {
              merged.services[name] = def;
            }
          }
        }

        // Merge networks
        if (content.networks) {
          for (const [name, def] of Object.entries(content.networks)) {
            if (!merged.networks[name]) {
              merged.networks[name] = def;
            }
          }
        }

        // Merge volumes
        if (content.volumes) {
          for (const [name, def] of Object.entries(content.volumes)) {
            if (!merged.volumes[name]) {
              merged.volumes[name] = def;
            }
          }
        }
      }

      // Report service name conflicts
      for (const [name, sources] of serviceOrigins) {
        if (sources.length > 1) {
          conflicts.push({
            type: 'service_name',
            sources,
            description: `Service "${name}" declared in multiple compose files`,
          });
        }
      }

      // Report port conflicts
      for (const [port, sources] of portOrigins) {
        if (sources.length > 1) {
          conflicts.push({
            type: 'port',
            sources,
            description: `Host port ${port} mapped in multiple compose files`,
          });
        }
      }

      return { merged, conflicts };
    },
  };
}
