# Checks against the deployed Worker: wrong passcode, one full live run with cost, and the per-passcode cap.
# Costs about the price of one student session (a dollar or two at most). Run after deploy.ps1.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot
$relay = (Get-Content "$root\config.json" -Raw | ConvertFrom-Json).relayUrl
$code = ((Get-Content "$root\_local\passcodes.txt" -Raw).Trim() -split '=', 2)[1]
$admin = (Get-Content "$root\_local\admin-token.txt" -Raw).Trim()
$env:RELAY = $relay
Set-Location $root

Write-Host "== wrong passcode =="
$env:CODE = "wrong-passcode-0000"; node test/relay-client.mjs check
Write-Host "== right passcode =="
$env:CODE = $code; node test/relay-client.mjs check

Write-Host "== full live run (tennis facility) =="
node test/live-flow.mjs

Write-Host "== usage so far =="
curl.exe -s -H "X-Admin-Token: $admin" "$relay/api/usage"; ""

Write-Host "== cap test: set the per-passcode limit to 1 more than today's count, then exceed it =="
$u = curl.exe -s -H "X-Admin-Token: $admin" "$relay/api/usage" | ConvertFrom-Json
$today = $u.today; $used = $u.calls.$today.zakston
$low = $used + 1
Set-Location "$root\worker"
npx wrangler deploy --var "PER_CODE_DAILY:$low" | Out-Null
Set-Location $root
Write-Host "limit is now $low (used $used). Two calls: first should pass, second should be refused."
node test/relay-client.mjs one CRITIQUE | Select-String '"status"'
node test/relay-client.mjs one CRITIQUE | Select-String '"status"|passcode_cap'

Write-Host "== restore the limit and confirm =="
Set-Location "$root\worker"
npx wrangler deploy | Out-Null
Set-Location $root
curl.exe -s -H "X-Admin-Token: $admin" "$relay/api/usage" | ConvertFrom-Json | Select-Object -ExpandProperty limits
node test/relay-client.mjs one CRITIQUE | Select-String '"status"'
