#Requires -Version 5.1
# Independent after-state check for Joiner-Mover-Leaver_JML.ps1.
# Reads AD only. Compares every LAB-* identity with the HR file and flags drift.
[CmdletBinding()]
param(
    [string]$HrSourcePath = 'C:\workspace\hr-source.csv',
    [string]$ParentOuName = 'Identities'
)
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory
$ParentPath = "OU=$ParentOuName,$((Get-ADDomain).DistinguishedName)"
$hr = @{}
foreach ($r in Import-Csv -LiteralPath $HrSourcePath) { $hr[$r.EmployeeId] = $r }

Write-Host "`n=== POST-SYNC ACCOUNT AUDIT RESULTS ===" -ForegroundColor Cyan
$Users = Get-ADUser -Filter "EmployeeID -like 'LAB-*'" -SearchBase $ParentPath -Properties Department, EmployeeID, Enabled

$report = $Users | ForEach-Object {
    $groups = (Get-ADPrincipalGroupMembership -Identity $_ | Select-Object -ExpandProperty Name) -join ', '
    $ouLocation = (($_.DistinguishedName -split ',')[1]) -replace '^OU=', ''
    $source = $hr[$_.EmployeeID]
    $finding = if (-not $source) { 'ORPHAN: no HR record' }
        elseif ($source.EmploymentStatus -eq 'Terminated' -and $_.Enabled) { 'RISK: terminated but enabled' }
        elseif ($source.EmploymentStatus -eq 'Terminated' -and $groups -ne 'Domain Users') { 'RISK: terminated with groups' }
        elseif ($source.EmploymentStatus -eq 'Active' -and $source.DepartmentCode -ne $_.Department) { 'DRIFT: department mismatch' }
        else { 'OK' }
    [pscustomobject]@{
        'Employee ID'  = $_.EmployeeID
        'Display Name' = $_.Name
        'OU'           = $ouLocation
        'Dept Code'    = $_.Department
        'Status'       = if ($_.Enabled) { 'ENABLED' } else { 'DISABLED' }
        'Groups'       = $groups
        'Finding'      = $finding
    }
}
$report | Format-Table -AutoSize -Wrap
$missing = @($hr.Keys | Where-Object { $_ -notin @($Users.EmployeeID) -and $hr[$_].EmploymentStatus -eq 'Active' })
if ($missing.Count) { Write-Host "MISSING: active HR records with no account: $($missing -join ', ')" -ForegroundColor Red }
Write-Host '=== END OF COMPLIANCE VERIFICATION ===' -ForegroundColor Cyan
if ($missing.Count -or @($report | Where-Object Finding -ne 'OK').Count) { exit 2 }
