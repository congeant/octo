import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../shared/process-runner.js';

const HEADER = '# Changelog\n';

/**
 * Generates a Keep a Changelog entry and prepends it to CHANGELOG.md.
 * Returns the generated entry text.
 */
export class ChangelogGenerator {
  async generate(packageDir: string, newVersion: string): Promise<string> {
    const changelogPath = join(packageDir, 'CHANGELOG.md');
    const commits = await this.getCommitsSinceLastTag(packageDir);
    const entry = this.buildEntry(newVersion, commits);

    const existing = await this.readChangelog(changelogPath);
    const updated = this.prependEntry(existing, entry);
    await writeFile(changelogPath, updated, 'utf-8');

    return entry;
  }

  private async getCommitsSinceLastTag(cwd: string): Promise<string[]> {
    // Try to get the last tag for this directory
    const tagResult = await run('git', ['describe', '--tags', '--abbrev=0'], { cwd });
    const lastTag = tagResult.exitCode === 0 ? tagResult.stdout.trim() : '';

    const logArgs = lastTag
      ? ['log', `${lastTag}..HEAD`, '--oneline', '--', '.']
      : ['log', '--oneline', '--', '.'];

    const logResult = await run('git', logArgs, { cwd });
    if (logResult.exitCode !== 0 || !logResult.stdout.trim()) {
      return [];
    }

    return logResult.stdout
      .trim()
      .split('\n')
      .map((line) => line.replace(/^[a-f0-9]+\s+/, ''));
  }

  private buildEntry(version: string, commits: string[]): string {
    const date = new Date().toISOString().slice(0, 10);
    const lines = [`## [${version}] - ${date}`, '', '### Changed', ''];

    if (commits.length > 0) {
      for (const msg of commits) {
        lines.push(`- ${msg}`);
      }
    } else {
      lines.push('- Version bump');
    }

    lines.push('');
    return lines.join('\n');
  }

  private async readChangelog(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf-8');
    } catch {
      return '';
    }
  }

  private prependEntry(existing: string, entry: string): string {
    if (!existing) {
      return HEADER + '\n' + entry;
    }

    // Insert after the "# Changelog" header line
    const headerIndex = existing.indexOf('# Changelog');
    if (headerIndex !== -1) {
      const afterHeader = existing.indexOf('\n', headerIndex);
      if (afterHeader !== -1) {
        const before = existing.slice(0, afterHeader + 1);
        const after = existing.slice(afterHeader + 1);
        return before + '\n' + entry + after;
      }
    }

    // No header found — prepend at top
    return HEADER + '\n' + entry + existing;
  }
}
