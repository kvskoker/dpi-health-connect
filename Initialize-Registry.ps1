$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $folder = Join-Path $PSScriptRoot 'secrets/opencr'
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $configPath = Join-Path $folder 'config.json'
    if (-not (Test-Path -LiteralPath $configPath)) {
        $config = Get-Content 'infra/opencr-config.template.json' -Raw | ConvertFrom-Json
        $bytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        $config.auth.secret = [Convert]::ToHexString($bytes)
        $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $configPath
    }
    $expected = @('server_key.pem','server_cert.pem','client_key.pem','client_cert.pem')
    $existing = @($expected | Where-Object { Test-Path -LiteralPath (Join-Path $folder $_) })
    if ($existing.Count -eq 4) { Write-Host 'Registry configuration and certificates already exist.'; return }
    if ($existing.Count -gt 0) { throw 'Partial registry certificate set found. Preserve and inspect it before generating replacements.' }
    $openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
    if (-not $openssl) { $openssl = 'C:\Program Files\Git\usr\bin\openssl.exe' }
    if (-not (Test-Path -LiteralPath $openssl)) { throw 'OpenSSL is required. Install it or use the copy bundled with Git for Windows.' }
    & $openssl req -x509 -newkey rsa:2048 -nodes -keyout "$folder/server_key.pem" -out "$folder/server_cert.pem" -days 365 -subj '/CN=opencr' -addext 'subjectAltName=DNS:opencr,DNS:localhost,IP:127.0.0.1' -addext 'basicConstraints=critical,CA:TRUE'
    if ($LASTEXITCODE -ne 0) { throw 'Registry certificate generation failed.' }
    & $openssl req -newkey rsa:2048 -nodes -keyout "$folder/client_key.pem" -out "$folder/client.csr" -subj '/CN=dpi-core'
    if ($LASTEXITCODE -ne 0) { throw 'Client certificate request failed.' }
    & $openssl x509 -req -in "$folder/client.csr" -CA "$folder/server_cert.pem" -CAkey "$folder/server_key.pem" -CAcreateserial -out "$folder/client_cert.pem" -days 365
    if ($LASTEXITCODE -ne 0) { throw 'Client certificate signing failed.' }
    Write-Host 'Generated local pilot certificates. Keys stay in ignored secrets/opencr; no existing keys were replaced.'
} finally { Pop-Location }
