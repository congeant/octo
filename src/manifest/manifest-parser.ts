import { parse as parseYaml, YAMLParseError } from 'yaml';
import { OctoManifestSchema, type OctoManifest } from './manifest-schema.js';
import { ManifestError } from '../shared/errors.js';

export type ParseSuccess = {
  ok: true;
  value: OctoManifest;
  warnings: string[];
};

export type ParseFailure = {
  ok: false;
  error: ManifestError;
};

export type ParseResult = ParseSuccess | ParseFailure;

/** Known top-level keys in the manifest schema */
const KNOWN_TOP_KEYS = new Set(['hooks', 'services', 'packages']);
const KNOWN_HOOK_KEYS = new Set(['pre-build', 'pre-bump']);

/**
 * Detects unknown keys at top level and in hooks, returning warnings.
 */
function detectUnknownKeys(data: Record<string, unknown>): string[] {
  const warnings: string[] = [];

  for (const key of Object.keys(data)) {
    if (!KNOWN_TOP_KEYS.has(key)) {
      warnings.push(`Unknown key "${key}" at root level`);
    }
  }

  if (data.hooks && typeof data.hooks === 'object' && data.hooks !== null) {
    for (const key of Object.keys(data.hooks as Record<string, unknown>)) {
      if (!KNOWN_HOOK_KEYS.has(key)) {
        warnings.push(`Unknown key "${key}" in hooks`);
      }
    }
  }

  return warnings;
}

/**
 * Parses YAML content and validates against OctoManifestSchema.
 * Returns all validation errors in a single message (does not stop at first error).
 * Emits warnings for unknown keys without blocking the parse.
 */
export function parseManifest(content: string, filePath?: string): ParseResult {
  // Handle empty/whitespace-only content
  if (!content || content.trim().length === 0) {
    return {
      ok: false,
      error: new ManifestError('Manifest file is empty or contains only whitespace', filePath),
    };
  }

  // Parse YAML — catch syntax errors with line/column
  let data: unknown;
  try {
    data = parseYaml(content);
  } catch (err) {
    if (err instanceof YAMLParseError) {
      const pos = err.linePos?.[0];
      return {
        ok: false,
        error: new ManifestError(
          `YAML syntax error: ${err.message}`,
          filePath,
          pos?.line,
          pos?.col,
        ),
      };
    }
    return {
      ok: false,
      error: new ManifestError(`Unexpected parse error: ${String(err)}`, filePath),
    };
  }

  if (data === null || data === undefined || typeof data !== 'object') {
    return {
      ok: false,
      error: new ManifestError('Manifest must be a YAML mapping (object)', filePath),
    };
  }

  // Detect unknown keys (warnings, non-blocking)
  const warnings = detectUnknownKeys(data as Record<string, unknown>);

  // Validate with Zod — collect ALL errors
  const result = OctoManifestSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    return {
      ok: false,
      error: new ManifestError(
        `Manifest validation failed:\n${issues.join('\n')}`,
        filePath,
      ),
    };
  }

  return { ok: true, value: result.data, warnings };
}
