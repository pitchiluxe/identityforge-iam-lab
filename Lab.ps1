param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$statePath = Join-Path $root 'workspace\state.json'
$evidence = Join-Path $root 'evidence'
function Save-Lab($s) { $s | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $statePath -Encoding UTF8 }
function Read-Lab { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json }
function Write-Audit($eventName, $details) {
    [pscustomobject]@{Utc=[datetime]::UtcNow.ToString('o');Event=$eventName;Details=$details} |
        ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $evidence 'audit.jsonl') -Encoding UTF8
}
function Initialize-Lab {
    New-Item -ItemType Directory -Path (Join-Path $root 'workspace'),$evidence -Force | Out-Null
    $s = [ordered]@{
        Completed=@(); ClockUtc=[datetime]::UtcNow.ToString('o')
        Users=@(
            @{Id='LAB-001';Name='Alex Morgan';Dept='SUP';Enabled=$true;Groups=@('AllEmployees','Support-Tickets')},
            @{Id='LAB-002';Name='Jordan Lee';Dept='FIN';Enabled=$true;Groups=@('AllEmployees','Finance-Read','Payment-Creator','Payment-Approver')},
            @{Id='LAB-003';Name='Taylor Reed';Dept='ENG';Enabled=$true;Groups=@('AllEmployees','Engineering-Tools')}
        )
        Hr=@(
            @{Id='LAB-001';Name='Alex Morgan';Dept='ENG';Status='Active'},
            @{Id='LAB-002';Name='Jordan Lee';Dept='FIN';Status='Active'},
            @{Id='LAB-003';Name='Taylor Reed';Dept='ENG';Status='Terminated'},
            @{Id='LAB-004';Name='Casey Patel';Dept='HR';Status='Active'}
        )
        Token=@{Issuer='https://idp.lab.invalid';Audience='expense-app';Subject='LAB-001';Email='';ExpiresUtc=[datetime]::UtcNow.AddHours(24).ToString('o')}
        Grant=$null
    }
    Save-Lab $s
    Copy-Item -LiteralPath (Join-Path $root 'templates\rules.json') -Destination (Join-Path $root 'workspace\rules.json') -Force
    Copy-Item -LiteralPath (Join-Path $root 'templates\access-policy.json') -Destination (Join-Path $root 'workspace\access-policy.json') -Force
    Write-Audit 'RESET' 'Synthetic baseline restored; earlier evidence retained.'
}
function Show-Directory($s) {
    $s.Users | Select-Object Id,Name,Dept,Enabled,@{n='Groups';e={$_.Groups -join ', '}} | Format-Table -Wrap -AutoSize
}
function Run-Iga {
    $s=Read-Lab
    $rules=Get-Content (Join-Path $root 'workspace\rules.json') -Raw | ConvertFrom-Json
    foreach($hr in $s.Hr) {
        $u=$s.Users | Where-Object Id -eq $hr.Id
        if($hr.Status -eq 'Terminated') {
            if($u) { $u.Enabled=$false; $u.Groups=@(); Write-Audit 'LEAVER' $hr.Id }; continue
        }
        $mapping=$rules.PSObject.Properties[$hr.Dept]
        if(-not $mapping -or @($mapping.Value).Count -eq 0) { throw "Missing mapping for $($hr.Dept). Fix rules.json before applying." }
        if(-not $u) {
            $u=[pscustomobject]@{Id=$hr.Id;Name=$hr.Name;Dept=$hr.Dept;Enabled=$true;Groups=@()}
            $s.Users=@($s.Users)+$u; Write-Audit 'JOINER' $hr.Id
        }
        # Reconcile this lab's complete entitlement set, rather than only adding groups.
        $u.Dept=$hr.Dept; $u.Enabled=$true; $u.Groups=@($mapping.Value)
        Write-Audit 'RECONCILE' $hr.Id
    }
    Save-Lab $s; Show-Directory $s
}
function Export-Review {
    $s=Read-Lab
    $rows=@(foreach($u in $s.Users) {
        if($u.Groups -contains 'Payment-Creator' -and $u.Groups -contains 'Payment-Approver') {
            [pscustomobject]@{Id=$u.Id;Finding='Separation of duties conflict';Risk='High';Decision='Remove one privilege after owner review'}
        }
        $hr=$s.Hr | Where-Object Id -eq $u.Id
        if($hr.Status -eq 'Terminated' -and $u.Enabled) {
            [pscustomobject]@{Id=$u.Id;Finding='Terminated identity enabled';Risk='High';Decision='Disable and revoke access'}
        }
    })
    $file=Join-Path $evidence 'access-review.csv'
    if($rows.Count) { $rows | Export-Csv $file -NoTypeInformation; $rows | Format-Table -Wrap }
    else { 'Id,Finding,Risk,Decision' | Set-Content $file; Write-Host 'No baseline violations found.' }
    Write-Audit 'ACCESS_REVIEW' "Findings=$($rows.Count)"
}
function Run-Am {
    $policy=Get-Content (Join-Path $root 'workspace\access-policy.json') -Raw | ConvertFrom-Json
    $cases=@(
        @{Name='Corporate managed device';Risk='Low';Managed=$true;Corporate=$true;Expected='Allow'},
        @{Name='Remote managed device';Risk='Low';Managed=$true;Corporate=$false;Expected='RequirePhishingResistantMFA'},
        @{Name='Impossible travel on corporate IP';Risk='High';Managed=$true;Corporate=$true;Expected='Block'},
        @{Name='Unmanaged remote device';Risk='Low';Managed=$false;Corporate=$false;Expected='Block'}
    )
    $rows=foreach($c in $cases) {
        $decision=if($c.Risk -eq 'High'){$policy.HighRisk}elseif(-not $c.Managed){$policy.Unmanaged}elseif($c.Corporate){$policy.CorporateManaged}else{$policy.RemoteManaged}
        [pscustomobject]@{Case=$c.Name;Decision=$decision;Expected=$c.Expected;Pass=($decision -eq $c.Expected)}
    }
    $rows | Format-Table -Wrap; $rows | Export-Csv (Join-Path $evidence 'policy-results.csv') -NoTypeInformation
    $s=Read-Lab; $t=$s.Token
    $errors=@()
    if($t.Issuer -ne 'https://idp.lab.invalid'){$errors+='Issuer mismatch'}
    if($t.Audience -ne 'expense-app'){$errors+='Audience mismatch'}
    if(-not $t.Subject){$errors+='Missing subject'}
    if(-not $t.Email){$errors+='Missing mandatory email claim'}
    if([datetime]::Parse($t.ExpiresUtc).ToUniversalTime() -le [datetime]::UtcNow){$errors+='Expired token'}
    if($errors.Count){Write-Host ('TOKEN REJECTED: '+($errors -join '; '))}else{Write-Host 'TOKEN CLAIM CHECK PASSED (unsigned simulation)'}
    Write-Audit 'AM_CHECK' ($errors -join '; ')
}
function Request-Grant {
    $s=Read-Lab
    if($s.Grant -and $s.Grant.Status -eq 'Active'){throw 'An active grant already exists. Reset or advance the simulated clock.'}
    $reason=Read-Host 'Enter a ticket reference and business justification'
    if([string]::IsNullOrWhiteSpace($reason)){throw 'Justification is required.'}
    $approval=Read-Host 'Simulated separate approver: type APPROVE'
    if($approval -cne 'APPROVE'){Write-Host 'Request denied';return}
    $now=[datetime]::Parse($s.ClockUtc).ToUniversalTime()
    $s.Grant=[pscustomobject]@{Identity='LAB-001';Role='Simulated-Domain-Admin';Reason=$reason;StartUtc=$now.ToString('o');ExpiresUtc=$now.AddHours(2).ToString('o');Status='Active'}
    Save-Lab $s; Write-Audit 'JIT_APPROVED' $s.Grant; $s.Grant | Format-List
}
function Check-Grant($s) {
    if($s.Grant -and [datetime]::Parse($s.ClockUtc).ToUniversalTime() -ge [datetime]::Parse($s.Grant.ExpiresUtc).ToUniversalTime()) {
        $s.Grant.Status='Expired'; Save-Lab $s
    }
    if($s.Grant -and $s.Grant.Status -eq 'Active'){Write-Host 'ACCESS ALLOWED by simulated grant'}else{Write-Host 'ACCESS DENIED: no active grant'}
}
function Verify-Lab {
    $s=Read-Lab
    $alex=$s.Users | Where-Object Id -eq 'LAB-001'
    $taylor=$s.Users | Where-Object Id -eq 'LAB-003'
    $casey=$s.Users | Where-Object Id -eq 'LAB-004'
    $iga=($null -ne $casey -and $casey.Groups -contains 'HR-Portal' -and -not $taylor.Enabled -and @($taylor.Groups).Count -eq 0 -and $alex.Groups -contains 'Engineering-Tools' -and $alex.Groups -notcontains 'Support-Tickets')
    $p=Get-Content (Join-Path $root 'workspace\access-policy.json') -Raw | ConvertFrom-Json
    $am=($p.HighRisk -eq 'Block' -and $p.Unmanaged -eq 'Block' -and $p.CorporateManaged -eq 'Allow' -and $p.RemoteManaged -eq 'RequirePhishingResistantMFA' -and $s.Token.Email -eq 'alex.morgan@example.invalid')
    $pam=($s.Grant -and $s.Grant.Status -eq 'Expired' -and (([datetime]$s.Grant.ExpiresUtc)-([datetime]$s.Grant.StartUtc)).TotalHours -eq 2)
    [pscustomobject]@{IGA=[bool]$iga;AM=[bool]$am;PAM=[bool]$pam} | Format-List
    $s.Completed=@();if($iga){$s.Completed+='IGA'};if($am){$s.Completed+='AM'};if($pam){$s.Completed+='PAM'};Save-Lab $s
    Write-Host 'Checks validate selected exercise outcomes; use the workbook for evidence and reasoning requirements.'
}
if($SelfTest) {
    $source=Get-Content -LiteralPath $PSCommandPath -Raw
    $null=[scriptblock]::Create($source)
    foreach($file in @('rules.json','access-policy.json')) { $null=Get-Content (Join-Path $root "templates\$file") -Raw | ConvertFrom-Json }
    Write-Host 'PASS: script syntax and JSON templates';exit 0
}
if(-not(Test-Path -LiteralPath $statePath)){Initialize-Lab}
while($true) {
    Write-Host "`n  ============================================================" -ForegroundColor Cyan
    Write-Host '             IDENTITYFORGE | PRACTICE CONSOLE' -ForegroundColor Cyan
    Write-Host '  ============================================================' -ForegroundColor Cyan
    Write-Host '  Synthetic local training - no Windows account changes'
    Write-Host ''
    Write-Host '  IDENTITY GOVERNANCE (IGA)' -ForegroundColor Cyan
    Write-Host '    [1] View directory and HR records'
    Write-Host '    [2] Export access certification findings'
    Write-Host '    [3] Apply your birthright and lifecycle rules'
    Write-Host ''
    Write-Host '  ACCESS MANAGEMENT (AM)' -ForegroundColor Cyan
    Write-Host '    [4] Test risk policies and required token claims'
    Write-Host ''
    Write-Host '  PRIVILEGED ACCESS (PAM)' -ForegroundColor Cyan
    Write-Host '    [5] Request a simulated two-hour JIT grant'
    Write-Host '    [6] Check privileged authorization'
    Write-Host '    [7] Advance the simulated clock by two hours'
    Write-Host '    [8] Inspect the privileged-session audit exercise'
    Write-Host ''
    Write-Host '  PROGRESS AND CONTROLS' -ForegroundColor Cyan
    Write-Host '    [9] Check saved exercise outcomes'
    Write-Host '    [R] Reset exercise state (confirmation required)'
    Write-Host '    [Q] Return to launcher / exit console'
    Write-Host '  ------------------------------------------------------------' -ForegroundColor Cyan
    $choice=Read-Host '  Choose an option'
    try {
        switch($choice.ToUpperInvariant()) {
            '1' { $s=Read-Lab;Show-Directory $s;$s.Hr | Format-Table }
            '2' { Export-Review }
            '3' { Run-Iga }
            '4' { Run-Am }
            '5' { Request-Grant }
            '6' { Check-Grant (Read-Lab) }
            '7' { $s=Read-Lab;$s.ClockUtc=([datetime]::Parse($s.ClockUtc).AddHours(2)).ToString('o');Save-Lab $s;Check-Grant $s;Write-Audit 'CLOCK_ADVANCED' $s.ClockUtc }
            '8' { Import-Csv (Join-Path $root 'templates\session-log.csv') | Format-Table -Wrap }
            '9' { Verify-Lab }
            'R' { if((Read-Host 'Type RESET to replace exercise state (evidence retained)') -ceq 'RESET'){Initialize-Lab} }
            'Q' { return }
            default { Write-Host '  Please choose 1-9, R, or Q.' -ForegroundColor Yellow }
        }
    } catch { Write-Host $_.Exception.Message -ForegroundColor Yellow }
}
