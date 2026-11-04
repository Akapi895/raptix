---
name: dfir-overview
description: >
  Use to close the Offensive Vaccine loop on the defender side. The Detector
  agent produces Sigma / YARA rules from offensive operations; this catalog
  validates those rules against real memory dumps, event logs, and forensic
  artifacts using Volatility 3, plaso, and sigma-cli. Without this catalog,
  detection rules are theoretical.
metadata:
  subdomain: dfir
  when_to_use: "dfir validation sigma yara volatility plaso memory dump event log forensic artifact detection rule blue team"
  tags: dfir, memory, volatility, plaso, sigma, validation, blue-team
  upstream_ref: "Sigma rules + YARA + Volatility 3 + plaso — detection-rule validation harness for the Offensive Vaccine loop"
  runtime_note: "No automated tool adapter — all commands run manually in the sandbox terminal"
---

# Forensicator / DFIR Skill Catalog

> **Runtime note:** This system does not expose a DFIR tool adapter. All commands
> below are run manually in the sandbox terminal (same shell you use for offensive
> tooling). Treat this file as a runbook, not as a skill the agent can auto-execute.

Raptix emits attacks AND detection rules. This catalog feeds the
detection rules back through real forensic artifacts to confirm they fire
— closing the Offensive Vaccine loop on the operations side.

## Playbooks

> **Inline technique reference — not separately loadable skills.** The entries below
> are summarized here for direct use; there is no separate `SKILL.md` to open for
> each. Do NOT call the skill loader on them — apply the technique with your tools
> using this summary and the Workflow in this file.


| Technique | Use for | Example command |
|---|---|---|
| **volatility-windows** | Windows plugins: pslist, malfind, cmdline, netscan, dlllist, handles | `vol -f mem.raw windows.pslist` · `vol -f mem.raw windows.malfind` · `vol -f mem.raw windows.netscan` |
| **volatility-linux** | Linux plugins | `vol -f mem.raw linux.pslist` · `vol -f mem.raw linux.bash` · `vol -f mem.raw linux.malfind` |
| **plaso-timeline** | Super-timeline from disk image or collected artifacts | `log2timeline.py timeline.plaso image.dd` · `psort.py -o timeline.csv timeline.plaso` |
| **sigma-cli-validation** | Convert Sigma rule + match against evtx or sqlite | `sigma convert -t sqlite sigma.yml -o rule.sql` · `sigma check rule.yml` |
| **yara-scan** | Memory dumps and disk images | `yr scan rules.yar mem.raw` · `yr scan -r rules/ image_mount/` |
| **event-log-mining** | .evtx extraction + key event IDs | `EvtxECmd.exe -f Security.evtx --csv out/` · PowerShell `Get-WinEvent -Path Security.evtx` |
| **etw-trace** | ETW provider triage + .etl extraction | `tracerpt trace.etl -o trace.xml -of XML` |
| **edr-validation** | Live-system replay with Velociraptor / OSQuery | `velociraptor.exe --config client.config.yaml client -v` (query via notebook) |

## Loop closure workflow

1. **Run an offensive technique** (e.g., `dcsync` from the ad-operator agent).
2. **Detector agent emits Sigma rule** describing the expected detection
   pattern (event 4662 with right `ControlAccessRights`, etc.).
3. **Defender pushes the Sigma to the customer SIEM** via
   `sigma_to_splunk_savedsearch` / `sigma_to_sentinel_analyticrule` /
   `sigma_to_elastic_detection_rule`.
4. **Forensicator validates** by:
   - Collecting the event log from the DC at attack time.
   - Importing the collected EVTX into SQLite with EvtxECmd, converting the
     Sigma rule with `sigma convert -t sqlite`, and matching against the DB.

     ```bash
     # 4a. Pull the DC Security log covering the attack window
     wevtutil epl Security C:\Evidence\dc_security.evtx
     wevtutil epl "Microsoft-Windows-Security-Auditing" C:\Evidence\dc_auditing.evtx

     # 4b. Import EVTX into SQLite using EvtxECmd (creates the schema Sigma expects)
     EvtxECmd.exe -f C:\Evidence\dc_security.evtx --sqlite C:\Evidence\dc_security.db

     # 4c. Convert Sigma rule to SQLite-flavored SQL and execute against the imported DB
     sigma convert -t sqlite --without-pipeline rules/dcsync_4662.yml > rules/dcsync.sql
     sqlite3 C:\Evidence\dc_security.db < rules/dcsync.sql
     # Row count = match count. 0 matches → rule has a bug (scope, field name, event ID).
     # N matches → validate against a known-benign baseline to rule out false positives.

     # 4d. Optional: YARA sanity-check against LSASS dump if captured
     yr scan rules/lsass_access.yar C:\Evidence\lsass.dmp
     ```

   - If the match count is 0 → detection rule has a bug. Iterate with
     Detector.
   - If match count is N → detection works. Record the validation
     evidence in the engagement knowledge graph.
5. **Patcher proposes the fix**; Forensicator validates the patch
   doesn't break the detection (verify the rule still fires on attempted
   exploitation of the patched build).

## Tools sandbox

- Volatility 3 (`vol`, `volshell`) — already in operator's AGENTS.md tooling.
- plaso (`log2timeline`, `psort`).
- sigma-cli (`sigma convert`, `sigma check`).
- yara-x (`yr`) — operator already has it installed at `C:\Tools\yara-x\yr.exe`.
- Velociraptor + OSQuery (for live-system validation paths).

## Defender View (what analysts look for)

When validating that a detection rule actually works, the forensics analyst's
mindset is the test oracle. Key question: **would a competent analyst see this
without the rule?** If yes, the rule is redundant or too specific; if no, the
rule has value.

Common analyst triage paths during a suspected intrusion:

- **Timeline first.** plaso super-timeline over disk image, filtered to ±2h of
  alert time. Anti-forensic gaps (missing Prefetch for a binary that ran, USN
  journal deleted, `.evtx` with fresh creation time) are more suspicious than
  the activity itself.
- **Process tree from memory.** `vol windows.pstree` reconstructs parent-child
  relationships. Orphaned `cmd.exe`/`powershell.exe` under a service or unusual
  user is high-signal.
- **Network pivots.** `vol windows.netscan` for established connections; cross-
  reference destination IPs with the SIEM's outbound proxy logs.
- **Registry + filesystem coupling.** Shimcache/Amcache entry with no
  corresponding file on disk = execution then deletion. This is the single most
  common tell that cleanup was attempted.
- **Log integrity.** EventID 1102 in Security log = someone cleared it.
  EventID 104 in System log = same. Absence of these but a Security log with
  fresh creation time is equally suspicious.

Use this list as the negative-control checklist for every Sigma/YARA rule you
ship: if the rule fires on a synthetic version of the attack but an analyst
following this workflow would still miss it, the rule is not sufficient.

## Why this is differentiating

Strix doesn't have this. XBOW doesn't have this. The "Offensive Vaccine"
promise (every attack becomes a defense improvement) is only deliverable
when someone validates the detection. Without Forensicator, the loop
stops at "rule written". With it, the loop completes at "rule verified to
fire on this attack class against this client's stack".
