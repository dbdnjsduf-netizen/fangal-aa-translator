$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot '.fangal-logs'
$standardLog = Join-Path $logDirectory 'server.log'
$errorLog = Join-Path $logDirectory 'server-error.log'
$appPort = 3000

if ($env:PORT -match '^\d+$' -and [int]$env:PORT -ge 1 -and [int]$env:PORT -le 65535) {
    $appPort = [int]$env:PORT
} else {
    $envPath = Join-Path $projectRoot '.env'
    if (Test-Path $envPath) {
        $portLine = Get-Content $envPath | Where-Object { $_ -match '^\s*PORT\s*=\s*["'']?(\d+)["'']?\s*$' } | Select-Object -Last 1
        if ($portLine -match '^\s*PORT\s*=\s*["'']?(\d+)["'']?\s*$') {
            $candidatePort = [int]$Matches[1]
            if ($candidatePort -ge 1 -and $candidatePort -le 65535) { $appPort = $candidatePort }
        }
    }
}

$appUrl = "http://127.0.0.1:$appPort"

try {
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
    $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
    $serverProcess = Start-Process `
        -FilePath $npmCommand `
        -ArgumentList @('run', 'dev') `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $standardLog `
        -RedirectStandardError $errorLog `
        -PassThru

    $ready = $false
    for ($attempt = 0; $attempt -lt 80; $attempt += 1) {
        try {
            $response = Invoke-WebRequest -Uri "$appUrl/api/config" -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {
            if ($serverProcess.HasExited) {
                break
            }
        }
        Start-Sleep -Milliseconds 250
    }

    if (-not $ready) {
        $details = if (Test-Path $errorLog) { (Get-Content -Raw $errorLog).Trim() } else { '' }
        if ($details.Length -gt 1200) { $details = $details.Substring($details.Length - 1200) }
        throw "서버가 20초 안에 시작되지 않았습니다.`n`n$details`n`n로그: $errorLog"
    }

    Start-Process $appUrl
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        $_.Exception.Message,
        'Fangal AA Translator 실행 오류',
        [System.Windows.MessageBoxButton]::OK,
        [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
    exit 1
}
