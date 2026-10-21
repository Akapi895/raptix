"""Nmap XML output parser (``nmap -oX``).

The graph shape matches the legacy adapter in ``knowledge/graph/ingest.py``, so a scan written by either
path lands on the same keys and edges: ``service::<ip>:<port>`` is a Service that the Host reaches with
``HOSTS``, and a web port gives an ``entrypoint::<scheme>://<host>:<port>/`` that the Host reaches with
``HAS``. The asset map's inspector reads exactly these edges.
"""

from __future__ import annotations

import defusedxml.ElementTree as ET

from raptix.knowledge.graph.asset_identity import WEB_PORTS
from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix.knowledge.ingest.registry import ParseError
from raptix_core.types.capability import Artifact, Observation


class NmapXmlParser:
    format_id = "nmap_xml"
    parser_version = "1.1.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        head = content[:4096].lstrip()
        if head.startswith(b"<nmaprun"):
            return 0.9
        if head.startswith(b"<?xml") and b"<nmaprun" in content[:65536]:
            return 0.9
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        scanner_hint = str(artifact.metadata.get("scanner_hint") or "nmap")
        try:
            root = ET.fromstring(content)
        except ET.ParseError as exc:
            raise ParseError(f"failed to parse nmap xml: {exc}") from exc
        observations: list[Observation] = []
        hosts = 0
        services = 0
        entrypoints = 0

        for host_el in root.findall("host"):
            status = host_el.find("status")
            if status is not None and status.get("state") not in {None, "up"}:
                continue
            addr_el = host_el.find("address[@addrtype='ipv4']")
            if addr_el is None:
                addr_el = host_el.find("address")
            if addr_el is None:
                continue
            ip = addr_el.get("addr")
            if not ip:
                continue
            hostname_el = host_el.find("hostnames/hostname")
            hostname = hostname_el.get("name") if hostname_el is not None else ""
            host_label = hostname or ip
            host_key = f"host::{ip}"
            host_edges: list[dict[str, object]] = []

            for port_el in host_el.findall("ports/port"):
                state_el = port_el.find("state")
                if state_el is None or state_el.get("state") != "open":
                    continue
                try:
                    port = int(port_el.get("portid", "0"))
                except ValueError:
                    continue
                proto = port_el.get("protocol", "tcp")
                service_el = port_el.find("service")
                service_name = service_el.get("name") if service_el is not None else "unknown"
                product = service_el.get("product") if service_el is not None else ""
                version = service_el.get("version") if service_el is not None else ""
                service_key = f"service::{ip}:{port}"
                host_edges.append({"to_key": service_key, "kind": "HOSTS", "weight": 0.5})
                observations.append(
                    node_observation(
                        "Service",
                        key=service_key,
                        label=f"{ip}:{port}/{proto}",
                        props={
                            "port": port,
                            "protocol": proto,
                            "service": service_name,
                            "product": product or "",
                            "version": version or "",
                            "source": scanner_hint,
                        },
                    )
                )
                services += 1

                if port in WEB_PORTS:
                    scheme = "https" if port in {443, 8443} else "http"
                    url = f"{scheme}://{host_label}:{port}/"
                    entrypoint_key = f"entrypoint::{url}"
                    host_edges.append({"to_key": entrypoint_key, "kind": "HAS", "weight": 0.5})
                    observations.append(
                        node_observation(
                            "Entrypoint",
                            key=entrypoint_key,
                            label=url,
                            props={
                                "scheme": scheme,
                                "host": host_label,
                                "port": port,
                                "source": scanner_hint,
                            },
                        )
                    )
                    entrypoints += 1

            observations.append(
                node_observation(
                    "Host",
                    key=host_key,
                    label=host_label,
                    props={
                        "ip": ip,
                        "hostname": hostname or "",
                        "explored": True,
                        "source": scanner_hint,
                    },
                    edges_out=host_edges,
                )
            )
            hosts += 1

        observations.append(
            summary_observation({"hosts": hosts, "services": services, "entrypoints": entrypoints})
        )
        return observations
