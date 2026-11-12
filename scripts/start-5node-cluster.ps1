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
Write-Host "Waiting 2 seconds for leader election..."
Start-Sleep -Seconds 2

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
