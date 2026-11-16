$leaderPort = "8002"
$acc = Invoke-RestMethod -Uri "http://127.0.0.1:$leaderPort/v1/payments/accounts"
Write-Host "Accounts count: $($acc.count)"
$acc.accounts | ForEach-Object {
    Write-Host "  - $($_.accountId) [$($_.currency)]: Balance=$($_.balanceCents) Reserved=$($_.reservedCents) Available=$($_.availableBalanceCents)"
}

