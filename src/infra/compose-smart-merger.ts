import { z } from 'zod';
import { generateJSON, isAvailable } from '../shared/llm.js';
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

/** Build the structured prompt */
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

export function createComposeSmartMerger(): ComposeSmartMerger {
  const aggregator = createComposeAggregator();

  return {
    async deduplicate(composes: DiscoveredCompose[]): Promise<MergedCompose> {
      if (composes.length === 0) {
        return { services: {}, networks: {}, volumes: {} };
      }

      // Try LLM-based merge
      if (await isAvailable()) {
        try {
          logger.info('Using local AI for smart compose merge...');
          const prompt = buildPrompt(composes);
          const parsed = await generateJSON(prompt);

          if (parsed) {
            const validated = MergedComposeSchema.safeParse(parsed);
            if (validated.success) {
              logger.info('Smart merge completed successfully.');
              return validated.data;
            }
            logger.warn('AI output failed validation. Using deterministic fallback.');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`AI error: ${msg}. Using deterministic fallback.`);
        }
      } else {
        logger.info('Local AI unavailable. Using deterministic merge.');
      }

      // Fallback: deterministic merge
      const { merged } = aggregator.merge(composes);
      return merged;
    },
  };
}
