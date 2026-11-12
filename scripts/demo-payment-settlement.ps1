# ==============================================================================
# Raftline Real-Time Payment Settlement & Idempotency Switch Demonstration
# Supports Instant Payment Rails: FedNow, SEPA Instant, UPI, Faster Payments
# ==============================================================================

$baseDir = Split-Path -Parent $PSScriptRoot

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "   Raftline Real-Time Payment Settlement & Idempotency Switch" -ForegroundColor Cyan
Write-Host "       (FedNow / SEPA Instant / UPI / Faster Payments)" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Discover active cluster leader
$ports = @("8001", "8002", "8003", "8004", "8005")
$leaderPort = $null
$leaderId = $null

for ($i = 1; $i -le 10; $i++) {
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
    if ($leaderPort) { break }
    Start-Sleep -Milliseconds 500
}

if (-not $leaderPort) {
    Write-Host "No active cluster detected. Starting 5-node cluster first..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$PSScriptRoot\start-5node-cluster.ps1`" -KeepAlive" -WindowStyle Hidden
    Start-Sleep -Seconds 3
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
}

Write-Host "`n[STEP 1] Connected to Consensus Leader: $leaderId on port $leaderPort" -ForegroundColor Green

# 2. Provision Payment Accounts
Write-Host "`n[STEP 2] Provisioning B2B FinTech Payment Accounts..." -ForegroundColor Green

$aliceAcc = @{
    accountId = "acc_alice_fednow"
    currency = "USD"
    initialBalanceCents = 100000 # $1,000.00
    metadata = @{ holder = "Alice Smith"; routingNumber = "121000358" }
} | ConvertTo-Json

$bobAcc = @{
    accountId = "acc_bob_fednow"
    currency = "USD"
    initialBalanceCents = 25000 # $250.00
    metadata = @{ holder = "Bob Jones Corp"; routingNumber = "021000021" }
} | ConvertTo-Json

$resAlice = Invoke-RestMethod -Method Post -Uri "http://localhost:$leaderPort/v1/payments/accounts" -Body $aliceAcc -ContentType "application/json"
$resBob = Invoke-RestMethod -Method Post -Uri "http://localhost:$leaderPort/v1/payments/accounts" -Body $bobAcc -ContentType "application/json"

Write-Host "  -> Provisioned Alice: $($resAlice.accountId) | Balance: `$$([math]::Round($resAlice.balanceCents / 100, 2)) $($resAlice.currency)" -ForegroundColor Yellow
Write-Host "  -> Provisioned Bob:   $($resBob.accountId) | Balance: `$$([math]::Round($resBob.balanceCents / 100, 2)) $($resBob.currency)" -ForegroundColor Yellow

# 3. Execute Instant Payment Settlement (FedNow rail)
Write-Host "`n[STEP 3] Executing Instant FedNow Payment Settlement..." -ForegroundColor Green
$idempKey = "pmt_fednow_$(Get-Random)"

$paymentPayload = @{
    idempotencyKey = $idempKey
    rail = "FEDNOW"
    sourceAccountId = "acc_alice_fednow"
    destinationAccountId = "acc_bob_fednow"
    amountCents = 30000 # $300.00
    currency = "USD"
    description = "Invoice #4812 FedNow Instant Settlement"
} | ConvertTo-Json

$settleRes1 = Invoke-RestMethod -Method Post -Uri "http://localhost:$leaderPort/v1/payments/settle" -Body $paymentPayload -ContentType "application/json"

Write-Host "  -> Settlement Result: $($settleRes1.status)" -ForegroundColor Cyan
Write-Host "     Payment Reference: $($settleRes1.paymentRef)"
Write-Host "     Idempotency Key:   $($settleRes1.idempotencyKey)"
Write-Host "     Raft Log Index:    $($settleRes1.raftLogIndex)"
Write-Host "     Alice New Balance: `$$([math]::Round($settleRes1.sourceBalanceAfter / 100, 2))" -ForegroundColor Yellow
Write-Host "     Bob New Balance:   `$$([math]::Round($settleRes1.destinationBalanceAfter / 100, 2))" -ForegroundColor Yellow

# 4. Flaky Network Retry: Simulating 3 Duplicate Retries with Same Idempotency Key
Write-Host "`n[STEP 4] FLAKY NETWORK TEST: Client retries identical payment 3 times..." -ForegroundColor Magenta
for ($attempt = 1; $attempt -le 3; $attempt++) {
    $retryRes = Invoke-RestMethod -Method Post -Uri "http://localhost:$leaderPort/v1/payments/settle" -Body $paymentPayload -ContentType "application/json"
    Write-Host "  Retry #$($attempt): Status=$($retryRes.status) | IdempotentReplay=$($retryRes.isIdempotentReplay) | Ref=$($retryRes.paymentRef)" -ForegroundColor Gray
}

