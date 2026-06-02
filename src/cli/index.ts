#!/usr/bin/env node
import { Command } from 'commander';
import { triggerShutdown } from '../shared/shutdown.js';

// Graceful shutdown on SIGINT (Ctrl+C) and SIGTERM
process.on('SIGINT', () => triggerShutdown('SIGINT'));
process.on('SIGTERM', () => triggerShutdown('SIGTERM'));

const program = new Command();

program
  .name('octo')
  .description('Build orchestration, semantic versioning, and local infrastructure management for repository workspaces')
  .version('0.10.0');

program
  .command('init')
  .description('Scan the workspace and generate octo.yaml')
  .option('--standalone', 'Generate manifest for the current project only')
  .action(async (opts) => {
    const { initCommand } = await import('./init.command.js');
    await initCommand(opts);
  });

program
  .command('graph')
  .description('Display the dependency graph')
  .action(async () => {
    const { graphCommand } = await import('./graph.command.js');
    await graphCommand();
  });

program
  .command('build [service]')
  .description('Build workspace services')
  .option('--affected', 'Build only affected services')
  .action(async (service, opts) => {
    const { buildCommand } = await import('./build.command.js');
    await buildCommand(service, opts);
  });

program
  .command('bump <package>')
  .description('Bump package version with semver')
  .argument('[type]', 'Bump type: patch | minor | major', 'patch')
  .option('--install', 'Run pnpm install in updated dependents')
  .option('--push', 'Push commit and tags to remote after bump')
  .option('--tag', 'Create a git tag for the new version')
  .option('--auto', 'Non-interactive mode: skip confirmations, tag and push automatically')
  .action(async (pkg, type, opts) => {
    const { bumpCommand } = await import('./bump.command.js');
    await bumpCommand(pkg, type, opts);
  });

program
  .command('up [service]')
  .description('Start local infrastructure')
  .action(async (service) => {
    const { upCommand } = await import('./up.command.js');
    await upCommand(service);
  });

program
  .command('down')
  .description('Stop local infrastructure')
  .option('--volumes', 'Remove volumes as well')
  .action(async (opts) => {
    const { downCommand } = await import('./down.command.js');
    await downCommand(opts);
  });

program
  .command('status')
  .description('Show container status')
  .action(async () => {
    const { statusCommand } = await import('./status.command.js');
    await statusCommand();
  });

program
  .command('add <repo-url>')
  .description('Clone a repository and register it in octo.yaml')
  .option('--name <name>', 'Custom name for the cloned directory')
  .action(async (repoUrl, opts) => {
    const { addCommand } = await import('./add.command.js');
    await addCommand(repoUrl, opts);
  });

program
  .command('sync')
  .description('Clone all missing repositories declared in octo.yaml')
  .action(async () => {
    const { syncCommand } = await import('./sync.command.js');
    await syncCommand();
  });

const config = program
  .command('config')
  .description('Configure octo and git settings');

config
  .command('git-cache [value]')
  .description('Set git credential.helper (default: "cache")')
  .action(async (value) => {
    const { configGitCacheCommand } = await import('./config.command.js');
    await configGitCacheCommand(value);
  });

config
  .command('llm')
  .description('Configure LLM provider (openai, gemini, groq, anthropic, custom)')
  .action(async () => {
    const { configLlmCommand } = await import('./config.command.js');
    await configLlmCommand();
  });

program.parse();
