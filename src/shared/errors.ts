/** Base error for all Octo CLI errors */
export class OctoError extends Error {
  constructor(message: string, public readonly exitCode: number = 1) {
    super(message);
    this.name = 'OctoError';
  }
}

/** Manifest parsing/validation errors */
export class ManifestError extends OctoError {
  constructor(
    message: string,
    public readonly file?: string,
    public readonly line?: number,
    public readonly column?: number,
  ) {
    super(message);
    this.name = 'ManifestError';
  }
}

/** Build engine/orchestration errors */
export class BuildError extends OctoError {
  constructor(
    message: string,
    public readonly service?: string,
    public readonly output?: string,
  ) {
    super(message);
    this.name = 'BuildError';
  }
}

/** Dependency cycle detection errors */
export class CycleError extends OctoError {
  constructor(
    message: string,
    public readonly cycle: string[],
  ) {
    super(message);
    this.name = 'CycleError';
  }
}
