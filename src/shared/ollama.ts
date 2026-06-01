import { run } from './process-runner.js';
import { logger } from './logger.js';
import { confirm } from './prompt.js';

/**
 * Checks if Ollama CLI is installed on the system.
 */
async function isInstalled(): Promise<boolean> {
  const result = await run('ollama', ['--version'], { timeout: 5_000 });
  return result.exitCode === 0;
}

/**
 * Checks if the phi4 model is available locally.
 */
async function hasModel(model: string): Promise<boolean> {
  const result = await run('ollama', ['list'], { timeout: 10_000 });
  if (result.exitCode !== 0) return false;
  return result.stdout.includes(model);
}

/**
 * Installs Ollama via the official install script.
 */
async function install(): Promise<boolean> {
  logger.info('Instalando Ollama...');
  const result = await run('curl', ['-fsSL', 'https://ollama.com/install.sh', '|', 'sh'], {
    timeout: 120_000,
    interactive: true,
  });
  return result.exitCode === 0;
}

/**
 * Pulls a model from the Ollama registry.
 */
async function pull(model: string): Promise<boolean> {
  logger.info(`Baixando modelo ${model}...`);
  const result = await run('ollama', ['pull', model], {
    timeout: 300_000,
    interactive: true,
  });
  return result.exitCode === 0;
}

/**
 * Ensures Ollama and the specified model are available.
 * Prompts the user interactively if installation is needed.
 */
export async function ensureOllamaSetup(model = 'phi4'): Promise<void> {
  if (!await isInstalled()) {
    const shouldInstall = await confirm('Ollama não encontrado. Deseja instalar? (s/n) ');
    if (!shouldInstall) {
      logger.info('Ollama não instalado. Funcionalidades de IA indisponíveis.');
      return;
    }
    if (!await install()) {
      logger.info('Falha ao instalar Ollama. Prosseguindo sem IA.');
      return;
    }
  }

  if (!await hasModel(model)) {
    const shouldPull = await confirm(`Modelo ${model} não encontrado. Deseja baixar? (s/n) `);
    if (!shouldPull) {
      logger.info(`${model} não instalado. Funcionalidades de IA indisponíveis.`);
      return;
    }
    if (!await pull(model)) {
      logger.info(`Falha ao baixar ${model}. Prosseguindo sem IA.`);
      return;
    }
  }

  logger.info(`Ollama + ${model} configurados.`);
}
