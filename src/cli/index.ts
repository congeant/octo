#!/usr/bin/env node
import { Command } from 'commander';
import { triggerShutdown } from '../shared/shutdown.js';

// Graceful shutdown on SIGINT (Ctrl+C) and SIGTERM
process.on('SIGINT', () => triggerShutdown('SIGINT'));
process.on('SIGTERM', () => triggerShutdown('SIGTERM'));

const program = new Command();

program
  .name('octo')
  .description('CLI de orquestração de builds, versionamento e infraestrutura para o monorepo Spectre')
  .version('0.1.0');

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
  .description('Incrementa versão de um pacote')
  .argument('[type]', 'Tipo de bump: patch | minor | major', 'patch')
  .option('--install', 'Executa pnpm install nos projetos atualizados')
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

program.parse();
