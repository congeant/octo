import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildAggregatedGraph } from '../../src/graph/aggregated-graph.js';
import type { DiscoveredManifest } from '../../src/manifest/manifest-discovery.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `octo-agg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Validates: Requirements 8.3
 * Property 16: Cross-Project Dependency Resolution
 *
 * For any set of manifests in aggregated mode where package P from manifest A
 * is consumed by service S in manifest B, the unified dependency graph SHALL
 * contain an edge from S to P, and the topological sort SHALL place P before S.
 */
describe('Property 16: Cross-Project Dependency Resolution', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('unified graph contains edge from S to P and topological sort places P before S', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[a-z]+$/.test(s)),
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[a-z]+$/.test(s)),
        (pkgSuffix, svcSuffix) => {
          // Ensure distinct names
          const pkgName = `@test/pkg-${pkgSuffix}`;
          const svcName = `svc-${svcSuffix}`;
          if (pkgName === svcName) return;

          const root = createTmpDir();
          dirs.push(root);

          // Manifest A: declares package P
          const projectA = join(root, 'project-a');
          mkdirSync(projectA, { recursive: true });
          const pkgDir = join(projectA, 'pkg');
          mkdirSync(pkgDir, { recursive: true });
          writeFileSync(join(projectA, 'octo.yaml'), `services: []\npackages:\n  - "${pkgName}"`);
          writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: pkgName, version: '1.0.0' }));

          // Manifest B: declares service S that depends on package P
          const projectB = join(root, 'project-b');
          mkdirSync(projectB, { recursive: true });
          const svcDir = join(projectB, svcName);
          mkdirSync(svcDir, { recursive: true });
          writeFileSync(join(projectB, 'octo.yaml'), `services:\n  - ${svcName}\npackages: []`);
          writeFileSync(join(svcDir, 'package.json'), JSON.stringify({
            name: svcName,
            version: '1.0.0',
            dependencies: { [pkgName]: '^1.0.0' },
          }));
          // Add Dockerfile so it's recognized as service
          writeFileSync(join(svcDir, 'Dockerfile'), 'FROM node:25');

          const manifests: DiscoveredManifest[] = [
            { name: 'project-a', path: join(projectA, 'octo.yaml'), isRoot: false },
            { name: 'project-b', path: join(projectB, 'octo.yaml'), isRoot: false },
          ];

          const graph = buildAggregatedGraph(manifests);

          // Graph should contain both nodes
          expect(graph.getNode(pkgName)).toBeDefined();
          expect(graph.getNode(svcName)).toBeDefined();

          // Edge from S to P (S depends on P)
          const deps = graph.getDependencies(svcName);
          expect(deps).toContain(pkgName);

          // Topological sort places P before S
          const sortResult = graph.topologicalSort();
          expect(sortResult.ok).toBe(true);
          if (sortResult.ok) {
            const pkgIdx = sortResult.value.indexOf(pkgName);
            const svcIdx = sortResult.value.indexOf(svcName);
            expect(pkgIdx).toBeGreaterThanOrEqual(0);
            expect(svcIdx).toBeGreaterThanOrEqual(0);
            expect(pkgIdx).toBeLessThan(svcIdx);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('multiple cross-project dependencies are all resolved', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),
        (pkgCount) => {
          const root = createTmpDir();
          dirs.push(root);

          const pkgNames: string[] = [];

          // Manifest A: declares multiple packages
          const projectA = join(root, 'project-a');
          mkdirSync(projectA, { recursive: true });
          let packagesYaml = 'packages:\n';
          for (let i = 0; i < pkgCount; i++) {
            const name = `@test/lib-${i}`;
            pkgNames.push(name);
            const dir = join(projectA, `lib-${i}`);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
            packagesYaml += `  - "${name}"\n`;
          }
          writeFileSync(join(projectA, 'octo.yaml'), `services: []\n${packagesYaml}`);

          // Manifest B: declares service that depends on all packages from A
          const projectB = join(root, 'project-b');
          mkdirSync(projectB, { recursive: true });
          const svcDir = join(projectB, 'my-svc');
          mkdirSync(svcDir, { recursive: true });
          const deps: Record<string, string> = {};
          for (const pkg of pkgNames) deps[pkg] = '^1.0.0';
          writeFileSync(join(svcDir, 'package.json'), JSON.stringify({
            name: 'my-svc',
            version: '1.0.0',
            dependencies: deps,
          }));
          writeFileSync(join(svcDir, 'Dockerfile'), 'FROM node:25');
          writeFileSync(join(projectB, 'octo.yaml'), `services:\n  - my-svc\npackages: []`);

          const manifests: DiscoveredManifest[] = [
            { name: 'project-a', path: join(projectA, 'octo.yaml'), isRoot: false },
            { name: 'project-b', path: join(projectB, 'octo.yaml'), isRoot: false },
          ];

          const graph = buildAggregatedGraph(manifests);

          // All packages should be dependencies of the service
          const svcDeps = graph.getDependencies('my-svc');
          for (const pkg of pkgNames) {
            expect(svcDeps).toContain(pkg);
          }

          // Topological sort: all packages before service
          const sortResult = graph.topologicalSort();
          expect(sortResult.ok).toBe(true);
          if (sortResult.ok) {
            const svcIdx = sortResult.value.indexOf('my-svc');
            for (const pkg of pkgNames) {
              const pkgIdx = sortResult.value.indexOf(pkg);
              expect(pkgIdx).toBeLessThan(svcIdx);
            }
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
