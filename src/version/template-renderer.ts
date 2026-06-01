import type { OctoManifest } from '../manifest/manifest-schema.js';

export interface TemplateContext {
  name: string;
  version: string;
  previousVersion: string;
  type: string;
  date: string;
}

const DEFAULTS = {
  commit: 'chore({{name}}): bump version to {{version}}',
  tag: '{{name}}@{{version}}',
  pr: 'chore({{name}}): bump {{previousVersion}} → {{version}}',
};

/** Renders a template string replacing {{var}} placeholders with context values */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template
    .replace(/\{\{name\}\}/g, ctx.name)
    .replace(/\{\{version\}\}/g, ctx.version)
    .replace(/\{\{previousVersion\}\}/g, ctx.previousVersion)
    .replace(/\{\{type\}\}/g, ctx.type)
    .replace(/\{\{date\}\}/g, ctx.date);
}

/** Get the commit message template (from manifest or default) */
export function getCommitTemplate(manifest: OctoManifest): string {
  return manifest.templates?.commit ?? DEFAULTS.commit;
}

/** Get the tag template (from manifest or default) */
export function getTagTemplate(manifest: OctoManifest): string {
  return manifest.templates?.tag ?? DEFAULTS.tag;
}

/** Get the PR title template (from manifest or default) */
export function getPrTemplate(manifest: OctoManifest): string {
  return manifest.templates?.pr ?? DEFAULTS.pr;
}
