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
  deduplicate(composes: DiscoveredCompose[], rootDir: string): Promise<MergedCompose>;
}

/**
 * Builds the LLM prompt for optimized compose merging.
 * The prompt is agnostic — it describes optimization principles without
 * referencing specific technologies or project names.
 *
 * @param composes - Array of discovered compose files to merge.
 * @returns The formatted prompt string.
 */
function buildPrompt(composes: DiscoveredCompose[]): string {
  const composesText = composes
    .map((c) => `--- ${c.serviceName} (${c.path}) ---\n${JSON.stringify(c.content, null, 2)}`)
    .join('\n\n');

  return `You are given multiple docker-compose files from a workspace of microservices. Produce a single optimized unified docker-compose file.

Optimization principles:

- Infrastructure consolidation: when multiple services declare separate containers of the same database engine (e.g. multiple PostgreSQL instances), consolidate them into a single shared instance that hosts multiple databases. The same applies to message brokers, caches, search engines, and any other shared infrastructure.

- Application preservation: each application service (containers with a "build" directive) must remain as a separate container. Never merge application services together.

- Dependency correctness: update all environment variables in application services to point to the consolidated infrastructure container names. Ensure depends_on references the correct unified containers with condition: service_healthy.

- Minimal resource footprint: use one shared network, one volume per infrastructure type, and eliminate any redundant declarations.

- Healthchecks: every infrastructure container must have a healthcheck defined.

- Port conflicts: if consolidation would create port conflicts on the host, remap to available ports.

Input compose files:
${composesText}

Return ONLY valid JSON with this structure: {"services": {...}, "networks": {...}, "volumes": {...}}`
}

export function createComposeSmartMerger(): ComposeSmartMerger {
  const aggregator = createComposeAggregator();

  return {
    async deduplicate(composes: DiscoveredCompose[], rootDir: string): Promise<MergedCompose> {
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
      const { merged } = aggregator.merge(composes, rootDir);
      return merged;
    },
  };
}
