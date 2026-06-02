<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D25-brightgreen" alt="Node.js >= 25" />
  <img src="https://img.shields.io/badge/typescript-5.8-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/pnpm-11-orange" alt="pnpm" />
</p>

<h1 align="center">🐙 Octo</h1>

<p align="center">
  <strong>Build orchestration, semantic versioning, and local infrastructure management for repository workspaces.</strong>
</p>

<p align="center">
  <code>octo build</code> · <code>octo bump</code> · <code>octo up</code> · <code>octo down</code> · <code>octo status</code>
</p>

---

## Why Octo?

Managing a workspace with multiple repositories, microservices and shared packages means dealing with:

- **Manual build ordering** — services depend on shared packages that must be built first
- **Version drift** — bumping a shared SDK requires updating every consumer by hand
- **Infrastructure sprawl** — each service has its own `docker-compose.yml` with overlapping containers

Octo solves all three with a single CLI that understands your dependency graph.

---

## Quick Start

```bash
# Install globally
npm install -g octo-dev

# Initialize in your workspace
octo init

# Build everything in dependency order
octo build

# Bump a shared package and propagate
octo bump @myorg/shared-lib minor --install

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

Scans the workspace, discovers services (directories with `Dockerfile`) and packages, and generates `octo.yaml`.

```bash
octo init                # Recursive scan, generates root manifest
octo init --standalone   # Current directory only
```

---

### `octo graph`

Displays the dependency graph as an indented adjacency list.

```bash
$ octo graph

api-gateway
  @myorg/shared-lib
  @myorg/config
user-service
  @myorg/shared-lib
@myorg/shared-lib
@myorg/config
```

---

### `octo build`

Orchestrates Docker builds respecting topological order with maximum parallelism.

```bash
octo build                # Build all services
octo build api-gateway    # Build api-gateway + modified dependencies
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
octo bump @myorg/shared-lib           # patch (default)
octo bump @myorg/shared-lib minor     # minor
octo bump @myorg/shared-lib major     # major
octo bump @myorg/shared-lib --install # also runs pnpm install in consumers
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
octo up              # All infrastructure
octo up user-service # Only user-service's dependencies
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

NAME                           IMAGE                               STATE        PORT
my-postgres                    postgres:16                         running      5432:5432
my-redis                       redis:7-alpine                      running      6379:6379
my-nats                        nats:2.10                           running      4222:4222
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
  - api-gateway
  - user-service
  - billing-service

# Shared packages — libraries consumed by services
packages:
  - "@myorg/shared-lib"
  - "@myorg/config"
```

### Path Resolution

By default, Octo resolves paths automatically by searching for a directory whose `package.json` `name` field matches the entry. To override:

```yaml
services:
  - api-gateway:
      path: ./custom/gateway-dir
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

MIT
