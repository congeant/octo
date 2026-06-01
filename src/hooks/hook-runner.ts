import { run } from '../shared/process-runner.js';
import { logger } from '../shared/logger.js';
import type { OctoManifest, HookDefinition } from '../manifest/manifest-schema.js';

export type HookTrigger = 'pre-build' | 'pre-bump';

export interface HookContext {
  target: string;
  workingDir: string;
  manifest: OctoManifest;
}

export interface HookResult {
  success: boolean;
  hook: string;
  output?: string;
  durationMs: number;
}

/** Executes hooks sequentially in declaration order. Aborts on first failure. */
export async function runHooks(trigger: HookTrigger, context: HookContext): Promise<HookResult[]> {
  const hooks: HookDefinition[] = context.manifest.hooks?.[trigger] ?? [];

  if (hooks.length === 0) return [];

  const results: HookResult[] = [];

  for (const hook of hooks) {
    logger.info(`Running hook "${hook.name}" (${trigger})...`);
    const start = Date.now();

    const result = await run(hook.command, [], { cwd: context.workingDir });
    const durationMs = Date.now() - start;
    const output = (result.stdout + result.stderr).trim() || undefined;

    if (result.exitCode !== 0) {
      logger.error(`Hook "${hook.name}" failed (exit ${result.exitCode})`);
      results.push({ success: false, hook: hook.name, output, durationMs });
      throw new HookError(hook.name, trigger, output);
    }

    results.push({ success: true, hook: hook.name, output, durationMs });
  }

  return results;
}

export class HookError extends Error {
  constructor(
    public readonly hook: string,
    public readonly trigger: HookTrigger,
    public readonly output?: string,
  ) {
    super(`Hook "${hook}" failed during ${trigger}${output ? `: ${output}` : ''}`);
    this.name = 'HookError';
  }
}
