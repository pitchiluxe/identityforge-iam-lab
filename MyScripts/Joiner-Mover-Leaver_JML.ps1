#Requires -Version 5.1
# ==============================================================================
# ACTIVE DIRECTORY AUTOMATION: JML USER LIFECYCLE SYNC ENGINE
# ==============================================================================
# Source : C:\workspace\hr-source.csv (create it with Create_hr-source.ps1)
# Target : OU=Identities,<your domain>  (sub-OUs HR, Engineering, Finance,
#          Support and Terminated must already exist, plus the groups below)
#
# Preview first:   .\Joiner-Mover-Leaver_JML.ps1 -WhatIf
# Then apply:      .\Joiner-Mover-Leaver_JML.ps1
#
# Real-world rules this script follows:
#   - Joiners are created DISABLED. Enabling is a separate, verified step on
#     the start date (provisioning is not the same as authorization).
#   - Movers lose old department access BEFORE they get new access.
#   - Leavers are disabled first, then stripped of groups, then moved.
#   - One identity failing does not stop the others; every failure is reported.
# ==============================================================================
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$HrSourcePath = 'C:\workspace\hr-source.csv',
    [string]$UpnSuffix = '',
    [string]$ParentOuName = 'Identities'
)
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory

if (-not (Test-Path -LiteralPath $HrSourcePath)) {
    throw "HR source file not found at $HrSourcePath. Run Create_hr-source.ps1 first."
}

$domain = Get-ADDomain
if ([string]::IsNullOrWhiteSpace($UpnSuffix)) { $UpnSuffix = $domain.DNSRoot }
$ParentPath = "OU=$ParentOuName,$($domain.DistinguishedName)"

# Department code -> OU and birthright groups (the entitlement matrix)
$BirthrightMatrix = @{
    'HR'  = @{ OU = 'HR';          Groups = @('AllEmployees', 'HR-Portal') }
    'ENG' = @{ OU = 'Engineering'; Groups = @('AllEmployees', 'Engineering-Tools') }
    'FIN' = @{ OU = 'Finance';     Groups = @('AllEmployees', 'Finance-Read') }
    'SUP' = @{ OU = 'Support';     Groups = @('AllEmployees', 'Support-Tickets') }
}
$managedGroups = @($BirthrightMatrix.Values | ForEach-Object { $_.Groups } | Select-Object -Unique)

$hrRecords = @(Import-Csv -LiteralPath $HrSourcePath)

# Validate the WHOLE feed before touching AD, so a bad row cannot leave a half-run.
$seen = @{}
foreach ($r in $hrRecords) {
    foreach ($field in 'EmployeeId', 'DisplayName', 'DepartmentCode', 'EmploymentStatus') {
        if ([string]::IsNullOrWhiteSpace($r.$field)) { throw "Row is missing $field. Fix the HR file and rerun." }
    }
    if ($seen.ContainsKey($r.EmployeeId)) { throw "Duplicate EmployeeId $($r.EmployeeId) in HR feed." }
    $seen[$r.EmployeeId] = $true
    if (-not $BirthrightMatrix.ContainsKey($r.DepartmentCode)) { throw "Unknown department code '$($r.DepartmentCode)' for $($r.EmployeeId)." }
    if ($r.EmploymentStatus -notin 'Active', 'Terminated') { throw "EmploymentStatus for $($r.EmployeeId) must be Active or Terminated." }
}

$results = New-Object System.Collections.Generic.List[object]
Write-Host "`n[INIT] Evaluating $($hrRecords.Count) HR records against $ParentPath" -ForegroundColor Cyan

