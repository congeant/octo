import { execaCommand, execa } from 'execa';

export interface RunOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  /** When true, inherits stdio so the user can interact (e.g. git password prompts) */
  interactive?: boolean;
  /** When true, runs command through the system shell. Use only for piped/complex commands. */
  shell?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Executes a command with args. Powered by execa.
 * Returns stdout, stderr, and exitCode without throwing on non-zero exit.
 */
export async function run(command: string, args: string[] = [], options: RunOptions = {}): Promise<RunResult> {
  const { cwd, timeout = 60_000, env, interactive = false, shell = false } = options;

  const execOptions = {
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    timeout,
    shell,
    reject: false,
    stdin: interactive ? 'inherit' as const : undefined,
    stdout: interactive ? 'inherit' as const : 'pipe' as const,
    stderr: interactive ? 'inherit' as const : 'pipe' as const,
  };

  const result = shell && args.length === 0
    ? await execaCommand(command, execOptions)
    : await execa(command, args, execOptions);

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.exitCode ?? 1,
  };
}
