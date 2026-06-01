import { readdir, readFile, access, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join, relative } from 'node:path';
import { logger } from '../shared/logger.js';
import { OctoError } from '../shared/errors.js';
import { printManifest } from '../manifest/manifest-printer.js';
import { run } from '../shared/process-runner.js';
import type { OctoManifest } from '../manifest/manifest-schema.js';

const EXCLUDED_DIRS = new Set(['node_modules', 'dist']);
const MAX_DEPTH = 5;

interface DiscoveredProject {
  name: string;
  relativePath: string;
  hasDockerfile: boolean;
}

function isExcluded(name: string): boolean {
  return EXCLUDED_DIRS.has(name) || name.startsWith('.');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function scanDirectory(
  dir: string,
  rootDir: string,
  depth: number,
  results: DiscoveredProject[],
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  const pkgPath = join(dir, 'package.json');
  if (await exists(pkgPath)) {
    try {
      const content = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      if (pkg.name) {
        const hasDockerfile = await exists(join(dir, 'Dockerfile'));
        results.push({
          name: pkg.name,
          relativePath: './' + relative(rootDir, dir),
          hasDockerfile,
        });
      }
    } catch {
      // Invalid JSON — skip
    }
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || isExcluded(entry.name)) continue;
    await scanDirectory(join(dir, entry.name), rootDir, depth + 1, results);
  }
}

function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 's');
    });
  });
}

async function isOllamaInstalled(): Promise<boolean> {
  const result = await run('ollama', ['--version'], { timeout: 5_000 });
  return result.exitCode === 0;
}

async function hasPhi4Model(): Promise<boolean> {
  const result = await run('ollama', ['list'], { timeout: 10_000 });
  if (result.exitCode !== 0) return false;
  return result.stdout.includes('phi4');
}

async function installOllama(): Promise<boolean> {
  logger.info('Instalando Ollama...');
  const result = await run('curl', ['-fsSL', 'https://ollama.com/install.sh', '|', 'sh'], {
    timeout: 120_000,
    interactive: true,
  });
  return result.exitCode === 0;
}

async function pullPhi4(): Promise<boolean> {
  logger.info('Baixando modelo Phi-4...');
  const result = await run('ollama', ['pull', 'phi4'], {
    timeout: 300_000,
    interactive: true,
  });
  return result.exitCode === 0;
}

async function ensureOllamaSetup(): Promise<void> {
  const ollamaPresent = await isOllamaInstalled();

  if (!ollamaPresent) {
    const install = await confirm('Ollama não encontrado. Deseja instalar? (s/n) ');
    if (!install) {
      logger.info('Ollama não instalado. Funcionalidades de IA estarão indisponíveis.');
      return;
    }
    const ok = await installOllama();
    if (!ok) {
      logger.info('Falha ao instalar Ollama. Prosseguindo sem IA.');
      return;
    }
  }

  const hasModel = await hasPhi4Model();
  if (!hasModel) {
    const pull = await confirm('Modelo Phi-4 não encontrado. Deseja baixar? (s/n) ');
    if (!pull) {
      logger.info('Phi-4 não instalado. Funcionalidades de IA estarão indisponíveis.');
      return;
    }
    const ok = await pullPhi4();
    if (!ok) {
      logger.info('Falha ao baixar Phi-4. Prosseguindo sem IA.');
      return;
    }
  }

  logger.info('Ollama + Phi-4 configurados.');
}

export async function initCommand(opts: { standalone?: boolean }): Promise<void> {
  await ensureOllamaSetup();

  const rootDir = process.cwd();
  const results: DiscoveredProject[] = [];

  if (opts.standalone) {
    // Only scan current directory, no recursion into subdirectories
    const pkgPath = join(rootDir, 'package.json');
    if (await exists(pkgPath)) {
      try {
        const content = await readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(content);
        if (pkg.name) {
          const hasDockerfile = await exists(join(rootDir, 'Dockerfile'));
          results.push({ name: pkg.name, relativePath: '.', hasDockerfile });
        }
      } catch {
        // Invalid JSON
      }
    }
  } else {
    await scanDirectory(rootDir, rootDir, 0, results);
  }

  if (results.length === 0) {
    logger.info('Nenhum pacote com package.json encontrado. Criando octo.yaml vazio.');
  }

  const services = results.filter((p) => p.hasDockerfile).map((p) => p.name);
  const packages = results.filter((p) => !p.hasDockerfile).map((p) => p.name);

  const manifest: OctoManifest = { services };
  if (packages.length > 0) {
    manifest.packages = packages;
  }

  const yaml = printManifest(manifest);

  const outputPath = join(rootDir, 'octo.yaml');
  await writeFile(outputPath, yaml, 'utf-8');

  logger.info(`octo.yaml gerado com ${services.length} serviço(s)${packages.length > 0 ? ` e ${packages.length} pacote(s)` : ''}.`);
}
