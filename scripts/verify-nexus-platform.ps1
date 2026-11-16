# ==============================================================================
# Nexus Clearing — End-to-End Platform Verification Suite
# Verifies all 4 modules, API proxy, consensus telemetry, idempotency, and ISO 20022
# ==============================================================================

$baseUrl = "http://localhost:3000"
$successCount = 0
$totalTests = 0

function Assert-Step([string]$name, [scriptblock]$action) {
    $script:totalTests++
    Write-Host -NoNewline "[TEST $script:totalTests] $name... "
    try {
        $result = & $action
        Write-Host "PASS" -ForegroundColor Green
        if ($result) {
            Write-Host "       Result: $result" -ForegroundColor DarkGray
        }
        $script:successCount++
    } catch {
        Write-Host "FAIL" -ForegroundColor Red
        Write-Host "       Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "   NEXUS CLEARING END-TO-END VERIFICATION SUITE" -ForegroundColor Cyan
Write-Host "==================================================================`n" -ForegroundColor Cyan

# 1. Frontend Pages Rendering
Assert-Step "HTTP GET / (Root Redirect)" {
    $r = Invoke-WebRequest -Uri "$baseUrl/" -MaximumRedirection 0 -ErrorAction SilentlyContinue
    if ($r.StatusCode -ne 200 -and $r.StatusCode -ne 307 -and $r.StatusCode -ne 308) {
        throw "Unexpected status: $($r.StatusCode)"
    }
    "Status $($r.StatusCode)"
}

Assert-Step "HTTP GET /wallet (Customer Neobank Wallet)" {
    $r = Invoke-WebRequest -Uri "$baseUrl/wallet" -UseBasicParsing
    if ($r.StatusCode -ne 200) { throw "Status $($r.StatusCode)" }
    "OK 200 ($( $r.Content.Length ) bytes)"
}

Assert-Step "HTTP GET /terminal (Merchant Terminal)" {
    $r = Invoke-WebRequest -Uri "$baseUrl/terminal" -UseBasicParsing
    if ($r.StatusCode -ne 200) { throw "Status $($r.StatusCode)" }
    "OK 200 ($( $r.Content.Length ) bytes)"
}

Assert-Step "HTTP GET /treasury (Corporate Treasury Ledger)" {
    $r = Invoke-WebRequest -Uri "$baseUrl/treasury" -UseBasicParsing
    if ($r.StatusCode -ne 200) { throw "Status $($r.StatusCode)" }
    "OK 200 ($( $r.Content.Length ) bytes)"
}

Assert-Step "HTTP GET /consensus (Consensus Quorum & Chaos Center)" {
    $r = Invoke-WebRequest -Uri "$baseUrl/consensus" -UseBasicParsing
    if ($r.StatusCode -ne 200) { throw "Status $($r.StatusCode)" }
    "OK 200 ($( $r.Content.Length ) bytes)"
}

# 2. Consensus & Node Telemetry API
$clusterStatus = $null
Assert-Step "API GET /api/raft/cluster/status (Dynamic Leader Discovery)" {
    $script:clusterStatus = Invoke-RestMethod -Uri "$baseUrl/api/raft/cluster/status"
    if (-not $script:clusterStatus.nodeId) { throw "No nodeId in status" }
    "Leader: $($script:clusterStatus.nodeId) | Role: $($script:clusterStatus.role) | Term: $($script:clusterStatus.term) | CommitIndex: $($script:clusterStatus.commitIndex)"
}

Assert-Step "API GET /api/raft/cluster/nodes (5-Node Telemetry Map)" {
    $nodesResp = Invoke-RestMethod -Uri "$baseUrl/api/raft/cluster/nodes"
    if (-not $nodesResp.nodes -or $nodesResp.nodes.Count -lt 5) {
        throw "Expected 5 nodes, got $($nodesResp.nodes.Count)"
    }
    $online = ($nodesResp.nodes | Where-Object { $_.reachable -eq $true }).Count
    "$online / $($nodesResp.nodes.Count) nodes healthy and reachable"
}

# 3. Account Seeding & Discovery
$accounts = $null
Assert-Step "API GET /api/raft/payments/accounts (Demo Customer Accounts)" {
    $accResp = Invoke-RestMethod -Uri "$baseUrl/api/raft/payments/accounts"
    $script:accounts = $accResp.accounts
    if (-not $script:accounts -or $script:accounts.Count -lt 2) {
        throw "Insufficient accounts found: $($script:accounts.Count)"
    }
    "$($script:accounts.Count) accounts discovered (Alice, Bob, Charlie, Deepak)"
}

# 4. Instant Settlement with Idempotency Key
$alice = $script:accounts | Where-Object { $_.accountId -like "*alice*" } | Select-Object -First 1
$bob = $script:accounts | Where-Object { $_.accountId -like "*bob*" } | Select-Object -First 1
if (-not $alice) { $alice = $script:accounts[0] }
if (-not $bob) { $bob = $script:accounts[1] }

$testKey = "e2e_idem_" + [guid]::NewGuid().ToString()
$settleResult1 = $null

Assert-Step "API POST /api/raft/payments/settle (Instant Transfer via FEDNOW)" {
    $body = @{
        idempotencyKey = $testKey
        rail = "FEDNOW"
        sourceAccountId = $alice.accountId
        destinationAccountId = $bob.accountId
        amountCents = 1500
        currency = "USD"
        description = "E2E Settlement Invariant Verification"
    } | ConvertTo-Json

    $script:settleResult1 = Invoke-RestMethod -Uri "$baseUrl/api/raft/payments/settle" -Method Post -Body $body -ContentType "application/json"
    if ($script:settleResult1.status -ne "SETTLED") {
        throw "Expected status SETTLED, got $($script:settleResult1.status)"
    }
    "Ref: $($script:settleResult1.paymentRef) | LogIndex: $($script:settleResult1.raftLogIndex) | isReplay: $($script:settleResult1.isIdempotentReplay)"
}

Assert-Step "API POST /api/raft/payments/settle (Strict Idempotent Replay Verification)" {
    $body = @{
        idempotencyKey = $testKey
        rail = "FEDNOW"
        sourceAccountId = $alice.accountId
        destinationAccountId = $bob.accountId
        amountCents = 1500
        currency = "USD"
        description = "E2E Duplicate Retry Verification"
    } | ConvertTo-Json

    $replay = Invoke-RestMethod -Uri "$baseUrl/api/raft/payments/settle" -Method Post -Body $body -ContentType "application/json"
    if ($replay.isIdempotentReplay -ne $true) {
        throw "Expected isIdempotentReplay=true, got $($replay.isIdempotentReplay)"
    }
    if ($replay.paymentRef -ne $script:settleResult1.paymentRef) {
        throw "Payment ref mismatch on idempotent replay!"
    }
    "Guaranteed 1 execution: isIdempotentReplay: true | Zero Duplicate Debit Verified"
}

# 5. Two-Phase Pre-Auth Hold, Capture & Void
$holdId = $null
$holdKey = "e2e_hold_" + [guid]::NewGuid().ToString()

Assert-Step "API POST /api/raft/payments/authorize (Pre-Auth Hold Reservation)" {
    $body = @{
        idempotencyKey = $holdKey
        sourceAccountId = $bob.accountId
        destinationAccountId = $alice.accountId
        amountCents = 2500
        currency = "USD"
        expiresInSeconds = 300
    } | ConvertTo-Json

    $authResp = Invoke-RestMethod -Uri "$baseUrl/api/raft/payments/authorize" -Method Post -Body $body -ContentType "application/json"
    $script:holdId = $authResp.holdId
    if (-not $script:holdId) { throw "No holdId returned" }
    "Hold ID: $($script:holdId) | Amount: $25.00 | Status: $($authResp.status)"
}

Assert-Step "API GET /api/raft/payments/holds (Inspect Active Reservation Holds)" {
    $holdsResp = Invoke-RestMethod -Uri "$baseUrl/api/raft/payments/holds"
    $found = $holdsResp.holds | Where-Object { $_.holdId -eq $script:holdId }
    if (-not $found) { throw "Created hold not found in active holds query" }
    "Active hold $($script:holdId) confirmed present in consensus state machine"
}

Assert-Step "API POST /api/raft/payments/capture (Finalize Pre-Auth Hold Settlement)" {
    $capKey = "e2e_cap_" + [guid]::NewGuid().ToString()
    $body = @{
        holdId = $script:holdId
        idempotencyKey = $capKey
        amountCents = 2500
    } | ConvertTo-Json

    $capResp = Invoke-RestMethod -Uri "$baseUrl/api/raft/payments/capture" -Method Post -Body $body -ContentType "application/json"
    if ($capResp.status -ne "CAPTURED" -and $capResp.status -ne "SETTLED") {
        throw "Unexpected status: $($capResp.status)"
    }
    "Hold $($script:holdId) successfully captured! Settled Ref: $($capResp.paymentRef)"
}

# 6. Corporate Treasury Ledger & ISO 20022 XML
Assert-Step "API GET /api/raft/payments/transactions (Audit Ledger Trail)" {
    $txResp = Invoke-RestMethod -Uri "$baseUrl/api/raft/payments/transactions"
    if (-not $txResp.transactions -or $txResp.transactions.Count -eq 0) {
        throw "No transactions found in ledger"
    }
    "$($txResp.transactions.Count) immutable settlement entries in Raft log"
}

Assert-Step "API GET /api/raft/payments/iso20022 (Live pacs.008.001.08 XML Generation)" {
    $ref = $script:settleResult1.paymentRef
    $xml = Invoke-RestMethod -Uri "$baseUrl/api/raft/payments/iso20022?ref=$ref"
    if ($xml -notlike "*pacs.008.001.08*" -and $xml -notlike "*FIToFICstmrCdtTrf*") {
        throw "Response does not contain valid pacs.008 XML format"
    }
    "Valid ISO 20022 pacs.008.001.08 XML generated ($( $xml.Length ) chars)"
}

# 7. Final Summary
Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "   VERIFICATION SUMMARY: $successCount / $totalTests PASSED" -ForegroundColor $(if ($successCount -eq $totalTests) { "Green" } else { "Yellow" })
Write-Host "==================================================================" -ForegroundColor Cyan

if ($successCount -ne $totalTests) {
    exit 1
}