foreach ($record in $hrRecords) {
    $empId = $record.EmployeeId
    $name = $record.DisplayName.Trim()
    $dept = $record.DepartmentCode
    $status = $record.EmploymentStatus
    $parts = $name -split '\s+', 2
    $samAccountName = ($name -replace '\s', '').ToLower()
    if ($samAccountName.Length -gt 20) { $samAccountName = $samAccountName.Substring(0, 20) }
    $outcome = 'NoChange'

    Write-Host "`n--------------------------------------------------" -ForegroundColor Gray
    Write-Host "Evaluating: $name [$empId] | Dept: $dept | Status: $status" -ForegroundColor Yellow
    try {
        $adUser = Get-ADUser -Filter "EmployeeID -eq '$empId'" -Properties Department, Enabled, MemberOf -ErrorAction Stop

        # ---------------------------------------------------------------- LEAVER
        if ($status -eq 'Terminated') {
            if ($null -eq $adUser) {
                Write-Host '[SKIPPED] No AD account for this terminated employee.' -ForegroundColor Gray
            } else {
                if ($adUser.Enabled -and $PSCmdlet.ShouldProcess($adUser.SamAccountName, 'Disable account')) {
                    Disable-ADAccount -Identity $adUser -Confirm:$false
                    $outcome = 'Disabled'
                }
                $groups = @(Get-ADPrincipalGroupMembership -Identity $adUser | Where-Object { $_.Name -ne 'Domain Users' })
                foreach ($group in $groups) {
                    if ($PSCmdlet.ShouldProcess("$($adUser.SamAccountName) from $($group.Name)", 'Remove group membership')) {
                        Remove-ADGroupMember -Identity $group -Members $adUser -Confirm:$false
                        Write-Host "   -> [REVOKED] $($group.Name)" -ForegroundColor Red
                        $outcome = 'Deprovisioned'
                    }
                }
                $terminatedOu = "OU=Terminated,$ParentPath"
                if (-not $adUser.DistinguishedName.EndsWith(",$terminatedOu", [StringComparison]::OrdinalIgnoreCase) -and
                    $PSCmdlet.ShouldProcess($adUser.SamAccountName, "Move to $terminatedOu")) {
                    Move-ADObject -Identity $adUser.DistinguishedName -TargetPath $terminatedOu
                    $outcome = 'Deprovisioned'
                }
                Write-Host "[LEAVER] $outcome. Note: disabling does not end existing sessions or cloud tokens." -ForegroundColor Green
            }
        }
        # ---------------------------------------------------------------- JOINER
        elseif ($null -eq $adUser) {
            $collision = Get-ADUser -Filter "SamAccountName -eq '$samAccountName'" -ErrorAction Stop
            if ($collision) { throw "Account name $samAccountName already belongs to someone else. Needs manual naming decision." }
            $mapping = $BirthrightMatrix[$dept]
            $userParams = @{
                SamAccountName        = $samAccountName
                UserPrincipalName     = "$samAccountName@$UpnSuffix"
                Name                  = $name
                DisplayName           = $name
                GivenName             = $parts[0]
                Surname               = $(if ($parts.Count -gt 1) { $parts[1] } else { '' })
                Department            = $dept
                EmployeeID            = $empId
                Path                  = "OU=$($mapping.OU),$ParentPath"
                Enabled               = $false
                ChangePasswordAtLogon = $true
            }
            if ($PSCmdlet.ShouldProcess($samAccountName, "Create disabled user in $($mapping.OU)")) {
                New-ADUser @userParams
                foreach ($groupName in $mapping.Groups) {
                    Add-ADGroupMember -Identity $groupName -Members $samAccountName
                    Write-Host "   -> [GRANTED] $groupName" -ForegroundColor Green
                }
                $outcome = 'CreatedDisabled'
            }
            Write-Host '[JOINER] Account stays disabled until start-date activation with a verified password handoff.' -ForegroundColor Green
        }
        # ----------------------------------------------------------------- MOVER
        elseif ($adUser.Department -ne $dept) {
            Write-Host "[MOVER] $($adUser.Department) -> $dept" -ForegroundColor Cyan
            $newMapping = $BirthrightMatrix[$dept]
            $currentNames = @($adUser.MemberOf | ForEach-Object { (Get-ADGroup -Identity $_).Name })
            # Remove only managed birthright groups the new role does not get. Exception
            # grants approved by an owner are left alone and reported for review.
            foreach ($old in $currentNames) {
                if ($old -in $managedGroups -and $old -notin $newMapping.Groups -and
                    $PSCmdlet.ShouldProcess("$($adUser.SamAccountName) from $old", 'Remove old birthright group')) {
                    Remove-ADGroupMember -Identity $old -Members $adUser -Confirm:$false
                    Write-Host "   -> [REVOKED] $old" -ForegroundColor Red
                }
            }
            foreach ($new in $newMapping.Groups) {
                if ($new -notin $currentNames -and $PSCmdlet.ShouldProcess("$($adUser.SamAccountName) to $new", 'Add new birthright group')) {
                    Add-ADGroupMember -Identity $new -Members $adUser
                    Write-Host "   -> [GRANTED] $new" -ForegroundColor Green
                }
            }
            $others = @($currentNames | Where-Object { $_ -notin $managedGroups })
            if ($others.Count) { Write-Host "   -> [REVIEW] Non-birthright groups kept for owner review: $($others -join ', ')" -ForegroundColor Yellow }
            if ($PSCmdlet.ShouldProcess($adUser.SamAccountName, "Move to $($newMapping.OU) and set Department")) {
                Move-ADObject -Identity $adUser.DistinguishedName -TargetPath "OU=$($newMapping.OU),$ParentPath"
                Set-ADUser -Identity $adUser.ObjectGUID -Department $dept
                $outcome = 'Moved'
            }
        } else {
            Write-Host '[RECONCILED] AD matches HR.' -ForegroundColor Gray
        }
    } catch {
        $outcome = "Failed: $($_.Exception.Message)"
        Write-Host "[FAILED] $empId $($_.Exception.Message)" -ForegroundColor Red
    }
    $results.Add([pscustomobject]@{ EmployeeId = $empId; Name = $name; Status = $status; Outcome = $outcome })
}

Write-Host "`n==================================================" -ForegroundColor Gray
$results | Format-Table -AutoSize
$failed = @($results | Where-Object { $_.Outcome -like 'Failed*' })
if ($failed.Count) {
    Write-Host "[INCOMPLETE] $($failed.Count) identities failed. Fix the cause and rerun; completed work is not repeated." -ForegroundColor Red
    exit 2
}
Write-Host '[DONE] Run Verification_JML.ps1 to confirm the after-state independently.' -ForegroundColor Green
