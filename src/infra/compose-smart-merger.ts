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

/**
 * Builds the LLM prompt for optimized compose merging.
 * Instructs the model to unify redundant infrastructure (databases, caches, brokers)
 * into shared instances while preserving application-specific services.
 *
 * @param composes - Array of discovered compose files to merge.
 * @returns The formatted prompt string.
 */
function buildPrompt(composes: DiscoveredCompose[]): string {
  const composesText = composes
    .map((c) => `--- ${c.serviceName} (${c.path}) ---\n${JSON.stringify(c.content, null, 2)}`)
    .join('\n\n');

  return `You are a Docker Compose optimization expert. Given multiple docker-compose files from a workspace of microservices, produce the most optimized unified compose possible.

Optimization goals (in priority order):
1. UNIFY shared infrastructure — multiple PostgreSQL, Redis, MongoDB, Elasticsearch, RabbitMQ, NATS, or similar containers MUST be consolidated into a single shared instance. Create separate databases/schemas via environment variables or init scripts, not separate containers.
2. UNIFY shared volumes — if multiple services mount the same type of volume (e.g. pg-data), consolidate into one.
3. UNIFY networks — use a single shared network unless isolation is explicitly required for security.
4. PRESERVE application services — each microservice container remains separate (they are distinct apps).
5. MERGE environment variables — when unifying databases, collect all required databases/users into the shared instance config.
6. AVOID port conflicts — if two services expose the same host port, remap one to an available port.
7. USE latest image versions when duplicates exist with different tags.
8. ADD healthchecks to infrastructure services (postgres, redis, etc.) if not already present.
9. ADD depends_on with condition: service_healthy for app services that need infrastructure.

Example: If service-a has postgres:16 on port 5432 and service-b has postgres:15 on port 5433, produce ONE postgres:16 container with both databases created via POSTGRES_MULTIPLE_DATABASES env or an init script volume.

Input compose files:
${composesText}

Return ONLY valid JSON with this exact structure:
{"services": {...}, "networks": {...}, "volumes": {...}}`
}

export function createComposeSmartMerger(): ComposeSmartMerger {
  const aggregator = createComposeAggregator();

  return {
    async deduplicate(composes: DiscoveredCompose[]): Promise<MergedCompose> {
      if (composes.length === 0) {
        return { services: {}, networks: {}, volumes: {} };
      }

      // Try LLM-based merge
      if (isAvailable()) {
        try {
          logger.info('Using local AI for smart compose merge...');
          const prompt = buildPrompt(composes);
          const parsed = await generateJSON(prompt, 4096);

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
