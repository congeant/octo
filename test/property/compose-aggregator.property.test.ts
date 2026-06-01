import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createComposeAggregator, DiscoveredCompose } from '../../src/infra/compose-aggregator.js';

const aggregator = createComposeAggregator();

// Generator: valid service name (lowercase alphanumeric + hyphens)
const serviceNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/);

// Generator: valid port number (1024-65535)
const portArb = fc.integer({ min: 1024, max: 65535 });

// Generator: a compose service definition with optional ports
const composeServiceDefArb = fc.record({
  image: fc.constantFrom('postgres:16', 'redis:7', 'mongo:7', 'mysql:8', 'nginx:latest'),
  ports: fc.option(
    fc.array(portArb.map(p => `${p}:${p}`), { minLength: 1, maxLength: 3 }),
    { nil: undefined },
  ),
});

// Generator: a DiscoveredCompose with unique service names
const discoveredComposeArb = fc.tuple(serviceNameArb, serviceNameArb).chain(([svcName, composeSvcName]) =>
  composeServiceDefArb.map(def => ({
    serviceName: svcName,
    path: `/fake/${svcName}/docker-compose.yml`,
    content: { services: { [composeSvcName]: def } },
  })),
);

describe('ComposeAggregator Properties', () => {
  /**
   * Property 20: Docker Compose Merge Completeness
   * **Validates: Requirements 5.1**
   *
   * For any set of N services with valid docker-compose.yml files,
   * the merged compose output SHALL contain all unique infrastructure
   * containers required by the services.
   */
  it('Property 20: merged output contains all unique services from all compose files', () => {
    fc.assert(
      fc.property(
        fc.array(discoveredComposeArb, { minLength: 1, maxLength: 10 }),
        (composes) => {
          const { merged } = aggregator.merge(composes);

          // Collect all unique service names across all compose files
          const allServiceNames = new Set<string>();
          for (const compose of composes) {
            if (compose.content.services) {
              for (const name of Object.keys(compose.content.services)) {
                allServiceNames.add(name);
              }
            }
          }

          // Every unique service name must appear in merged output
          for (const name of allServiceNames) {
            expect(merged.services[name]).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 21: Docker Compose Port Conflict Detection
   * **Validates: Requirements 5.1**
   *
   * For any set of docker-compose files where two or more services map
   * the same host port, the compose aggregator SHALL detect and report
   * the conflict with the involved service names and source file paths.
   */
  it('Property 21: detects port conflicts when same host port is mapped in multiple compose files', () => {
    fc.assert(
      fc.property(
        portArb,
        serviceNameArb,
        serviceNameArb,
        (port, svc1, svc2) => {
          // Ensure distinct service names for the compose-level services
          const name1 = `${svc1}-a`;
          const name2 = `${svc2}-b`;

          const composes: DiscoveredCompose[] = [
            {
              serviceName: 'service-1',
              path: '/path/service-1/docker-compose.yml',
              content: {
                services: { [name1]: { image: 'postgres:16', ports: [`${port}:5432`] } },
              },
            },
            {
              serviceName: 'service-2',
              path: '/path/service-2/docker-compose.yml',
              content: {
                services: { [name2]: { image: 'redis:7', ports: [`${port}:6379`] } },
              },
            },
          ];

          const { conflicts } = aggregator.merge(composes);

          // Must detect the port conflict
          const portConflicts = conflicts.filter(c => c.type === 'port');
          expect(portConflicts.length).toBeGreaterThanOrEqual(1);

          // The conflict must reference both source paths
          const relevant = portConflicts.find(c => c.description.includes(String(port)));
          expect(relevant).toBeDefined();
          expect(relevant!.sources).toContain('/path/service-1/docker-compose.yml');
          expect(relevant!.sources).toContain('/path/service-2/docker-compose.yml');
        },
      ),
      { numRuns: 100 },
    );
  });
});
