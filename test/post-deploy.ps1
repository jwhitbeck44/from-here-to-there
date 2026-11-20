# Checks against the deployed Worker: relay reachable, one full live run with cost, and the per-connection cap.
# Costs about the price of one student session (a dollar or two at most). Run after deploy.ps1.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot
$relay = (Get-Content "$root\config.json" -Raw | ConvertFrom-Json).relayUrl
$admin = (Get-Content "$root\_local\admin-token.txt" -Raw).Trim()
$env:RELAY = $relay
Set-Location $root

Write-Host "== relay reachable, no passcode =="
node test/relay-client.mjs check

Write-Host "== full live run (tennis facility) =="
node test/live-flow.mjs

Write-Host "== usage so far =="
curl.exe -s -H "X-Admin-Token: $admin" "$relay/api/usage"; ""

Write-Host "== cap test: set the per-passcode limit to 1 more than today's count, then exceed it =="
$u = curl.exe -s -H "X-Admin-Token: $admin" "$relay/api/usage" | ConvertFrom-Json
$today = $u.today; $used = [int](($u.calls.$today.PSObject.Properties.Value) | Measure-Object -Maximum).Maximum
$low = $used + 1
Set-Location "$root\worker"
npx wrangler deploy --var "PER_CODE_DAILY:$low" | Out-Null
Set-Location $root
Write-Host "limit is now $low (used $used). Two calls: first should pass, second should be refused."
node test/relay-client.mjs one PLAYBACK | Select-String '"status"'
node test/relay-client.mjs one PLAYBACK | Select-String '"status"|passcode_cap'

Write-Host "== restore the limit and confirm =="
Set-Location "$root\worker"
npx wrangler deploy | Out-Null
Set-Location $root
curl.exe -s -H "X-Admin-Token: $admin" "$relay/api/usage" | ConvertFrom-Json | Select-Object -ExpandProperty limits
node test/relay-client.mjs one PLAYBACK | Select-String '"status"'

