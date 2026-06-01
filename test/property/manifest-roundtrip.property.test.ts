import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseManifest } from '../../src/manifest/manifest-parser.js';
import { printManifest } from '../../src/manifest/manifest-printer.js';
import type { OctoManifest } from '../../src/manifest/manifest-schema.js';

/**
 * Feature: octo, Property 11: Manifest Parse-Print-Parse Round Trip
 * Validates: Requirements 7.3, 7.4
 *
 * For any valid OctoManifest object, serializing it to YAML (print) and then
 * parsing the result back SHALL produce an object that is structurally identical
 * (deep equality) to the original. Additionally, comments present in the original
 * YAML source SHALL be preserved in the printed output.
 */

// Generators for OctoManifest components
const hookDefArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z][a-z0-9-]*$/.test(s)),
  command: fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\n') && s.trim().length > 0),
});

const serviceEntryArb = fc.oneof(
  // Simple string entry
  fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z][a-z0-9-]*$/.test(s)),
  // Object entry with optional path
  fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z][a-z0-9-]*$/.test(s)).chain(name =>
    fc.record({ path: fc.option(fc.constant(`./services/${name}`), { nil: undefined }) }).map(opts => {
      const entry: Record<string, { path?: string }> = {};
      entry[name] = opts.path !== undefined ? { path: opts.path } : {};
      return entry;
    })
  ),
);

const packageEntryArb = fc.oneof(
  // Simple string entry (scoped package name)
  fc.string({ minLength: 1, maxLength: 15 }).filter(s => /^[a-z][a-z0-9-]*$/.test(s)).map(s => `@spectre/${s}`),
  // Object entry with optional path
  fc.string({ minLength: 1, maxLength: 15 }).filter(s => /^[a-z][a-z0-9-]*$/.test(s)).chain(name =>
    fc.record({ path: fc.option(fc.constant(`./packages/${name}`), { nil: undefined }) }).map(opts => {
      const entry: Record<string, { path?: string }> = {};
      entry[`@spectre/${name}`] = opts.path !== undefined ? { path: opts.path } : {};
      return entry;
    })
  ),
);

const manifestArb: fc.Arbitrary<OctoManifest> = fc.record({
  hooks: fc.option(
    fc.record({
      'pre-build': fc.option(fc.array(hookDefArb, { minLength: 0, maxLength: 3 }), { nil: undefined }),
      'pre-bump': fc.option(fc.array(hookDefArb, { minLength: 0, maxLength: 3 }), { nil: undefined }),
    }),
    { nil: undefined },
  ),
  services: fc.array(serviceEntryArb, { minLength: 1, maxLength: 5 }),
  packages: fc.array(packageEntryArb, { minLength: 1, maxLength: 5 }),
});

describe('Property 11: Manifest Parse-Print-Parse Round Trip', () => {
  it('print → parse produces structurally identical object', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        const yaml = printManifest(manifest);
        const result = parseManifest(yaml);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toEqual(manifest);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('parse → print → parse preserves deep equality', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        // First print
        const yaml1 = printManifest(manifest);
        // Parse it
        const parsed1 = parseManifest(yaml1);
        expect(parsed1.ok).toBe(true);
        if (!parsed1.ok) return;

        // Print again (with original content for comment preservation path)
        const yaml2 = printManifest(parsed1.value, yaml1);
        // Parse again
        const parsed2 = parseManifest(yaml2);
        expect(parsed2.ok).toBe(true);
        if (!parsed2.ok) return;

        expect(parsed2.value).toEqual(parsed1.value);
      }),
      { numRuns: 100 },
    );
  });

  it('preserves comments from original YAML source', () => {
    const originalYaml = `# Top-level comment about the manifest
services:
  - auth # inline comment about auth
  - workspace
# Comment about packages section
packages:
  - "@spectre/events"
`;

    const parsed = parseManifest(originalYaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const printed = printManifest(parsed.value, originalYaml);

    // Comments should be preserved
    expect(printed).toContain('# Top-level comment about the manifest');
    expect(printed).toContain('# inline comment about auth');
    expect(printed).toContain('# Comment about packages section');

    // Round-trip should still produce identical object
    const reparsed = parseManifest(printed);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.value).toEqual(parsed.value);
  });
});
