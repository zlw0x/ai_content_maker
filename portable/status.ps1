$ErrorActionPreference = "Continue"
Set-Location (Split-Path -Parent $PSScriptRoot)
$compose = @("compose", "--project-name", "acm-staging", "--env-file", ".env.staging", "-f", "compose.staging.yaml")
if (-not (Test-Path ".env.staging")) { Write-Host "No staging environment found."; exit 1 }
Write-Host "Docker Compose services:" -ForegroundColor Cyan
& docker @compose ps
Write-Host ""
Write-Host "Recent worker logs (no API secret values expected):" -ForegroundColor Cyan
& docker @compose logs --tail=65 worker
Write-Host ""
Write-Host "App: http://localhost:3100"
