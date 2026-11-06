# PowerShell 5.1 compatible; never echo the WaveSpeed API key.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$envPath = Join-Path $root ".env.staging"
$template = Join-Path $root ".env.staging.example"
$compose = @("compose", "--project-name", "acm-staging", "--env-file", ".env.staging", "-f", "compose.staging.yaml")

Write-Host ""
Write-Host "AI Content Maker | isolated staging setup" -ForegroundColor Cyan
Write-Host "No Node.js or local GPU required. Docker Desktop must be installed and running."
Write-Host "The paid generation is NOT started by this setup."
if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) {
  throw "Docker CLI not found. Install Docker Desktop with WSL2 and open it, then run 01_START_HERE.cmd again."
}
& docker info --format "{{.ServerVersion}}" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Docker engine is unavailable. Open Docker Desktop and wait until it reports running."
}
if (-not (Test-Path -LiteralPath $envPath)) {
  if (-not (Test-Path -LiteralPath $template)) { throw "Missing .env.staging.example" }
  Write-Host ""
  Write-Host "Paste a NEW / ROTATED WaveSpeed API key; input is hidden." -ForegroundColor Yellow
  Write-Host "Never reuse the key previously pasted into a chat."
  $secure = Read-Host "WaveSpeed API key" -AsSecureString
  $ptr = [IntPtr]::Zero
  try {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if (-not $key -or $key.Length -lt 20 -or $key.Contains(" ") -or -not $key.StartsWith("wsk_")) {
      throw "Invalid WaveSpeed access-key format. No settings were saved."
    }
    $bytes = New-Object 'System.Byte[]' 24
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $password = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    $templateText = [IO.File]::ReadAllText($template)
    $templateText = $templateText.Replace("REPLACE_WITH_GENERATED_PASSWORD", $password)
    $templateText = $templateText.Replace("REPLACE_WITH_ROTATED_WAVESPEED_KEY", $key)
    [IO.File]::WriteAllText($envPath, $templateText, ([System.Text.UTF8Encoding]::new($false)))
  } finally {
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    $key = $null
  }
  # Files are local. Reduce accidental exposure to other accounts where available.
  try {
    $account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $envPath /inheritance:r /grant:r "$($account):(R,W)" | Out-Null
  } catch {
    Write-Warning "Could not restrict .env.staging ACL. Keep this file private."
  }
  Write-Host "Created private .env.staging. Keep this file off GitHub." -ForegroundColor Green
} else {
  Write-Host "Reusing existing .env.staging (not overwriting your private key)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Building and starting the isolated app on http://localhost:3100 ..." -ForegroundColor Cyan
& docker @compose up -d --build
if ($LASTEXITCODE -ne 0) { throw "Docker Compose start failed. Check 03_STATUS.cmd." }

$ready = $false
for ($i = 0; $i -lt 75; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:3100/api/v1/health/ready" -TimeoutSec 3
    if ($health.status -eq "ready") { $ready = $true; break }
  } catch {}
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  & docker @compose ps
  throw "App is not ready on port 3100. Inspect 03_STATUS.cmd; do not launch the paid test."
}
Write-Host "App is READY. Checking provider key, balance, and dynamic price (NO charge) ..." -ForegroundColor Cyan
& docker @compose exec -T worker npm run provider:check
if ($LASTEXITCODE -ne 0) {
  throw "Provider preflight failed. Fix your key, WaveSpeed balance or $0.01 price cap. No paid inference was submitted."
}
Write-Host ""
Write-Host "Setup complete. Open http://localhost:3100" -ForegroundColor Green
Write-Host "Run 02_RUN_ONE_TEST.cmd to create a TEST USER and request ONE paid image."
