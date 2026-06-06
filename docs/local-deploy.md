# Local deploys (npm publish retired)

As of 2026-06-06 flywheel-memory is **not published to npm** beyond the frozen
`2.12.13`. It runs from versioned on-disk deploys instead — no registry in the
loop for our own packages.

## Running from a clone

The build is not self-contained (`esbuild --packages=external`; better-sqlite3
is a native module), so a deploy is a checkout with its dependencies installed:

```bash
git clone https://github.com/velvetmonkey/flywheel-memory
cd flywheel-memory
npm ci          # @velvetmonkey/vault-core resolves to the workspace copy
npm run build
```

Point any MCP config at the result:

```json
"flywheel": {
  "command": "node",
  "args": ["/path/to/flywheel-memory/packages/mcp-server/dist/index.js"],
  "env": { "VAULT_PATH": "/path/to/your/vault" }
}
```

HTTP mode: set `FLYWHEEL_TRANSPORT=http` + `FLYWHEEL_HTTP_PORT` (see the
systemd unit shape in this repo's history / your `~/.config/systemd/user/`).

## Versioned deploys — `scripts/deploy-local.sh`

```bash
scripts/deploy-local.sh [flywheel-memory-vX.Y.Z] [--prune]
```

- Clones the repo **at the release tag** into `~/flywheel/releases/<tag>`
- `npm ci` (verifies vault-core is workspace-linked) + `npm run build`
- Smoke-tests the build (HTTP boot against a throwaway vault)
- Atomically flips `~/flywheel/releases/current` → the new release
- Restarts the `flywheel-memory` systemd user unit and health-checks `:3111`
- `--prune` keeps the newest 3 release dirs

All consumers point at the stable path
`~/flywheel/releases/current/packages/mcp-server/dist/index.js`
(`bin/flywheel-memory.js` for `FLYWHEEL_MEMORY_BIN` consumers like
flywheel-ideas), so a deploy or rollback never touches config:

```bash
# rollback
ln -sfn ~/flywheel/releases/<previous-tag> ~/flywheel/releases/current
systemctl --user restart flywheel-memory
```

## Release flow

`/release flywheel-memory` (Claude Code command): bump → commit → push → tag
`flywheel-memory-vX.Y.Z` → GitHub release → `scripts/deploy-local.sh <tag>`.
No npm publish; vault-core needs no separate release (workspace resolution).
