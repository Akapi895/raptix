import { useState, useRef, useEffect, useCallback } from 'react'


// ─── Types ────────────────────────────────────────────────────────────────────

type TerminalLine =
  | { type: 'prompt'; text: string }
  | { type: 'output'; text: string }
  | { type: 'ai'; text: string }
  | { type: 'cursor' }

type SessionSubTab = 'sessions' | 'listeners' | 'payload-generator' | 'tunnels'

interface SessionRow {
  id: string
  status: 'ACTIVE' | 'STALE' | 'DEAD'
  targetHost: string
  ip: string
  userPrivilege: string
  transport: string
  lastSeen: string
  hasTerminal: boolean
  // for terminal context
  username: string
  os: string
  platform: 'windows' | 'linux' | 'macos'
}

// ─── Static data ──────────────────────────────────────────────────────────────

const SESSIONS: SessionRow[] = [
  {
    id: 'SID-001',
    status: 'ACTIVE',
    targetHost: 'WORKSTATION-105',
    ip: '192.168.1.105',
    userPrivilege: 'ACME\\john.doe (User)',
    transport: 'HTTPS/443',
    lastSeen: '2s ago',
    hasTerminal: true,
    username: 'ACME\\john.doe',
    os: 'Windows 10',
    platform: 'windows',
  },
  {
    id: 'SID-002',
    status: 'ACTIVE',
    targetHost: 'SQL-SERVER-01',
    ip: '10.10.0.23',
    userPrivilege: 'ACME\\svc_sql (SvcAcct)',
    transport: 'SMB/445',
    lastSeen: '8s ago',
    hasTerminal: true,
    username: 'ACME\\svc_sql',
    os: 'Windows Server 2019',
    platform: 'windows',
  },
  {
    id: 'SID-003',
    status: 'ACTIVE',
    targetHost: 'UBUNTU-WEB',
    ip: '172.16.5.88',
    userPrivilege: 'root (Admin)',
    transport: 'TCP/4444',
    lastSeen: '1s ago',
    hasTerminal: true,
    username: 'root',
    os: 'Ubuntu 22.04 LTS',
    platform: 'linux',
  },
  {
    id: 'SID-004',
    status: 'ACTIVE',
    targetHost: 'MACBOOK-ALICE',
    ip: '192.168.1.201',
    userPrivilege: 'alice (User)',
    transport: 'HTTPS/443',
    lastSeen: '15s ago',
    hasTerminal: true,
    username: 'alice',
    os: 'macOS Ventura 13.4',
    platform: 'macos',
  },
  {
    id: 'SID-005',
    status: 'STALE',
    targetHost: 'LEGACY-WIN7',
    ip: '10.10.0.45',
    userPrivilege: 'Administrator',
    transport: 'TCP/8080',
    lastSeen: '5m ago',
    hasTerminal: true,
    username: 'Administrator',
    os: 'Windows 7 SP1',
    platform: 'windows',
  },
  {
    id: 'SID-006',
    status: 'DEAD',
    targetHost: 'WEB-DMZ',
    ip: '192.168.2.10',
    userPrivilege: 'www-data',
    transport: '—',
    lastSeen: '12m ago',
    hasTerminal: false,
    username: 'www-data',
    os: 'Debian 11',
    platform: 'linux',
  },
  {
    id: 'SID-007',
    status: 'ACTIVE',
    targetHost: 'WORKSTATION-115',
    ip: '10.10.1.15',
    userPrivilege: 'ACME\\jane.smith (User)',
    transport: 'HTTPS/443',
    lastSeen: '3s ago',
    hasTerminal: true,
    username: 'ACME\\jane.smith',
    os: 'Windows 10',
    platform: 'windows',
  },
  {
    id: 'SID-008',
    status: 'ACTIVE',
    targetHost: 'DC-BACKUP',
    ip: '192.168.1.99',
    userPrivilege: 'ACME\\admin (Admin)',
    transport: 'HTTPS/443',
    lastSeen: '5s ago',
    hasTerminal: true,
    username: 'ACME\\admin',
    os: 'Windows Server 2022',
    platform: 'windows',
  },
]

// ─── Default terminal histories ───────────────────────────────────────────────

