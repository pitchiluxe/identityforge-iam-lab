/**
 * terminal/helpdocs.ts — what Get-Help says about each command, in Microsoft's
 * words.
 *
 * SYNOPSIS is the official one-line synopsis from the module's help (Active
 * Directory, Microsoft Graph PowerShell, ADSync, Microsoft.PowerShell.*, and
 * the Windows command reference for programs). Parameter types are the real
 * ones, so the syntax reads as it does on a server. Anything specific to
 * Meridian's procedures goes in NOTES, never in the synopsis.
 */

export interface HelpDoc {
  synopsis: string;
  /** Meridian practice for this command (shown as NOTES). */
  notes?: string;
}

export const HELP: Record<string, HelpDoc> = {
  // ---------------------------------------------------------------- ActiveDirectory
  'Add-ADGroupMember': { synopsis: 'Adds one or more members to an Active Directory group.', notes: 'Access is granted through groups (IAM-POL-004). Check SoD-Matrix.csv before adding to a payroll or privileged group.' },
  'Add-ADPrincipalGroupMembership': { synopsis: 'Adds a member to one or more Active Directory groups.' },
  'Clear-ADAccountExpiration': { synopsis: 'Clears the expiration date for an Active Directory account.' },
  'Disable-ADAccount': { synopsis: 'Disables an Active Directory account.', notes: 'Disabling does not end cloud sessions: run a delta sync and Revoke-MgUserSignInSession for a leaver.' },
  'Enable-ADAccount': { synopsis: 'Enables an Active Directory account.' },
  'Get-ADAccountAuthorizationGroup': { synopsis: 'Gets the accounts token group information.', notes: 'Shows nested and built-in groups the account would carry in its Kerberos token.' },
  'Get-ADComputer': { synopsis: 'Gets one or more Active Directory computers.' },
  'Get-ADDefaultDomainPasswordPolicy': { synopsis: 'Gets the default password policy for an Active Directory domain.' },
  'Get-ADDomain': { synopsis: 'Gets an Active Directory domain.' },
  'Get-ADDomainController': { synopsis: 'Gets one or more Active Directory domain controllers based on discoverable services criteria, search parameters or by providing a domain controller identifier, such as the NetBIOS name.' },
  'Get-ADFineGrainedPasswordPolicy': { synopsis: 'Gets one or more Active Directory fine-grained password policies.' },
  'Get-ADForest': { synopsis: 'Gets an Active Directory forest.' },
  'Get-ADGroup': { synopsis: 'Gets one or more Active Directory groups.' },
  'Get-ADGroupMember': { synopsis: 'Gets the members of an Active Directory group.' },
  'Get-ADObject': { synopsis: 'Gets one or more Active Directory objects.' },
  'Get-ADOrganizationalUnit': { synopsis: 'Gets one or more Active Directory organizational units.' },
  'Get-ADPrincipalGroupMembership': { synopsis: 'Gets the Active Directory groups that have a specified user, computer, group, or service account.' },
  'Get-ADUser': { synopsis: 'Gets one or more Active Directory users.' },
  'Get-ADUserResultantPasswordPolicy': { synopsis: 'Gets the resultant password policy for a user.', notes: 'Returns nothing when only the default domain policy applies.' },
  'Move-ADObject': { synopsis: 'Moves an Active Directory object or a container of objects to a different container or domain.', notes: 'Corp/Staging and Corp/ServiceAccounts are outside the Entra Connect scope.' },
  'New-ADGroup': { synopsis: 'Creates an Active Directory group.' },
  'New-ADOrganizationalUnit': { synopsis: 'Creates an Active Directory organizational unit.' },
  'New-ADUser': { synopsis: 'Creates an Active Directory user.', notes: 'Joiners are created from a PeopleHub hire record. Leave the account disabled until the start date.' },
  'Remove-ADGroup': { synopsis: 'Removes an Active Directory group.' },
  'Remove-ADGroupMember': { synopsis: 'Removes one or more members from an Active Directory group.' },
  'Remove-ADOrganizationalUnit': { synopsis: 'Removes an Active Directory organizational unit.' },
  'Remove-ADPrincipalGroupMembership': { synopsis: 'Removes a member from one or more Active Directory groups.' },
  'Remove-ADUser': { synopsis: 'Removes an Active Directory user.', notes: 'The JML SOP disables leavers and keeps them for 30 days; deleting destroys audit evidence.' },
  'Search-ADAccount': { synopsis: 'Gets Active Directory user, computer, or service accounts.' },
  'Set-ADAccountControl': { synopsis: 'Modifies user account control (UAC) values for an Active Directory account.' },
  'Set-ADAccountExpiration': { synopsis: 'Sets the expiration date for an Active Directory account.' },
  'Set-ADAccountPassword': { synopsis: 'Modifies the password of an Active Directory account.', notes: 'Reset with -Reset and a SecureString, then Set-ADUser -ChangePasswordAtLogon $true so IAM never knows the working password.' },
  'Set-ADGroup': { synopsis: 'Modifies an Active Directory group.' },
  'Set-ADUser': { synopsis: 'Modifies an Active Directory user.' },
  'Unlock-ADAccount': { synopsis: 'Unlocks an Active Directory account.', notes: 'Find the source first: event 4740 on the DC names the caller computer.' },
  // ---------------------------------------------------------------- ADSync
  'Get-ADSyncConnector': { synopsis: 'Gets a connector.' },
  'Get-ADSyncConnectorRunStatus': { synopsis: 'Gets the run status of the connectors.', notes: 'Returns nothing when no connector is running.' },
  'Get-ADSyncScheduler': { synopsis: 'Gets the current sync cycle settings for the sync scheduler.' },
  'Start-ADSyncSyncCycle': { synopsis: 'Triggers a sync cycle.', notes: 'Runs on MHS-SYNC01. A Delta cycle carries recent AD changes to Entra ID; use Initial only after a scope change.' },
  // ---------------------------------------------------------------- Microsoft.Graph
  'Connect-MgGraph': { synopsis: 'Microsoft Graph PowerShell supports two types of authentication: delegated and app-only access.', notes: 'Request only the scopes the task needs, e.g. User.Read.All, AuditLog.Read.All.' },
  'Disconnect-MgGraph': { synopsis: 'Once you are signed in, you will remain signed in until you invoke Disconnect-MgGraph.' },
  'Get-MgAuditLogDirectoryAudit': { synopsis: 'Get the list of audit logs generated by Microsoft Entra ID.' },
  'Get-MgAuditLogSignIn': { synopsis: 'Retrieve the Microsoft Entra user sign-ins for your tenant.' },
  'Get-MgContext': { synopsis: 'Gets details about the current session.' },
  'Get-MgDirectoryRole': { synopsis: 'List the directory roles that are activated in the tenant.' },
  'Get-MgDirectoryRoleMember': { synopsis: 'Retrieve a list of the users that are assigned to the directory role.' },
  'Get-MgGroup': { synopsis: 'Get the properties and relationships of a group object.' },
  'Get-MgGroupMember': { synopsis: 'Get a list of the group\'s direct members.', notes: 'Members come back as directory objects (Id only). Pipe the Ids to Get-MgUser for names.' },
  'Get-MgIdentityConditionalAccessPolicy': { synopsis: 'Retrieve the properties and relationships of a conditionalAccessPolicy object.' },
  'Get-MgRiskyUser': { synopsis: 'Read the properties and relationships of a riskyUser object.' },
  'Get-MgRoleManagementDirectoryRoleAssignment': { synopsis: 'Get the properties and relationships of a unifiedRoleAssignment object.', notes: 'Active assignments. Standing Global Administrator outside break-glass breaks SEC-STD-007.' },
  'Get-MgRoleManagementDirectoryRoleEligibilitySchedule': { synopsis: 'Retrieve the schedule for a role eligibility operation.', notes: 'PIM eligible assignments: activated just in time.' },
  'Get-MgServicePrincipal': { synopsis: 'Retrieve the properties and relationships of a servicePrincipal object.' },
  'Get-MgSubscribedSku': { synopsis: 'Get a specific commercial subscription that an organization acquired.' },
  'Get-MgUser': { synopsis: 'Retrieve the properties and relationships of user object.' },
  'Get-MgUserAuthenticationMethod': { synopsis: 'Retrieve a list of authentication methods registered to a user.' },
  'Get-MgUserLicenseDetail': { synopsis: 'Retrieve a list of licenseDetails objects for enterprise users.' },
  'Get-MgUserMemberOf': { synopsis: 'Groups, directory roles, and administrative units that the user is a direct member of.' },
  'Invoke-MgDismissRiskyUser': { synopsis: 'Dismiss the risk of one or more riskyUser objects.', notes: 'Dismiss only after the account is secured: password reset, sessions revoked, MFA re-registered.' },
  'Revoke-MgUserSignInSession': { synopsis: 'Invalidates all the refresh tokens issued to applications for a user (as well as session cookies in a user\'s browser), by resetting the signInSessionsValidFromDateTime user property to the current date-time.' },
  'Update-MgUser': { synopsis: 'Update the properties of a user object.', notes: 'Synced users are mastered in AD: change them there and run a sync.' },
  // ---------------------------------------------------------------- Microsoft.PowerShell.*
  'Add-Content': { synopsis: 'Adds content to the specified items, such as adding words to a file.' },
  'Clear-History': { synopsis: 'Deletes entries from the PowerShell session command history.' },
  'Clear-Host': { synopsis: 'Clears the display in the host program.' },
  'ConvertFrom-Json': { synopsis: 'Converts a JSON-formatted string to a custom object or a hash table.' },
  'ConvertTo-Json': { synopsis: 'Converts an object to a JSON-formatted string.' },
  'ConvertTo-SecureString': { synopsis: 'Converts plain text or encrypted strings to secure strings.', notes: 'Prefer Read-Host -AsSecureString: plain text stays in command history.' },
  'Copy-Item': { synopsis: 'Copies an item from one location to another.' },
  'Export-Csv': { synopsis: 'Converts objects into a series of character-separated value (CSV) strings and saves the strings to a file.' },
  'ForEach-Object': { synopsis: 'Performs an operation against each item in a collection of input objects.' },
  'Format-List': { synopsis: 'Formats the output as a list of properties in which each property appears on a new line.' },
  'Format-Table': { synopsis: 'Formats the output as a table.' },
  'Get-ChildItem': { synopsis: 'Gets the items and child items in one or more specified locations.' },
  'Get-Command': { synopsis: 'Gets all commands.' },
  'Get-ComputerInfo': { synopsis: 'Gets a consolidated object of system and operating system properties.' },
  'Get-Content': { synopsis: 'Gets the content of the item at the specified location.' },
  'Get-Date': { synopsis: 'Gets the current date and time.' },
  'Get-ExecutionPolicy': { synopsis: 'Gets the execution policies for the current session.' },
  'Get-Help': { synopsis: 'Displays information about PowerShell commands and concepts.' },
  'Get-History': { synopsis: 'Gets a list of the commands entered during the current session.' },
  'Get-Location': { synopsis: 'Gets information about the current working location or a location stack.' },
  'Get-Member': { synopsis: 'Gets the properties and methods of objects.' },
  'Get-Module': { synopsis: 'List the modules imported in the current session or that can be imported from the PSModulePath.' },
  'Get-Process': { synopsis: 'Gets the processes that are running on the local computer.' },
  'Get-Random': { synopsis: 'Gets a random number, or selects objects randomly from a collection.' },
  'Get-Service': { synopsis: 'Gets the services on the computer.' },
  'Get-Variable': { synopsis: 'Gets the variables in the current console.' },
  'Get-WinEvent': { synopsis: 'Gets events from event logs and event tracing log files on local and remote computers.', notes: 'Use -ComputerName MHS-DC01 for the domain Security log: 4740 lockouts, 4625/4771 failed logons, 4720/4726 account changes.' },
  'Group-Object': { synopsis: 'Groups objects that contain the same value for specified properties.' },
  'Import-Csv': { synopsis: 'Creates table-like custom objects from the items in a character-separated value (CSV) file.' },
  'Import-Module': { synopsis: 'Adds modules to the current session.' },
  'Invoke-Command': { synopsis: 'Runs commands on local and remote computers.', notes: 'Entra Connect cmdlets run on MHS-SYNC01: Invoke-Command -ComputerName MHS-SYNC01 { Start-ADSyncSyncCycle -PolicyType Delta }.' },
  'Measure-Object': { synopsis: 'Calculates the numeric properties of objects, and the characters, words, and lines in string objects, such as files of text.' },
  'Move-Item': { synopsis: 'Moves an item from one location to another.' },
  'New-Item': { synopsis: 'Creates a new item.' },
  'New-TimeSpan': { synopsis: 'Creates a TimeSpan object.' },
  'Out-Host': { synopsis: 'Sends output to the command line.' },
  'Out-Null': { synopsis: 'Hides the output instead of sending it down the pipeline or displaying it.' },
  'Out-String': { synopsis: 'Outputs input objects as a string.' },
  'Read-Host': { synopsis: 'Reads a line of input from the console.' },
  'Remove-Item': { synopsis: 'Deletes the specified items.' },
  'Rename-Item': { synopsis: 'Renames an item in a PowerShell provider namespace.' },
  'Select-Object': { synopsis: 'Selects objects or object properties.' },
  'Select-String': { synopsis: 'Finds text in strings and files.' },
  'Set-Content': { synopsis: 'Writes new content or replaces existing content in a file.' },
  'Set-ExecutionPolicy': { synopsis: 'Sets the PowerShell execution policies for Windows computers.' },
  'Set-Location': { synopsis: 'Sets the current working location to a specified location.' },
  'Sort-Object': { synopsis: 'Sorts objects by property values.' },
  'Start-Process': { synopsis: 'Starts one or more processes on the local computer.' },
  'Start-Sleep': { synopsis: 'Suspends the activity in a script or session for the specified period of time.' },
  'Stop-Process': { synopsis: 'Stops one or more running processes.' },
  'Test-Connection': { synopsis: 'Sends ICMP echo request packets, or pings, to one or more computers.' },
  'Test-Path': { synopsis: 'Determines whether all elements of a path exist.' },
  'Where-Object': { synopsis: 'Selects objects from a collection based on their property values.' },
  'Write-Error': { synopsis: 'Writes an object to the error stream.' },
  'Write-Host': { synopsis: 'Writes customized output to a host.' },
  'Write-Output': { synopsis: 'Writes the specified objects to the pipeline.' },
  'Write-Verbose': { synopsis: 'Writes text to the verbose message stream.' },
  'Write-Warning': { synopsis: 'Writes a warning message.' },
  exit: { synopsis: 'Exits the current PowerShell session.' },
  // ---------------------------------------------------------------- Windows programs (Windows Commands reference)
  explorer: { synopsis: 'Opens File Explorer.' },
  findstr: { synopsis: 'Searches for patterns of text in files.' },
  gpresult: { synopsis: 'Displays the Resultant Set of Policy (RSoP) information for a remote user and computer.' },
  gpupdate: { synopsis: 'Updates Group Policy settings.' },
  hostname: { synopsis: 'Displays the host name portion of the full computer name of the computer.' },
  ipconfig: { synopsis: 'Displays all current TCP/IP network configuration values and refreshes Dynamic Host Configuration Protocol (DHCP) and Domain Name System (DNS) settings.' },
  ise: { synopsis: 'Opens the Windows PowerShell Integrated Scripting Environment (ISE).' },
  klist: { synopsis: 'Displays a list of currently cached Kerberos tickets.' },
  net: { synopsis: 'Manages users, groups, shares and services: net user <name> /domain, net group <name> /domain, net localgroup.' },
  notepad: { synopsis: 'Opens Notepad.' },
  nslookup: { synopsis: 'Displays information that you can use to diagnose Domain Name System (DNS) infrastructure.' },
  ping: { synopsis: 'Verifies IP-level connectivity to another TCP/IP computer by sending Internet Control Message Protocol (ICMP) echo Request messages.' },
  systeminfo: { synopsis: 'Displays detailed configuration information about a computer and its operating system, including operating system configuration, security information, product ID, and hardware properties.' },
  tasklist: { synopsis: 'Displays a list of currently running processes on the local computer or on a remote computer.' },
  tree: { synopsis: 'Displays the directory structure of a path or of the disk in a drive graphically.' },
  'where.exe': { synopsis: 'Displays the location of files that match the given search pattern. In PowerShell, type where.exe: where is an alias for Where-Object.' },
  whoami: { synopsis: 'Displays user, group and privileges information for the user who is currently logged on to the local system.' },
};

