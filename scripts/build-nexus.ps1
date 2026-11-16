<#
.SYNOPSIS
    Rebuilds the Raftline cluster and restarts the five node Raft cluster.

.DESCRIPTION
    The protobuf-maven-plugin cannot always delete its temporary proto dependency
    directory on Windows, which breaks `mvn clean`. This script works around that by
    removing the temporary directory up front and building without the clean goal.

.PARAMETER SkipTests
    Skip the test phase (default: run tests).

.PARAMETER NoRestart
    Build only, do not restart the cluster.
#>
param(
    [switch]$SkipTests,
    [switch]$NoRestart
)

$ErrorActionPreference = "Stop"
$baseDir = Split-Path -Parent $PSScriptRoot
Set-Location $baseDir

function Write-Step([string]$message) {
    Write-Host "==> $message" -ForegroundColor Cyan
}

Write-Step "Stopping running Raftline cluster"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stop-5node-cluster.ps1") | Out-Null
Start-Sleep -Seconds 2

Write-Step "Clearing the transport module build output"
# The protobuf plugin cannot always delete its temporary proto dependency directory on
# Windows. Removing only that directory leaves the module in a state where protoc
# regenerates sources that the compiler then treats as unreadable, so the whole module
# target is cleared instead.
$transportTarget = Join-Path $baseDir "raftline-transport\target"
if (Test-Path $transportTarget) {
    Remove-Item -Recurse -Force $transportTarget -ErrorAction SilentlyContinue
}

$goal = if ($SkipTests) { "install" } else { "install" }
$skipFlag = if ($SkipTests) { "-DskipTests" } else { "" }

Write-Step "Building and installing modules"
& mvn install $skipFlag
if ($LASTEXITCODE -ne 0) {
    Write-Host "BUILD FAILED" -ForegroundColor Red
    exit $LASTEXITCODE
}

if (-not $NoRestart) {
    Write-Step "Starting five node cluster"
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start-5node-cluster.ps1") | Out-Null
    Start-Sleep -Seconds 5
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "probe-cluster.ps1")
}

Write-Host "Done." -ForegroundColor Green
