import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DependencyGraph } from '../../src/graph/dependency-graph.js';
import { createAffectedDetector } from '../../src/build/affected-detector.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `octo-affected-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function buildGraph(tmpDir: string): DependencyGraph {
  const graph = new DependencyGraph();

  // Create directories with source files
  const authDir = join(tmpDir, 'auth');
  const eventsDir = join(tmpDir, 'events');
  const wsDir = join(tmpDir, 'workspace');

  mkdirSync(authDir, { recursive: true });
  mkdirSync(eventsDir, { recursive: true });
  mkdirSync(wsDir, { recursive: true });

  writeFileSync(join(authDir, 'index.ts'), 'export const auth = true;');
  writeFileSync(join(eventsDir, 'index.ts'), 'export const events = true;');
  writeFileSync(join(wsDir, 'index.ts'), 'export const ws = true;');

  graph.addNode({ name: '@spectre/events', type: 'package', path: eventsDir });
  graph.addNode({ name: 'auth', type: 'service', path: authDir });
  graph.addNode({ name: 'workspace', type: 'service', path: wsDir });

  // auth depends on @spectre/events
  graph.addEdge('auth', '@spectre/events');
  // workspace depends on @spectre/events
  graph.addEdge('workspace', '@spectre/events');

  return graph;
}

describe('affected-detector', () => {
  let tmpDir: string;
  const detector = createAffectedDetector();

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns all nodes when no cache exists', async () => {
    const graph = buildGraph(tmpDir);
    const affected = await detector.detect(graph, tmpDir);
    expect(affected.sort()).toEqual(['@spectre/events', 'auth', 'workspace'].sort());
  });

  it('returns empty when nothing changed since last build', async () => {
    const graph = buildGraph(tmpDir);

    // Record build for all
    await detector.recordBuild(['@spectre/events', 'auth', 'workspace'], tmpDir);

    // Wait a tick to ensure mtime is before record
    await new Promise((r) => setTimeout(r, 50));

    const affected = await detector.detect(graph, tmpDir);
    expect(affected).toEqual([]);
  });

  it('detects directly modified node', async () => {
    const graph = buildGraph(tmpDir);

    await detector.recordBuild(['@spectre/events', 'auth', 'workspace'], tmpDir);
    await new Promise((r) => setTimeout(r, 50));

    // Modify auth source
    writeFileSync(join(tmpDir, 'auth', 'index.ts'), 'export const auth = "modified";');

    const affected = await detector.detect(graph, tmpDir);
    expect(affected).toContain('auth');
  });

  it('calculates transitive closure when package is modified', async () => {
    const graph = buildGraph(tmpDir);

    await detector.recordBuild(['@spectre/events', 'auth', 'workspace'], tmpDir);
    await new Promise((r) => setTimeout(r, 50));

    // Modify events package → auth and workspace should be affected
    writeFileSync(join(tmpDir, 'events', 'index.ts'), 'export const events = "v2";');

    const affected = await detector.detect(graph, tmpDir);
    expect(affected.sort()).toEqual(['@spectre/events', 'auth', 'workspace'].sort());
  });

  it('considers node affected if never built before', async () => {
    const graph = buildGraph(tmpDir);

    // Only record build for auth
    await detector.recordBuild(['auth'], tmpDir);
    await new Promise((r) => setTimeout(r, 50));

    const affected = await detector.detect(graph, tmpDir);
    // events and workspace never built → affected, plus auth depends on events
    expect(affected).toContain('@spectre/events');
    expect(affected).toContain('workspace');
    expect(affected).toContain('auth'); // transitive dependent of events
  });

  it('recordBuild persists timestamps to cache file', async () => {
    const graph = buildGraph(tmpDir);

    await detector.recordBuild(['auth'], tmpDir);

    const { readFileSync } = await import('node:fs');
    const cache = JSON.parse(readFileSync(join(tmpDir, '.octo-cache.json'), 'utf-8'));
    expect(cache.builds.auth).toBeTypeOf('number');
    expect(cache.builds.auth).toBeGreaterThan(0);
  });
});
