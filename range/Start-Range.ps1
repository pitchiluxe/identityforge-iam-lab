#Requires -Version 5.1
# Starts Meridian IAM Range on http://localhost:5180 and opens it in your browser.
# First run installs the two build tools (TypeScript and Vite) into range\node_modules.
# Ollama is optional: if it is running on this computer, the range uses it for
# AI-designed labs, ticket rewording and coaching. Nothing is sent anywhere else.
[CmdletBinding()]
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 22.18 or newer is required. Install the LTS from https://nodejs.org and run this again.' }
$version = [version]((& node --version).TrimStart('v'))
if ($version -lt [version]'22.18.0') { throw "Node.js $version is too old. Install 22.18 or newer from https://nodejs.org." }

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\vite'))) {
    Write-Host 'First run: installing build tools (one time)...' -ForegroundColor Cyan
    # The desktop packaging tools are not needed to run from source; skip Electron's 100 MB download.
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Check your internet connection and try again.' }
}

try {
    $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2
    Write-Host 'Ollama is running: AI-designed labs and the coach are available.' -ForegroundColor Green
} catch {
    Write-Host 'Ollama is not running. Every lab still works; start Ollama for AI-designed labs and coaching.' -ForegroundColor Yellow
}

if (-not $NoBrowser) {
    Start-Job -ScriptBlock { Start-Sleep -Seconds 3; Start-Process 'http://localhost:5180/' } | Out-Null
}
Write-Host 'Meridian IAM Range: http://localhost:5180  (Ctrl+C to stop)' -ForegroundColor Cyan
& node node_modules/vite/bin/vite.js
