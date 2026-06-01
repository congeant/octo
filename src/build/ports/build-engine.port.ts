/** Port — interface that the build orchestrator consumes */
export interface BuildTarget {
  name: string;
  path: string;
  buildFile: string;
  context?: string;
}

export interface BuildEngineResult {
  success: boolean;
  output: string;
  durationMs: number;
}

export interface BuildEngine {
  name: string;
  build(target: BuildTarget): Promise<BuildEngineResult>;
  isAvailable(): Promise<boolean>;
  detect(buildFile: string): boolean;
}

/** Registry — resolves the correct adapter by build_file */
export interface BuildEngineRegistry {
  register(engine: BuildEngine): void;
  resolve(buildFile: string): BuildEngine | undefined;
}

export class DefaultBuildEngineRegistry implements BuildEngineRegistry {
  private engines: BuildEngine[] = [];

  register(engine: BuildEngine): void {
    this.engines.push(engine);
  }

  resolve(buildFile: string): BuildEngine | undefined {
    return this.engines.find((e) => e.detect(buildFile));
  }
}
