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

### HTTP reverse proxy recipes

If you need to expose the HTTP transport beyond localhost (e.g., for remote agents or multi-machine setups), always put a reverse proxy in front. **Never change `FLYWHEEL_HTTP_HOST` from `127.0.0.1`.**

<details>
<summary><strong>nginx</strong></summary>

```nginx
# /etc/nginx/sites-available/flywheel
limit_req_zone $binary_remote_addr zone=flywheel:10m rate=30r/m;

server {
    listen 443 ssl;
    server_name flywheel.example.com;

    ssl_certificate     /etc/ssl/certs/flywheel.pem;
    ssl_certificate_key /etc/ssl/private/flywheel.key;

    location /mcp {
        limit_req zone=flywheel burst=10 nodelay;

        proxy_pass http://127.0.0.1:3111;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable buffering for streaming MCP responses
        proxy_buffering off;

        # Add your auth layer here (e.g., auth_basic, auth_request, or mTLS)
    }

    location /health {
        proxy_pass http://127.0.0.1:3111;
    }
}
```

</details>

<details>
<summary><strong>Caddy</strong></summary>

```caddyfile
flywheel.example.com {
    # Caddy handles TLS automatically

    @mcp path /mcp
    handle @mcp {
        reverse_proxy localhost:3111 {
            flush_interval -1  # Stream responses immediately
        }
        # Add your auth layer here (e.g., basicauth, forward_auth)
    }

    handle /health {
        reverse_proxy localhost:3111
    }
}
```

</details>

### Network access

Core indexing, search, and graph run with **zero network access**. The only outbound calls are:
- `@huggingface/transformers` model download (one-time, on `init_semantic`)
- `simple-git` operations (local only, no remote push)

No telemetry, no analytics, no phone-home. Enforced by `test/write/security/sovereignty.test.ts` — CI scans all source files for unaudited network calls.

### Audit trail

Every tool call is recorded to `tool_invocations` in `.flywheel/state.db`. Every write is a git commit. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#audit-trail) for the full audit model and inspection commands.

## Testing

Security is tested in CI with 7 dedicated test suites covering injection, path encoding, permission bypass, boundaries, platform behavior, sensitive file detection, and sovereignty enforcement. See [docs/TESTING.md](docs/TESTING.md) for methodology.
