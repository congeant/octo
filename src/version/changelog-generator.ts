import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generate } from '../shared/llm.js';
import { run } from '../shared/process-runner.js';
import { logger } from '../shared/logger.js';

const HEADER = '# Changelog\n';

export class ChangelogGenerator {
  async generate(packageDir: string, newVersion: string): Promise<string> {
    const changelogPath = join(packageDir, 'CHANGELOG.md');
    const commits = await this.getCommitsSinceLastTag(packageDir);
    const entry = await this.buildEntry(newVersion, commits);

    const existing = await this.readChangelog(changelogPath);
    const updated = this.prependEntry(existing, entry);
    await writeFile(changelogPath, updated, 'utf-8');

    return entry;
  }

  private async getCommitsSinceLastTag(cwd: string): Promise<string[]> {
    const tagResult = await run('git', ['describe', '--tags', '--abbrev=0'], { cwd });
    const lastTag = tagResult.exitCode === 0 ? tagResult.stdout.trim() : '';

    const logArgs = lastTag
      ? ['log', `${lastTag}..HEAD`, '--oneline', '--', '.']
      : ['log', '--oneline', '--', '.'];

    const logResult = await run('git', logArgs, { cwd });
    if (logResult.exitCode !== 0 || !logResult.stdout.trim()) return [];

    return logResult.stdout
      .trim()
      .split('\n')
      .map((line) => line.replace(/^[a-f0-9]+\s+/, ''));
  }

  private async buildEntry(version: string, commits: string[]): Promise<string> {
    const date = new Date().toISOString().slice(0, 10);

    if (commits.length === 0) {
      return [`## [${version}] - ${date}`, '', '### Changed', '', '- Version bump', ''].join('\n');
    }

    // Try LLM-generated changelog
    const llmEntry = await this.generateWithLLM(version, date, commits);
    if (llmEntry) return llmEntry;

    // Fallback: plain commit list
    const lines = [`## [${version}] - ${date}`, '', '### Changed', ''];
    for (const msg of commits) {
      lines.push(`- ${msg}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  private async generateWithLLM(version: string, date: string, commits: string[]): Promise<string | null> {
    try {
      const commitList = commits.map((c) => `- ${c}`).join('\n');
      const prompt = `You are a changelog writer. Given these git commits, generate a concise, well-organized changelog entry in Keep a Changelog format.

Group changes into appropriate sections: Added, Changed, Fixed, Removed (only include sections that apply).
Rewrite commit messages into clear, user-facing descriptions. Merge related commits into single entries when appropriate.

Commits:
${commitList}

Output ONLY the markdown sections (### Added, ### Changed, etc.) with bullet points. No header, no version line.`;

      const sections = await generate(prompt);
      if (!sections || sections.length < 10) return null;

      return [`## [${version}] - ${date}`, '', sections.trim(), ''].join('\n');
    } catch {
      return null;
    }
  }

  private async readChangelog(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf-8');
    } catch {
      return '';
    }
  }

  private prependEntry(existing: string, entry: string): string {
    if (!existing) return HEADER + '\n' + entry;

    const headerIndex = existing.indexOf('# Changelog');
    if (headerIndex !== -1) {
      const afterHeader = existing.indexOf('\n', headerIndex);
      if (afterHeader !== -1) {
        const before = existing.slice(0, afterHeader + 1);
        const after = existing.slice(afterHeader + 1);
        return before + '\n' + entry + after;
      }
    }

    return HEADER + '\n' + entry + existing;
  }
}
