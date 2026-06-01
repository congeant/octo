import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseManifest } from './manifest-parser.js';
import { printManifest } from './manifest-printer.js';
import { OctoError } from '../shared/errors.js';
import type { OctoManifest } from './manifest-schema.js';

export interface LoadedManifest {
  manifest: OctoManifest;
  originalContent?: string;
}

/**
 * Loads an existing octo.yaml manifest, or returns a minimal empty one.
 */
export function loadOrCreateManifest(manifestPath: string): LoadedManifest {
  if (existsSync(manifestPath)) {
    const content = readFileSync(manifestPath, 'utf-8');
    const parsed = parseManifest(content, manifestPath);
    if (parsed.ok) {
      return { manifest: parsed.value, originalContent: content };
    }
    throw new OctoError(`Invalid octo.yaml: ${parsed.error.message}`);
  }
  return { manifest: { services: [] } };
}

/**
 * Adds a project entry to the manifest, avoiding duplicates.
 * If the directory name matches the project name, registers as a simple string
 * (octo resolves the path by convention). Otherwise, uses an object with explicit path.
 *
 * Returns true if the entry was added, false if it already existed.
 */
export function addEntry(
  manifest: OctoManifest,
  name: string,
  dirName: string,
  type: 'service' | 'package',
): boolean {
  if (type === 'package' && !manifest.packages) {
    manifest.packages = [];
  }

  const list = type === 'service' ? manifest.services : manifest.packages!;

  const alreadyExists = list.some((entry) => {
    if (typeof entry === 'string') return entry === name;
    if (typeof entry === 'object' && entry !== null) return Object.keys(entry).includes(name);
    return false;
  });

  if (alreadyExists) {
    return false;
  }

  if (name === dirName) {
    list.push(name);
  } else {
    list.push({ [name]: { path: `./${dirName}` } });
  }
  return true;
}

/**
 * Persists the manifest to disk, preserving comments when possible.
 */
export function saveManifest(
  manifestPath: string,
  manifest: OctoManifest,
  originalContent?: string,
): void {
  const yaml = printManifest(manifest, originalContent);
  writeFileSync(manifestPath, yaml, 'utf-8');
}
