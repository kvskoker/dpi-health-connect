param([switch]$CoreOnly)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
$previousPort = $env:EMR_PORT
try {
    if (-not (Test-Path -LiteralPath '.env')) {
        throw 'Create .env from .env.example with a random database password and API token first. See docs/RUNNING.md.'
    }
    ./Initialize-Registry.ps1
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) { throw 'Core startup failed.' }
    if (-not $CoreOnly) {
        $env:EMR_PORT = '18081'
        docker compose -p dpi-h-phu --env-file .env -f infra/openmrs.compose.yaml up -d
        if ($LASTEXITCODE -ne 0) { throw 'PHU startup failed.' }
        $env:EMR_PORT = '18082'
        docker compose -p dpi-h-hospital --env-file .env -f infra/openmrs.compose.yaml up -d
        if ($LASTEXITCODE -ne 0) { throw 'Hospital startup failed.' }
    }
    Write-Host 'Containers started. OpenMRS may still be initializing; run Get-StackStatus.ps1 to check.'
    Write-Host 'API health: http://127.0.0.1:4310/health'
    Write-Host 'PHU: http://127.0.0.1:18081/openmrs/spa'
    Write-Host 'Hospital: http://127.0.0.1:18082/openmrs/spa'
} finally {
    $env:EMR_PORT = $previousPort
    Pop-Location
}
