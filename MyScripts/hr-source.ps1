#Requires -Version 5.1
# This file used to hold a second, older copy of the JML engine with the same
# syntax bugs. One engine is easier to maintain: this now runs the fixed one
# against the HR file in Documents\IAM-HomeLab-IGA. Add -WhatIf to preview.
[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$HrSourcePath = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'IAM-HomeLab-IGA\hr-source.csv'))
& (Join-Path $PSScriptRoot 'Joiner-Mover-Leaver_JML.ps1') -HrSourcePath $HrSourcePath -WhatIf:$WhatIfPreference
exit $LASTEXITCODE
