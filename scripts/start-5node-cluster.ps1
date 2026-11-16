param(
    [switch]$KeepAlive
)

# Starts 5 independent Raftline processes locally with isolated data directories and ports

$baseDir = Split-Path -Parent $PSScriptRoot
$jarPath = "$baseDir\raftline-api\target\raftline-api-1.0.0-SNAPSHOT.jar"

if (-not (Test-Path $jarPath)) {
    Write-Error "JAR not found at $jarPath. Run 'mvn package -DskipTests' first."
    exit 1
}

$nodes = @(
    @{ Id = "node-1"; Http = 8001; Grpc = 9001 },
    @{ Id = "node-2"; Http = 8002; Grpc = 9002 },
    @{ Id = "node-3"; Http = 8003; Grpc = 9003 },
    @{ Id = "node-4"; Http = 8004; Grpc = 9004 },
    @{ Id = "node-5"; Http = 8005; Grpc = 9005 }
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Starting 5-Node Raftline Distributed Cluster on Localhost" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Refuse to start on top of a running cluster. Two Raftline nodes writing the same write
# ahead log would corrupt the replicated state, and a duplicate launch leaves orphans
# behind that hold the data directory without owning the port.
$alreadyRunning = Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*raftline-api-1.0.0-SNAPSHOT.jar*" }
if ($alreadyRunning) {
    Write-Host "A Raftline cluster is already running ($($alreadyRunning.Count) process(es))." -ForegroundColor Red
    Write-Host "Stop it first with: .\scripts\stop-5node-cluster.ps1" -ForegroundColor Red
    exit 1
}

# Refuse to start when the ports are taken by something else.
$busyPorts = @()
foreach ($node in $nodes) {
    foreach ($port in @($node.Http, $node.Grpc)) {
        if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
            $busyPorts += $port
        }
    }
}
if ($busyPorts.Count -gt 0) {
    Write-Host "The following ports are already in use: $($busyPorts -join ', ')" -ForegroundColor Red
    Write-Host "Free them before starting the cluster." -ForegroundColor Red
    exit 1
}

$processList = @()

foreach ($node in $nodes) {
    $id = $node.Id
    $httpPort = $node.Http
    $grpcPort = $node.Grpc
    $dataDir = "$baseDir\data\$id"

    if (-not (Test-Path $dataDir)) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    }

    # Build peers list
    $peerList = @()
    foreach ($other in $nodes) {
        if ($other.Id -ne $id) {
            $peerList += "$($other.Id)=127.0.0.1:$($other.Grpc):$($other.Http)"
        }
    }
    $peersArg = $peerList -join ","

    $redisPort = $httpPort - 8001 + 6379
    $cmdArgs = "-jar `"$jarPath`" --id=$id --http-port=$httpPort --grpc-port=$grpcPort --redis-port=$redisPort --data-dir=`"$dataDir`" --peers=$peersArg"

    Write-Host "Launching $id [HTTP: $httpPort, gRPC: $grpcPort, Redis: $redisPort] ..." -ForegroundColor Green
    $proc = Start-Process -FilePath "java" -ArgumentList $cmdArgs `
        -RedirectStandardOutput "$dataDir\stdout.log" `
        -RedirectStandardError "$dataDir\stderr.log" `
        -PassThru -WindowStyle Hidden

    $processList += [PSCustomObject]@{
        Id = $id
        Pid = $proc.Id
        HttpPort = $httpPort
        GrpcPort = $grpcPort
    }
}

$processList | Export-Csv -Path "$baseDir\data\cluster-pids.csv" -NoTypeInformation
Write-Host "All 5 nodes launched! PIDs saved to data\cluster-pids.csv" -ForegroundColor Yellow
Write-Host "Waiting for the cluster to become healthy..."

# Verify that every node actually answers before reporting success. A node that failed to
# bind its port would otherwise only be discovered later, as a missing node in the topology.
$deadline = (Get-Date).AddSeconds(30)
$ready = @{}
while ((Get-Date) -lt $deadline -and $ready.Count -lt $nodes.Count) {
    foreach ($node in $nodes) {
        if ($ready.ContainsKey($node.Id)) { continue }
        try {
            $status = Invoke-RestMethod -Uri "http://localhost:$($node.Http)/v1/cluster/status" -TimeoutSec 2
            if ($status.nodeId -eq $node.Id) {
                $ready[$node.Id] = $status
            }
        } catch {}
    }
    if ($ready.Count -lt $nodes.Count) { Start-Sleep -Milliseconds 500 }
}

if ($ready.Count -lt $nodes.Count) {
    $missing = $nodes | Where-Object { -not $ready.ContainsKey($_.Id) } | ForEach-Object { $_.Id }
    Write-Host "ERROR: these nodes did not come up: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "Check data\<node>\stderr.log for details." -ForegroundColor Red
    exit 1
}

Write-Host "All 5 nodes are healthy." -ForegroundColor Green

# Inspect leader
try {
    $status = Invoke-RestMethod -Uri "http://localhost:8001/v1/cluster/status"
    Write-Host "Cluster Leader: $($status.leaderId) (Term: $($status.term))" -ForegroundColor Cyan
} catch {
    Write-Host "Leader election in progress. Querying again in 1s..."
}

if ($KeepAlive) {
    Write-Host "Cluster is active and running in background. Monitoring cluster health..." -ForegroundColor Green
    while ($true) {
        Start-Sleep -Seconds 10
    }
}
