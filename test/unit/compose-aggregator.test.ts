import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createComposeAggregator } from '../../src/infra/compose-aggregator.js';

describe('ComposeAggregator', () => {
  let tempDir: string;
  const aggregator = createComposeAggregator();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'octo-compose-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createService(name: string, composeContent: string): string {
    const dir = join(tempDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'docker-compose.yml'), composeContent);
    return dir;
  }

  describe('discover', () => {
    it('finds docker-compose.yml in service directories', () => {
      const authDir = createService('auth', `
services:
  postgres:
    image: postgres:16
`);
      const result = aggregator.discover([authDir]);
      expect(result).toHaveLength(1);
      expect(result[0].serviceName).toBe('auth');
      expect(result[0].content.services?.postgres).toBeDefined();
    });

    it('skips directories without docker-compose.yml', () => {
      const dir = join(tempDir, 'no-compose');
      mkdirSync(dir);
      const result = aggregator.discover([dir]);
      expect(result).toHaveLength(0);
    });

    it('discovers multiple services', () => {
      const authDir = createService('auth', 'services:\n  pg:\n    image: postgres:16');
      const wsDir = createService('workspace', 'services:\n  redis:\n    image: redis:7');
      const result = aggregator.discover([authDir, wsDir]);
      expect(result).toHaveLength(2);
    });
  });

  describe('merge', () => {
    it('merges services from multiple compose files', () => {
      const authDir = createService('auth', `
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
`);
      const wsDir = createService('workspace', `
services:
  redis:
    image: redis:7
    ports:
      - "6379:6379"
`);
      const discovered = aggregator.discover([authDir, wsDir]);
      const { merged, conflicts } = aggregator.merge(discovered);

      expect(merged.services.postgres).toBeDefined();
      expect(merged.services.redis).toBeDefined();
      expect(conflicts).toHaveLength(0);
    });

    it('detects service name conflicts', () => {
      const authDir = createService('auth', `
services:
  postgres:
    image: postgres:16
`);
      const wsDir = createService('workspace', `
services:
  postgres:
    image: postgres:15
`);
      const discovered = aggregator.discover([authDir, wsDir]);
      const { conflicts } = aggregator.merge(discovered);

      const svcConflict = conflicts.find(c => c.type === 'service_name');
      expect(svcConflict).toBeDefined();
      expect(svcConflict!.sources).toHaveLength(2);
      expect(svcConflict!.description).toContain('postgres');
    });

    it('detects port conflicts', () => {
      const authDir = createService('auth', `
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
`);
      const wsDir = createService('workspace', `
services:
  postgres2:
    image: postgres:15
    ports:
      - "5432:5432"
`);
      const discovered = aggregator.discover([authDir, wsDir]);
      const { conflicts } = aggregator.merge(discovered);

      const portConflict = conflicts.find(c => c.type === 'port');
      expect(portConflict).toBeDefined();
      expect(portConflict!.sources).toHaveLength(2);
      expect(portConflict!.description).toContain('5432');
    });

    it('merges networks and volumes', () => {
      const authDir = createService('auth', `
services:
  postgres:
    image: postgres:16
networks:
  backend:
    driver: bridge
volumes:
  pg_data:
`);
      const wsDir = createService('workspace', `
services:
  redis:
    image: redis:7
networks:
  frontend:
    driver: bridge
volumes:
  redis_data:
`);
      const discovered = aggregator.discover([authDir, wsDir]);
      const { merged } = aggregator.merge(discovered);

      expect(merged.networks.backend).toBeDefined();
      expect(merged.networks.frontend).toBeDefined();
      expect(merged.volumes.pg_data).toBeDefined();
      expect(merged.volumes.redis_data).toBeDefined();
    });

    it('first definition wins for duplicate service names', () => {
      const authDir = createService('auth', `
services:
  postgres:
    image: postgres:16
`);
      const wsDir = createService('workspace', `
services:
  postgres:
    image: postgres:15
`);
      const discovered = aggregator.discover([authDir, wsDir]);
      const { merged } = aggregator.merge(discovered);

      expect(merged.services.postgres.image).toBe('postgres:16');
    });

    it('reports conflict sources with file paths', () => {
      const authDir = createService('auth', `
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
`);
      const wsDir = createService('workspace', `
services:
  postgres:
    image: postgres:15
    ports:
      - "5432:5432"
`);
      const discovered = aggregator.discover([authDir, wsDir]);
      const { conflicts } = aggregator.merge(discovered);

      for (const conflict of conflicts) {
        for (const source of conflict.sources) {
          expect(source).toContain('docker-compose.yml');
        }
      }
    });

    it('handles empty compose files gracefully', () => {
      const authDir = createService('auth', '');
      const discovered = aggregator.discover([authDir]);
      const { merged, conflicts } = aggregator.merge(discovered);

      expect(merged.services).toEqual({});
      expect(merged.networks).toEqual({});
      expect(merged.volumes).toEqual({});
      expect(conflicts).toHaveLength(0);
    });
  });
});
