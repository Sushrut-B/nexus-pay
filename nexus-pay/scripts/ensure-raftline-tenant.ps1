<#
.SYNOPSIS
Registers the configured Nexus Pay tenant on every local Raftline node.

.DESCRIPTION
Raftline's per-tenant token bucket applies to settlement requests. If the
tenant is not registered on the current leader, every settlement returns HTTP
429 and Nexus Pay correctly leaves the payment unresolved. Run this script once
after starting the five-node cluster so the sandbox tenant exists on all nodes.

It is safe to re-run: registration is idempotent and replaces the tenant
configuration on each node.
#>

param(
    [string]$TenantId = "nexuspay",
    [int[]]$Ports = @(8001, 8002, 8003, 8004, 8005),
    [int]$MaxOpsPerSec = 1000
)

$body = @{
    tenantId       = $TenantId
    name           = "Nexus Pay sandbox"
    tier           = "PRO"
    maxOpsPerSec   = $MaxOpsPerSec
    maxKeys        = 100000
    maxStorageBytes = 1073741824
} | ConvertTo-Json

foreach ($port in $Ports) {
    try {
        $response = Invoke-RestMethod `
            -Uri "http://localhost:$port/v1/dbaas/tenants" `
            -Method Post `
            -Body $body `
            -ContentType "application/json" `
            -TimeoutSec 5
        Write-Host "node $port : $($response.status)"
    } catch {
        Write-Warning "node $port : $($_.Exception.Message)"
    }
}
