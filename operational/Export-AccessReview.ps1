[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$SnapshotPath,
    [Parameter(Mandatory=$true)][string]$HrCsv,
    [ValidateSet('OfflineFixture','LiveADSnapshot')][string]$EvidenceKind='OfflineFixture',
    [string]$OutputPath='')
$ErrorActionPreference='Stop'
if([string]::IsNullOrWhiteSpace($OutputPath)){$OutputPath=Join-Path $PSScriptRoot '..\evidence\certification.csv'}
$parsed=Get-Content -LiteralPath $SnapshotPath -Raw|ConvertFrom-Json
$users=@($parsed)
$hr=@(Import-Csv -LiteralPath $HrCsv)
if(@($hr|Group-Object EmployeeID|Where-Object {$_.Count -gt 1 -or [string]::IsNullOrWhiteSpace($_.Name)}).Count){throw 'Duplicate or missing HR EmployeeID; certification stopped.'}
if(@($users|Group-Object EmployeeID|Where-Object {$_.Count -gt 1 -or [string]::IsNullOrWhiteSpace($_.Name)}).Count){throw 'Duplicate or missing snapshot EmployeeID; certification stopped.'}
$findings=@(foreach($u in $users){
    $r=@($hr|Where-Object EmployeeID -eq $u.EmployeeID)
    $reasons=@()
    if($u.Groups -contains 'LAB-Payment-Creator' -and $u.Groups -contains 'LAB-Payment-Approver'){$reasons+='Payment separation-of-duties conflict'}
    if($r.Count -eq 1 -and $r[0].EmploymentStatus -eq 'Terminated' -and $u.Enabled){$reasons+='Terminated identity remains enabled'}
    foreach($finding in $reasons){[pscustomobject][ordered]@{EmployeeID=$u.EmployeeID;Finding=$finding;Risk='High';EvidenceKind=$EvidenceKind;Decision='PENDING';Reviewer='';Ticket='';Justification='';ExceptionExpiryUtc=''}}
})
$parent=Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
New-Item -ItemType Directory -Path $parent -Force|Out-Null
if($findings.Count){$findings|Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding UTF8}else{'EmployeeID,Finding,Risk,EvidenceKind,Decision,Reviewer,Ticket,Justification,ExceptionExpiryUtc'|Set-Content -LiteralPath $OutputPath -Encoding UTF8}
$findings|Format-Table -Wrap
Write-Host "Findings: $($findings.Count). Decisions remain pending until an owner reviews them. Output: $OutputPath"
