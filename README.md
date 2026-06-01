<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D25-brightgreen" alt="Node.js >= 25" />
  <img src="https://img.shields.io/badge/typescript-5.8-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/pnpm-11-orange" alt="pnpm" />
</p>

<h1 align="center">🐙 Octo CLI</h1>

<p align="center">
  <strong>Build orchestration, semantic versioning, and local infrastructure management for the Spectre monorepo.</strong>
</p>

<p align="center">
  <code>octo build</code> · <code>octo bump</code> · <code>octo up</code> · <code>octo down</code> · <code>octo status</code>
</p>

---

## Why Octo?

Managing a monorepo with 8+ microservices and shared packages means dealing with:

- **Manual build ordering** — services depend on shared packages that must be built first
- **Version drift** — bumping a shared SDK requires updating every consumer by hand
- **Infrastructure sprawl** — each service has its own `docker-compose.yml` with overlapping containers

Octo solves all three with a single CLI that understands your dependency graph.

---

## Quick Start

```bash
# Install globally
pnpm add -g @spectre/octo

# Or via install script
curl -fsSL https://spectre.dev/octo/install.sh | sh

# Initialize in your monorepo
octo init

# Build everything in dependency order
octo build

# Bump a shared package and propagate
octo bump @spectre/events minor --install

# Spin up all infrastructure
octo up
```

---

## Requirements

| Tool | Version |
|------|---------|
| Node.js | >= 25 |
| Docker | Latest |
| Git | >= 2.x |
| pnpm | >= 11 |

---

## Commands

### `octo init`

Scans the monorepo, discovers services (directories with `Dockerfile`) and packages, and generates `octo.yaml`.

```bash
octo init                # Recursive scan, generates root manifest
octo init --standalone   # Current directory only
```

---

### `octo graph`

Displays the dependency graph as an indented adjacency list.

```bash
$ octo graph

auth
  @spectre/events
  @spectre/typescript-config
workspace
  @spectre/events
agentic
  @spectre/events
@spectre/events
@spectre/typescript-config
```

---

### `octo build`

Orchestrates Docker builds respecting topological order with maximum parallelism.

```bash
octo build                # Build all services
octo build auth           # Build auth + modified dependencies
octo build --affected     # Build only changed services since last build
```

**Features:**
- Parallel execution limited by available CPUs
- Failure propagation — if a dependency fails, dependents are cancelled
- Independent services continue building
- Real-time progress reporting (updated every 1s)
- Affected detection via file mtime comparison

---

### `octo bump`

