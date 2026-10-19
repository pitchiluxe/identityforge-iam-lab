[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$results=@()
function Check($name,[scriptblock]$action){
    & $action
    if($LASTEXITCODE -ne 0){throw "Check failed: $name (exit $LASTEXITCODE)"}
    $script:results += [pscustomobject]@{Check=$name;Status='Passed';Kind='LocalOffline';Utc=[datetime]::UtcNow.ToString('o')}
}
Check 'AD planner/executor and activation containment' {& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'advanced\lifecycle\tests\Planner.Tests.ps1')}
Check 'AD runner preview with test-only provider' {& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'advanced\lifecycle\tests\Preview.Tests.ps1')}
Check 'Access review export and duplicate HR rejection' {& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'operational\tests\Review.Tests.ps1')}
Push-Location (Join-Path $root 'sso')
try{
    Check 'SSO claim/config/evidence tests' {& node --test tests/policy.test.mjs}
    Check 'SSO production build' {& node node_modules/vite/bin/vite.js build}
}finally{Pop-Location}
$dir=Join-Path $root 'evidence\verification'
New-Item -ItemType Directory -Path $dir -Force|Out-Null
$file=Join-Path $dir ('upgrade-'+[datetime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'.json')
[ordered]@{Scope='Local and offline only';LiveAD='NotVerified';LiveSSO='NotVerified_NoTenantAvailable';Results=$results}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $file -Encoding UTF8
Write-Host "All upgrade checks passed. Local verification evidence: $file"
