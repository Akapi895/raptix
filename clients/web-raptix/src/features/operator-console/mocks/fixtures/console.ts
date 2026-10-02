// DEMO public-action sample — static fixtures for the Operator Console timeline.
// Public tool actions/observations only: no fabricated agent private reasoning
// and no hardcoded OPSEC/EDT telemetry claims. Not live run data — the live
// run state, agents and HITL approvals come from features/agent-runs/store.

export type ConsoleActionStatus = 'running' | 'completed' | 'failed'

export interface DemoActionCard {
  type: 'action'
  id: string
  tool: string
  args: Record<string, string>
  status: ConsoleActionStatus
}

export interface DemoObservationCard {
  type: 'observation'
  id: string
  summary: string
  terminalOutput: string
}

export interface DemoOperatorCard {
  type: 'operator'
  id: string
  message: string
}

export type DemoTimelineEvent = DemoActionCard | DemoObservationCard | DemoOperatorCard

export const CONSOLE_DEMO_LABEL = 'DEMO public-action sample'

export const DEMO_TIMELINE_EVENTS: DemoTimelineEvent[] = [
  {
    type: 'operator',
    id: 'ev-1',
    message: 'Begin network enumeration from established foothold on 10.10.14.22.',
  },
  {
    type: 'action',
    id: 'ev-3',
    tool: 'nmap',
    args: { target: '10.10.14.0/24', flags: '-sS -T3 -p 22,80,443,445,3389' },
    status: 'completed',
  },
  {
    type: 'observation',
    id: 'ev-4',
    summary: '14 live hosts discovered. DC01 at 10.10.14.67 (ports 88, 445, 3389 open).',
    terminalOutput: `Starting Nmap 7.94 ( https://nmap.org ) at 2026-09-29 14:22 UTC
Nmap scan report for 10.10.14.1
Host is up (0.0021s latency).
Nmap scan report for 10.10.14.10
Host is up (0.0019s latency).
Nmap scan report for 10.10.14.15
Host is up (0.0025s latency).
...
Nmap scan report for 10.10.14.67 (DC01.ACME.LOCAL)
Host is up (0.0018s latency).
PORT     STATE SERVICE
88/tcp   open  kerberos-sec
445/tcp  open  microsoft-ds
3389/tcp open  ms-wbt-server

Nmap done: 256 IP addresses (14 hosts up) scanned in 47.32 seconds`,
  },
  {
    type: 'action',
    id: 'ev-6',
    tool: 'crackmapexec',
    args: { target: '10.10.14.67', protocol: 'smb', wordlist: 'rockyou-top100.txt' },
    status: 'completed',
  },
  {
    type: 'observation',
    id: 'ev-7',
    summary: 'Valid credential found: CORP\\svc_backup:P@ssword2024! — local admin on DC01.',
    terminalOutput: `SMB         10.10.14.67     445    DC01             [*] Windows Server 2022 Build 20348 x64
SMB         10.10.14.67     445    DC01             [+] CORP\\svc_backup:P@ssword2024! (Pwn3d!)
SMB         10.10.14.67     445    DC01             [+] Enumerating shares...
SHARE           Permissions     Remark
-----           -----------     ------
ADMIN$          READ,WRITE      Remote Admin
C$              READ,WRITE      Default share
IPC$            READ            Remote IPC
SYSVOL          READ            Logon server share
NETLOGON        READ            Logon server share

[*] Completed spray in 12.4s — 1 valid credential`,
  },
]
