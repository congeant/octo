import { logger } from './logger.js';
import { loadConfig } from './config.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  choices: Array<{ message: { content: string } }>;
}

/**
 * Sends a prompt to the configured LLM provider via OpenAI-compatible API.
 * Returns null if no LLM is configured or the request fails.
 *
 * @param prompt - The user prompt to send.
 * @param maxTokens - Maximum tokens in the response.
 * @returns The generated text, or null on failure.
 */
export async function generate(prompt: string, maxTokens = 512): Promise<string | null> {
  const config = loadConfig();
  if (!config.llm?.apiKey || !config.llm?.baseUrl) return null;

  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

  try {
    const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages,
        max_tokens: maxTokens,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      logger.warn(`LLM request failed (${response.status}). Using deterministic fallback.`);
      return null;
    }

    const data = await response.json() as ChatResponse;
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`LLM unavailable: ${msg}. Using deterministic fallback.`);
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
 * Checks if an LLM provider is configured and reachable.
 *
 * @returns true if LLM config exists with apiKey and baseUrl.
 */
export function isAvailable(): boolean {
  const config = loadConfig();
  return !!(config.llm?.apiKey && config.llm?.baseUrl);
}