const DEFAULT_HISTORIES: Record<string, TerminalLine[]> = {
  'SID-001': [
    { type: 'prompt', text: '[raptix@c2]$ whoami' },
    { type: 'output', text: 'ACME\\john.doe' },
    { type: 'output', text: '' },
    { type: 'prompt', text: '[raptix@c2]$ ipconfig' },
    { type: 'output', text: 'Windows IP Configuration' },
    { type: 'output', text: '' },
    { type: 'output', text: 'Ethernet adapter Ethernet0:' },
    { type: 'output', text: '   IPv4 Address. . . . . . . : 192.168.1.105' },
    { type: 'output', text: '   Subnet Mask . . . . . . . : 255.255.255.0' },
    { type: 'output', text: '   Default Gateway . . . . . : 192.168.1.1' },
    { type: 'output', text: '   DNS Servers . . . . . . . : 10.10.0.1' },
    { type: 'output', text: '' },
    { type: 'prompt', text: '[raptix@c2]$ net user /domain' },
    { type: 'output', text: 'Domain users list truncated (47 accounts)' },
    { type: 'output', text: '' },
    { type: 'ai', text: '[AI-GHOST]$ Enumerated domain users → 47 accounts. High-value targets: svc_sql (SPN set), Administrator. Initiating AS-REP roasting...' },
    { type: 'ai', text: '[AI-GHOST]$ Kerberoasting: 3 hashes extracted → /loot/krb5tgs.txt' },
    { type: 'output', text: '' },
  ],
  'SID-002': [
    { type: 'prompt', text: '[raptix@c2]$ whoami' },
    { type: 'output', text: 'ACME\\svc_sql' },
    { type: 'output', text: '' },
    { type: 'prompt', text: '[raptix@c2]$ hostname' },
    { type: 'output', text: 'SQL-SERVER-01' },
    { type: 'output', text: '' },
    { type: 'ai', text: '[AI-GHOST]$ Service account detected with SPN. Running Kerberoast attack...' },
    { type: 'ai', text: '[AI-GHOST]$ Hash captured: $krb5tgs$23$*svc_sql*ACME.LOCAL*... → /loot/svc_sql.hash' },
    { type: 'output', text: '' },
  ],
  'SID-003': [
    { type: 'prompt', text: '[raptix@c2]$ whoami' },
    { type: 'output', text: 'root' },
    { type: 'output', text: '' },
    { type: 'prompt', text: '[raptix@c2]$ hostname' },
    { type: 'output', text: 'UBUNTU-WEB' },
    { type: 'output', text: '' },
    { type: 'prompt', text: '[raptix@c2]$ pwd' },
    { type: 'output', text: '/root' },
    { type: 'output', text: '' },
    { type: 'ai', text: '[AI-GHOST]$ Root shell on Ubuntu. Dumping /etc/shadow for offline cracking...' },
    { type: 'ai', text: '[AI-GHOST]$ 8 password hashes saved → /loot/shadow.txt. Starting SOCKS5 pivot on 127.0.0.1:1080...' },
    { type: 'output', text: '' },
  ],
}

// ─── Command processor ────────────────────────────────────────────────────────

