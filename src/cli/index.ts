#!/usr/bin/env node
import { Command } from 'commander';
import { triggerShutdown } from '../shared/shutdown.js';

// Graceful shutdown on SIGINT (Ctrl+C) and SIGTERM
process.on('SIGINT', () => triggerShutdown('SIGINT'));
process.on('SIGTERM', () => triggerShutdown('SIGTERM'));

const program = new Command();

program
  .name('octo')
  .description('Monorepo build orchestration, versioning, and infrastructure CLI')
  .version('0.4.1');

program
  .command('init')
  .description('Escaneia o monorepo e gera octo.yaml')
  .option('--standalone', 'Gera manifesto apenas para o projeto corrente')
  .action(async (opts) => {
    const { initCommand } = await import('./init.command.js');
    await initCommand(opts);
  });

program
  .command('graph')
  .description('Exibe o grafo de dependências')
  .action(async () => {
    const { graphCommand } = await import('./graph.command.js');
    await graphCommand();
  });

program
  .command('build [service]')
  .description('Builda serviços do monorepo')
  .option('--affected', 'Builda apenas serviços afetados')
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
  .description('Sobe infraestrutura local')
  .action(async (service) => {
    const { upCommand } = await import('./up.command.js');
    await upCommand(service);
  });

program
  .command('down')
  .description('Para infraestrutura local')
  .option('--volumes', 'Remove volumes também')
  .action(async (opts) => {
    const { downCommand } = await import('./down.command.js');
    await downCommand(opts);
  });

program
  .command('status')
  .description('Exibe status dos containers')
  .action(async () => {
    const { statusCommand } = await import('./status.command.js');
    await statusCommand();
  });

program
  .command('add <repo-url>')
  .description('Clona um repositório e registra no octo.yaml')
  .option('--name <name>', 'Nome customizado para o diretório clonado')
  .action(async (repoUrl, opts) => {
    const { addCommand } = await import('./add.command.js');
    await addCommand(repoUrl, opts);
  });

program.parse();
