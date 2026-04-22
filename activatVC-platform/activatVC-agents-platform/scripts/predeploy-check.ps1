param(
  [string]$BaseUrl = "http://127.0.0.1:8888"
)

$ErrorActionPreference = "Stop"

Write-Host "[agents-platform] Checking service health at $BaseUrl/health"
$health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health"
if ($health.status -ne "ok") {
  throw "Unexpected /health response: $($health | ConvertTo-Json -Depth 5)"
}
Write-Host "[ok] agents-platform is healthy"

Write-Host "[agents-platform] Checking runs endpoint"
$runs = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/v1/runs"
if ($null -eq $runs) {
  throw "Runs endpoint returned null"
}
Write-Host "[ok] API endpoints are reachable"
