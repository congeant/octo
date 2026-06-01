import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveMode, discoverManifests, detectNameCollisions } from '../../src/manifest/manifest-discovery.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `octo-prop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Validates: Requirements 8.1, 8.2
 * Property 15: Mode Detection (Standalone vs Aggregated)
 *
 * For any directory structure, if exactly one octo.yaml exists in the execution
 * directory with no sub-manifests, the CLI SHALL operate in standalone mode.
 * If multiple octo.yaml files exist in subdirectories, the CLI SHALL operate
 * in aggregated mode and discover all manifests.
 */
describe('Property 15: Mode Detection (Standalone vs Aggregated)', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('standalone when exactly one root manifest with no sub-manifests', () => {
    fc.assert(
      fc.property(fc.nat({ max: 5 }), (_seed) => {
        const dir = createTmpDir();
        dirs.push(dir);
        writeFileSync(join(dir, 'octo.yaml'), 'services: []\npackages: []');
        expect(resolveMode(dir)).toBe('standalone');
      }),
      { numRuns: 20 },
    );
  });

  it('aggregated when multiple sub-manifests exist without root', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), (count) => {
        const dir = createTmpDir();
        dirs.push(dir);
        for (let i = 0; i < count; i++) {
          const sub = join(dir, `project-${i}`);
          mkdirSync(sub);
          writeFileSync(join(sub, 'octo.yaml'), `services: []\npackages: []`);
        }
        expect(resolveMode(dir)).toBe('aggregated');
        const manifests = discoverManifests(dir);
        expect(manifests.length).toBe(count);
      }),
      { numRuns: 20 },
    );
  });

  it('standalone when root manifest exists alongside sub-manifests (root priority)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), (subCount) => {
        const dir = createTmpDir();
        dirs.push(dir);
        writeFileSync(join(dir, 'octo.yaml'), 'services: []\npackages: []');
        for (let i = 0; i < subCount; i++) {
          const sub = join(dir, `sub-${i}`);
          mkdirSync(sub);
          writeFileSync(join(sub, 'octo.yaml'), 'services: []');
        }
        expect(resolveMode(dir)).toBe('standalone');
        const manifests = discoverManifests(dir);
        expect(manifests.length).toBe(1);
        expect(manifests[0].isRoot).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});

/**
 * Validates: Requirements 8.7
 * Property 17: Name Collision Detection Across Manifests
 *
 * For any set of manifests where two or more declare the same package or service
 * name, the CLI SHALL detect the collision and report the conflicting manifest
 * file paths.
 */
describe('Property 17: Name Collision Detection Across Manifests', () => {
  it('detects collision when two manifests share the same name', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        (name) => {
          const manifests = [
            { name, path: '/path/a/octo.yaml', isRoot: false },
            { name, path: '/path/b/octo.yaml', isRoot: false },
          ];
          expect(() => detectNameCollisions(manifests)).toThrow(/Name collision detected/);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('does not throw when all names are unique', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0), {
          minLength: 1,
          maxLength: 10,
        }),
        (names) => {
          const manifests = names.map((n, i) => ({
            name: n,
            path: `/path/${i}/octo.yaml`,
            isRoot: i === 0,
          }));
          expect(() => detectNameCollisions(manifests)).not.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });
});
