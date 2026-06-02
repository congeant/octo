import { run } from '../shared/process-runner.js';
import { logger } from '../shared/logger.js';
import { saveConfig, getConfigPath, type LlmConfig } from '../shared/config.js';
import { ask, askSecret } from '../shared/prompt.js';

const PROVIDERS: Record<string, { baseUrl: string; defaultModel: string }> = {
  openai: { baseUrl: 'https://openai.com/v1', defaultModel: 'gpt-4o-mini' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-20250514' },
  custom: { baseUrl: '', defaultModel: '' },
};

/**
 * octo config git-cache [value]
 *
 * Sets git credential.helper locally.
 *
 * @param value - The credential helper value (default: "cache").
 */
export async function configGitCacheCommand(value?: string): Promise<void> {
  const helper = value || 'cache';
  const result = await run('git', ['config', '--local', 'credential.helper', helper]);
  if (result.exitCode !== 0) {
    logger.error(`Failed to set credential.helper: ${result.stderr.trim()}`);
    return;
  }
  logger.info(`Git credential.helper set to "${helper}".`);
}

/**
 * octo config llm
 *
 * Configures the LLM provider interactively.
 * Stores api key and provider settings in ~/.octo-config.json.
 */
export async function configLlmCommand(): Promise<void> {
  const providerNames = Object.keys(PROVIDERS);
  logger.info(`Available providers: ${providerNames.join(', ')}`);

  const provider = await ask('Provider: ');
  if (!providerNames.includes(provider)) {
    logger.error(`Unknown provider "${provider}". Available: ${providerNames.join(', ')}`);
    return;
  }

  const preset = PROVIDERS[provider];
  const baseUrl = provider === 'custom'
    ? await ask('Base URL (OpenAI-compatible): ')
    : preset.baseUrl;

  const model = await ask(`Model [${preset.defaultModel}]: `) || preset.defaultModel;
  const apiKey = await askSecret('API key: ');

  if (!apiKey) {
    logger.error('API key is required.');
    return;
  }

  const llm: LlmConfig = { provider, baseUrl, model, apiKey };
  saveConfig({ llm });

  logger.info(`LLM configured (${provider}/${model}). Saved to ${getConfigPath()}`);
}
