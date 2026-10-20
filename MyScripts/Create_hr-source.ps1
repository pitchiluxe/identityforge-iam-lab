# Create the working workspace directory if it doesn't already exist
if (-not (Test-Path -LiteralPath "C:\workspace")) {
    New-Item -ItemType Directory -Path "C:\workspace" -Force | Out-Null
}

# Define the exact identity database context required for the lab
$hrData = @'
EmployeeId,DisplayName,DepartmentCode,EmploymentStatus
LAB-001,Alex Morgan,SUP,Active
LAB-002,Jordan Lee,FIN,Active
LAB-003,Taylor Reed,ENG,Terminated
LAB-004,Casey Patel,HR,Active
'@

# Generate the authoritative hr-source.csv file inside your target folder
Set-Content -Path "C:\workspace\hr-source.csv" -Value $hrData -Encoding UTF8

Write-Host "=== FILE INITIALIZATION COMPLETE ===" -ForegroundColor Green
Write-Host "Successfully generated: C:\workspace\hr-source.csv" -ForegroundColor Cyan
