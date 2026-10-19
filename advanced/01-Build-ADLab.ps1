[CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='Medium')]
param(
    [Parameter(Mandatory=$true)][string]$Server,
    [Parameter(Mandatory=$true)][string]$ExpectedDomain
)
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory -ErrorAction Stop
$domain=Get-ADDomain -Server $Server
if($domain.DNSRoot -ne $ExpectedDomain){throw 'Connected domain does not match ExpectedDomain.'}
$base=$domain.DistinguishedName
$lab="OU=IAM-Training,$base"
Write-Host "Target: $($domain.DNSRoot) on $Server"
Write-Host "Scope: $lab"

# Read actual containers once. Planned parents may not exist during -WhatIf.
$existingOus=@(Get-ADOrganizationalUnit -Filter * -Server $Server | Select-Object -ExpandProperty DistinguishedName)
foreach($spec in @(
    @{Name='IAM-Training';Path=$base},
    @{Name='HR';Path=$lab},
    @{Name='Engineering';Path=$lab},
    @{Name='Finance';Path=$lab},
    @{Name='Support';Path=$lab},
    @{Name='Terminated';Path=$lab},
    @{Name='Groups';Path=$lab}
)) {
    $dn="OU=$($spec.Name),$($spec.Path)"
    if($existingOus -contains $dn){continue}
    if($PSCmdlet.ShouldProcess($dn,'Create protected training OU')) {
        New-ADOrganizationalUnit -Name $spec.Name -Path $spec.Path -ProtectedFromAccidentalDeletion $true -Server $Server
    }
}
$groupNames=@('LAB-AllEmployees','LAB-HR-Portal','LAB-Engineering-Tools','LAB-Finance-Read','LAB-Support-Tickets','LAB-Payment-Creator','LAB-Payment-Approver')
foreach($name in $groupNames){
    $found=Get-ADGroup -Filter "SamAccountName -eq '$name'" -Server $Server
    if($found){
        if($found.DistinguishedName -notlike "*,OU=Groups,$lab"){throw "Name collision outside lab: $name"}
        if($found.GroupCategory -ne 'Security' -or $found.GroupScope -ne 'Global'){throw "Unexpected existing group type: $name"}
        continue
    }
    if($PSCmdlet.ShouldProcess($name,'Create global security group inside lab')){
        New-ADGroup -Name $name -SamAccountName $name -GroupCategory Security -GroupScope Global -Path "OU=Groups,$lab" -Description 'Synthetic IAM training access; no resource permissions assigned' -Server $Server
    }
}
# Disabled seed identity: no password, sign-in access, or privileged memberships.
$user=Get-ADUser -Filter "SamAccountName -eq 'lab-alex'" -Server $Server
if($user){
    if($user.DistinguishedName -notlike "*,OU=Support,$lab"){throw 'Existing lab-alex is outside expected training OU.'}
}elseif($PSCmdlet.ShouldProcess('lab-alex','Create disabled synthetic AD user')){
    New-ADUser -Name 'LAB Alex Morgan' -SamAccountName 'lab-alex' -GivenName 'Alex' -Surname 'Morgan' -DisplayName 'LAB Alex Morgan' -UserPrincipalName "lab-alex@$($domain.DNSRoot)" -EmployeeID 'LAB-001' -Department 'Support' -Path "OU=Support,$lab" -Enabled $false -Description 'Synthetic training identity; disabled by design' -Server $Server
}
if(-not $WhatIfPreference){
    Get-ADOrganizationalUnit -SearchBase $lab -Filter * -Server $Server | Select-Object Name,DistinguishedName
    Get-ADGroup -SearchBase $lab -Filter * -Server $Server | Select-Object Name,GroupCategory,GroupScope
    Get-ADUser -Identity 'lab-alex' -Properties EmployeeID,Department -Server $Server | Select-Object SamAccountName,Enabled,EmployeeID,Department,DistinguishedName
}
