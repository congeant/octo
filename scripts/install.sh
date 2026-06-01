#!/usr/bin/env bash
# Octo CLI — Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/vguerato/octo/main/scripts/install.sh | sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { printf "${GREEN}[INFO]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[AVISO]${NC} %s\n" "$1"; }
error() { printf "${RED}[ERRO]${NC} %s\n" "$1"; }

missing=()

# Check Node.js >= 25
check_node() {
  if ! command -v node &>/dev/null; then
    missing+=("node")
    error "Node.js não encontrado"
    echo "  → Instale via: https://nodejs.org/ ou use nvm:"
    echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
    echo "    nvm install 25"
    return
  fi

  local version
  version=$(node --version | sed 's/^v//')
  local major
  major=$(echo "$version" | cut -d. -f1)

  if [ "$major" -lt 25 ]; then
    missing+=("node")
    error "Node.js >= 25 necessário (encontrado: v${version})"
    echo "  → Atualize via nvm: nvm install 25"
  else
    info "Node.js v${version} ✓"
  fi
}

# Check Docker
check_docker() {
  if ! command -v docker &>/dev/null; then
    missing+=("docker")
    error "Docker não encontrado"
    echo "  → Instale via: https://docs.docker.com/get-docker/"
  else
    local version
    version=$(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    info "Docker v${version} ✓"
  fi
}

# Check Git
check_git() {
  if ! command -v git &>/dev/null; then
    missing+=("git")
    error "Git não encontrado"
    echo "  → Instale via: https://git-scm.com/downloads"
  else
    local version
    version=$(git --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    info "Git v${version} ✓"
  fi
}

# Check pnpm
check_pnpm() {
  if ! command -v pnpm &>/dev/null; then
    missing+=("pnpm")
    error "pnpm não encontrado"
    echo "  → Instale via: corepack enable && corepack prepare pnpm@latest --activate"
    echo "    ou: npm install -g pnpm"
  else
    local version
    version=$(pnpm --version)
    info "pnpm v${version} ✓"
  fi
}

main() {
  echo ""
  echo "╔══════════════════════════════════════╗"
  echo "║       Octo CLI — Installer          ║"
  echo "╚══════════════════════════════════════╝"
  echo ""

  info "Verificando pré-requisitos..."
  echo ""

  check_node
  check_docker
  check_git
  check_pnpm

  echo ""

  if [ ${#missing[@]} -gt 0 ]; then
    error "Pré-requisitos faltantes: ${missing[*]}"
    echo ""
    echo "Instale os itens acima e execute novamente."
    exit 1
  fi

  info "Todos os pré-requisitos atendidos."
  info "Instalando @spectre/octo globalmente..."
  echo ""

  pnpm add -g @spectre/octo

  echo ""
  info "Instalação concluída. Verifique com: octo --version"
}

main
