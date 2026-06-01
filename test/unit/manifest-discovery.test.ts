import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverManifests, resolveMode, detectNameCollisions } from '../../src/manifest/manifest-discovery.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `octo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('manifest-discovery', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('discoverManifests', () => {
    it('finds root octo.yaml', () => {
      writeFileSync(join(tmpDir, 'octo.yaml'), 'services: []\npackages: []');
      const result = discoverManifests(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].isRoot).toBe(true);
      expect(result[0].name).toBe('root');
    });

    it('finds sub-directory manifests', () => {
      mkdirSync(join(tmpDir, 'projectA'));
      mkdirSync(join(tmpDir, 'projectB'));
      writeFileSync(join(tmpDir, 'projectA', 'octo.yaml'), 'services: []');
      writeFileSync(join(tmpDir, 'projectB', 'octo.yaml'), 'services: []');
      const result = discoverManifests(tmpDir);
      expect(result).toHaveLength(2);
    });

    it('prioritizes root manifest over sub-manifests', () => {
      writeFileSync(join(tmpDir, 'octo.yaml'), 'services: []');
      mkdirSync(join(tmpDir, 'sub'));
      writeFileSync(join(tmpDir, 'sub', 'octo.yaml'), 'services: []');
      const result = discoverManifests(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].isRoot).toBe(true);
    });

    it('skips node_modules, dist, and dot-prefixed dirs', () => {
      mkdirSync(join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
      mkdirSync(join(tmpDir, 'dist'));
      mkdirSync(join(tmpDir, '.hidden'));
      writeFileSync(join(tmpDir, 'node_modules', 'pkg', 'octo.yaml'), '');
      writeFileSync(join(tmpDir, 'dist', 'octo.yaml'), '');
      writeFileSync(join(tmpDir, '.hidden', 'octo.yaml'), '');
      const result = discoverManifests(tmpDir);
      expect(result).toHaveLength(0);
    });

    it('respects max depth of 5', () => {
      let path = tmpDir;
      for (let i = 0; i < 6; i++) {
        path = join(path, `level${i}`);
        mkdirSync(path);
      }
      writeFileSync(join(path, 'octo.yaml'), 'services: []');
      const result = discoverManifests(tmpDir);
      expect(result).toHaveLength(0);
    });

    it('returns empty for directory with no manifests', () => {
      const result = discoverManifests(tmpDir);
      expect(result).toHaveLength(0);
    });
  });

  describe('resolveMode', () => {
    it('returns standalone when single root manifest exists', () => {
      writeFileSync(join(tmpDir, 'octo.yaml'), 'services: []');
      expect(resolveMode(tmpDir)).toBe('standalone');
    });

    it('returns aggregated when multiple sub-manifests exist', () => {
      mkdirSync(join(tmpDir, 'a'));
      mkdirSync(join(tmpDir, 'b'));
      writeFileSync(join(tmpDir, 'a', 'octo.yaml'), '');
      writeFileSync(join(tmpDir, 'b', 'octo.yaml'), '');
      expect(resolveMode(tmpDir)).toBe('aggregated');
    });

    it('returns standalone when root exists with sub-manifests', () => {
      writeFileSync(join(tmpDir, 'octo.yaml'), '');
      mkdirSync(join(tmpDir, 'sub'));
      writeFileSync(join(tmpDir, 'sub', 'octo.yaml'), '');
      expect(resolveMode(tmpDir)).toBe('standalone');
    });

    it('returns standalone for single sub-manifest', () => {
      mkdirSync(join(tmpDir, 'only'));
      writeFileSync(join(tmpDir, 'only', 'octo.yaml'), '');
      expect(resolveMode(tmpDir)).toBe('standalone');
    });
  });

  describe('detectNameCollisions', () => {
    it('does not throw when names are unique', () => {
      const manifests = [
        { name: 'a', path: '/a/octo.yaml', isRoot: false },
        { name: 'b', path: '/b/octo.yaml', isRoot: false },
      ];
      expect(() => detectNameCollisions(manifests)).not.toThrow();
    });

    it('throws ManifestError on name collision', () => {
      const manifests = [
        { name: 'dup', path: '/x/octo.yaml', isRoot: false },
        { name: 'dup', path: '/y/octo.yaml', isRoot: false },
      ];
      expect(() => detectNameCollisions(manifests)).toThrow(/Name collision detected/);
    });
  });
});
