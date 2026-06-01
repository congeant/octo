import { run } from '../../shared/process-runner.js';
import type { BuildEngine, BuildTarget, BuildEngineResult } from '../ports/build-engine.port.js';

/** Adapter — Docker build engine via CLI */
export class DockerBuildEngine implements BuildEngine {
  name = 'docker';

  async build(target: BuildTarget): Promise<BuildEngineResult> {
    const context = target.context ?? target.path;
    const start = Date.now();

    const result = await run('docker', ['build', '-f', target.buildFile, context], {
      cwd: target.path,
    });

    const durationMs = Date.now() - start;
    const output = (result.stdout + result.stderr).trim();

    return {
      success: result.exitCode === 0,
      output,
      durationMs,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await run('docker', ['--version'], { timeout: 5_000 });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  detect(buildFile: string): boolean {
    const name = buildFile.split('/').pop() ?? buildFile;
    return name === 'Dockerfile' || name.startsWith('Dockerfile.');
  }
}
