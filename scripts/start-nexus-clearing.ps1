<#
.SYNOPSIS
    Starts the complete Nexus Clearing stack: the five node Raftline cluster and the
    Nexus Clearing BFF / console.

.DESCRIPTION
    Order matters. The cluster must be healthy before the console is started, because the
    console discovers the leader from live cluster state on its very first request.

.EXAMPLE
    .\scripts\start-nexus-clearing.ps1
#>
param(
    [switch]$SkipCluster,
    [switch]$Dev
)

$ErrorActionPreference = "Stop"
$raftDir = "C:\Sushrut\projects\Raftline"
$clearingDir = "C:\Sushrut\projects\nexus-clearing"

function Write-Step([string]$message) {
    Write-Host "==> $message" -ForegroundColor Cyan
}

if (-not $SkipCluster) {
    Write-Step "Stopping any running Raftline cluster"
    & powershell -ExecutionPolicy Bypass -File (Join-Path $raftDir "scripts\stop-5node-cluster.ps1") | Out-Null
    Start-Sleep -Seconds 2

    Write-Step "Building the Raftline modules"
    # Clear the whole transport module output: deleting only the protobuf plugin's
    # temporary directory leaves protoc regenerating sources that the compiler then
    # treats as unreadable on Windows.
    $transportTarget = Join-Path $raftDir "raftline-transport\target"
    if (Test-Path $transportTarget) {
        Remove-Item -Recurse -Force $transportTarget -ErrorAction SilentlyContinue
    }
    Push-Location $raftDir
    & mvn install -DskipTests
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "Raftline build failed" -ForegroundColor Red; exit 1 }
    Pop-Location

    Write-Step "Starting the five node cluster"
    & powershell -ExecutionPolicy Bypass -File (Join-Path $raftDir "scripts\start-5node-cluster.ps1") | Out-Null
    Start-Sleep -Seconds 6

    Write-Step "Cluster status"
    & powershell -ExecutionPolicy Bypass -File (Join-Path $raftDir "scripts\probe-cluster.ps1")
}

Write-Step "Starting Nexus Clearing"
if (-not (Test-Path (Join-Path $clearingDir "node_modules"))) {
    Push-Location $clearingDir
    & npm install
    Pop-Location
}

$logFile = Join-Path $env:TEMP "nexus-clearing.log"
if ($Dev) {
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "npm run dev > `"$logFile`" 2>&1" `
        -WorkingDirectory $clearingDir
} else {
    Push-Location $clearingDir
    & npm run build
    Pop-Location
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "npm run start > `"$logFile`" 2>&1" `
        -WorkingDirectory $clearingDir
}

Start-Sleep -Seconds 8
Write-Host ""
Write-Host "Nexus Clearing is running at http://localhost:3000" -ForegroundColor Green
Write-Host "Log file: $logFile" -ForegroundColor DarkGray
