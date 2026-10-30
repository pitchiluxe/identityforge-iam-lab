[CmdletBinding()]
param([string]$OutputRoot='')
$ErrorActionPreference='Stop'
if([string]::IsNullOrWhiteSpace($OutputRoot)){$OutputRoot=Join-Path $PSScriptRoot '..\output\portfolio-bundles'}
$root=Split-Path -Parent $PSScriptRoot
$id='IdentityForge-Source-'+[datetime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'-'+([guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $OutputRoot -Force|Out-Null
$stage=Join-Path $OutputRoot $id
New-Item -ItemType Directory -Path $stage|Out-Null
$files=@('.gitignore','README.md','HIRING-ASSET-START-HERE.md','tools\Test-Upgrade.ps1','portfolio\README.md','portfolio\VERIFICATION.md','sso\README.md','sso\package.json','sso\package-lock.json','sso\vite.config.mjs','sso\policy.mjs','sso\main.mjs','sso\index.html','sso\style.css','sso\public\config.example.json','advanced\01-Build-ADLab.ps1','advanced\CHECKPOINT-01.md','output\pdf\IdentityForge-Getting-Started-and-Lab-Handbook.pdf','output\pdf\IdentityForge-Roadmap-and-LinkedIn-Playbook.pdf','output\pdf\IdentityForge-Hiring-Asset-Upgrade.pdf')
foreach($folder in @('advanced\lifecycle','operational')){
    $base=Join-Path $root $folder
    foreach($f in Get-ChildItem -LiteralPath $base -File -Recurse){
        if($f.Extension -in @('.ps1','.psm1','.md','.csv','.json')){$files+=$f.FullName.Substring($root.Length+1)}
    }
}
# IdentityForge Range: source only (no node_modules, no dist).
$files+=@('range\README.md','range\package.json','range\package-lock.json','range\tsconfig.json','range\vite.config.mjs','range\index.html','range\Start-Range.ps1','range\LICENSE.txt','range\.gitignore','range\build-icons.cjs','range\build-installer-art.cjs','range\electron\main.cjs','range\electron\preload.cjs','range\tests\editor-ui.cjs','range\tests\azure-ui.cjs','range\tests\azure-home-ui.cjs','range\frame-check.mjs','range\frame-check.d.mts','api\frame-check.mjs','vercel.json','CLAUDE.md')
foreach($folder in @('range\src','range\tests','MyScripts')){
    foreach($f in Get-ChildItem -LiteralPath (Join-Path $root $folder) -File -Recurse){
        if($f.Extension -in @('.ts','.css','.ps1')){$files+=$f.FullName.Substring($root.Length+1)}
    }
}
# Range static assets, installer artwork, and the landing page (deployed to Vercel from site\).
foreach($folder in @('range\public','range\build','site')){
    foreach($f in Get-ChildItem -LiteralPath (Join-Path $root $folder) -File -Recurse){
        if($f.Extension -in @('.svg','.webp','.png','.ico','.bmp','.html','.css','.js','.txt')){$files+=$f.FullName.Substring($root.Length+1)}
    }
}
$files+=@('.gitattributes','portfolio\LINKEDIN-ADVANCED.md')
$files+=@('Lab.ps1','Start-Lab.cmd','WORKBOOK.md','ANSWER-KEY.md','INTERVIEW.md','LINKEDIN-TEMPLATES.md','advanced\README.md','portfolio\Export-Portfolio.ps1','output\images\IdentityForge-Roadmap.png')
foreach($n in 1..8){$files+=('output\images\Milestone-{0:D2}-Image-Layout.png' -f $n)}
foreach($f in Get-ChildItem -LiteralPath (Join-Path $root 'templates') -File){$files+=$f.FullName.Substring($root.Length+1)}
foreach($f in Get-ChildItem (Join-Path $root 'sso\tests') -File){$files+=$f.FullName.Substring($root.Length+1)}
foreach($relative in ($files|Sort-Object -Unique)){
    $source=Join-Path $root $relative
    if(-not(Test-Path -LiteralPath $source -PathType Leaf)){throw "Required source missing: $relative"}
    $dest=Join-Path $stage $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force|Out-Null
    Copy-Item -LiteralPath $source -Destination $dest
}
'Source bundle only. No live AD or SSO verification is implied. Review contents before sharing.'|Set-Content (Join-Path $stage 'SCOPE.txt') -Encoding UTF8
$zip=Join-Path $OutputRoot ($id+'.zip')
Compress-Archive -LiteralPath $stage -DestinationPath $zip
Get-FileHash -LiteralPath $zip -Algorithm SHA256|Format-List
Write-Host "Portfolio source bundle: $zip"
