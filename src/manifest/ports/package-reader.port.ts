/**
 * Port — abstracts reading package metadata from a project directory.
 * Decouples domain logic from filesystem and specific package manager formats.
 */
export interface PackageMetadata {
  name?: string;
  version?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export interface PackageReader {
  /**
   * Reads package metadata from a project directory.
   *
   * @param dir - Absolute path to the project directory.
   * @returns Package metadata, or undefined if no package manifest exists.
   */
  read(dir: string): PackageMetadata | undefined;
}
