[CmdletBinding(SupportsShouldProcess=$true,ConfirmImpact='Medium')]
param(
    [Parameter(Mandatory=$true)][string]$Server,
    [Parameter(Mandatory=$true)][string]$ExpectedDomain,
    [Parameter(Mandatory=$true)][string]$CsvPath,
    [switch]$Apply,
    [string]$OutputRoot=''
)
$ErrorActionPreference='Stop'
if([string]::IsNullOrWhiteSpace($OutputRoot)){$OutputRoot=Join-Path $PSScriptRoot '..\..\evidence\ad-lifecycle'}
Set-StrictMode -Version 2.0
Import-Module (Join-Path $PSScriptRoot 'IamLifecycle.psm1') -Force
$rows=@(Import-Csv -LiteralPath $CsvPath)
# Validate HR syntax even before reading the directory.
$null=New-IamLifecyclePlan -Rows $rows -Users @() -LabDn 'OU=IAM-Training,DC=preflight,DC=test' -UpnSuffix 'preflight.test'
Import-Module ActiveDirectory -ErrorAction Stop
$domain=Get-ADDomain -Server $Server
if($domain.DNSRoot -ne $ExpectedDomain){throw 'ExpectedDomain does not match the connected domain.'}
$dc=Get-ADDomainController -Identity $Server -Server $Server
if($dc.IsReadOnly){throw 'Select a writable domain controller.'}
$lab='OU=IAM-Training,'+$domain.DistinguishedName
Get-ADOrganizationalUnit -Identity $lab -Server $Server | Out-Null
foreach($ou in @('HR','Engineering','Finance','Support','Terminated','Groups')){
    Get-ADOrganizationalUnit -Identity "OU=$ou,$lab" -Server $Server | Out-Null
}
$labGroups=@(Get-ADGroup -SearchBase "OU=Groups,$lab" -SearchScope OneLevel -Filter * -Properties MemberOf -Server $Server)
$groupByDn=@{};$groupByName=@{}
foreach($g in $labGroups){
    if($g.SamAccountName -like 'LAB-*' -and $g.GroupCategory -eq 'Security' -and $g.GroupScope -eq 'Global'){
        $groupByDn[$g.DistinguishedName]=$g.SamAccountName;$groupByName[$g.SamAccountName]=$g
    }
}
foreach($m in (Get-IamBirthright).Values){foreach($name in $m.Groups){if(-not $groupByName.ContainsKey($name)){throw "Missing expected global security group: $name"}}}
foreach($g in $groupByName.Values){foreach($parent in @($g.MemberOf)){
    if(-not $groupByDn.ContainsKey($parent)){throw "Lab group is nested outside approved lab groups: $($g.Name). Review inheritance before proceeding."}
}}
$runId=[guid]::NewGuid().ToString()
New-Item -ItemType Directory -Path $OutputRoot -Force -WhatIf:$false | Out-Null
$output=Join-Path $OutputRoot $runId
New-Item -ItemType Directory -Path $output -WhatIf:$false | Out-Null
$lockPath=Join-Path $OutputRoot '.lifecycle.lock'
$lock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {
    # Domain-wide read is intentional: duplicate EmployeeIDs and SAM names outside the lab must be detected.
    $all=@(Get-ADUser -Filter * -SearchBase $domain.DistinguishedName -Properties EmployeeID,Department,MemberOf,AdminCount,PrimaryGroupID,AccountExpirationDate,GivenName,Surname,UserPrincipalName -Server $Server)
    $snapshot=@(foreach($u in $all){
        $inside=@();$outside=@()
        foreach($dn in @($u.MemberOf)){
            if($groupByDn.ContainsKey($dn)){$inside+=($groupByDn[$dn])}else{$outside+=$dn}
        }
        [pscustomobject]@{EmployeeID=$u.EmployeeID;SamAccountName=$u.SamAccountName;DistinguishedName=$u.DistinguishedName;ObjectGUID=[string]$u.ObjectGUID;Department=$u.Department;Enabled=$u.Enabled;AccountExpirationDate=$u.AccountExpirationDate;Groups=$inside;ExternalGroups=$outside;PrimaryGroupID=$u.PrimaryGroupID;Protected=($u.AdminCount -eq 1);GivenName=$u.GivenName;Surname=$u.Surname;UserPrincipalName=$u.UserPrincipalName}
    })
    $plan=@(New-IamLifecyclePlan -Rows $rows -Users $snapshot -LabDn $lab -UpnSuffix $domain.DNSRoot)
    $plan | Export-Csv -LiteralPath (Join-Path $output 'plan.csv') -NoTypeInformation -Encoding UTF8 -WhatIf:$false
    @($snapshot|Where-Object {$rows.EmployeeID -contains $_.EmployeeID}) | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $output 'before.json') -Encoding UTF8 -WhatIf:$false
    $plan | Select-Object EmployeeID,Action,Value | Format-Table -Wrap -AutoSize
    $caller=$PSCmdlet
    $applyOperation={
        param($op)
        if(-not $caller.ShouldProcess("$ExpectedDomain/$($op.SamAccountName)","$($op.Action): $($op.Value)")){throw 'Operator declined the operation.'}
        $u=if($op.UserGuid){Get-ADUser -Identity ([guid]$op.UserGuid) -Properties EmployeeID,AdminCount,PrimaryGroupID -Server $Server}else{
            Get-ADUser -Filter "SamAccountName -eq '$($op.SamAccountName)'" -Properties EmployeeID,AdminCount,PrimaryGroupID -Server $Server
        }
        if($u){
            if($u.EmployeeID -ne $op.EmployeeID -or -not $u.DistinguishedName.EndsWith(','+$lab,[StringComparison]::OrdinalIgnoreCase) -or $u.AdminCount -eq 1 -or $u.PrimaryGroupID -ne 513){throw 'Identity changed since planning; stopped before mutation.'}
        }elseif($op.Action -ne 'CreateDisabled'){throw 'Identity missing during apply.'}
        switch($op.Action){
            'CreateDisabled' {
                if($u){throw 'Joiner account appeared after preflight; rerun reconciliation.'}
                New-ADUser -Name $op.SamAccountName -SamAccountName $op.SamAccountName -GivenName $op.GivenName -Surname $op.Surname -DisplayName ($op.GivenName+' '+$op.Surname) -EmployeeID $op.EmployeeID -Department $op.Department -UserPrincipalName $op.UserPrincipalName -Path $op.Value -Enabled $false -Description 'IdentityForge synthetic training account' -Server $Server
            }
            'SetAttributes' {Set-ADUser -Identity $u.ObjectGUID -EmployeeID $op.EmployeeID -Department $op.Department -GivenName $op.GivenName -Surname $op.Surname -DisplayName ($op.GivenName+' '+$op.Surname) -UserPrincipalName $op.UserPrincipalName -Server $Server}
            'RemoveGroup' {
                if(-not $groupByName.ContainsKey($op.Value)){throw 'Refusing unmanaged group mutation.'}
                Remove-ADGroupMember -Identity $groupByName[$op.Value].ObjectGUID -Members $u.ObjectGUID -Confirm:$false -Server $Server
            }
            'AddGroup' {
                if(-not $groupByName.ContainsKey($op.Value)){throw 'Refusing unmanaged group mutation.'}
                Add-ADGroupMember -Identity $groupByName[$op.Value].ObjectGUID -Members $u.ObjectGUID -Server $Server
            }
            'Disable' {Disable-ADAccount -Identity $u.ObjectGUID -Server $Server}
            'Expire' {Set-ADAccountExpiration -Identity $u.ObjectGUID -DateTime ([datetime]::Parse($op.Value).ToUniversalTime()) -Server $Server}
            'Move' {
                if($op.Value -notin @('HR','Engineering','Finance','Support','Terminated'|ForEach-Object{"OU=$_,$lab"})){throw 'Refusing unexpected target OU.'}
                Move-ADObject -Identity $u.ObjectGUID -TargetPath $op.Value -Server $Server
            }
            default {throw 'Unsupported operation.'}
        }
    }.GetNewClosure()
    $results=@(Invoke-IamPlan -Plan $plan -Apply:($Apply -and -not $WhatIfPreference) -AuditPath (Join-Path $output 'audit.jsonl') -ApplyOperation $applyOperation -RunId $runId)
    # Re-read AD and produce a fresh remaining plan. Applied is not the same as verified.
    $after=@(foreach($r in $rows){
        $u=Get-ADUser -Filter "EmployeeID -eq '$($r.EmployeeID)'" -Properties EmployeeID,Department,MemberOf,AdminCount,PrimaryGroupID,AccountExpirationDate,GivenName,Surname,UserPrincipalName -Server $Server
        if($u){
            $inside=@();$outside=@();foreach($dn in @($u.MemberOf)){if($groupByDn.ContainsKey($dn)){$inside+=$groupByDn[$dn]}else{$outside+=$dn}}
            [pscustomobject]@{EmployeeID=$u.EmployeeID;SamAccountName=$u.SamAccountName;DistinguishedName=$u.DistinguishedName;ObjectGUID=[string]$u.ObjectGUID;Department=$u.Department;Enabled=$u.Enabled;AccountExpirationDate=$u.AccountExpirationDate;Groups=$inside;ExternalGroups=$outside;PrimaryGroupID=$u.PrimaryGroupID;Protected=($u.AdminCount -eq 1);GivenName=$u.GivenName;Surname=$u.Surname;UserPrincipalName=$u.UserPrincipalName}
        }
    })
    $after | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $output 'after.json') -Encoding UTF8 -WhatIf:$false
    $remaining=@(New-IamLifecyclePlan -Rows $rows -Users $after -LabDn $lab -UpnSuffix $domain.DNSRoot)
    $remaining | Export-Csv (Join-Path $output 'remaining-plan.csv') -NoTypeInformation -Encoding UTF8 -WhatIf:$false
    $summary=@(foreach($r in $rows){
        $result=@($results|Where-Object EmployeeID -eq $r.EmployeeID)
        $pending=@($remaining|Where-Object EmployeeID -eq $r.EmployeeID)
        $states=@($result|ForEach-Object{$_.Status})
        $state=if(-not $Apply -or $WhatIfPreference){'Preview'}elseif($states -contains 'Failed'){'Failed'}elseif($pending.Count){'FollowUpRequired'}else{'Verified'}
        [pscustomobject]@{EmployeeID=$r.EmployeeID;Status=$state;RemainingOperations=$pending.Count;Detail=(@($result|ForEach-Object{$_.Detail}) -join '; ')}
    })
    $summary | Export-Csv (Join-Path $output 'summary.csv') -NoTypeInformation -Encoding UTF8 -WhatIf:$false
    $summary | Format-Table -Wrap
    Write-Host "Evidence: $output"
    if($summary.Status -contains 'Failed' -or $summary.Status -contains 'FollowUpRequired'){exit 2}
}finally{
    $lock.Dispose()
    # Keep the empty lock file; handle locking, not file existence, controls concurrency.
}
