import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { logger } from './logger.js';
import { loadConfig, type LlmConfig } from './config.js';

/**
 * Resolves the AI SDK language model from the stored config.
 * Supports openai, gemini, groq, anthropic, and any OpenAI-compatible custom endpoint.
 *
 * @param config - The LLM configuration with provider, baseUrl, model, and apiKey.
 * @returns An AI SDK language model instance.
 */
function resolveModel(config: LlmConfig) {
  switch (config.provider) {
    case 'google':
    case 'gemini': {
      const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
      return google(config.model);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: config.apiKey });
      return anthropic(config.model);
    }
    case 'openai':
    case 'groq':
    case 'custom':
    default: {
      const openai = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
      return openai(config.model);
    }
  }
}

/**
 * Generates text from a prompt using the configured LLM provider.
 * Returns null if no LLM is configured or the request fails.
 *
 * @param prompt - The user prompt to send.
 * @param maxTokens - Maximum tokens in the response.
 * @returns The generated text, or null on failure.
 */
export async function generate(prompt: string, maxTokens = 512): Promise<string | null> {
  const config = loadConfig();
  if (!config.llm?.apiKey) return null;

  try {
    const model = resolveModel(config.llm);
    const { text } = await generateText({
      model,
      prompt,
      maxTokens,
      temperature: 0,
    });
    return text?.trim() || null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`LLM request failed: ${msg}. Using deterministic fallback.`);
    return null;
  }
}

/**
 * Generates structured JSON output from a prompt.
 * Returns null if parsing fails or LLM is unavailable.
 *
 * @param prompt - The prompt requesting JSON output.
 * @param maxTokens - Maximum tokens in the response.
 * @returns Parsed JSON object, or null on failure.
 */
export async function generateJSON<T = unknown>(prompt: string, maxTokens = 1024): Promise<T | null> {
  const text = await generate(prompt, maxTokens);
  if (!text) return null;

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}

/**
 * Checks if an LLM provider is configured.
 *
 * @returns true if LLM config exists with a valid apiKey.
 */
export function isAvailable(): boolean {
  const config = loadConfig();
  return !!config.llm?.apiKey;
}
