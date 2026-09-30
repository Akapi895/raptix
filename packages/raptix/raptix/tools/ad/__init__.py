"""Active Directory / Windows offensive tooling.

- ``bloodhound`` — import BloodHound JSON dumps into the KnowledgeGraph
                   so the chain planner can walk AD attack paths alongside
                   web/cloud findings.
- ``kerberos``   — parse Kerberos ticket blobs (Base64 .kirbi / hashcat
                   krb5tgs format), classify Kerberoastable users,
                   AS-REP roastable users.
- ``adcs``       — ADCS ESC1-ESC15 template scoring (offline analyser).
- ``delegation`` — Delegation attack path analysis (unconstrained, constrained, RBCD).
- ``gpo``        — GPO abuse path analysis.
- ``shadow_creds`` — Shadow Credentials (msDS-KeyCredentialLink) analysis.
- ``dpapi``      — DPAPI blob triage heuristics.
- ``dcsync``     — Indicator checker for DCSync-capable principals.

"""

from __future__ import annotations

from raptix.tools.ad.adcs import ADCSFinding, analyze_adcs_templates
from raptix.tools.ad.bloodhound import ingest_bloodhound_zip, merge_bloodhound_json
from raptix.tools.ad.dcsync import dcsync_candidates
from raptix.tools.ad.delegation import DelegationFinding, analyze_delegation
from raptix.tools.ad.gpo import GPOFinding, analyze_gpo_abuse
from raptix.tools.ad.kerberos import KerberosTicket, classify_hashcat_hash, parse_ticket
from raptix.tools.ad.shadow_creds import ShadowCredsFinding, analyze_shadow_credentials

__all__ = [
    "ADCSFinding",
    "DelegationFinding",
    "GPOFinding",
    "KerberosTicket",
    "ShadowCredsFinding",
    "analyze_adcs_templates",
    "analyze_delegation",
    "analyze_gpo_abuse",
    "analyze_shadow_credentials",
    "classify_hashcat_hash",
    "dcsync_candidates",
    "ingest_bloodhound_zip",
    "merge_bloodhound_json",
    "parse_ticket",
]
