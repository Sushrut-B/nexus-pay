# ==============================================================================
# Nexus Clearing — Platform Shutdown Script
# Terminates Next.js and ngrok processes WITHOUT touching Raftline backend nodes
# ==============================================================================

$baseDir = Split-Path -Parent $PSScriptRoot
$pidsFile = Join-Path $baseDir "data\nexus-pids.csv"

Write-Host "Stopping Nexus Clearing frontend and ngrok processes..." -ForegroundColor Cyan

if (Test-Path $pidsFile) {
    $processes = Import-Csv -Path $pidsFile
    foreach ($p in $processes) {
        try {
            Stop-Process -Id $p.PID -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped $($p.Process) (PID $($p.PID))" -ForegroundColor Yellow
        } catch {}
    }
    Remove-Item $pidsFile -Force -ErrorAction SilentlyContinue
}

# Also ensure any lingering node on port 3000 is cleared
$port3000 = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($port3000) {
    foreach ($conn in $port3000) {
        if ($conn.OwningProcess -gt 0) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "Nexus Clearing frontend and tunnel stopped safely." -ForegroundColor Green
Write-Host "(Raftline consensus backend cluster remains active.)" -ForegroundColor Gray

