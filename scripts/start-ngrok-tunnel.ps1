# ==============================================================================
# Raftline Public Gateway — ngrok Tunnel Starter
# Exposes the live Customer Pay Portal and Consensus Cluster to the World / Mobile
# ==============================================================================

param(
    [string]$Authtoken = $env:NGROK_AUTHTOKEN
)

$baseDir = Split-Path -Parent $PSScriptRoot

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "       Raftline Pay — ngrok Public Tunnel Gateway" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Discover active cluster leader port
$ports = @("8001", "8002", "8003", "8004", "8005")
$leaderPort = $null
$leaderId = $null

foreach ($p in $ports) {
    try {
        $st = Invoke-RestMethod -Uri "http://localhost:$p/v1/cluster/status" -TimeoutSec 1 -ErrorAction SilentlyContinue
        if ($st.role -eq "LEADER") {
            $leaderPort = $p
            $leaderId = $st.nodeId
            break
        }
    } catch {}
}

if (-not $leaderPort) {
    Write-Host "Warning: No active cluster leader detected on 8001..8005." -ForegroundColor Yellow
    Write-Host "Defaulting tunnel target to port 8003 (standard leader port)..." -ForegroundColor Yellow
    $leaderPort = "8003"
} else {
    Write-Host "Connected to active Raft Leader: $leaderId on port $leaderPort" -ForegroundColor Green
}

# 2. Check if ngrok CLI is installed
$ngrokCmd = Get-Command ngrok -ErrorAction SilentlyContinue

if (-not $ngrokCmd) {
    Write-Host "`nngrok is not detected in your PATH." -ForegroundColor Yellow
    Write-Host "You can install it instantly using:" -ForegroundColor Cyan
    Write-Host "   winget install ngrok.ngrok" -ForegroundColor White
    Write-Host "   - OR -" -ForegroundColor Cyan
    Write-Host "   npm install -g ngrok" -ForegroundColor White
    Write-Host "`nAttempting to run via npx..." -ForegroundColor Cyan

    if ($Authtoken) {
        & npx -y @ngrok/ngrok http $leaderPort --authtoken $Authtoken
    } else {
        & npx -y @ngrok/ngrok http $leaderPort
    }
    exit 0
}

# 3. Configure Authtoken if provided
if ($Authtoken) {
    Write-Host "Setting ngrok authtoken..." -ForegroundColor Gray
    & ngrok config add-authtoken $Authtoken
}

# 4. Launch ngrok tunnel
Write-Host ""
Write-Host "Starting ngrok HTTP tunnel forwarding to http://localhost:$leaderPort..." -ForegroundColor Green
Write-Host "Customer Portal will be accessible at: https://<your-ngrok-subdomain>.ngrok-free.app/portal" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to terminate the tunnel." -ForegroundColor Gray
& ngrok http $leaderPort
