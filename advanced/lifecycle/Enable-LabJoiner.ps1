[CmdletBinding(SupportsShouldProcess=$true,ConfirmImpact='High')]
param(
    [Parameter(Mandatory=$true)][string]$Server,
    [Parameter(Mandatory=$true)][string]$ExpectedDomain,
    [Parameter(Mandatory=$true)][ValidatePattern('^LAB-[0-9]{3}$')][string]$EmployeeID,
    [Parameter(Mandatory=$true)][ValidatePattern('^CHG-LAB-[0-9]+$')][string]$Ticket,
    [switch]$Apply
)
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
Import-Module (Join-Path $PSScriptRoot 'IamLifecycle.psm1') -Force
$domain=Get-ADDomain -Server $Server
if($domain.DNSRoot -ne $ExpectedDomain){throw 'ExpectedDomain mismatch.'}
$lab='OU=IAM-Training,'+$domain.DistinguishedName
$users=@(Get-ADUser -Filter "EmployeeID -eq '$EmployeeID'" -Properties EmployeeID,Department,MemberOf,AdminCount,AccountExpirationDate,PrimaryGroupID -Server $Server)
if($users.Count -ne 1){throw 'Expected exactly one EmployeeID match.'}
$u=$users[0]
if(-not $u.DistinguishedName.EndsWith(','+$lab,[StringComparison]::OrdinalIgnoreCase) -or $u.SamAccountName -notlike 'lab-*' -or $u.AdminCount -eq 1 -or $u.PrimaryGroupID -ne 513){throw 'Unsafe activation target.'}
if($u.DistinguishedName -like "*,OU=Terminated,$lab" -or $u.AccountExpirationDate){throw 'Rehire/expired account needs a separate review; this helper is for initial activation only.'}
$mapping=Get-IamBirthright
$matched=@($mapping.Values|Where-Object OU -eq $u.Department)
if($matched.Count -ne 1){throw 'Unknown department.'}
if(-not $u.DistinguishedName.EndsWith(',OU='+$u.Department+','+$lab,[StringComparison]::OrdinalIgnoreCase)){throw 'Department and OU differ.'}
$expectedDns=@()
foreach($name in $matched[0].Groups){
    $g=Get-ADGroup -Identity $name -Properties MemberOf -Server $Server
    if(($g.DistinguishedName -split ',',2)[1] -ne "OU=Groups,$lab" -or $g.MemberOf.Count -gt 0 -or $g.GroupCategory -ne 'Security' -or $g.GroupScope -ne 'Global'){throw 'Activation requires global security groups directly in the lab Groups OU, with no nesting.'}
    if(@($u.MemberOf) -notcontains $g.DistinguishedName){throw "Missing required birthright group: $name"}
    $expectedDns+=$g.DistinguishedName
}
if(@($u.MemberOf|Where-Object {$expectedDns -notcontains $_}).Count){throw 'Unexpected direct memberships on initial joiner; review before activation.'}
if($u.Enabled){Write-Host 'Already enabled; no password or account change made.';return}
Write-Host "Initial activation candidate: $EmployeeID / $($u.SamAccountName) / $Ticket"
if(-not $Apply){Write-Host 'Preview only. Use -Apply after verifying HR status, birthright access and ticket approval.';return}
if(-not $PSCmdlet.ShouldProcess($u.SamAccountName,'Set password, require change at next sign-in, enable initial joiner')){return}
$dir=Join-Path $PSScriptRoot '..\..\evidence\ad-activation'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$file=Join-Path $dir (([guid]::NewGuid().ToString())+'.jsonl')
$password=Read-Host 'Enter a unique lab password (not logged)' -AsSecureString
try {
    $applyOperation={param($action)
        switch($action){
            'ResetPassword'{Set-ADAccountPassword -Identity $u.ObjectGUID -Reset -NewPassword $password -Server $Server}
            'RequirePasswordChange'{Set-ADUser -Identity $u.ObjectGUID -ChangePasswordAtLogon $true -Server $Server}
            'Enable'{
                $fresh=Get-ADUser -Identity $u.ObjectGUID -Properties MemberOf,AdminCount,EmployeeID,AccountExpirationDate -Server $Server
                if($fresh.EmployeeID -ne $EmployeeID -or $fresh.AdminCount -eq 1 -or $fresh.AccountExpirationDate -or $fresh.DistinguishedName -ne $u.DistinguishedName -or @(Compare-Object @($fresh.MemberOf) $expectedDns).Count){throw 'Identity or memberships changed before activation.'}
                Enable-ADAccount -Identity $u.ObjectGUID -Server $Server
            }
            'Verify'{if(-not(Get-ADUser -Identity $u.ObjectGUID -Server $Server).Enabled){throw 'Activation did not verify.'}}
            'Disable'{Disable-ADAccount -Identity $u.ObjectGUID -Server $Server}
        }
    }.GetNewClosure()
    $writeAudit={param($eventName)
        [IO.File]::AppendAllText($file,(([ordered]@{Utc=[datetime]::UtcNow.ToString('o');EmployeeID=$EmployeeID;Ticket=$Ticket;Event=$eventName}|ConvertTo-Json -Compress)+[Environment]::NewLine))
    }.GetNewClosure()
    Invoke-IamActivation -ApplyOperation $applyOperation -WriteAudit $writeAudit
    Write-Host "Enabled and verified. Evidence: $file"
}finally{if($password){$password.Dispose()}}
