import { writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';

const ASKPASS_SCRIPT = join(tmpdir(), '.octo-askpass');

/**
 * Prompts the user for a GitHub Personal Access Token (PAT) via stdin.
 * Input is hidden (not echoed to terminal).
 *
 * @returns The token string entered by the user.
 */
async function promptToken(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    process.stdout.write('GitHub token (PAT): ');
    // Disable echo for password input
    if (process.stdin.isTTY) process.stdin.setRawMode?.(true);

    let token = '';
    process.stdin.once('data', (data) => {
      token = data.toString().trim();
      if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
      process.stdout.write('\n');
      rl.close();
      resolve(token);
    });
  });
}

/**
 * Sets up a temporary GIT_ASKPASS script that returns the provided token.
 * Git uses this script instead of prompting interactively for each clone.
 *
 * @param token - The GitHub PAT to inject into git operations.
 * @returns Environment variables to pass to git commands.
 */
export function setupGitAuth(token: string): Record<string, string> {
  const script = `#!/bin/sh\necho "${token}"`;
  writeFileSync(ASKPASS_SCRIPT, script, { mode: 0o700 });
  chmodSync(ASKPASS_SCRIPT, 0o700);

  return {
    GIT_ASKPASS: ASKPASS_SCRIPT,
    GIT_TERMINAL_PROMPT: '0',
  };
}

/**
 * Removes the temporary ASKPASS script from disk.
 */
export function cleanupGitAuth(): void {
  try {
    unlinkSync(ASKPASS_SCRIPT);
  } catch {
    // Already cleaned or never created
  }
}

/**
 * Acquires a GitHub token from the user and returns env vars for git auth.
 * If the user provides an empty token, returns undefined (skip auth injection).
 *
 * @returns Environment variables for git auth, or undefined if skipped.
 */
export async function acquireGitToken(): Promise<Record<string, string> | undefined> {
  const token = await promptToken();
  if (!token) return undefined;
  return setupGitAuth(token);
}
