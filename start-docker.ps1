$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Docker nie jest zainstalowany." -ForegroundColor Red
    Write-Host "Zainstaluj Docker Desktop: https://www.docker.com/products/docker-desktop/"
    Read-Host "Nacisnij Enter, aby zamknac"
    exit 1
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Uruchom Docker Desktop i zaczekaj, az silnik Docker bedzie gotowy." -ForegroundColor Yellow
    Read-Host "Nacisnij Enter, aby zamknac"
    exit 1
}

if (-not (Test-Path ".env.docker")) {
    $bytes = New-Object byte[] 64
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $generator.GetBytes($bytes)
    $generator.Dispose()
    $secret = [Convert]::ToBase64String($bytes)
    $environment = @"
JWT_SECRET=$secret
OPENAI_API_KEY=
"@
    [System.IO.File]::WriteAllText(
        (Join-Path $PSScriptRoot ".env.docker"),
        $environment,
        (New-Object System.Text.UTF8Encoding($false))
    )
}

New-Item -ItemType Directory -Force -Path "runtime\data", "runtime\uploads", "runtime\exports" | Out-Null

Write-Host "Buduje i uruchamiam AI Video Clipper..." -ForegroundColor Cyan
docker compose up --build -d
if ($LASTEXITCODE -ne 0) {
    Read-Host "Uruchomienie nie powiodlo sie. Nacisnij Enter, aby zamknac"
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Aplikacja jest dostepna pod adresem:" -ForegroundColor Green
Write-Host "http://localhost:5173"
Start-Process "http://localhost:5173"
