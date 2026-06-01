import { Ollama } from 'ollama';
import { z } from 'zod';
import { createComposeAggregator, type DiscoveredCompose, type MergedCompose } from './compose-aggregator.js';
import { logger } from '../shared/logger.js';

/** Zod schema to validate LLM output */
const MergedComposeSchema = z.object({
  services: z.record(z.string(), z.any()).default({}),
  networks: z.record(z.string(), z.any()).default({}),
  volumes: z.record(z.string(), z.any()).default({}),
});

export interface ComposeSmartMerger {
  deduplicate(composes: DiscoveredCompose[]): Promise<MergedCompose>;
}

/** Build the structured prompt for Phi-4 */
function buildPrompt(composes: DiscoveredCompose[]): string {
  const composesText = composes
    .map((c) => `--- ${c.serviceName} (${c.path}) ---\n${JSON.stringify(c.content, null, 2)}`)
    .join('\n\n');

  return `You are a Docker Compose expert. Given multiple docker-compose files from different services, merge them into a single unified compose file.

Rules:
1. Deduplicate containers that represent the same infrastructure (e.g. multiple postgres definitions → keep one)
2. When images differ, prefer the most recent version
3. Merge all environment variables from duplicates without losing any
4. Consolidate networks and volumes, removing redundancies
5. Preserve all port mappings, flagging conflicts if any

Input compose files:
${composesText}

Return ONLY valid JSON with this exact structure:
{"services": {...}, "networks": {...}, "volumes": {...}}`;
}

/** Check if Ollama is available with phi4 model */
async function isOllamaAvailable(client: Ollama): Promise<boolean> {
  try {
    const models = await client.list();
    return models.models.some((m) => m.name.startsWith('phi4'));
  } catch {
    return false;
  }
}

export function createComposeSmartMerger(): ComposeSmartMerger {
  const client = new Ollama();
  const aggregator = createComposeAggregator();

  return {
    async deduplicate(composes: DiscoveredCompose[]): Promise<MergedCompose> {
      if (composes.length === 0) {
        return { services: {}, networks: {}, volumes: {} };
      }

      // Try LLM-based merge
      if (await isOllamaAvailable(client)) {
        try {
          logger.info('Usando Phi-4 para merge inteligente de compose files...');
          const prompt = buildPrompt(composes);
          const response = await client.generate({
            model: 'phi4',
            prompt,
            format: 'json',
            stream: false,
          });

          const parsed = JSON.parse(response.response);
          const validated = MergedComposeSchema.safeParse(parsed);

          if (validated.success) {
            logger.info('Merge inteligente concluído com sucesso.');
            return validated.data;
          }

          logger.warn('Output da LLM falhou na validação Zod. Usando fallback determinístico.');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`Erro ao usar Phi-4: ${msg}. Usando fallback determinístico.`);
        }
      } else {
        logger.info('Ollama/Phi-4 indisponível. Usando merge determinístico.');
      }

      // Fallback: deterministic merge
      const { merged } = aggregator.merge(composes);
      return merged;
    },
  };
}
