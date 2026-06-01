import { pipeline, type TextGenerationPipeline } from '@huggingface/transformers';
import { logger } from './logger.js';

const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';

let generator: TextGenerationPipeline | null = null;
let initFailed = false;

/**
 * Lazily initializes the text generation pipeline.
 * Downloads the ONNX model on first use (~500MB, cached locally).
 */
async function getGenerator(): Promise<TextGenerationPipeline | null> {
  if (initFailed) return null;
  if (generator) return generator;

  try {
    logger.info('Carregando modelo de IA local (primeira execução pode demorar)...');
    generator = await pipeline('text-generation', MODEL_ID, {
      dtype: 'q4',
    }) as TextGenerationPipeline;
    return generator;
  } catch (err) {
    initFailed = true;
    const msg = err instanceof Error ? err.message : String(err);
    logger.info(`Modelo de IA indisponível: ${msg}. Usando fallback determinístico.`);
    return null;
  }
}

/**
 * Generates text from a prompt using the local ONNX model.
 * Returns null if the model is unavailable or generation fails.
 */
export async function generate(prompt: string, maxTokens = 512): Promise<string | null> {
  const gen = await getGenerator();
  if (!gen) return null;

  try {
    const messages = [
      { role: 'user', content: prompt },
    ];
    const result = await gen(messages, {
      max_new_tokens: maxTokens,
      do_sample: false,
    });
    const output = result[0]?.generated_text;
    if (Array.isArray(output)) {
      const last = output[output.length - 1];
      return typeof last === 'object' && 'content' in last ? String(last.content) : null;
    }
    return typeof output === 'string' ? output : null;
  } catch {
    return null;
  }
}

/**
 * Generates structured JSON output from a prompt.
 * Returns null if parsing fails or model is unavailable.
 */
export async function generateJSON<T = unknown>(prompt: string, maxTokens = 1024): Promise<T | null> {
  const text = await generate(prompt, maxTokens);
  if (!text) return null;

  // Extract JSON from the response (model may wrap in markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}

/**
 * Checks if the LLM is available (model loaded or loadable).
 */
export async function isAvailable(): Promise<boolean> {
  const gen = await getGenerator();
  return gen !== null;
}
