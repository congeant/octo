import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Wrapper for child_process.spawn with Promise, timeout, and stdout/stderr capture */
export function run(command: string, args: string[] = [], options: RunOptions = {}): Promise<RunResult> {
  const { cwd, timeout = 60_000, env } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeout}ms: ${command} ${args.join(' ')}`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
