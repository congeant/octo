import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadOrCreateManifest, addEntry, saveManifest } from '../../src/manifest/manifest-mutator.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `octo-mutator-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('manifest-mutator', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  describe('loadOrCreateManifest', () => {
    it('returns empty manifest when file does not exist', () => {
      const { manifest, originalContent } = loadOrCreateManifest(join(tmpDir, 'octo.yaml'));
      expect(manifest.services).toEqual([]);
      expect(manifest.packages).toBeUndefined();
      expect(originalContent).toBeUndefined();
    });

    it('loads existing valid manifest', () => {
      const path = join(tmpDir, 'octo.yaml');
      writeFileSync(path, 'services:\n  - my-svc\npackages:\n  - my-pkg\n');
      const { manifest, originalContent } = loadOrCreateManifest(path);
      expect(manifest.services).toEqual(['my-svc']);
      expect(manifest.packages).toEqual(['my-pkg']);
      expect(originalContent).toBeDefined();
    });

    it('throws on invalid manifest', () => {
      const path = join(tmpDir, 'octo.yaml');
      writeFileSync(path, 'invalid: yaml: [[[');
      expect(() => loadOrCreateManifest(path)).toThrow();
    });
  });

  describe('addEntry', () => {
    it('adds a service as string when name matches dirName', () => {
      const manifest = { services: [] as any[] };
      const added = addEntry(manifest, 'auth', 'auth', 'service');
      expect(added).toBe(true);
      expect(manifest.services).toEqual(['auth']);
    });

    it('adds a service with path when name differs from dirName', () => {
      const manifest = { services: [] as any[] };
      const added = addEntry(manifest, '@scope/auth', 'auth', 'service');
      expect(added).toBe(true);
      expect(manifest.services).toEqual([{ '@scope/auth': { path: './auth' } }]);
    });

    it('adds a package and creates the array if missing', () => {
      const manifest = { services: [] as any[] };
      const added = addEntry(manifest, 'utils', 'utils', 'package');
      expect(added).toBe(true);
      expect(manifest.packages).toEqual(['utils']);
    });

    it('returns false for duplicate string entry', () => {
      const manifest = { services: ['auth'] as any[] };
      const added = addEntry(manifest, 'auth', 'auth', 'service');
      expect(added).toBe(false);
    });

    it('returns false for duplicate object entry', () => {
      const manifest = { services: [{ auth: { path: './auth' } }] as any[] };
      const added = addEntry(manifest, 'auth', 'auth-svc', 'service');
      expect(added).toBe(false);
    });
  });

  describe('saveManifest', () => {
    it('writes manifest to disk', () => {
      const path = join(tmpDir, 'octo.yaml');
      saveManifest(path, { services: ['svc-a'] });
      const content = readFileSync(path, 'utf-8');
      expect(content).toContain('svc-a');
    });

    it('preserves original content structure when provided', () => {
      const path = join(tmpDir, 'octo.yaml');
      const original = '# My comment\nservices:\n  - old-svc\n';
      writeFileSync(path, original);
      saveManifest(path, { services: ['new-svc'] }, original);
      const content = readFileSync(path, 'utf-8');
      expect(content).toContain('# My comment');
      expect(content).toContain('new-svc');
      expect(content).not.toContain('old-svc');
    });
  });
});
