foreach ($p in 8001..8005) {
    try {
        $s = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $p + "/v1/cluster/status") -TimeoutSec 1 -ErrorAction Stop
        Write-Host "Port $p : $($s.nodeId) | Role: $($s.role) | Term: $($s.term) | CommitIdx: $($s.commitIndex) | LeaderId: $($s.leaderId)"
    } catch {
        Write-Host "Port $p : DOWN or UNREACHABLE ($($_.Exception.Message))" -ForegroundColor Yellow
    }
}

