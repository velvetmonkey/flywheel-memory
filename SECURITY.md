# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.0.x   | ✓         |
| < 2.0   | ✗         |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report via [GitHub Security Advisories](https://github.com/velvetmonkey/flywheel-memory/security/advisories/new) (private reporting).

### What to expect

- **Acknowledgment** within 48 hours
- **Assessment** within 7 days
- **Fix or mitigation** within 14 days for confirmed issues
- Credit in the advisory (unless you prefer anonymity)

### Scope

This policy covers:
- The MCP server (`@velvetmonkey/flywheel-memory`)
- The shared core library (`@velvetmonkey/vault-core`)
- Write-side mutations, path traversal, injection vectors
- The HTTP transport security model

Out of scope:
- Obsidian plugin (`flywheel-crank`) — report to that repo
- Issues requiring physical access to the machine running [[Flywheel]]
- Social engineering

## Security Architecture

Flywheel runs locally on your machine. The default transport is **stdio** (no network listener).

### Boundaries enforced

- **File access:** Limited to `.md` files within the configured vault root
- **Path traversal:** Prevented via `validatePath()` / `validatePathSecure()` with symlink resolution
- **Sensitive files:** 86 patterns blocked (`.env*`, `*.pem`, `*.key`, credentials, SSH keys, git config)
- **Injection:** YAML, shell, and template injection tested and prevented
- **Unicode normalization:** HFS+ case-insensitive matching tested (macOS vault paths)
- **Content size limits:** Max file size 5MB for FTS5 indexing
- **Protected zones:** Code blocks, frontmatter, existing wikilinks are never modified by auto-linking
- **Git operations:** Scoped to vault directory only
- **`.flywheel/`:** State database — not accessible via mutation tools
- **Multi-vault isolation:** Per-request vault scoping via AsyncLocalStorage prevents cross-vault data leakage

### HTTP transport

When `FLYWHEEL_TRANSPORT=http`, the server listens on `127.0.0.1:3111` by default. **There is no authentication** — any process on localhost can call tools. Do not expose to network without your own auth layer.

### Network access

Core indexing, search, and graph run with **zero network access**. The only outbound calls are:
- `@huggingface/transformers` model download (one-time, on `init_semantic`)
- `simple-git` operations (local only, no remote push)

No telemetry, no analytics, no phone-home. Enforced by `test/write/security/sovereignty.test.ts` — CI scans all source files for unaudited network calls.

### Audit trail

Every tool call is recorded to `tool_invocations` in `.flywheel/state.db`. Every write is a git commit. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#audit-trail) for the full audit model and inspection commands.

## Testing

Security is tested in CI with 7 dedicated test suites covering injection, path encoding, permission bypass, boundaries, platform behavior, sensitive file detection, and sovereignty enforcement. See [docs/TESTING.md](docs/TESTING.md) for methodology.
