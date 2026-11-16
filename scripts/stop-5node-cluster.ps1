$baseDir = Split-Path -Parent $PSScriptRoot
$nodes = @("node-1", "node-2", "node-3", "node-4", "node-5")
foreach ($id in $nodes) {
    $pidFile = "$baseDir\data\$id\node.pid"
    if (Test-Path $pidFile) {
        $realPid = [int](Get-Content $pidFile).Trim()
        Write-Host "Stopping $id (PID $realPid) ..." -ForegroundColor Yellow
        Stop-Process -Id $realPid -Force -ErrorAction SilentlyContinue
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
}

if (Test-Path "$baseDir\data\cluster-pids.csv") {
    try {
        $csv = Import-Csv -Path "$baseDir\data\cluster-pids.csv" -ErrorAction SilentlyContinue
        foreach ($row in $csv) {
            if ($row.Pid) {
                Stop-Process -Id ([int]$row.Pid) -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {}
    Remove-Item "$baseDir\data\cluster-pids.csv" -Force -ErrorAction SilentlyContinue
}

# Catch any surviving Raftline JVM. A duplicated launch can leave nodes running that are
# no longer listed in the PID file; those orphans still hold the write ahead log of their
# data directory, so they must be terminated as well.
$orphans = Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*raftline-api-1.0.0-SNAPSHOT.jar*" }
foreach ($orphan in $orphans) {
    $nodeId = if ($orphan.CommandLine -match '--id=(\S+)') { $matches[1] } else { "unknown" }
    Write-Host "Stopping orphaned Raftline process $nodeId (PID $($orphan.ProcessId)) ..." -ForegroundColor Yellow
    Stop-Process -Id $orphan.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 800
$remaining = Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*raftline-api-1.0.0-SNAPSHOT.jar*" }
if ($remaining) {
    Write-Host "WARNING: $($remaining.Count) Raftline process(es) are still running." -ForegroundColor Red
} else {
    Write-Host "All Raftline cluster processes stopped." -ForegroundColor Green
}