function processCommand(cmd: string, session: SessionRow): string[] {
  const c = cmd.trim().toLowerCase()
  const isWindows = session.platform === 'windows'

  if (c === 'whoami') {
    return [session.username]
  }
  if (c === 'hostname') {
    return [session.targetHost]
  }
  if (c === 'ipconfig' || c === 'ipconfig /all') {
    if (isWindows) {
      return [
        'Windows IP Configuration',
        '',
        'Ethernet adapter Ethernet0:',
        `   IPv4 Address. . . . . . . : ${session.ip}`,
        '   Subnet Mask . . . . . . . : 255.255.255.0',
        '   Default Gateway . . . . . : ' + session.ip.split('.').slice(0, 3).join('.') + '.1',
        '   DNS Servers . . . . . . . : 10.10.0.1',
      ]
    }
    return [`Command not found. Try 'ifconfig' on this platform.`]
  }
  if (c === 'ifconfig') {
    if (!isWindows) {
      return [
        'eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500',
        `        inet ${session.ip}  netmask 255.255.255.0  broadcast ${session.ip.split('.').slice(0, 3).join('.')}.255`,
        '        ether 00:0c:29:a1:b2:c3  txqueuelen 1000  (Ethernet)',
        '',
        'lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536',
        '        inet 127.0.0.1  netmask 255.0.0.0',
      ]
    }
    return [`Command not found. Try 'ipconfig' on this platform.`]
  }
  if (c === 'pwd') {
    if (isWindows) return ['C:\\Users\\' + session.username.replace('ACME\\', '')]
    if (session.username === 'root') return ['/root']
    return ['/home/' + session.username]
  }
  if (c === 'sudo -l') {
    if (isWindows) return [`'sudo' is not recognized as an internal or external command.`]
    if (session.username === 'root') {
      return [
        'Matching Defaults entries for root on this host:',
        '    env_reset, mail_badpass',
        '',
        'User root may run the following commands on this host:',
        '    (ALL : ALL) ALL',
      ]
    }
    return [
      `[sudo] password for ${session.username}:`,
      'Sorry, user ' + session.username + ' may not run sudo on this host.',
    ]
  }
  if (c === 'cat /etc/passwd') {
    if (isWindows) return [`'cat' is not recognized as an internal or external command.`]
    return [
      'root:x:0:0:root:/root:/bin/bash',
      'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
      'bin:x:2:2:bin:/bin:/usr/sbin/nologin',
      'sys:x:3:3:sys:/dev:/usr/sbin/nologin',
      'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin',
      `${session.username}:x:1000:1000::/home/${session.username}:/bin/bash`,
      '... (truncated)',
    ]
  }
  if (c === 'ls') {
    if (isWindows) {
      return [
        ' Directory of C:\\Users\\' + session.username.replace('ACME\\', ''),
        '',
        '09/29/2026  10:14    <DIR>          Desktop',
        '09/29/2026  10:14    <DIR>          Documents',
        '09/29/2026  09:55    <DIR>          Downloads',
        '09/29/2026  08:12               482 notes.txt',
        '09/29/2026  07:44    <DIR>          AppData',
      ]
    }
    return [
      'total 48',
      'drwxr-xr-x  8 ' + session.username + ' ' + session.username + ' 4096 Sep 29 10:14 .',
      'drwxr-xr-x 24 root root 4096 Sep 28 18:00 ..',
      '-rw-------  1 ' + session.username + ' ' + session.username + '  220 Sep 28 18:00 .bash_logout',
      '-rw-r--r--  1 ' + session.username + ' ' + session.username + ' 3526 Sep 28 18:00 .bashrc',
      'drwxr-xr-x  2 ' + session.username + ' ' + session.username + ' 4096 Sep 29 09:12 .ssh',
      '-rw-r--r--  1 ' + session.username + ' ' + session.username + '  807 Sep 28 18:00 .profile',
      '-rw-r--r--  1 ' + session.username + ' ' + session.username + '   87 Sep 29 10:01 readme.txt',
    ]
  }
  if (c === 'ps') {
    if (isWindows) {
      return [
        'Handles  NPM(K)    PM(K)      WS(K) VM(M)   CPU(s)     Id ProcessName',
        '-------  ------    -----      ----- -----   ------     -- -----------',
        '    414      18    10952      14628   ...    0.52   1024 svchost',
        '    312      14     6128       8204   ...    0.14   1340 explorer',
        '    189       9     3244       5012   ...    0.08   2468 notepad',
        '    256      11     4096       6400   ...    0.21   3120 chrome',
        '     98       6     1280       2048   ...    0.02   4016 cmd',
      ]
    }
    return [
      '  PID TTY          TIME CMD',
      '    1 ?        00:00:02 systemd',
      '  412 ?        00:00:00 sshd',
      ' 1024 pts/0    00:00:00 bash',
      ' 2048 ?        00:00:01 nginx',
      ' 2100 ?        00:00:00 mysql',
      ' 3012 pts/0    00:00:00 ps',
    ]
  }
  if (c === 'netstat -an') {
    return [
      isWindows ? 'Active Connections' : 'Active Internet connections (servers and established)',
      '',
      isWindows
        ? '  Proto  Local Address          Foreign Address        State'
        : 'Proto Recv-Q Send-Q Local Address           Foreign Address         State',
      isWindows
        ? '  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING'
        : 'tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN',
      isWindows
        ? '  TCP    0.0.0.0:443            0.0.0.0:0              LISTENING'
        : 'tcp        0      0 0.0.0.0:80              0.0.0.0:*               LISTEN',
      isWindows
        ? `  TCP    ${session.ip}:4444       10.10.100.5:59812      ESTABLISHED`
        : `tcp        0      0 ${session.ip}:4444      10.10.100.5:59812       ESTABLISHED`,
      isWindows
        ? '  TCP    0.0.0.0:3389           0.0.0.0:0              LISTENING'
        : 'tcp        0      0 0.0.0.0:443             0.0.0.0:*               LISTEN',
    ]
  }
  if (c === 'help') {
    return [
      'Available commands: whoami, hostname, ipconfig, ifconfig, pwd, sudo -l, cat /etc/passwd, ls, ps, netstat -an, help',
    ]
  }
  return ['Command not found or access denied.']
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function C2Sessions() {
  const [ghostMode, setGhostMode] = useState(true)
  const [sessionSubTab, setSessionSubTab] = useState<SessionSubTab>('sessions')
  const [activeSessionId, setActiveSessionId] = useState('SID-001')
  const [selectedRowId, setSelectedRowId] = useState<string | null>('SID-001')
  const [openTabs, setOpenTabs] = useState(['SID-001', 'SID-002', 'SID-003'])
  const [terminalHistories, setTerminalHistories] = useState<Record<string, TerminalLine[]>>(
    () => ({ ...DEFAULT_HISTORIES })
  )
  const [terminalInputs, setTerminalInputs] = useState<Record<string, string>>({})
  const [payloadOs, setPayloadOs] = useState('windows-x64')
  const [payloadFormat, setPayloadFormat] = useState('exe')

  const terminalEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // scroll to bottom when active session or history changes
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeSessionId, terminalHistories])

  // focus input when tab changes
  useEffect(() => {
    inputRef.current?.focus()
  }, [activeSessionId])

  const activeSession = SESSIONS.find(s => s.id === activeSessionId)
  const currentInput = terminalInputs[activeSessionId] ?? ''
  const currentHistory = terminalHistories[activeSessionId] ?? []

  const setCurrentInput = useCallback(
    (val: string) => setTerminalInputs(prev => ({ ...prev, [activeSessionId]: val })),
    [activeSessionId]
  )

  function openTerminalTab(sessionId: string) {
    if (!openTabs.includes(sessionId)) {
      setOpenTabs(prev => [...prev, sessionId])
    }
    setActiveSessionId(sessionId)
    setSelectedRowId(sessionId)
  }

  function closeTab(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation()
    const next = openTabs.filter(t => t !== sessionId)
    setOpenTabs(next)
    if (activeSessionId === sessionId) {
      setActiveSessionId(next.length > 0 ? next[next.length - 1] : '')
    }
  }

  function addNewTab() {
    const unopened = SESSIONS.filter(s => s.hasTerminal && !openTabs.includes(s.id))
    if (unopened.length === 0) return
    openTerminalTab(unopened[0].id)
  }

  function handleRowClick(session: SessionRow) {
    setSelectedRowId(session.id)
    if (session.hasTerminal) {
      openTerminalTab(session.id)
    }
  }

  function handleSendCommand() {
    const cmd = currentInput.trim()
    if (!cmd || !activeSession) return

    const promptLine: TerminalLine = {
      type: 'prompt',
      text: `[raptix@c2]$ ${cmd}`,
    }

    setTerminalHistories(prev => ({
      ...prev,
      [activeSessionId]: [...(prev[activeSessionId] ?? []), promptLine],
    }))
    setCurrentInput('')

    setTimeout(() => {
      const outputLines = processCommand(cmd, activeSession)
      const lines: TerminalLine[] = outputLines.map(t => ({ type: 'output', text: t }))
      lines.push({ type: 'output', text: '' })
      setTerminalHistories(prev => ({
        ...prev,
        [activeSessionId]: [...(prev[activeSessionId] ?? []), ...lines],
      }))
    }, 200)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleSendCommand()
    }
  }

  const activeCount = SESSIONS.filter(s => s.status === 'ACTIVE').length

  const subTabs: { id: SessionSubTab; label: string }[] = [
    { id: 'sessions', label: 'Sessions' },
    { id: 'listeners', label: 'Listeners' },
    { id: 'payload-generator', label: 'Payload Generator' },
    { id: 'tunnels', label: 'Tunnels' },
  ]

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#F8FAFC',
        overflow: 'hidden',
      }}
    >
      {/* ── TOP HALF ── */}
      <div
        style={{
          flex: '0 0 50%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          padding: '16px 20px 8px 20px',
          gap: '10px',
        }}
      >
        {/* Stat chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {/* Active Beacons */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              padding: '5px 12px',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#16A34A',
                flexShrink: 0,
                boxShadow: '0 0 0 2px #16A34A33',
              }}
            />
            <span
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '12px',
                fontWeight: 600,
                color: '#0F172A',
              }}
            >
              {activeCount} Active Beacons
            </span>
          </div>
          {/* Listeners */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              padding: '5px 12px',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#2563EB',
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '12px',
                fontWeight: 600,
                color: '#0F172A',
              }}
            >
              2 Listeners
            </span>
          </div>
          {/* Tunnels */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              padding: '5px 12px',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#7C3AED',
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '12px',
                fontWeight: 600,
                color: '#0F172A',
              }}
            >
              1 SOCKS5 Tunnel
            </span>
          </div>
        </div>

        {/* White card */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: '12px',
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          {/* Card header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              padding: '14px 20px 0 20px',
              borderBottom: '1px solid #E2E8F0',
              flexShrink: 0,
            }}
          >
            {/* Left: title + tabs */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <span
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 700,
                    fontSize: '15px',
                    color: '#0F172A',
                  }}
                >
                  Session Matrix
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                {subTabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setSessionSubTab(tab.id)}
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      fontWeight: sessionSubTab === tab.id ? 600 : 400,
                      fontSize: '13px',
                      color: sessionSubTab === tab.id ? '#DC2626' : '#64748B',
                      background: 'none',
                      border: 'none',
                      borderBottom:
                        sessionSubTab === tab.id ? '2px solid #DC2626' : '2px solid transparent',
                      padding: '0 14px 10px 14px',
                      cursor: 'pointer',
                      transition: 'color 0.15s',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Ghost mode toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '12px',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: '#475569',
                }}
              >
                {ghostMode ? 'AI Ghost Mode' : 'Manual Takeover'}
              </span>
              <button
                onClick={() => setGhostMode(g => !g)}
                aria-label="Toggle AI Ghost Mode"
                style={{
                  width: '44px',
                  height: '24px',
                  borderRadius: '12px',
                  background: ghostMode ? '#2563EB' : '#D97706',
                  border: 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'background 0.2s',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '3px',
                    left: ghostMode ? '23px' : '3px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: '#FFFFFF',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                    transition: 'left 0.2s',
                    display: 'block',
                  }}
                />
              </button>
              <span
                style={{
                  background: ghostMode ? '#DBEAFE' : '#FEF3C7',
                  color: ghostMode ? '#2563EB' : '#D97706',
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 700,
                  fontSize: '11px',
                  padding: '4px 12px',
                  borderRadius: '20px',
                  letterSpacing: '0.04em',
                }}
              >
                {ghostMode ? 'AI GHOST' : 'MANUAL'}
              </span>
            </div>
          </div>

          {/* Sub-tab content */}
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            {/* Sessions table */}
            {sessionSubTab === 'sessions' && (
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                    {['', 'Session ID', 'Target Host', 'IP Address', 'User / Privilege', 'Transport', 'Last Seen', 'Actions'].map(
                      (col, i) => (
                        <th
                          key={i}
                          style={{
                            padding: '9px 14px',
                            textAlign: 'left',
                            fontWeight: 600,
                            fontSize: '11px',
                            color: '#94A3B8',
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            whiteSpace: 'nowrap',
                            position: 'sticky',
                            top: 0,
                            background: '#F8FAFC',
                            zIndex: 1,
                          }}
                        >
                          {col}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {SESSIONS.map(session => {
                    const isSelected = selectedRowId === session.id
                    const dotColor =
                      session.status === 'ACTIVE'
                        ? '#16A34A'
                        : session.status === 'STALE'
                        ? '#D97706'
                        : '#94A3B8'
                    return (
                      <tr
                        key={session.id}
                        onClick={() => handleRowClick(session)}
                        style={{
                          background: isSelected ? '#FEF2F2' : '#FFFFFF',
                          borderBottom: '1px solid #F1F5F9',
                          borderLeft: isSelected ? '3px solid #DC2626' : '3px solid transparent',
                          cursor: 'pointer',
                          transition: 'background 0.1s',
                        }}
                      >
                        {/* Status dot */}
                        <td style={{ padding: '10px 14px', width: '28px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: dotColor,
                              boxShadow:
                                session.status === 'ACTIVE' ? `0 0 0 2px ${dotColor}33` : 'none',
                            }}
                          />
                        </td>
                        {/* Session ID */}
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              fontFamily: '"JetBrains Mono", monospace',
                              fontWeight: 600,
                              fontSize: '12px',
                              color: '#0F172A',
                            }}
                          >
                            {session.id}
                          </span>
                        </td>
                        {/* Target Host */}
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: '12px',
                              color: '#0F172A',
                              fontWeight: 500,
                            }}
                          >
                            {session.targetHost}
                          </span>
                        </td>
                        {/* IP */}
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: '12px',
                              color: '#2563EB',
                            }}
                          >
                            {session.ip}
                          </span>
                        </td>
                        {/* User / Privilege */}
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: '12px',
                              color: '#475569',
                            }}
                          >
                            {session.userPrivilege}
                          </span>
                        </td>
                        {/* Transport */}
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: '11px',
                              color:
                                session.transport === '—' ? '#94A3B8' : '#0F172A',
                            }}
                          >
                            {session.transport}
                          </span>
                        </td>
                        {/* Last Seen */}
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              fontSize: '12px',
                              color:
                                session.status === 'DEAD'
                                  ? '#94A3B8'
                                  : session.status === 'STALE'
                                  ? '#D97706'
                                  : '#475569',
                            }}
                          >
                            {session.lastSeen}
                          </span>
                        </td>
                        {/* Actions */}
                        <td
                          style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}
                          onClick={e => e.stopPropagation()}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {session.hasTerminal && (
                              <button
                                onClick={() => openTerminalTab(session.id)}
                                style={{
                                  fontFamily: 'Inter, sans-serif',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  color: '#DC2626',
                                  background: 'transparent',
                                  border: '1px solid #DC2626',
                                  borderRadius: '5px',
                                  padding: '4px 10px',
                                  cursor: 'pointer',
                                }}
                              >
                                Terminal
                              </button>
                            )}
                            <button
                              style={{
                                fontFamily: 'Inter, sans-serif',
                                fontSize: '11px',
                                fontWeight: 600,
                                color: '#475569',
                                background: 'transparent',
                                border: '1px solid #CBD5E1',
                                borderRadius: '5px',
                                padding: '4px 10px',
                                cursor: 'pointer',
                              }}
                              onMouseEnter={e => {
                                ;(e.currentTarget as HTMLButtonElement).style.color = '#DC2626'
                                ;(e.currentTarget as HTMLButtonElement).style.borderColor = '#DC2626'
                              }}
                              onMouseLeave={e => {
                                ;(e.currentTarget as HTMLButtonElement).style.color = '#475569'
                                ;(e.currentTarget as HTMLButtonElement).style.borderColor = '#CBD5E1'
                              }}
                            >
                              Kill
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {/* Listeners sub-tab */}
            {sessionSubTab === 'listeners' && (
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                    {['Protocol', 'Bind Address', 'Sessions', 'Status'].map((col, i) => (
                      <th
                        key={i}
                        style={{
                          padding: '9px 16px',
                          textAlign: 'left',
                          fontWeight: 600,
                          fontSize: '11px',
                          color: '#94A3B8',
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { proto: 'HTTPS/443', bind: '0.0.0.0', sessions: '6 sessions' },
                    { proto: 'TCP/4444', bind: '0.0.0.0', sessions: '1 session' },
                  ].map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#0F172A',
                          }}
                        >
                          {row.proto}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: '12px',
                            color: '#475569',
                          }}
                        >
                          {row.bind}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontSize: '12px', color: '#475569' }}>{row.sessions}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            background: '#DCFCE7',
                            color: '#16A34A',
                            fontFamily: 'Inter, sans-serif',
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 10px',
                            borderRadius: '20px',
                          }}
                        >
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: '#16A34A',
                            }}
                          />
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Payload Generator sub-tab */}
            {sessionSubTab === 'payload-generator' && (
              <div style={{ padding: '20px 24px', maxWidth: '480px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  {/* OS target */}
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontFamily: 'Inter, sans-serif',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#475569',
                        marginBottom: '8px',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                      }}
                    >
                      OS Target
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {['windows-x64', 'linux-x64', 'macos'].map(os => (
                        <label
                          key={os}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontFamily: 'Inter, sans-serif',
                            fontSize: '13px',
                            color: '#0F172A',
                            cursor: 'pointer',
                            background: payloadOs === os ? '#FEF2F2' : '#F8FAFC',
                            border: `1px solid ${payloadOs === os ? '#DC2626' : '#E2E8F0'}`,
                            borderRadius: '7px',
                            padding: '7px 14px',
                          }}
                        >
                          <input
                            type="radio"
                            name="os"
                            value={os}
                            checked={payloadOs === os}
                            onChange={() => setPayloadOs(os)}
                            style={{ accentColor: '#DC2626' }}
                          />
                          {os === 'windows-x64' ? 'Windows x64' : os === 'linux-x64' ? 'Linux x64' : 'macOS'}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Format */}
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontFamily: 'Inter, sans-serif',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#475569',
                        marginBottom: '8px',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Format
                    </label>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {['exe', 'dll', 'shellcode', 'powershell'].map(fmt => (
                        <label
                          key={fmt}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontFamily: 'Inter, sans-serif',
                            fontSize: '13px',
                            color: '#0F172A',
                            cursor: 'pointer',
                            background: payloadFormat === fmt ? '#FEF2F2' : '#F8FAFC',
                            border: `1px solid ${payloadFormat === fmt ? '#DC2626' : '#E2E8F0'}`,
                            borderRadius: '7px',
                            padding: '7px 14px',
                          }}
                        >
                          <input
                            type="radio"
                            name="format"
                            value={fmt}
                            checked={payloadFormat === fmt}
                            onChange={() => setPayloadFormat(fmt)}
                            style={{ accentColor: '#DC2626' }}
                          />
                          {fmt === 'exe' ? 'EXE' : fmt === 'dll' ? 'DLL' : fmt === 'shellcode' ? 'Shellcode' : 'PowerShell'}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* LHOST / LPORT */}
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <label
                        style={{
                          display: 'block',
                          fontFamily: 'Inter, sans-serif',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#475569',
                          marginBottom: '6px',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}
                      >
                        LHOST
                      </label>
                      <input
                        type="text"
                        defaultValue="192.168.100.10"
                        style={{
                          width: '100%',
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: '13px',
                          color: '#0F172A',
                          background: '#FFFFFF',
                          border: '1px solid #E2E8F0',
                          borderRadius: '7px',
                          padding: '8px 12px',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ width: '100px' }}>
                      <label
                        style={{
                          display: 'block',
                          fontFamily: 'Inter, sans-serif',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#475569',
                          marginBottom: '6px',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}
                      >
                        LPORT
                      </label>
                      <input
                        type="text"
                        defaultValue="443"
                        style={{
                          width: '100%',
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: '13px',
                          color: '#0F172A',
                          background: '#FFFFFF',
                          border: '1px solid #E2E8F0',
                          borderRadius: '7px',
                          padding: '8px 12px',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>

                  <button
                    style={{
                      alignSelf: 'flex-start',
                      background: '#DC2626',
                      color: '#FFFFFF',
                      fontFamily: 'Inter, sans-serif',
                      fontWeight: 700,
                      fontSize: '13px',
                      padding: '10px 24px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      letterSpacing: '0.02em',
                    }}
                  >
                    Generate Payload
                  </button>
                </div>
              </div>
            )}

            {/* Tunnels sub-tab */}
            {sessionSubTab === 'tunnels' && (
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                    {['Type', 'Bind Address', 'Via Session', 'Status'].map((col, i) => (
                      <th
                        key={i}
                        style={{
                          padding: '9px 16px',
                          textAlign: 'left',
                          fontWeight: 600,
                          fontSize: '11px',
                          color: '#94A3B8',
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#0F172A',
                        }}
                      >
                        SOCKS5
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: '12px',
                          color: '#475569',
                        }}
                      >
                        127.0.0.1:1080
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: '12px',
                          color: '#2563EB',
                        }}
                      >
                        SID-003
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          background: '#EDE9FE',
                          color: '#7C3AED',
                          fontFamily: 'Inter, sans-serif',
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: '20px',
                        }}
                      >
                        <span
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: '#7C3AED',
                          }}
                        />
                        Active
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ── BOTTOM HALF — Terminal Dock ── */}
      <div
        style={{
          flex: '0 0 50%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          padding: '0 20px 16px 20px',
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: '#0B0F19',
            borderRadius: '12px',
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          {/* Terminal header bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: '#111827',
              borderBottom: '1px solid #1F2937',
              height: '42px',
              flexShrink: 0,
            }}
          >
            {/* Tab bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'stretch',
                flex: 1,
                overflowX: 'auto',
                height: '100%',
              }}
            >
              {openTabs.map(tabId => {
                const isActive = tabId === activeSessionId
                const sess = SESSIONS.find(s => s.id === tabId)
                return (
                  <button
                    key={tabId}
                    onClick={() => setActiveSessionId(tabId)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '0 14px',
                      background: isActive ? '#0B0F19' : 'transparent',
                      border: 'none',
                      borderTop: isActive ? '2px solid #FFFFFF' : '2px solid transparent',
                      borderRight: '1px solid #1F2937',
                      cursor: 'pointer',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: '12px',
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? '#FFFFFF' : '#6B7280',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: sess?.status === 'ACTIVE' ? '#16A34A' : '#6B7280',
                        flexShrink: 0,
                      }}
                    />
                    {tabId}
                    <span
                      onClick={e => closeTab(e, tabId)}
                      style={{
                        marginLeft: '4px',
                        color: '#6B7280',
                        fontSize: '14px',
                        lineHeight: '1',
                        cursor: 'pointer',
                        padding: '1px 3px',
                        borderRadius: '2px',
                      }}
                    >
                      ×
                    </span>
                  </button>
                )
              })}
              {/* + button */}
              <button
                onClick={addNewTab}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '36px',
                  background: 'transparent',
                  border: 'none',
                  borderRight: '1px solid #1F2937',
                  cursor: 'pointer',
                  color: '#6B7280',
                  fontSize: '18px',
                  lineHeight: '1',
                  flexShrink: 0,
                }}
              >
                +
              </button>
            </div>

            {/* Center: session info */}
            {activeSession && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '0 16px',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: '11px',
                    color: '#9CA3AF',
                  }}
                >
                  {activeSession.ip}
                </span>
                <span style={{ color: '#374151', fontSize: '11px' }}>·</span>
                <span
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: '11px',
                    color: '#9CA3AF',
                  }}
                >
                  {activeSession.username}
                </span>
                <span style={{ color: '#374151', fontSize: '11px' }}>·</span>
                <span
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: '11px',
                    color: '#9CA3AF',
                  }}
                >
                  {activeSession.os}
                </span>
              </div>
            )}

            {/* Right: AI / interact */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0 14px',
                flexShrink: 0,
              }}
            >
              {ghostMode ? (
                <span
                  style={{
                    background: '#1D4ED8',
                    color: '#BFDBFE',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 700,
                    fontSize: '10px',
                    padding: '4px 10px',
                    borderRadius: '20px',
                    letterSpacing: '0.06em',
                  }}
                >
                  AI ACTIVE
                </span>
              ) : (
                <button
                  style={{
                    background: '#D97706',
                    color: '#FFFFFF',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 700,
                    fontSize: '11px',
                    padding: '5px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    letterSpacing: '0.02em',
                  }}
                >
                  INTERACT
                </button>
              )}
            </div>
          </div>

          {/* Terminal output area */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '14px 20px',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '12.5px',
              lineHeight: '1.7',
              minHeight: 0,
            }}
          >
            {currentHistory.map((line, idx) => {
              if (line.type === 'cursor') {
                return (
                  <div key={idx} style={{ color: '#4ADE80' }}>
                    <span>[raptix@c2]$ </span>
                    <span
                      style={{
                        display: 'inline-block',
                        width: '7px',
                        height: '14px',
                        background: '#4ADE80',
                        verticalAlign: 'text-bottom',
                        animation: 'blink 1s step-end infinite',
                      }}
                    />
                  </div>
                )
              }
              if (line.type === 'prompt') {
                const bracketEnd = line.text.indexOf(']$')
                const prefix = bracketEnd >= 0 ? line.text.slice(0, bracketEnd + 2) : ''
                const rest = bracketEnd >= 0 ? line.text.slice(bracketEnd + 2) : line.text
                return (
                  <div key={idx}>
                    <span style={{ color: '#4ADE80' }}>{prefix}</span>
                    <span style={{ color: '#E2E8F0' }}>{rest}</span>
                  </div>
                )
              }
              if (line.type === 'ai') {
                const bracketEnd = line.text.indexOf(']$')
                const prefix = bracketEnd >= 0 ? line.text.slice(0, bracketEnd + 2) : ''
                const rest = bracketEnd >= 0 ? line.text.slice(bracketEnd + 2) : line.text
                return (
                  <div key={idx}>
                    <span style={{ color: '#60A5FA', fontWeight: 600 }}>{prefix}</span>
                    <span style={{ color: '#60A5FA' }}>{rest}</span>
                  </div>
                )
              }
              // output
              return (
                <div key={idx} style={{ color: '#E2E8F0' }}>
                  {line.text === '' ? '\u00A0' : line.text}
                </div>
              )
            })}

            {/* Blinking cursor at bottom when no history ends with cursor line */}
            {(currentHistory.length === 0 ||
              currentHistory[currentHistory.length - 1]?.type !== 'cursor') && (
              <div style={{ color: '#4ADE80' }}>
                <span>[raptix@c2]$ </span>
                <span
                  style={{
                    display: 'inline-block',
                    width: '7px',
                    height: '14px',
                    background: '#4ADE80',
                    verticalAlign: 'text-bottom',
                    animation: 'blink 1s step-end infinite',
                  }}
                />
              </div>
            )}

            <div ref={terminalEndRef} />
          </div>

          {/* Terminal input bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: '#0D1117',
              borderTop: '1px solid #1F2937',
              padding: '8px 16px',
              gap: '10px',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: '13px',
                color: '#4ADE80',
                flexShrink: 0,
              }}
            >
              &gt;_
            </span>
            <input
              ref={inputRef}
              type="text"
              value={currentInput}
              onChange={e => setCurrentInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={activeSession ? `Enter command for ${activeSession.id}...` : 'Select a session tab...'}
              disabled={!activeSession}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: '12.5px',
                color: '#E2E8F0',
                caretColor: '#4ADE80',
              }}
            />
            <button
              onClick={handleSendCommand}
              disabled={!currentInput.trim() || !activeSession}
              style={{
                background: currentInput.trim() && activeSession ? '#1F2937' : '#111827',
                border: '1px solid #374151',
                borderRadius: '5px',
                padding: '5px 16px',
                fontFamily: 'Inter, sans-serif',
                fontSize: '12px',
                fontWeight: 600,
                color: currentInput.trim() && activeSession ? '#D1D5DB' : '#4B5563',
                cursor: currentInput.trim() && activeSession ? 'pointer' : 'default',
                flexShrink: 0,
              }}
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Global styles */}
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap');
      `}</style>
    </div>
  )
}
