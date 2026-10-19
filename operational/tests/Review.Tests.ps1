$ErrorActionPreference='Stop'
$out=Join-Path ([IO.Path]::GetTempPath()) ('identityforge-review-'+[guid]::NewGuid()+'.csv')
try{
    & (Join-Path $PSScriptRoot '..\Export-AccessReview.ps1') -SnapshotPath (Join-Path $PSScriptRoot '..\data\review-fixture.json') -HrCsv (Join-Path $PSScriptRoot '..\..\advanced\lifecycle\data\02-mover-leaver.csv') -OutputPath $out | Out-Null
    $rows=@(Import-Csv -LiteralPath $out)
    if($rows.Count -ne 2){throw 'Expected two separate findings from two separate identities.'}
    if(@($rows|Where-Object EmployeeID -eq 'LAB-002').Count -ne 1){throw 'SoD identity must retain its scalar EmployeeID.'}
    if(@($rows|Where-Object {$_.EmployeeID -eq 'LAB-003' -and $_.Finding -eq 'Terminated identity remains enabled'}).Count -ne 1){throw 'Leaver must be independently reviewed.'}
    if(@($rows|Where-Object Decision -ne 'PENDING').Count){throw 'No automated approval may be invented.'}
    $duplicate=Join-Path (Split-Path $out) ('duplicate-'+[guid]::NewGuid()+'.csv')
    try{
        @([pscustomobject]@{EmployeeID='LAB-003';EmploymentStatus='Terminated'},[pscustomobject]@{EmployeeID='LAB-003';EmploymentStatus='Terminated'})|Export-Csv $duplicate -NoTypeInformation
        $thrown=$false
        try{& (Join-Path $PSScriptRoot '..\Export-AccessReview.ps1') -SnapshotPath (Join-Path $PSScriptRoot '..\data\review-fixture.json') -HrCsv $duplicate -OutputPath $out | Out-Null}catch{$thrown=$true}
        if(-not $thrown){throw 'Duplicate HR identities must fail before producing a misleading certification.'}
    }finally{Remove-Item -LiteralPath $duplicate -ErrorAction SilentlyContinue}
    Write-Host 'PASS: separate identities, SoD, stale leaver, pending decisions and duplicate-HR rejection'
}finally{Remove-Item -LiteralPath $out -ErrorAction SilentlyContinue}
