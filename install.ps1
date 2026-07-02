#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Install history-trimmer plugin for OpenCode
.DESCRIPTION
  Downloads the plugin file to OpenCode's plugins directory.
  Works on Windows (PowerShell 5+) and Linux/macOS with pwsh.
.USAGE
  irm https://raw.githubusercontent.com/aetox-skills/history-trimmer/main/install.ps1 | iex
#>

$pluginDir = if ($env:XDG_CONFIG_HOME) {
  Join-Path $env:XDG_CONFIG_HOME "opencode" "plugins"
} elseif ($env:USERPROFILE) {
  Join-Path $env:USERPROFILE ".config" "opencode" "plugins"
} else {
  Join-Path $env:HOME ".config" "opencode" "plugins"
}

$pluginFile = Join-Path $pluginDir "history-trimmer.ts"
$rawUrl = "https://raw.githubusercontent.com/aetox-skills/history-trimmer/main/history-trimmer.ts"

# Create plugins directory if missing
if (-not (Test-Path $pluginDir)) {
  New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
}

# Download plugin file
Write-Host "⬇️  Downloading history-trimmer..."
try {
  Invoke-WebRequest -Uri $rawUrl -OutFile $pluginFile -ErrorAction Stop
} catch {
  Write-Host "❌ Download failed: $_" -ForegroundColor Red
  exit 1
}

Write-Host "✅ Installed to $pluginFile" -ForegroundColor Green
Write-Host "🔄 Restart OpenCode to activate the plugin." -ForegroundColor Yellow
