"""Nmap XML output parser (``nmap -oX``)."""

from __future__ import annotations

import defusedxml.ElementTree as ET

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix.knowledge.ingest.registry import ParseError
from raptix_core.types.capability import Artifact, Observation

_WEB_PORTS = {80, 81, 443, 3000, 5000, 7001, 8000, 8008, 8080, 8443, 8888}


def _is_web_port(port: int) -> bool:
    return port in _WEB_PORTS


class NmapXmlParser:
    format_id = "nmap_xml"
    parser_version = "1.0.0"

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
                service_key = f"service::{host_label}:{port}/{proto}"
                service_edges: list[dict[str, object]] = [
                    {"to_key": host_key, "kind": "HOSTS", "weight": 0.6}
                ]
                host_edges.append({"to_key": service_key, "kind": "EXPOSES", "weight": 0.6})

                if _is_web_port(port):
                    scheme = "https" if port in {443, 8443} else "http"
                    default_port = (scheme == "http" and port == 80) or (
                        scheme == "https" and port == 443
                    )
                    endpoint = (
                        f"{scheme}://{host_label}/"
                        if default_port
                        else f"{scheme}://{host_label}:{port}/"
                    )
                    entrypoint_key = f"entrypoint::{endpoint}"
                    service_edges.append(
                        {"to_key": entrypoint_key, "kind": "EXPOSES", "weight": 0.5}
                    )
                    observations.append(
                        node_observation(
                            "Entrypoint",
                            key=entrypoint_key,
                            label=endpoint,
                            props={
                                "source": scanner_hint,
                                "host": host_label,
                                "port": port,
                                "scheme": scheme,
                            },
                            edges_out=[{"to_key": service_key, "kind": "HOSTS", "weight": 0.5}],
                        )
                    )
                    entrypoints += 1

                observations.append(
                    node_observation(
                        "Service",
                        key=service_key,
                        label=f"{host_label}:{port}/{proto}",
                        props={
                            "host": host_label,
                            "port": port,
                            "protocol": proto,
                            "source": scanner_hint,
                            "service": service_name,
                            "product": product,
                            "version": version,
                        },
                        edges_out=service_edges,
                    )
                )
                services += 1

            observations.append(
                node_observation(
                    "Host",
                    key=host_key,
                    label=host_label,
                    props={"ip": ip, "hostname": hostname, "source": scanner_hint},
                    edges_out=host_edges,
                )
            )
            hosts += 1

        observations.append(
            summary_observation({"hosts": hosts, "services": services, "entrypoints": entrypoints})
        )
        return observations
