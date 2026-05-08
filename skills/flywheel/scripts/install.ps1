# Flywheel MCP installer (PowerShell, Windows).
#
# Single job: write/merge Flywheel into <vault>/.mcp.json so the Flywheel MCP
# server is registered for the user's client (Claude Code, Codex, etc).
#
# The Flywheel agent skill (SKILL.md) is installed separately via:
#   npx -y skills add velvetmonkey/flywheel-memory -g
# Run that first; this script only handles the MCP wiring step.
#
# Safe to invoke via:
#   iex (irm https://raw.githubusercontent.com/.../install.ps1)  # remote
#   pwsh /path/to/cloned/repo/.../install.ps1                    # in-tree
# Both shapes write the same .mcp.json. No filesystem siblings required, so
# this works under Invoke-Expression where $MyInvocation.MyCommand.Path is null.

param(
  [string]$Vault = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Vault -PathType Container)) {
  Write-Error "vault directory does not exist: $Vault"
  exit 1
}

# Windows requires `cmd /c npx` because npx is a .cmd script that cannot be spawned directly.
$Snippet = [ordered]@{
  command = 'cmd'
  args    = @('/c', 'npx', '-y', '@velvetmonkey/flywheel-memory')
  env     = [ordered]@{ FLYWHEEL_WATCH_POLL = 'true' }
}

$McpFile = Join-Path $Vault '.mcp.json'
if (Test-Path $McpFile) {
  $raw = Get-Content $McpFile -Raw
  try {
    $data = $raw | ConvertFrom-Json -AsHashtable
  } catch {
    Write-Error "existing $McpFile is not valid JSON: $_"
    exit 1
  }
} else {
  $data = @{}
}
if (-not $data.ContainsKey('mcpServers')) { $data['mcpServers'] = @{} }
$data['mcpServers']['flywheel'] = $Snippet
$data | ConvertTo-Json -Depth 10 | Set-Content -Path $McpFile -Encoding UTF8
Write-Host "  written:   $McpFile"

Write-Host ''
Write-Host "Flywheel MCP wired into $McpFile"
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. If you haven''t installed the agent skill: npx -y skills add velvetmonkey/flywheel-memory -g'
Write-Host '  2. Exit your current Claude Code or Codex session if one is running.'
Write-Host '  3. Re-launch the client from this directory: `claude` or `codex`.'
Write-Host '  4. The Flywheel MCP server starts on first tool call (~3-5s warmup).'
Write-Host ''
Write-Host 'Do NOT continue in the same session — MCP servers register at client startup only.'
