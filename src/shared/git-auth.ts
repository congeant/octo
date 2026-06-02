import { askSecret } from './prompt.js';

let cachedToken: string | undefined;

/**
 * Acquires a GitHub Personal Access Token for git HTTPS operations.
 * Prompts the user once (input hidden) and caches in memory for the process lifetime.
 * The token is never persisted to disk or echoed to the terminal.
 *
 * @returns The PAT string, or undefined if the user provides empty input (skip).
 */
export async function acquireGitToken(): Promise<string | undefined> {
  if (cachedToken) return cachedToken;
  const input = await askSecret('GitHub token (PAT): ');
  cachedToken = input || undefined;
  return cachedToken;
}

/**
 * Embeds a token into an HTTPS git URL for credential-less cloning.
 * Produces format: https://<token>@github.com/org/repo.git
 *
 * @param baseUrl - The base HTTPS clone URL (e.g. "https://github.com/org/repo.git").
 * @param token - The GitHub PAT to embed.
 * @returns The URL with credentials embedded in the authority segment.
 */
export function embedTokenInUrl(baseUrl: string, token: string): string {
  return baseUrl.replace('https://', `https://${token}@`);
}

/**
 * Clears the cached token from process memory.
 * Should be called after sync completes as defense-in-depth.
 */
export function clearCachedToken(): void {
  cachedToken = undefined;
}
