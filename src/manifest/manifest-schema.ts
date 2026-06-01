import { z } from 'zod';

export const HookDefinitionSchema = z.object({
  name: z.string(),
  command: z.string(),
});

export const ServiceEntrySchema = z.union([
  z.string(),
  z.record(z.string(), z.object({
    path: z.string().optional(),
  })),
]);

export const PackageEntrySchema = z.union([
  z.string(),
  z.record(z.string(), z.object({
    path: z.string().optional(),
  })),
]);

export const TemplatesSchema = z.object({
  commit: z.string().optional(),
  tag: z.string().optional(),
  pr: z.string().optional(),
}).optional();

export const OctoManifestSchema = z.object({
  hooks: z.object({
    'pre-build': z.array(HookDefinitionSchema).optional(),
    'pre-bump': z.array(HookDefinitionSchema).optional(),
  }).optional(),
  templates: TemplatesSchema,
  services: z.array(ServiceEntrySchema),
  packages: z.array(PackageEntrySchema),
});

export type OctoManifest = z.infer<typeof OctoManifestSchema>;
export type HookDefinition = z.infer<typeof HookDefinitionSchema>;
export type ServiceEntry = z.infer<typeof ServiceEntrySchema>;
export type PackageEntry = z.infer<typeof PackageEntrySchema>;
