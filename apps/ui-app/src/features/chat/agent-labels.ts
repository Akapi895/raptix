/**
 * Human-readable labels for the raw specialist identifiers the runtime emits
 * (einoAgent / task()'s subagent_type -- see langgraph.json's registered graphs).
 * Without this, the Agents sidebar (workspace/workspace.ts) and the "[name] "
 * tool-call prefix (process/render-title.ts) show Python module names verbatim,
 * including a few that read as near-duplicates of each other (appsec_specialist
 * vs exploit) with nothing to tell them apart.
 */
const SPECIALIST_LABELS: Record<string, string> = {
  raptix: 'Raptix (orchestrator)',
  decepticon: 'Raptix (orchestrator)',
  recon: 'Recon',
  exploit: 'Exploit',
  appsec_specialist: 'App/API Pentest',
  postexploit: 'Post-Exploitation',
  ad_operator: 'Active Directory',
  cloud_hunter: 'Cloud',
  autohunt: 'Autohunt',
  soundwave: 'Report Writer',
  analyst: 'Analyst',
  reverser: 'Reverse Engineering',
  contract_auditor: 'Smart Contract Audit',
  blue_cell: 'Blue Cell (Defense)',
  phisher: 'Phishing',
  mobile_operator: 'Mobile',
  wireless_operator: 'Wireless',
  osint_operator: 'OSINT',
  iot_operator: 'IoT',
  ics_operator: 'ICS/SCADA',
  forensicator: 'Forensics',
  supply_chain_operator: 'Supply Chain',
};

/** Title-cases an unmapped identifier (`new_specialist` -> `New Specialist`) rather than
 *  leaking the raw snake_case name -- a safety net for specialists added after this list. */
function titleCase(name: string): string {
  return name.split(/[_\s]+/).filter(Boolean).map(word => word[0]!.toUpperCase() + word.slice(1)).join(' ');
}

export function specialistLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return SPECIALIST_LABELS[trimmed.toLowerCase()] ?? titleCase(trimmed);
}
