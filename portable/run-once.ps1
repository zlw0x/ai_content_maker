$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$envPath = Join-Path $root ".env.staging"
$compose = @("compose", "--project-name", "acm-staging", "--env-file", ".env.staging", "-f", "compose.staging.yaml")
Write-Host ""
Write-Host "ONE-SHOT REAL WAVE SPEED INFERENCE" -ForegroundColor Cyan
Write-Host "This creates a new local staging user, credits its synthetic RUB wallet,"
Write-Host "charges the shared WaveSpeed account ONCE (model: z-image/turbo),"
Write-Host "and attempts to download the result into the private library."
Write-Host "Max provider quote: USD 0.01. Actual provider billing must be checked afterward."
Write-Host ""
if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Missing .env.staging. Run 01_START_HERE.cmd first."
}
if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) { throw "Docker CLI missing" }
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:3100/api/v1/health/ready" -TimeoutSec 4
  if ($health.status -ne "ready") { throw "not ready" }
} catch {
  throw "Staging is not running. Run 01_START_HERE.cmd first."
}
Write-Host "Check that the previous chat-exposed key was revoked and replaced." -ForegroundColor Yellow
$approval = Read-Host "Type GENERATE to authorize exactly ONE paid inference"
if ($approval -cne "GENERATE") {
  Write-Host "Cancelled, no paid job was created."
  exit 0
}
& docker @compose exec -T worker npm run staging:one-shot -- --allow-one-paid-inference
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "TEST STOPPED. If submission may have reached WaveSpeed, DO NOT RETRY." -ForegroundColor Red
  Write-Host "Check 03_STATUS.cmd and your WaveSpeed History first."
  exit 1
}
Write-Host ""
Write-Host "Success. Credentials are in the console output above." -ForegroundColor Green
Write-Host "Open http://localhost:3100/account and sign in to view http://localhost:3100/library"
