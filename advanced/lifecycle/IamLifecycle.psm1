Set-StrictMode -Version 2.0
function Get-IamBirthright {
    @{
        HR=@{OU='HR';Groups=@('LAB-AllEmployees','LAB-HR-Portal')}
        ENG=@{OU='Engineering';Groups=@('LAB-AllEmployees','LAB-Engineering-Tools')}
        FIN=@{OU='Finance';Groups=@('LAB-AllEmployees','LAB-Finance-Read')}
        SUP=@{OU='Support';Groups=@('LAB-AllEmployees','LAB-Support-Tickets')}
    }
}
function New-IamLifecyclePlan {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][AllowEmptyCollection()][object[]]$Rows,
        [AllowEmptyCollection()][object[]]$Users=@(),
        [Parameter(Mandatory=$true)][string]$LabDn,
        [Parameter(Mandatory=$true)][string]$UpnSuffix,
        [datetime]$NowUtc=[datetime]::UtcNow)
    if($LabDn -notmatch '^OU=IAM-Training,DC='){throw 'Only the fixed IAM-Training tree is supported.'}
    if($UpnSuffix -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'){throw 'Invalid UPN suffix.'}
    if(-not $Rows.Count){throw 'The HR feed is empty.'}
    $mapping=Get-IamBirthright
    $managed=@($mapping.Values | ForEach-Object {$_.Groups} | Select-Object -Unique)
    $ids=@{};$names=@{}
    # Validate the entire batch before emitting even the first operation.
    foreach($r in $Rows){
        foreach($field in @('EmployeeID','SamAccountName','GivenName','Surname','DepartmentCode','EmploymentStatus')){
            if(-not $r.PSObject.Properties[$field] -or [string]::IsNullOrWhiteSpace([string]$r.$field)){throw "Missing required HR field: $field"}
        }
        if($r.EmployeeID -cnotmatch '^LAB-[0-9]{3}$'){throw 'EmployeeID must have the LAB-001 format.'}
        if($r.SamAccountName -cnotmatch '^lab-[a-z0-9-]{1,16}$'){throw 'SamAccountName must be a lowercase lab- account, at most 20 characters.'}
        if($ids.ContainsKey($r.EmployeeID) -or $names.ContainsKey($r.SamAccountName)){throw 'Duplicate EmployeeID or SamAccountName in HR feed.'}
        $ids[$r.EmployeeID]=$true;$names[$r.SamAccountName]=$true
        if(-not $mapping.ContainsKey([string]$r.DepartmentCode)){throw "Unknown department: $($r.DepartmentCode)"}
        if($r.EmploymentStatus -cnotin @('Active','Terminated')){throw 'EmploymentStatus must be Active or Terminated.'}
        foreach($field in @('GivenName','Surname')){if(([string]$r.$field).Length -gt 64 -or $r.$field -match '[\x00-\x1F]'){throw 'Invalid HR name.'}}
        $matches=@($Users | Where-Object EmployeeID -eq $r.EmployeeID)
        if($matches.Count -gt 1){throw "Duplicate directory EmployeeID: $($r.EmployeeID)"}
        $collision=@($Users | Where-Object SamAccountName -eq $r.SamAccountName)
        if($matches.Count -eq 0 -and $collision.Count){throw "Account-name collision: $($r.SamAccountName)"}
        if($matches.Count){
            $u=$matches[0]
            if($u.SamAccountName -ne $r.SamAccountName){throw 'EmployeeID/account-name mismatch; renames require separate approval.'}
            if(-not $u.DistinguishedName.EndsWith(','+$LabDn,[StringComparison]::OrdinalIgnoreCase)){throw 'Matched identity is outside IAM-Training.'}
            if($u.Protected -or $u.PrimaryGroupID -ne 513){throw 'Protected account or nonstandard primary group requires manual review.'}
        }
    }
    $ops=New-Object System.Collections.Generic.List[object]
    foreach($r in $Rows){
        $m=$mapping[[string]$r.DepartmentCode]
        $u=@($Users|Where-Object EmployeeID -eq $r.EmployeeID)
        $current=if($u.Count){$u[0]}else{$null}
        $guid=if($current){[string]$current.ObjectGUID}else{''}
        $upn=$r.SamAccountName+'@'+$UpnSuffix
        $rowOps=New-Object System.Collections.Generic.List[object]
        if($r.EmploymentStatus -eq 'Terminated'){
            if(-not $current){continue}
            if($current.Enabled){$rowOps.Add(@{Action='Disable';Value=''})}
            if(-not $current.AccountExpirationDate -or ([datetime]$current.AccountExpirationDate).ToUniversalTime() -gt $NowUtc.ToUniversalTime()){
                $rowOps.Add(@{Action='Expire';Value=$NowUtc.ToUniversalTime().ToString('o')})
            }
            foreach($g in @($current.Groups|Sort-Object -Unique)){$rowOps.Add(@{Action='RemoveGroup';Value=$g})}
            $target='OU=Terminated,'+$LabDn
            if(-not $current.DistinguishedName.EndsWith(','+$target,[StringComparison]::OrdinalIgnoreCase)){$rowOps.Add(@{Action='Move';Value=$target})}
            foreach($g in $current.ExternalGroups){$rowOps.Add(@{Action='ManualFollowUp';Value="External direct membership remains: $g"})}
        }else{
            $target='OU='+$m.OU+','+$LabDn
            if(-not $current){
                $rowOps.Add(@{Action='CreateDisabled';Value=$target})
                $groups=@()
            }else{
                $groups=@($current.Groups)
                # Fail closed on an implicit rehire or an account still being onboarded.
                if(-not $current.Enabled){$rowOps.Add(@{Action='ActivationReview';Value='Account remains disabled; separate verified activation required.'})}
                # Remove all obsolete managed birthright grants before any new grants.
                foreach($g in @($groups|Sort-Object -Unique)){
                    if($managed -contains $g -and $m.Groups -notcontains $g){$rowOps.Add(@{Action='RemoveGroup';Value=$g})}
                }
                $attributesChanged=($current.Department -ne $m.OU)
                foreach($field in @('GivenName','Surname')){
                    if($current.PSObject.Properties[$field] -and $current.$field -ne $r.$field){$attributesChanged=$true}
                }
                if($current.PSObject.Properties['UserPrincipalName'] -and $current.UserPrincipalName -ne $upn){$attributesChanged=$true}
                if($attributesChanged){$rowOps.Add(@{Action='SetAttributes';Value=$m.OU})}
                if(-not $current.DistinguishedName.EndsWith(','+$target,[StringComparison]::OrdinalIgnoreCase)){$rowOps.Add(@{Action='Move';Value=$target})}
            }
            foreach($g in $m.Groups){if($groups -notcontains $g){$rowOps.Add(@{Action='AddGroup';Value=$g})}}
        }
        foreach($o in $rowOps){
            $ops.Add([pscustomobject][ordered]@{EmployeeID=$r.EmployeeID;SamAccountName=$r.SamAccountName;UserGuid=$guid;Action=$o.Action;Value=$o.Value;GivenName=$r.GivenName;Surname=$r.Surname;Department=$m.OU;UserPrincipalName=$upn})
        }
    }
    $ops.ToArray()
}
function Write-IamAudit {
    param([string]$Path,[string]$RunId,[string]$Event,[object]$Operation,[string]$Detail='')
    $entry=[ordered]@{Utc=[datetime]::UtcNow.ToString('o');RunId=$RunId;Event=$Event;Operation=$Operation;Detail=$Detail}
    [IO.File]::AppendAllText($Path,($entry|ConvertTo-Json -Depth 6 -Compress)+[Environment]::NewLine,(New-Object Text.UTF8Encoding($false)))
}
function Invoke-IamPlan {
    [CmdletBinding()]
    param([AllowEmptyCollection()][object[]]$Plan=@(),[switch]$Apply,
        [Parameter(Mandatory=$true)][string]$AuditPath,
        [Parameter(Mandatory=$true)][scriptblock]$ApplyOperation,
        [string]$RunId=([guid]::NewGuid().ToString()))
    Write-IamAudit $AuditPath $RunId 'RunStarted' $null $(if($Apply){'Apply'}else{'Preview'})
    foreach($batch in @($Plan|Group-Object EmployeeID)){
        $status=if($Apply){'Applied'}else{'Planned'};$detail='';$followup=$false
        foreach($op in $batch.Group){
            if(-not $Apply){Write-IamAudit $AuditPath $RunId 'Planned' $op;continue}
            if($op.Action -in @('ManualFollowUp','ActivationReview')){
                Write-IamAudit $AuditPath $RunId 'FollowUpRequired' $op $op.Value
                $followup=$true;continue
            }
            Write-IamAudit $AuditPath $RunId 'Intent' $op
            $operationError=$null
            try { & $ApplyOperation $op | Out-Null } catch {$operationError=$_}
            if($operationError){
                $status='Failed';$detail=$operationError.Exception.Message
                Write-IamAudit $AuditPath $RunId 'Failed' $op $detail
                break
            }
            # Audit failures escape instead of being misreported as directory failures.
            Write-IamAudit $AuditPath $RunId 'Succeeded' $op
        }
        if($status -eq 'Applied' -and $followup){$status='FollowUpRequired';$detail='Account activation or external access needs a separate owner decision.'}
        [pscustomobject]@{EmployeeID=$batch.Name;Status=$status;Detail=$detail}
    }
    Write-IamAudit $AuditPath $RunId 'RunFinished' $null
}
function Invoke-IamActivation {
    param([Parameter(Mandatory=$true)][scriptblock]$ApplyOperation,[Parameter(Mandatory=$true)][scriptblock]$WriteAudit)
    & $WriteAudit 'ActivationIntent'
    try{
        foreach($action in @('ResetPassword','RequirePasswordChange','Enable','Verify')){& $ApplyOperation $action|Out-Null}
        & $WriteAudit 'ActivationVerified'
    }catch{
        $original=$_;$containmentError=$null
        # Account containment must never depend on the availability of logging.
        try{& $ApplyOperation 'Disable'|Out-Null}catch{$containmentError=$_}
        try{& $WriteAudit 'ActivationFailed'}catch{}
        try{& $WriteAudit $(if($containmentError){'CRITICAL_ContainmentFailed'}else{'FailureContainedDisabled'})}catch{}
        if($containmentError){throw [InvalidOperationException]::new('Activation failed AND account containment failed. Escalate immediately.',$containmentError.Exception)}
        throw $original
    }
}
Export-ModuleMember -Function Get-IamBirthright,New-IamLifecyclePlan,Invoke-IamPlan,Invoke-IamActivation