Increments a package version following [Semantic Versioning 2.0.0](https://semver.org/).

```bash
octo bump @spectre/events           # patch (default)
octo bump @spectre/events minor     # minor
octo bump @spectre/events major     # major
octo bump @spectre/events --install # also runs pnpm install in consumers
```

**Pipeline:**

```
pre-bump hooks → version increment → build verification → changelog → git commit → propagation
```

**Safety guarantees:**
- Uncommitted changes trigger interactive confirmation
- Build failure triggers automatic rollback (byte-for-byte)
- Incompatible version ranges are skipped with conflict report

---

### `octo up`

Merges all `docker-compose.yml` files and starts infrastructure containers.

```bash
octo up          # All infrastructure
octo up auth     # Only auth's dependencies
```

**Features:**
- Smart merge via local LLM (Phi-4/Ollama) for deduplication
- Deterministic fallback when LLM is unavailable
- Healthcheck polling (60s timeout per container)
- Automatic log tail on healthcheck failure

---

### `octo down`

Stops and removes infrastructure containers.

```bash
octo down              # Stop containers, preserve volumes
octo down --volumes    # Also remove persistent volumes
```

---

### `octo status`

Displays container state in tabular format.

```bash
$ octo status

NOME                           IMAGEM                              ESTADO       PORTA
spectre-postgres               postgres:16                         running      5432:5432
spectre-redis                  redis:7-alpine                      running      6379:6379
spectre-nats                   nats:2.10                           running      4222:4222
```

---

## Configuration

### `octo.yaml`

```yaml
# Pre-validation hooks (run before build/bump)
hooks:
  pre-build:
    - name: lint
      command: pnpm run lint
    - name: type-check
      command: pnpm run type-check
  pre-bump:
    - name: lint
      command: pnpm run lint

# Services — directories with Dockerfile
services:
  - auth
  - workspace
  - agentic
  - gateway

# Shared packages — libraries consumed by services
packages:
  - "@spectre/events"
  - "@spectre/typescript-config"
```

### Path Resolution

By default, Octo resolves paths automatically by searching for a directory whose `package.json` `name` field matches the entry. To override:

```yaml
services:
  - auth:
      path: ./custom/auth-service
```

### Dependency Detection

Dependencies are resolved automatically from `package.json` fields (`dependencies` + `devDependencies`). Only internal packages (those declared in the manifest) create graph edges. External npm packages are ignored.

---

## Operating Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Standalone** | Single `octo.yaml` in CWD | Operates on local manifest only |
| **Aggregated** | Multiple `octo.yaml` in subdirectories | Discovers all manifests, builds unified dependency graph with cross-project resolution |

In aggregated mode, if a root `octo.yaml` exists alongside sub-manifests, the root takes priority.

---

## Architecture

```
packages/octo/
├── src/
│   ├── cli/              # Command definitions (Commander.js)
│   │   ├── index.ts      # Entry point + signal handlers
│   │   ├── init.command.ts
│   │   ├── graph.command.ts
│   │   ├── build.command.ts
│   │   ├── bump.command.ts
│   │   ├── up.command.ts
│   │   ├── down.command.ts
│   │   └── status.command.ts
│   ├── manifest/         # YAML parsing, validation, discovery
│   ├── graph/            # DAG, topological sort, cross-project resolution
│   ├── build/            # Port-Adapter build engine, scheduler, affected detector
│   ├── hooks/            # Pre-build/pre-bump hook runner
│   ├── version/          # Semver bumper, propagator, changelog generator
│   ├── infra/            # Compose aggregator, LLM smart merger, infra manager
│   └── shared/           # Logger, process runner, errors, graceful shutdown
├── test/
│   ├── unit/             # Vitest unit tests
│   └── property/         # fast-check property-based tests
├── scripts/
│   └── install.sh        # Global installer script
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Standalone CLI (not NestJS) | Dev tool, not a microservice. No DI overhead needed |
| Commander.js | Mature, typed, subcommand support, auto-complete |
| `yaml` (npm) | AST-based — preserves comments and key order |
| Zod validation | Consistent with Spectre stack, descriptive error paths |
| Port-Adapter for build engines | Decouples orchestration from concrete build mechanism |
| Docker via CLI (not dockerode) | Shell execution, no library dependency |
| In-memory adjacency list | Sufficient for monorepos up to ~100 packages |
| Phi-4 via Ollama | Local LLM for intelligent compose deduplication |

---

## Development

```bash
# Install dependencies
pnpm install

# Type-check
pnpm run type-check

# Run tests
pnpm run test

# Run in dev mode
pnpm run dev -- <command> [args]

# Examples
pnpm run dev -- init
pnpm run dev -- graph
pnpm run dev -- build --affected
```

---

## Testing

Dual testing strategy:

- **Unit tests** (Vitest) — specific examples, edge cases, integration between components
- **Property-based tests** (fast-check) — universal properties verified with 100+ iterations

```bash
pnpm run test          # Run all tests once
pnpm run test:watch    # Watch mode
```

### Correctness Properties

The codebase validates 22 formal correctness properties covering:

- Topological sort correctness and cycle detection
- Build parallelism and failure propagation
- Semver increment correctness and rollback guarantees
- Transitive version propagation and compatibility filtering
- Manifest parse-print-parse round-trip
- Mode detection and cross-project dependency resolution
- Hook execution order
- Compose merge completeness and port conflict detection

---

## Graceful Shutdown

Octo handles `SIGINT` (Ctrl+C) and `SIGTERM` gracefully:

1. Cancels builds in progress
2. Reports partial state (completed / in-progress / pending)
3. Exits with code 130

---

## Error Handling

All errors follow a consistent format:

```
[ERRO] <category>: <descriptive message>
  → <additional context (path, line, column)>
  → <suggested fix when applicable>
```

| Category | Behavior | Exit Code |
|----------|----------|-----------|
| Configuration error | Reports all problems at once | 1 |
| Dependency cycle | Reports cycle path `A -> B -> ... -> A` | 1 |
| Hook failure | Aborts operation, shows hook output | 1 |
| Build failure | Cancels dependents, continues independents | 1 |
| Version rollback | Automatic on build failure post-bump | 1 |
| Infrastructure timeout | Shows last 20 log lines | 1 |
| Unknown YAML keys | Warning on stderr, continues | 0 |

---

## License

MIT © Spectre Platform
