@echo off
setlocal
cd /d "%~dp0" || exit /b 1
title IdentityForge - IAM Engineer Career Lab
color 0B
:home
cls
echo.
echo  ======================================================================
echo                         I D E N T I T Y F O R G E
echo                          IAM ENGINEER CAREER LAB
echo  ======================================================================
echo.
echo    Learn identity. Build evidence. Tell your career story.
echo.
echo  GET STARTED
echo    [1] Open the setup and step-by-step PDF handbook
echo    [2] Open the roadmap and LinkedIn portfolio PDF
echo.
echo  PRACTICE
echo    [3] Launch the complete standalone simulation
echo        IGA lifecycle / AM policy checks / PAM time-bound access
echo.
echo    [4] Open the real Active Directory checkpoint
echo        Requires your own isolated Windows Server AD domain
echo.
echo  YOUR WORK
echo    [5] Open saved evidence and reports
echo    [6] Open the new AD lifecycle and hiring-asset guide
echo    [7] Open Entra SSO registration and break/fix instructions
echo    [8] Build a portfolio source bundle (local ZIP)
echo    [Q] Exit
echo.
echo  ----------------------------------------------------------------------
echo    Progress is saved automatically. Reset is inside the simulation.
echo    Simulation and actual AD exercises are separate learning tracks.
echo  ----------------------------------------------------------------------
echo.
choice /c 12345678Q /n /m "  Choose an option [1-8 or Q]: "
if errorlevel 9 goto done
if errorlevel 8 goto bundle
if errorlevel 7 goto sso
if errorlevel 6 goto hiring
if errorlevel 5 goto evidence
if errorlevel 4 goto advanced
if errorlevel 3 goto lab
if errorlevel 2 goto portfolio
if errorlevel 1 goto handbook
:handbook
if not exist "output\pdf\IdentityForge-Getting-Started-and-Lab-Handbook.pdf" goto missing
start "" "%~dp0output\pdf\IdentityForge-Getting-Started-and-Lab-Handbook.pdf"
goto home
:hiring
if exist "output\pdf\IdentityForge-Hiring-Asset-Upgrade.pdf" (
    start "" "%~dp0output\pdf\IdentityForge-Hiring-Asset-Upgrade.pdf"
) else (
    start "" notepad.exe "%~dp0HIRING-ASSET-START-HERE.md"
)
goto home
:sso
start "" notepad.exe "%~dp0sso\README.md"
goto home
:bundle
powershell.exe -NoProfile -File "%~dp0portfolio\Export-Portfolio.ps1"
if errorlevel 1 echo  Bundle creation failed. See the displayed error and handbook policy guidance.
pause
goto home
:portfolio
if not exist "output\pdf\IdentityForge-Roadmap-and-LinkedIn-Playbook.pdf" goto missing
start "" "%~dp0output\pdf\IdentityForge-Roadmap-and-LinkedIn-Playbook.pdf"
goto home
:advanced
start "" notepad.exe "%~dp0advanced\CHECKPOINT-01.md"
goto home
:evidence
if not exist "evidence" mkdir "evidence"
start "" explorer.exe "%~dp0evidence"
goto home
:lab
cls
powershell.exe -NoProfile -File "%~dp0Lab.ps1"
if errorlevel 1 (
    echo.
    echo  The simulation could not start or ended with an error.
    echo  See the handbook's troubleshooting page for script-policy help.
)
echo.
pause
goto home
:missing
echo.
echo  The PDF could not be found. Check the output\pdf folder.
pause
goto home
:done
endlocal
exit /b 0