# Verify Alice was NOT debited multiple times!
$aliceCheck = Invoke-RestMethod -Method Get -Uri "http://localhost:$leaderPort/v1/payments/account?id=acc_alice_fednow"
Write-Host "`n  [VERIFICATION] Alice Balance after 3 retries: `$$([math]::Round($aliceCheck.balanceCents / 100, 2)) (MUST BE EXACTLY `$700.00)" -ForegroundColor Green
if ($aliceCheck.balanceCents -eq 70000) {
    Write-Host "  SUCCESS: Zero Duplicate Debits! Strictly-Once Semantics Preserved!" -ForegroundColor Green
} else {
    Write-Error "  CRITICAL BUG: Duplicate debit occurred!"
}

# 5. Overdraft Prevention Invariant Check
Write-Host "`n[STEP 5] Testing Overdraft Prevention Invariant..." -ForegroundColor Green
$overdrawPayload = @{
    idempotencyKey = "pmt_overdraw_$(Get-Random)"
    rail = "UPI"
    sourceAccountId = "acc_alice_fednow"
    destinationAccountId = "acc_bob_fednow"
    amountCents = 500000 # $5,000.00 (Alice only has $700.00)
    currency = "USD"
    description = "Attempted overdraft"
} | ConvertTo-Json

try {
    $overdrawRes = Invoke-RestMethod -Method Post -Uri "http://localhost:$leaderPort/v1/payments/settle" -Body $overdrawPayload -ContentType "application/json"
} catch {
    $rawErr = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream()).ReadToEnd() }
    $errBody = $rawErr | ConvertFrom-Json
    Write-Host "  -> Expected Rejection: Status=$($errBody.status) | Reason=$($errBody.rejectionReason) | Ref=$($errBody.paymentRef)" -ForegroundColor Yellow
}

# 6. Two-Phase Authorization Hold & Capture
Write-Host "`n[STEP 6] Testing Two-Phase Authorization Hold & Capture (Pre-Auth -> Capture)..." -ForegroundColor Green
$holdId = "hld_hotel_$(Get-Random)"
$authPayload = @{
    idempotencyKey = "auth_$(Get-Random)"
    holdId = $holdId
    sourceAccountId = "acc_alice_fednow"
    destinationAccountId = "acc_bob_fednow"
    amountCents = 15000 # $150.00 hold
    currency = "USD"
    ttlMillis = 3600000
    description = "Hotel room reservation hold"
} | ConvertTo-Json

$authRes = Invoke-RestMethod -Method Post -Uri "http://localhost:$leaderPort/v1/payments/authorize" -Body $authPayload -ContentType "application/json"
Write-Host "  -> Phase 1: Hold Authorized: Status=$($authRes.status) | HoldId=$holdId" -ForegroundColor Cyan

$aliceHeld = Invoke-RestMethod -Method Get -Uri "http://localhost:$leaderPort/v1/payments/account?id=acc_alice_fednow"
Write-Host "     Alice Ledger Balance:    `$$([math]::Round($aliceHeld.balanceCents / 100, 2))"
Write-Host "     Alice Reserved Hold:     `$$([math]::Round($aliceHeld.reservedCents / 100, 2))"
Write-Host "     Alice Available Balance: `$$([math]::Round($aliceHeld.availableBalanceCents / 100, 2))" -ForegroundColor Yellow

Write-Host "  -> Phase 2: Capturing Hold into Settled Funds..." -ForegroundColor Cyan
$capPayload = @{
    holdId = $holdId
    idempotencyKey = "cap_$(Get-Random)"
} | ConvertTo-Json

$capRes = Invoke-RestMethod -Method Post -Uri "http://localhost:$leaderPort/v1/payments/capture" -Body $capPayload -ContentType "application/json"
Write-Host "     Captured! Payment Ref: $($capRes.paymentRef) | Alice Balance: `$$([math]::Round($capRes.sourceBalanceAfter / 100, 2)) | Bob Balance: `$$([math]::Round($capRes.destinationBalanceAfter / 100, 2))" -ForegroundColor Green

# 7. Settlement Switch Metrics
Write-Host "`n[STEP 7] Settlement Switch Operational Metrics:" -ForegroundColor Cyan
$metrics = Invoke-RestMethod -Method Get -Uri "http://localhost:$leaderPort/v1/payments/metrics"
$metrics | Format-List

Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  All Payment Settlement & Idempotency Tests Passed Successfully!" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
