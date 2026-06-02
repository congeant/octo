import { createInterface } from 'node:readline';

let cachedToken: string | undefined;

/**
 * Prompts the user for a GitHub Personal Access Token via stdin.
 * The token is held in memory only — never written to disk.
 *
 * @returns The token string, or undefined if the user skips (empty input).
 */
async function promptToken(): Promise<string | undefined> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question('GitHub token (PAT): ', (answer) => {
      rl.close();
      const token = answer.trim();
      resolve(token || undefined);
    });
  });
}

/**
 * Acquires a GitHub token for git operations.
 * Prompts once and caches in memory for the duration of the process.
 * Returns env vars that embed the token directly in the clone URL via credential helper.
 *
 * @returns Environment variables for git auth, or undefined if user skipped.
 */
export async function acquireGitToken(): Promise<string | undefined> {
  if (cachedToken) return cachedToken;
  cachedToken = await promptToken();
  return cachedToken;
}

/**
 * Builds a git clone URL with embedded token for HTTPS auth.
 * Format: https://<token>@github.com/org/repo.git
 * The token never touches the filesystem — it lives only in the URL passed to git.
 *
 * @param baseUrl - The HTTPS clone URL (e.g. https://github.com/org/repo.git).
 * @param token - The GitHub PAT.
 * @returns URL with embedded credentials.
 */
export function embedTokenInUrl(baseUrl: string, token: string): string {
  return baseUrl.replace('https://', `https://${token}@`);
}

/**
 * Clears the cached token from memory.
 * Call this after sync is complete for defense-in-depth.
 */
export function clearCachedToken(): void {
  cachedToken = undefined;
}