/** Programs that open a window rather than print, listed with the Windows programs. */
export const GUI_PROGRAMS = new Set(['notepad', 'explorer', 'ise', 'ipconfig']);

const ID_TYPE: [RegExp, string][] = [
  [/^(Get|Set|New|Remove)-ADUser$|^Get-ADUserResultantPasswordPolicy$/, 'ADUser'],
  [/ADGroupMember$|^(Get|Set|New|Remove)-ADGroup$/, 'ADGroup'],
  [/ADComputer$/, 'ADComputer'],
  [/ADOrganizationalUnit$/, 'ADOrganizationalUnit'],
  [/ADPrincipalGroupMembership$/, 'ADPrincipal'],
  [/^Get-ADDomain$/, 'ADDomain'],
  [/^Get-ADForest$/, 'ADForest'],
  [/^Get-ADDomainController$/, 'ADDomainController'],
  [/^Get-ADFineGrainedPasswordPolicy$/, 'ADFineGrainedPasswordPolicy'],
  [/ADObject$/, 'ADObject'],
  [/AD(Account|AccountPassword|AccountExpiration|AccountControl|AccountAuthorizationGroup)$/, 'ADAccount'],
];

const TYPES: Record<string, string> = {
  Filter: 'String', LDAPFilter: 'String', SearchBase: 'String', SearchScope: 'ADSearchScope', Properties: 'String[]', ResultSetSize: 'Int32',
  Members: 'ADPrincipal[]', MemberOf: 'ADGroup[]', TimeSpan: 'TimeSpan', DateTime: 'DateTime', NewPassword: 'SecureString', OldPassword: 'SecureString',
  TargetPath: 'String', Path: 'String', Name: 'String', Description: 'String', ManagedBy: 'ADPrincipal', GroupScope: 'ADGroupScope', GroupCategory: 'ADGroupCategory',
  UserId: 'String', GroupId: 'String', DirectoryRoleId: 'String', UserIds: 'String[]', Top: 'Int32', Property: 'String[]', Scopes: 'String[]', TenantId: 'String',
  PolicyType: 'String', ComputerName: 'String[]', ScriptBlock: 'ScriptBlock', FilterHashtable: 'Hashtable[]', LogName: 'String[]', MaxEvents: 'Int64',
  AccountEnabled: 'Boolean', PasswordNeverExpires: 'Boolean', ProtectedFromAccidentalDeletion: 'Boolean', Seconds: 'Double', Value: 'Object', Pattern: 'String[]',
  Prompt: 'Object', String: 'String', Count: 'Int32', Module: 'String[]', CommandType: 'CommandTypes', First: 'Int32', Last: 'Int32', Skip: 'Int32',
  ExpandProperty: 'String', FilterScript: 'ScriptBlock', Process: 'ScriptBlock[]', MemberName: 'String', InputObject: 'PSObject',
};

/** The .NET type Get-Help shows for a parameter. */
export function paramType(cmdlet: string, param: string): string {
  if (param === 'Identity') return ID_TYPE.find(([re]) => re.test(cmdlet))?.[1] ?? 'Object';
  return TYPES[param] ?? 'Object';
}
