# Scenario 1 / Checkpoint 1 — Actual AD foundation

Goal: create a training OU tree, seven global security groups, and one disabled synthetic user. No cloud sync or real privileged access is configured.

## A. Validate your AD environment

Run inside your dedicated lab Windows Server, or a management machine with the ActiveDirectory module and connectivity to that domain. Replace both sample values below with your lab DC FQDN and domain DNS name. Do not run until you have a dedicated test domain.

```powershell
Get-Module -ListAvailable ActiveDirectory
Import-Module ActiveDirectory
$labDc = 'dc01.iamlab.test'
$labDomain = 'iamlab.test'
Get-ADDomain -Server $labDc |
    Select-Object DNSRoot, DistinguishedName, DomainMode
Get-ADDomainController -Identity $labDc -Server $labDc |
    Select-Object HostName, IsReadOnly, Site
```

Gate: the module loads, the returned domain is your dedicated lab domain, and the selected controller is writable. If not, stop here. Windows 11/Ollama validation does not satisfy this AD prerequisite.

## B. Preview changes

Open PowerShell in this project's **advanced** folder (copy the folder into your VM if necessary). With the same two variables set:

```powershell
.\01-Build-ADLab.ps1 -Server $labDc -ExpectedDomain $labDomain -WhatIf
```

Expect proposed creation of IAM-Training under the domain root, child OUs HR/Engineering/Finance/Support/Terminated/Groups, seven LAB-prefixed groups and lab-alex. The preview queries the real domain but does not create objects. Every creation must be confined to IAM-Training except creation of that root OU itself.

## C. Apply and verify

Using a lab account delegated to create this OU tree (or the lab's administrative account):

```powershell
.\01-Build-ADLab.ps1 -Server $labDc -ExpectedDomain $labDomain
```

The key creation commands used in the script are New-ADOrganizationalUnit, New-ADGroup and New-ADUser. New groups have no permissions on resources. The user is disabled with EmployeeID LAB-001 and Department Support; no password is embedded. Re-running skips existing expected objects and rejects name collisions outside the expected locations. It does not repair drift in existing object attributes.

Verify independently:

```powershell
$labDn = 'OU=IAM-Training,' + (Get-ADDomain -Server $labDc).DistinguishedName
Get-ADOrganizationalUnit -SearchBase $labDn -Filter * -Server $labDc |
    Select-Object Name, DistinguishedName
Get-ADGroup -SearchBase $labDn -Filter * -Server $labDc |
    Select-Object Name, GroupCategory, GroupScope
Get-ADUser -Identity lab-alex -Properties EmployeeID,Department -Server $labDc |
    Select-Object SamAccountName,Enabled,EmployeeID,Department,DistinguishedName
```

Expected: seven OUs including IAM-Training, seven Global/Security groups, and lab-alex disabled in Support with the expected attributes. Repeat the build and verify that objects were not duplicated. The script specifies -Server on each AD call to keep operations on the chosen DC.

Evidence: screenshot the OU tree in Active Directory Users and Computers, group output and disabled-user attributes. Save in a dated evidence subfolder. Crop host/domain details if necessary. Record why OUs are different from authorization groups and why a local UPN is not proof of cloud synchronization.

**Stop and verify this checkpoint before continuing.** No birthright assignments, cloud synchronization, account enabling or privileged elevation occurs here. After verification, continue independently with **lifecycle/README.md**, starting with its preview-only checkpoint. Do not rerun this foundation builder after moving lab-alex; use the lifecycle reconciliation workflow instead.
