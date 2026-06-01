import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { runHooks, HookError } from '../../src/hooks/hook-runner.js';
import type { OctoManifest } from '../../src/manifest/manifest-schema.js';
import type { HookTrigger, HookContext } from '../../src/hooks/hook-runner.js';

/**
 * Feature: octo, Property 18: Pre-validation Hooks Execution Order
 * Validates: Requirements 2.1, 2.3
 *
 * For any set of hooks configured for a trigger (pre-build or pre-bump),
 * the hook runner SHALL execute them sequentially in declaration order.
 * If any hook fails (non-zero exit code), the runner SHALL abort the
 * remaining hooks and prevent the subsequent operation from executing.
 */

// Mock process-runner
vi.mock('../../src/shared/process-runner.js', () => ({
  run: vi.fn(),
}));

vi.mock('../../src/shared/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { run } from '../../src/shared/process-runner.js';
const mockRun = vi.mocked(run);

// Generators
const hookNameArb = fc.string({ minLength: 1, maxLength: 15 }).filter(s => /^[a-z][a-z0-9-]*$/.test(s));
const hookCommandArb = fc.string({ minLength: 1, maxLength: 30 }).filter(s => !s.includes('\n') && s.trim().length > 0);

const hookDefArb = fc.record({
  name: hookNameArb,
  command: hookCommandArb,
});

const triggerArb: fc.Arbitrary<HookTrigger> = fc.constantFrom('pre-build', 'pre-bump');

describe('Property 18: Pre-validation Hooks Execution Order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes all hooks sequentially in declaration order when all succeed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(hookDefArb, { minLength: 1, maxLength: 5 }),
        triggerArb,
        async (hooks, trigger) => {
          mockRun.mockReset();
          const executionOrder: string[] = [];

          mockRun.mockImplementation(async (cmd) => {
            executionOrder.push(cmd);
            return { stdout: '', stderr: '', exitCode: 0 };
          });

          const manifest: OctoManifest = {
            hooks: { [trigger]: hooks },
            services: [],
            packages: [],
          };

          const context: HookContext = {
            target: 'test-service',
            workingDir: '/tmp/test',
            manifest,
          };

          const results = await runHooks(trigger, context);

          // All hooks executed
          expect(results).toHaveLength(hooks.length);
          // Execution order matches declaration order
          expect(executionOrder).toEqual(hooks.map(h => h.command));
          // All results are success
          expect(results.every(r => r.success)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('aborts remaining hooks when one fails (non-zero exit code)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(hookDefArb, { minLength: 2, maxLength: 5 }),
        triggerArb,
        fc.nat(),
        async (hooks, trigger, failSeed) => {
          mockRun.mockReset();
          const failIndex = failSeed % hooks.length;
          let callCount = 0;

          mockRun.mockImplementation(async () => {
            const idx = callCount++;
            if (idx === failIndex) {
              return { stdout: '', stderr: 'error output', exitCode: 1 };
            }
            return { stdout: '', stderr: '', exitCode: 0 };
          });

          const manifest: OctoManifest = {
            hooks: { [trigger]: hooks },
            services: [],
            packages: [],
          };

          const context: HookContext = {
            target: 'test-service',
            workingDir: '/tmp/test',
            manifest,
          };

          await expect(runHooks(trigger, context)).rejects.toThrow(HookError);

          // Only hooks up to and including the failed one were executed
          expect(callCount).toBe(failIndex + 1);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('executes hooks in the workingDir from context', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(hookDefArb, { minLength: 1, maxLength: 3 }),
        triggerArb,
        fc.constant('/tmp/my-service'),
        async (hooks, trigger, workingDir) => {
          mockRun.mockReset();
          const cwdArgs: (string | undefined)[] = [];

          mockRun.mockImplementation(async (_cmd, _args, opts) => {
            cwdArgs.push(opts?.cwd);
            return { stdout: '', stderr: '', exitCode: 0 };
          });

          const manifest: OctoManifest = {
            hooks: { [trigger]: hooks },
            services: [],
            packages: [],
          };

          const context: HookContext = {
            target: 'test-service',
            workingDir,
            manifest,
          };

          await runHooks(trigger, context);

          // All hooks executed in the correct workingDir
          expect(cwdArgs).toHaveLength(hooks.length);
          expect(cwdArgs.every(cwd => cwd === workingDir)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });
});
