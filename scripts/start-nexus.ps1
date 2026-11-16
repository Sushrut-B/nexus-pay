# ==============================================================================
# Nexus Clearing — Full-Stack Platform Launcher & ngrok Gateway
# Starts Next.js (port 3000) with dynamic Raftline Leader Proxy and exposes via ngrok
# ==============================================================================

param(
    [string]$Authtoken = $env:NGROK_AUTHTOKEN,
    [switch]$NoNgrok
)

$baseDir = Split-Path -Parent $PSScriptRoot
$nexusUiDir = Join-Path $baseDir "nexus-ui"
$pidsFile = Join-Path $baseDir "data\nexus-pids.csv"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "   Nexus Clearing — Enterprise FinTech Platform Launcher" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Check Node.js and npm
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue

if (-not $nodeCmd -or -not $npmCmd) {
    Write-Error "Node.js and npm must be installed and in PATH."
    exit 1
}
Write-Host "✓ Node.js ($(& node --version)) & npm ($(& npm --version)) detected." -ForegroundColor Green

# 2. Check Raftline Backend Cluster Reachability
Write-Host "`nProbing Raftline 5-node cluster (8001..8005)..." -ForegroundColor Cyan
$leaderNode = $null
$leaderPort = $null

foreach ($p in 8001..8005) {
    try {
        $st = Invoke-RestMethod -Uri "http://127.0.0.1:$p/v1/cluster/status" -TimeoutSec 1 -ErrorAction SilentlyContinue
        if ($st.role -eq "LEADER") {
            $leaderNode = $st.nodeId
            $leaderPort = $p
            break
        }
    } catch {}
}

if (-not $leaderNode) {
    Write-Host "Warning: No active Raft leader detected on 8001..8005." -ForegroundColor Yellow
    Write-Host "Ensure the Raftline cluster is running: .\scripts\start-5node-cluster.ps1 -KeepAlive" -ForegroundColor Yellow
} else {
    Write-Host "✓ Connected to Raftline Consensus Leader: $leaderNode on port $leaderPort" -ForegroundColor Green
}

# 3. Start Next.js on port 3000
Write-Host "`nStarting Nexus Clearing Next.js frontend on port 3000..." -ForegroundColor Cyan

$dataDir = Join-Path $baseDir "data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

$runCmd = if (Test-Path (Join-Path $nexusUiDir ".next")) { "npm run start" } else { "npm run dev" }
$nextProc = Start-Process powershell -ArgumentList "-NoProfile -Command `"cd '$nexusUiDir'; $runCmd`"" -PassThru -WindowStyle Hidden

# 4. Wait for Next.js to respond on http://localhost:3000
Write-Host "Waiting for Next.js to initialize on http://localhost:3000..." -ForegroundColor Gray
$frontendReady = $false

for ($i = 1; $i -le 30; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:3000/api/raft/cluster/status" -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($resp.StatusCode -eq 200) {
            $frontendReady = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 1
}

if ($frontendReady) {
    Write-Host "✓ Nexus Clearing Frontend is LIVE on http://localhost:3000" -ForegroundColor Green
} else {
    Write-Host "Frontend is booting in background (check http://localhost:3000)" -ForegroundColor Yellow
}

# 5. Start ngrok Tunnel (Port 3000)
$ngrokProc = $null
$publicUrl = $null

if (-not $NoNgrok) {
    $ngrokCmd = Get-Command ngrok -ErrorAction SilentlyContinue

    if ($Authtoken -and $ngrokCmd) {
        & ngrok config add-authtoken $Authtoken
    }

    Write-Host "`nLaunching ngrok tunnel to expose Next.js (port 3000) to the Internet..." -ForegroundColor Cyan

    if ($ngrokCmd) {
        $ngrokProc = Start-Process ngrok -ArgumentList "http 3000 --log=stdout" -PassThru -WindowStyle Hidden
    } else {
        $ngrokProc = Start-Process powershell -ArgumentList "-NoProfile -Command `"npx -y @ngrok/ngrok http 3000`"" -PassThru -WindowStyle Hidden
    }

    # Query ngrok local inspect API for public URL
    Start-Sleep -Seconds 3
    for ($i = 1; $i -le 10; $i++) {
        try {
            $tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 1 -ErrorAction SilentlyContinue
            if ($tunnels.tunnels -and $tunnels.tunnels.Count -gt 0) {
                $publicUrl = $tunnels.tunnels[0].public_url
                break
            }
        } catch {}
        Start-Sleep -Seconds 1
    }
}

# Save PIDs for safe shutdown
$pidsData = @(
    [PSCustomObject]@{ Process = "NextJs"; PID = $nextProc.Id }
)
if ($ngrokProc) {
    $pidsData += [PSCustomObject]@{ Process = "ngrok"; PID = $ngrokProc.Id }
}
$pidsData | Export-Csv -Path $pidsFile -NoTypeInformation

# Summary Display
Write-Host "`n==================================================================" -ForegroundColor Green
Write-Host "   NEXUS CLEARING PLATFORM READY" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "Local URL:       http://localhost:3000" -ForegroundColor White
if ($publicUrl) {
    Write-Host "Public ngrok URL: $publicUrl" -ForegroundColor Cyan
    Write-Host "Mobile Wallet:   $publicUrl/wallet" -ForegroundColor Green
} else {
    Write-Host "Public Tunnel:   Run 'ngrok http 3000' or check http://127.0.0.1:4040" -ForegroundColor Yellow
}
Write-Host "Raft Leader:     $leaderNode (Port $leaderPort)" -ForegroundColor Yellow
Write-Host "PIDs saved to:   $pidsFile" -ForegroundColor Gray
Write-Host "To stop:         .\scripts\stop-nexus.ps1" -ForegroundColor Gray
Write-Host "==================================================================" -ForegroundColor Green

