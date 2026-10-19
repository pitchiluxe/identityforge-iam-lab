$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '..\IamLifecycle.psm1') -Force
$script:count=0
function Assert($ok,$message){if(-not $ok){throw $message};$script:count++}
function MustThrow([scriptblock]$action,$message){$thrown=$false;try{& $action | Out-Null}catch{$thrown=$true};Assert $thrown $message}
$base='OU=IAM-Training,DC=iamlab,DC=test'
function Row($id='LAB-001',$sam='lab-alex',$dept='ENG',$status='Active') {
    [pscustomobject]@{EmployeeID=$id;SamAccountName=$sam;GivenName='Alex';Surname='Morgan';DepartmentCode=$dept;EmploymentStatus=$status}
}
function User($groups=@('LAB-AllEmployees','LAB-Support-Tickets')) {
    [pscustomobject]@{EmployeeID='LAB-001';SamAccountName='lab-alex';DistinguishedName="CN=LAB Alex,OU=Support,$base";ObjectGUID='11111111-1111-1111-1111-111111111111';Department='Support';Enabled=$true;AccountExpirationDate=$null;Groups=$groups;ExternalGroups=@();PrimaryGroupID=513;Protected=$false}
}
$plan=@(New-IamLifecyclePlan -Rows @((Row)) -Users @((User)) -LabDn $base -UpnSuffix 'iamlab.test')
$remove=@($plan | Where-Object Action -eq 'RemoveGroup')
Assert ($remove.Count -eq 1 -and $remove[0].Value -eq 'LAB-Support-Tickets') 'Mover must remove old birthright access'
Assert (([array]::IndexOf($plan,$remove[0])) -lt ([array]::IndexOf($plan,(@($plan|Where-Object Action -eq 'AddGroup')[0])))) 'Removal must precede grants'
MustThrow {New-IamLifecyclePlan -Rows @((Row),(Row)) -Users @() -LabDn $base -UpnSuffix 'iamlab.test'} 'Duplicate employee IDs must fail'
MustThrow {New-IamLifecyclePlan -Rows @((Row -dept 'UNKNOWN')) -Users @() -LabDn $base -UpnSuffix 'iamlab.test'} 'Unknown departments must fail'
$collision=User;$collision.EmployeeID='LAB-999'
MustThrow {New-IamLifecyclePlan -Rows @((Row)) -Users @($collision) -LabDn $base -UpnSuffix 'iamlab.test'} 'Account collision must fail'
$outside=User;$outside.DistinguishedName='CN=Alex,CN=Users,DC=iamlab,DC=test'
MustThrow {New-IamLifecyclePlan -Rows @((Row)) -Users @($outside) -LabDn $base -UpnSuffix 'iamlab.test'} 'Out-of-scope users must fail'
$exception=User @('LAB-AllEmployees','LAB-Support-Tickets','LAB-Finance-Read','LAB-Approved-Exception')
$p=@(New-IamLifecyclePlan -Rows @((Row)) -Users @($exception) -LabDn $base -UpnSuffix 'iamlab.test')
Assert (@($p|Where-Object {$_.Action -eq 'RemoveGroup' -and $_.Value -eq 'LAB-Approved-Exception'}).Count -eq 0) 'Movers must preserve exceptional access'
$p=@(New-IamLifecyclePlan -Rows @((Row)) -Users @() -LabDn $base -UpnSuffix 'iamlab.test')
Assert ($p[0].Action -eq 'CreateDisabled') 'Joiners must be created disabled'
Assert (@($p|Where-Object Action -eq 'Enable').Count -eq 0) 'No implicit enable operation'
$leaver=User @('LAB-AllEmployees','LAB-Approved-Exception');$leaver.ExternalGroups=@('CN=Outside,CN=Users,DC=iamlab,DC=test')
$p=@(New-IamLifecyclePlan -Rows @((Row -status 'Terminated')) -Users @($leaver) -LabDn $base -UpnSuffix 'iamlab.test')
Assert ($p[0].Action -eq 'Disable') 'Leavers must disable before other changes'
Assert (@($p|Where-Object {$_.Action -eq 'RemoveGroup' -and $_.Value -eq 'LAB-Approved-Exception'}).Count -eq 1) 'Leavers must remove direct exceptional LAB grants'
Assert (@($p|Where-Object Action -eq 'ManualFollowUp').Count -gt 0) 'External grants must not be silently ignored'
$done=User @('LAB-AllEmployees','LAB-Engineering-Tools');$done.Department='Engineering';$done.DistinguishedName="CN=LAB Alex,OU=Engineering,$base"
$p=@(New-IamLifecyclePlan -Rows @((Row)) -Users @($done) -LabDn $base -UpnSuffix 'iamlab.test')
Assert ($p.Count -eq 0) 'Reconciliation must converge on no operations'
$protected=User;$protected.Protected=$true
MustThrow {New-IamLifecyclePlan -Rows @((Row)) -Users @($protected) -LabDn $base -UpnSuffix 'iamlab.test'} 'Protected identities must fail preflight'
$testDir=Join-Path ([IO.Path]::GetTempPath()) ('identityforge-tests-'+[guid]::NewGuid())
New-Item -ItemType Directory -Path $testDir | Out-Null
try {
    $script:writes=0
    $one=@([pscustomobject]@{EmployeeID='LAB-001';SamAccountName='lab-alex';Action='Disable';Value='';UserGuid='x'},[pscustomobject]@{EmployeeID='LAB-001';SamAccountName='lab-alex';Action='Move';Value='target';UserGuid='x'})
    $r=Invoke-IamPlan -Plan $one -AuditPath (Join-Path $testDir 'preview.jsonl') -ApplyOperation {$script:writes++}
    Assert ($script:writes -eq 0 -and $r[0].Status -eq 'Planned') 'Preview must never invoke writes'
    $r=Invoke-IamPlan -Plan $one -Apply -AuditPath (Join-Path $testDir 'failure.jsonl') -ApplyOperation {$script:writes++;throw 'Injected directory failure'}
    Assert ($script:writes -eq 1) 'Failure must prevent subsequent operations for identity'
    Assert ($r[0].Status -eq 'Failed') 'Failure must remain visible'
    $audit=@(Get-Content (Join-Path $testDir 'failure.jsonl')|ForEach-Object{$_|ConvertFrom-Json})
    Assert ($audit.Event -contains 'Intent' -and $audit.Event -contains 'Failed') 'Audit must retain intent and failure'
    $script:writes=0
    MustThrow {Invoke-IamPlan -Plan $one -Apply -AuditPath (Join-Path $testDir 'missing\audit.jsonl') -ApplyOperation {$script:writes++}} 'Unwritable audit destination must fail closed'
    Assert ($script:writes -eq 0) 'Audit failure must precede mutation'
    $script:enabled=$false;$script:contained=$false
    MustThrow {
        Invoke-IamActivation -ApplyOperation {
            param($action)
            if($action -eq 'Enable'){$script:enabled=$true}
            if($action -eq 'Disable'){$script:enabled=$false;$script:contained=$true}
        } -WriteAudit {
            param($eventName)
            if($eventName -ne 'ActivationIntent'){throw 'Injected audit failure after enable'}
        }
    } 'Activation audit failure must propagate'
    Assert ($script:contained -and -not $script:enabled) 'Containment must run even if failure audit is unavailable'
} finally {
    $resolved=[IO.Path]::GetFullPath($testDir)
    if($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'identityforge-tests-*'){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
Write-Host "PASS: $script:count lifecycle assertions (offline; no AD calls)"
