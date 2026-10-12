# Demonstrates 5-node Raft failover, leader kill, and data recovery

$baseDir = Split-Path -Parent $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Raftline 5-Node Cluster Chaos & Failover Demonstration" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Start cluster
& "$PSScriptRoot\start-5node-cluster.ps1"
Start-Sleep -Seconds 3

# 2. Find current leader (retry up to 10 seconds)
$ports = @("8001", "8002", "8003", "8004", "8005")
$leaderNodeId = $null
$leaderHttpPort = $null

for ($attempt = 1; $attempt -le 20; $attempt++) {
    foreach ($port in $ports) {
        try {
            $st = Invoke-RestMethod -Uri "http://localhost:$port/v1/cluster/status" -TimeoutSec 1
            if ($st.role -eq "LEADER") {
                $leaderNodeId = $st.nodeId
                $leaderHttpPort = $port
            }
        } catch {}
    }
    if ($leaderNodeId) {
        break
    }
    Start-Sleep -Milliseconds 500
}

if (-not $leaderNodeId) {
    Write-Error "Could not find current leader."
    exit 1
}

Write-Host "`n[STEP 1] Detected Leader: $leaderNodeId on HTTP port $leaderHttpPort" -ForegroundColor Green

# 3. Client writes PUT user:42 "Sushrut"
Write-Host "`n[STEP 2] Client sends: PUT user:42 `"Sushrut`" to leader..." -ForegroundColor Green
$putUrl = "http://localhost:$leaderHttpPort/v1/kv/user:42"
$putResult = Invoke-RestMethod -Method Put -Uri $putUrl -Body "Sushrut" -ContentType "text/plain"
Write-Host "Write Response: $($putResult | ConvertTo-Json -Compress)" -ForegroundColor Yellow

# 4. Verify linearizable read
$readResult = Invoke-RestMethod -Method Get -Uri "http://localhost:$leaderHttpPort/v1/kv/user:42"
Write-Host "Linearizable Read returned: '$readResult'" -ForegroundColor Cyan

# 5. KILL THE LEADER!
Write-Host "`n[STEP 3] KILLING THE LEADER PROCESS ($leaderNodeId)..." -ForegroundColor Red
$pidFile = "$baseDir\data\$leaderNodeId\node.pid"
if (Test-Path $pidFile) {
    $realPid = [int](Get-Content $pidFile).Trim()
    Stop-Process -Id $realPid -Force
    Write-Host "Leader $leaderNodeId (PID $realPid) successfully terminated!" -ForegroundColor Red
} else {
    Write-Error "Could not find node.pid for leader $leaderNodeId"
    exit 1
}

# 6. Wait for new leader election
Write-Host "`n[STEP 4] Waiting for remaining 4 nodes to detect failure and elect new leader..." -ForegroundColor Yellow

$newLeaderId = $null
$newLeaderPort = $null

for ($attempt = 1; $attempt -le 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    foreach ($port in $ports) {
        if ($port -ne $leaderHttpPort) {
            try {
                $st = Invoke-RestMethod -Uri "http://localhost:$port/v1/cluster/status" -TimeoutSec 1
                if ($st.role -eq "LEADER") {
                    $newLeaderId = $st.nodeId
                    $newLeaderPort = $port
                }
            } catch {}
        }
    }
    if ($newLeaderId) {
        break
    }
}

if (-not $newLeaderId) {
    Write-Error "Could not elect new leader after old leader was killed."
    & "$PSScriptRoot\stop-5node-cluster.ps1"
    exit 1
}

Write-Host "New Leader Elected: $newLeaderId (HTTP port $newLeaderPort)!" -ForegroundColor Green

# 7. Read committed data from new leader
Write-Host "`n[STEP 5] Performing Linearizable Read from NEW leader for key 'user:42'..." -ForegroundColor Green
$recoveredData = Invoke-RestMethod -Method Get -Uri "http://localhost:$newLeaderPort/v1/kv/user:42"
Write-Host "New Leader returned: '$recoveredData'" -ForegroundColor Cyan
if ($recoveredData -eq "Sushrut") {
    Write-Host "VERIFICATION SUCCESS: Committed entry survived leader crash!" -ForegroundColor Green
} else {
    Write-Error "Data mismatch: expected 'Sushrut', got '$recoveredData'"
}

# 8. Clean up
Write-Host "`nStopping cluster..."
& "$PSScriptRoot\stop-5node-cluster.ps1"
Write-Host "Demo finished successfully!" -ForegroundColor Green
