$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
$compose = @("compose", "--project-name", "acm-staging", "--env-file", ".env.staging", "-f", "compose.staging.yaml")
if (-not (Test-Path ".env.staging")) { Write-Host "Staging not configured."; exit 0 }
& docker @compose down
if ($LASTEXITCODE -ne 0) { throw "Stop failed" }
Write-Host "Stopped. Database and media volumes were PRESERVED." -ForegroundColor Green
Write-Host "Never use docker compose down -v unless you intend to DELETE all staging users and files."
