# Runs the Raftline High-Performance Benchmark Suite against the active cluster
param(
    [int]$Threads = 8,
    [int]$Ops = 250,
    [string]$Cluster = "http://localhost:8001,http://localhost:8002,http://localhost:8003,http://localhost:8004,http://localhost:8005"
)

$PSScriptRoot_Safe = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$PSScriptRoot_Safe\.."
$JarPath = "$ProjectRoot\raftline-api\target\raftline-api-1.0.0-SNAPSHOT-shaded.jar"

if (-not (Test-Path $JarPath)) {
    Write-Host "Jar not found. Building shaded JAR first..." -ForegroundColor Yellow
    & "$env:USERPROFILE\.maven\apache-maven-3.9.9\bin\mvn.cmd" package -DskipTests
}

Write-Host "Running Raftline Benchmark with $Threads threads ($Ops ops each)..." -ForegroundColor Cyan
java -cp $JarPath io.raftline.client.benchmark.RaftBenchmark --threads $Threads --ops $Ops --servers $Cluster
