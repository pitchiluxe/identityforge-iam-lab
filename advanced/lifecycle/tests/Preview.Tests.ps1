# Runs the real orchestration script against a read-only, test-only AD provider.
# This checks wiring and WhatIf behavior, not Microsoft's AD implementation.
$ErrorActionPreference='Stop'
$tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot=Join-Path $tempRoot ('identityforge-preview-'+[guid]::NewGuid())
$moduleDir=Join-Path $testRoot 'modules\ActiveDirectory'
New-Item -ItemType Directory -Path $moduleDir -Force|Out-Null
$provider=@'
function Get-ADDomain {param($Server) [pscustomobject]@{DNSRoot='iamlab.test';DistinguishedName='DC=iamlab,DC=test'}}
function Get-ADDomainController {param($Identity,$Server) [pscustomobject]@{IsReadOnly=$false}}
function Get-ADOrganizationalUnit {param($Identity,$Server) [pscustomobject]@{DistinguishedName=$Identity}}
function Get-ADGroup {
 param($SearchBase,$SearchScope,$Filter,$Properties,$Server)
 foreach($name in @('LAB-AllEmployees','LAB-HR-Portal','LAB-Engineering-Tools','LAB-Finance-Read','LAB-Support-Tickets','LAB-Payment-Creator','LAB-Payment-Approver')){
  [pscustomobject]@{Name=$name;SamAccountName=$name;DistinguishedName="CN=$name,OU=Groups,OU=IAM-Training,DC=iamlab,DC=test";GroupCategory='Security';GroupScope='Global';ObjectGUID=[guid]::NewGuid();MemberOf=@()}
 }
}
function Get-ADUser {param($Filter,$SearchBase,$Properties,$Server,$Identity) }
function New-ADUser { [IO.File]::WriteAllText($env:IDENTITYFORGE_TEST_MUTATION,'unexpected mutation'); throw 'AD writes forbidden in preview test' }
Export-ModuleMember -Function *-AD*
'@
$provider|Set-Content (Join-Path $moduleDir 'ActiveDirectory.psm1') -Encoding UTF8
$oldModules=$env:PSModulePath;$oldMarker=$env:IDENTITYFORGE_TEST_MUTATION
try{
    $env:PSModulePath=(Join-Path $testRoot 'modules')+';'+$oldModules
    $env:IDENTITYFORGE_TEST_MUTATION=Join-Path $testRoot 'mutation.txt'
    $fixture=Join-Path $testRoot 'project\advanced\lifecycle'
    New-Item -ItemType Directory -Path $fixture -Force|Out-Null
    foreach($source in @('Invoke-ADLifecycle.ps1','IamLifecycle.psm1')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot "..\$source") -Destination $fixture}
    $runner=Join-Path $fixture 'Invoke-ADLifecycle.ps1'
    $csv=Join-Path $PSScriptRoot '..\data\01-joiners.csv'
    $out=Join-Path $testRoot 'project\evidence\ad-lifecycle'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -Server dc01.iamlab.test -ExpectedDomain iamlab.test -CsvPath $csv -Apply -WhatIf
    if($LASTEXITCODE -ne 0){throw 'WhatIf orchestration must complete successfully against the test provider.'}
    $summaryFile=Get-ChildItem -LiteralPath $out -Filter summary.csv -Recurse
    $rows=@(Import-Csv -LiteralPath $summaryFile.FullName)
    if($rows.Count -ne 4 -or @($rows|Where-Object Status -ne 'Preview').Count){throw 'All HR rows must remain preview-only.'}
    if(Test-Path -LiteralPath $env:IDENTITYFORGE_TEST_MUTATION){throw 'Preview invoked a mutation.'}
    $auditFile=Get-ChildItem -LiteralPath $out -Filter audit.jsonl -Recurse
    $events=@(Get-Content $auditFile.FullName|ForEach-Object{$_|ConvertFrom-Json})
    if($events.Event -contains 'Intent' -or $events.Event -notcontains 'Planned'){throw 'Preview must audit plans without mutation intent.'}
    Write-Host 'PASS: real runner WhatIf creates local evidence, writes no directory changes and reports four preview rows (test-only provider)'
}finally{
    $env:PSModulePath=$oldModules;$env:IDENTITYFORGE_TEST_MUTATION=$oldMarker
    $resolved=[IO.Path]::GetFullPath($testRoot)
    if($resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'identityforge-preview-*'){
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
