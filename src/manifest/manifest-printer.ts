import { parseDocument, stringify, Document, isSeq, isScalar, isMap } from 'yaml';
import type { OctoManifest } from './manifest-schema.js';

/**
 * Checks if two values are deeply equal (for simple manifest structures).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/**
 * Gets the plain JS value from a YAML AST node for comparison.
 */
function nodeToPlain(node: unknown): unknown {
  if (isScalar(node)) return node.value;
  if (isSeq(node)) return node.items.map(nodeToPlain);
  if (isMap(node)) {
    const obj: Record<string, unknown> = {};
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      obj[key] = nodeToPlain(pair.value);
    }
    return obj;
  }
  return node;
}

/**
 * Serializes an OctoManifest back to YAML.
 * When originalContent is provided, updates the AST in-place to preserve comments and key order.
 * When no originalContent is provided, stringifies the object directly.
 */
export function printManifest(manifest: OctoManifest, originalContent?: string): string {
  if (!originalContent) {
    return stringify(manifest, { lineWidth: 0 });
  }

  // Parse original into a Document (AST) to preserve comments and ordering
  const doc = parseDocument(originalContent);

  // Update hooks
  if (manifest.hooks !== undefined) {
    const existingHooks = doc.get('hooks', true);
    if (!deepEqual(nodeToPlain(existingHooks), manifest.hooks)) {
      doc.set('hooks', manifest.hooks);
    }
  } else if (doc.has('hooks')) {
    doc.delete('hooks');
  }

  // Only update services/packages if values actually changed
  for (const key of ['services', 'packages'] as const) {
    const existingNode = doc.get(key, true);
    const existingPlain = nodeToPlain(existingNode);
    if (!deepEqual(existingPlain, manifest[key])) {
      doc.set(key, manifest[key]);
    }
    // If equal, leave the AST node untouched (preserves all comments)
  }

  return doc.toString({ lineWidth: 0 });
}
