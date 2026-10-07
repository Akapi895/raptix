"""Built-in artifact parsers — one module per scanner output format.

Each module exposes a parser class implementing the
:class:`~raptix.knowledge.ingest.registry.ArtifactParser` protocol
(``format_id`` / ``parser_version`` / ``supports`` / ``parse``).
``register_default_parsers`` registers every built-in with a registry;
parsers are internal services — none of them is or becomes an agent tool.

Ported from the former inline bodies of the ``kg_ingest_*`` agent tools
(``execution/tools/research/tools.py``) with behavior preserved:
same node keys, labels, props, edge weights, counters, and error strings.
The two pre-existing delegating services (``kg_ingest_sarif`` →
``research.sarif``, ``kg_ingest_slither`` → ``contracts.slither``) keep
their dedicated modules and are not registered here.
"""

from __future__ import annotations

from raptix.knowledge.ingest.parsers._shared import severity_from_string
from raptix.knowledge.ingest.registry import ParserRegistry

__all__ = ["ParserRegistry", "register_default_parsers", "severity_from_string"]


def register_default_parsers(registry: ParserRegistry) -> None:
    """Register every built-in parser. Re-registration replaces, so this
    is safe to call repeatedly."""
    from raptix.knowledge.ingest.parsers.asrep_hashes import AsrepHashesParser
    from raptix.knowledge.ingest.parsers.crackmapexec import CrackMapExecParser
    from raptix.knowledge.ingest.parsers.dnsx import DnsxParser
    from raptix.knowledge.ingest.parsers.ffuf import FfufParser
    from raptix.knowledge.ingest.parsers.gobuster import GobusterParser
    from raptix.knowledge.ingest.parsers.httpx_jsonl import HttpxJsonlParser
    from raptix.knowledge.ingest.parsers.impacket_txt import ImpacketTxtParser
    from raptix.knowledge.ingest.parsers.john_pot import JohnPotParser
    from raptix.knowledge.ingest.parsers.katana_jsonl import KatanaJsonlParser
    from raptix.knowledge.ingest.parsers.masscan import MasscanParser
    from raptix.knowledge.ingest.parsers.nikto_txt import NiktoTxtParser
    from raptix.knowledge.ingest.parsers.nmap_xml import NmapXmlParser
    from raptix.knowledge.ingest.parsers.nuclei_jsonl import NucleiJsonlParser
    from raptix.knowledge.ingest.parsers.peas_txt import PeasTxtParser
    from raptix.knowledge.ingest.parsers.pspy_log import PspyLogParser
    from raptix.knowledge.ingest.parsers.responder_log import ResponderLogParser
    from raptix.knowledge.ingest.parsers.slither_json import SlitherJsonParser
    from raptix.knowledge.ingest.parsers.snmpwalk_txt import SnmpwalkTxtParser
    from raptix.knowledge.ingest.parsers.sqlmap_log import SqlmapLogParser
    from raptix.knowledge.ingest.parsers.subfinder import SubfinderParser
    from raptix.knowledge.ingest.parsers.testssl import TestsslParser

    for parser in (
        AsrepHashesParser(),
        CrackMapExecParser(),
        DnsxParser(),
        FfufParser(),
        GobusterParser(),
        HttpxJsonlParser(),
        ImpacketTxtParser(),
        JohnPotParser(),
        KatanaJsonlParser(),
        MasscanParser(),
        NiktoTxtParser(),
        NmapXmlParser(),
        NucleiJsonlParser(),
        PeasTxtParser(),
        PspyLogParser(),
        ResponderLogParser(),
        SlitherJsonParser(),
        SnmpwalkTxtParser(),
        SqlmapLogParser(),
        SubfinderParser(),
        TestsslParser(),
    ):
        registry.register(parser)
