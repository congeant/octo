import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DependencyGraph } from '../../src/graph/dependency-graph.js';
import { createAffectedDetector } from '../../src/build/affected-detector.js';

/**
 * Feature: octo, Property 6: Affected Services Detection
 * Validates: Requirements 2.5
 *
 * For any dependency graph with a set of modified files, the affected set
 * SHALL equal the transitive closure of all nodes whose source files were
 * modified or whose dependencies (at any depth) were modified.
 * If no previous build is registered, all services SHALL be considered affected.
 */

function createTmpDir(): string {
  const dir = join(tmpdir(), `octo-pbt-affected-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Generator: DAG with N nodes and random edges (no cycles)
const dagArb = (minNodes: number, maxNodes: number) =>
  fc.integer({ min: minNodes, max: maxNodes }).chain((n) => {
    const nodeNames = Array.from({ length: n }, (_, i) => `pkg-${i}`);
    // Generate edges only from higher index to lower index (guarantees DAG)
    const edgesArb = fc.array(
      fc.tuple(
        fc.integer({ min: 1, max: n - 1 }),
        fc.integer({ min: 0, max: n - 2 }),
      ).filter(([from, to]) => from > to),
      { maxLength: n * 2 },
    );
    return edgesArb.map((edges) => ({ nodeNames, edges }));
  });

// Generator: subset of nodes to mark as "modified"
const modifiedSubsetArb = (nodeNames: string[]) =>
  fc.subarray(nodeNames, { minLength: 0, maxLength: nodeNames.length });

describe('Property 6: Affected Services Detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('all nodes affected when no previous build registered', async () => {
    await fc.assert(
      fc.asyncProperty(dagArb(2, 8), async ({ nodeNames }) => {
        const localDir = createTmpDir();
        try {
          const graph = new DependencyGraph();
          for (const name of nodeNames) {
            const dir = join(localDir, name);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'src.ts'), `// ${name}`);
            graph.addNode({ name, type: 'package', path: dir });
          }

          const detector = createAffectedDetector();
          const affected = await detector.detect(graph, localDir);

          expect(affected.sort()).toEqual(nodeNames.sort());
        } finally {
          rmSync(localDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 50 },
    );
  });

  it('affected set equals transitive closure of modified nodes', async () => {
    await fc.assert(
      fc.asyncProperty(
        dagArb(3, 6).chain(({ nodeNames, edges }) =>
          modifiedSubsetArb(nodeNames).map((modified) => ({ nodeNames, edges, modified })),
        ),
        async ({ nodeNames, edges, modified }) => {
          const localDir = createTmpDir();
          try {
            const graph = new DependencyGraph();

            // Create directories and nodes
            for (const name of nodeNames) {
              const dir = join(localDir, name);
              mkdirSync(dir, { recursive: true });
              writeFileSync(join(dir, 'src.ts'), `// ${name}`);
              graph.addNode({ name, type: 'package', path: dir });
            }

            // Add edges
            for (const [from, to] of edges) {
              graph.addEdge(nodeNames[from], nodeNames[to]);
            }

            const detector = createAffectedDetector();

            // Record build for all nodes
            await detector.recordBuild(nodeNames, localDir);
            await new Promise((r) => setTimeout(r, 50));

            // Modify selected nodes
            for (const name of modified) {
              writeFileSync(join(localDir, name, 'src.ts'), `// modified ${Date.now()}`);
            }

            const affected = await detector.detect(graph, localDir);
            const affectedSet = new Set(affected);

            // Compute expected transitive closure
            const expected = new Set<string>(modified);
            const queue = [...modified];
            while (queue.length > 0) {
              const current = queue.shift()!;
              for (const dep of graph.getDependents(current)) {
                if (!expected.has(dep)) {
                  expected.add(dep);
                  queue.push(dep);
                }
              }
            }

            // Affected set must equal transitive closure
            expect([...affectedSet].sort()).toEqual([...expected].sort());
          } finally {
            rmSync(localDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
