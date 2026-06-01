import { describe, it, expect } from 'vitest';
import { run } from '../../src/shared/process-runner.js';

describe('process-runner', () => {
  it('captures stdout from a simple command', async () => {
    const result = await run('echo', ['hello']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('captures stderr on failure', async () => {
    const result = await run('ls', ['--nonexistent-flag-xyz']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('returns non-zero exit code without throwing', async () => {
    const result = await run('false', []);
    expect(result.exitCode).not.toBe(0);
  });

  it('supports shell option for piped commands', async () => {
    const result = await run('echo hello | tr a-z A-Z', [], { shell: true });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('HELLO');
  });

  it('respects timeout', async () => {
    const result = await run('sleep', ['10'], { timeout: 200 });
    expect(result.exitCode).not.toBe(0);
  });

  it('supports cwd option', async () => {
    const result = await run('pwd', [], { cwd: '/tmp' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/\/tmp/);
  });
});
