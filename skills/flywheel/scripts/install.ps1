# Flywheel skill installer (PowerShell, Windows).
# Writes/merges .mcp.json in the current directory and installs SKILL.md
# into <vault>/.claude/skills/flywheel/ for auto-discovery by Claude Code.

param(
  [string]$Vault = (Get-Location).Path,
  [switch]$Codex
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Vault -PathType Container)) {
  Write-Error "vault directory does not exist: $Vault"
  exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillSrc = Join-Path (Split-Path -Parent $ScriptDir) 'SKILL.md'
if (-not (Test-Path $SkillSrc)) {
  Write-Error "SKILL.md not found at $SkillSrc"
  exit 1
}

# Windows requires `cmd /c npx` because npx is a .cmd script that cannot be spawned directly.
$Snippet = [ordered]@{
  command = 'cmd'
  args    = @('/c', 'npx', '-y', '@velvetmonkey/flywheel-memory')
  env     = [ordered]@{ FLYWHEEL_WATCH_POLL = 'true' }
}

# 1. Merge .mcp.json
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

# 2. Install SKILL.md into vault's .claude/skills/flywheel/
$SkillDestDir = Join-Path $Vault '.claude/skills/flywheel'
New-Item -ItemType Directory -Force -Path $SkillDestDir | Out-Null
Copy-Item -Force $SkillSrc (Join-Path $SkillDestDir 'SKILL.md')
Write-Host "  installed: $(Join-Path $SkillDestDir 'SKILL.md')"

# 3. Optional Codex install
if ($Codex) {
  $CodexDir = Join-Path $HOME '.codex/skills/flywheel'
  New-Item -ItemType Directory -Force -Path $CodexDir | Out-Null
  Copy-Item -Force $SkillSrc (Join-Path $CodexDir 'SKILL.md')
  Write-Host "  installed: $(Join-Path $CodexDir 'SKILL.md') (codex)"
}

Write-Host ''
Write-Host 'Flywheel skill installed.'
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. Exit your current Claude Code or Codex session if one is running.'
Write-Host '  2. Re-launch the client from this directory: `claude` or `codex`.'
Write-Host '  3. The Flywheel MCP server starts on first tool call (~3-5s warmup).'
Write-Host ''
Write-Host 'Do NOT continue in the same session — MCP servers register at client startup only.'
