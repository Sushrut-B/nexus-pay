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
    Remove-Item "$baseDir\data\cluster-pids.csv" -Force -ErrorAction SilentlyContinue
}
Write-Host "All Raftline cluster processes stopped." -ForegroundColor Green
