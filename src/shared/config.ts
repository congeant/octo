import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_FILE = join(homedir(), '.octo-config.json');

export interface LlmConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface OctoConfig {
  llm?: LlmConfig;
}

/**
 * Loads the octo configuration from ~/.octo-config.json.
 * Returns an empty config object if the file doesn't exist or is invalid.
 *
 * @returns The parsed configuration.
 */
export function loadConfig(): OctoConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as OctoConfig;
  } catch {
    return {};
  }
}

/**
 * Saves the octo configuration to ~/.octo-config.json.
 * Merges with existing config (does not overwrite unrelated keys).
 *
 * @param partial - Partial config to merge and persist.
 */
export function saveConfig(partial: Partial<OctoConfig>): void {
  const existing = loadConfig();
  const merged = { ...existing, ...partial };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

/**
 * Returns the path to the config file for display purposes.
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}
