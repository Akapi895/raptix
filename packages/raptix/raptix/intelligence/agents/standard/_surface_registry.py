"""Surface-exploit vulnerability registry and deterministic cell helpers."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Sequence

from raptix_core.types.engagement import EffectClass

Surface = Mapping[str, Any]
Applicability = Callable[[Surface], bool]


@dataclass(frozen=True)
class VulnClassSpec:
    """One registered vulnerability class consumed by matrix builders."""

    name: str
    skill_slug: str
    mitre: str
    tool_hints: tuple[str, ...]
    applies: Applicability
    # ADR-0077 fan-out annotation: probe work for the class is read-only
    # observation unless the class inherently writes state (authz write
    # checks, SSRF to internal services). Classes default to READ so the
    # admission gate lets same-surface probes overlap.
    effects: EffectClass = EffectClass.READ

    @property
    def skill_path(self) -> str:
        return f"/skills/standard/surface_exploit/{self.skill_slug}/SKILL.md"


def _props(surface: Surface) -> Mapping[str, Any]:
    value = surface.get("props")
    return value if isinstance(value, Mapping) else surface


def _text(surface: Surface) -> str:
    props = _props(surface)
    values = [surface.get("key", ""), props.get("url", ""), props.get("path", "")]
    return " ".join(str(value).lower() for value in values if value)


def _parameter_names(surface: Surface) -> set[str]:
    props = _props(surface)
    raw = surface.get("parameters", props.get("parameters", []))
    if isinstance(raw, Mapping):
        raw = raw.keys()
    if not isinstance(raw, (list, tuple, set)):
        return set()
    names: set[str] = set()
    for item in raw:
        if isinstance(item, Mapping):
            item = item.get("name", "")
        if isinstance(item, str):
            names.add(item.lower().strip())
    return names


def _has_parameter(surface: Surface, names: set[str]) -> bool:
    return bool(_parameter_names(surface) & names)


def _has_form(surface: Surface) -> bool:
    props = _props(surface)
    return bool(surface.get("forms") or props.get("form") or props.get("forms"))


def _sqli(surface: Surface) -> bool:
    return _has_parameter(surface, {"id", "q", "query", "search", "filter", "sort", "page"})


def _xss(surface: Surface) -> bool:
    props = _props(surface)
    return (
        _has_form(surface)
        or _has_parameter(surface, {"q", "query", "search", "name", "comment", "message", "title"})
        or str(props.get("content_type", "")).lower().startswith("text/html")
    )


def _idor(surface: Surface) -> bool:
    return _has_parameter(
        surface, {"id", "uuid", "user_id", "userid", "object_id", "objectid"}
    ) or (
        "/api/" in _text(surface)
        and bool(re.search(r"/(?:users?|objects?|accounts?)/[^/]+", _text(surface)))
    )


def _ssrf(surface: Surface) -> bool:
    return _has_parameter(
        surface, {"url", "uri", "link", "endpoint", "callback", "webhook", "fetch", "redirect"}
    )


def _authn_jwt(surface: Surface) -> bool:
    props = _props(surface)
    auth_model = str(surface.get("auth_model", props.get("auth_model", ""))).lower()
    return "jwt" in auth_model or any(
        token in _text(surface) for token in ("/login", "/token", "/oauth", "/auth")
    )


def _authz(surface: Surface) -> bool:
    props = _props(surface)
    auth_model = str(surface.get("auth_model", props.get("auth_model", "none"))).lower()
    return any(
        token in _text(surface) for token in ("/admin", "/private", "/manage", "/user")
    ) or auth_model not in {
        "",
        "none",
    }


def _ssti(surface: Surface) -> bool:
    return _has_parameter(surface, {"template", "name", "subject", "title", "message"})


def _xxe(surface: Surface) -> bool:
    props = _props(surface)
    content_type = str(props.get("content_type", props.get("body_type", ""))).lower()
    return "xml" in content_type or ".xml" in _text(surface)


def _open_redirect(surface: Surface) -> bool:
    return _has_parameter(surface, {"redirect", "next", "return", "continue", "url", "return_to"})


def _graphql(surface: Surface) -> bool:
    return (
        "/graphql" in _text(surface)
        or str(_props(surface).get("protocol", "")).lower() == "graphql"
    )


def _decode_props(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (TypeError, ValueError):
            return {}
        return dict(decoded) if isinstance(decoded, Mapping) else {}
    return {}


def surfaces_from_kg_inventory(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Normalize scoped Endpoint rows and their typed KG children."""
    surfaces: list[dict[str, Any]] = []
    for row in rows:
        props = _decode_props(row.get("props_json", row.get("props")))
        key = str(row.get("key") or props.get("url") or props.get("path") or "")
        if not key:
            continue
        surface: dict[str, Any] = {"key": key, "props": props}
        children = row.get("children") or row.get("related") or []
        parameters: list[dict[str, Any]] = []
        forms: list[dict[str, Any]] = []
        technologies: list[dict[str, Any]] = []
        for child in children if isinstance(children, list) else []:
            if not isinstance(child, Mapping) or not child.get("key"):
                continue
            child_props = _decode_props(child.get("props_json", child.get("props")))
            child_value = {
                "key": str(child["key"]),
                "label": str(child.get("label") or child["key"]),
                "props": child_props,
            }
            kind = str(child.get("kind") or "").lower()
            if kind == "parameter":
                parameters.append(
                    {
                        **child_value,
                        "name": child_props.get("name") or child_value["label"],
                    }
                )
            elif kind == "form":
                forms.append(child_value)
            elif kind == "technology":
                technologies.append(child_value)
            elif kind == "authmodel":
                surface["auth_model"] = (
                    child_props.get("model") or child_props.get("name") or child_value["label"]
                )
        if parameters:
            surface["parameters"] = sorted(parameters, key=lambda item: str(item["key"]))
        if forms:
            surface["forms"] = sorted(forms, key=lambda item: str(item["key"]))
        if technologies:
            surface["technologies"] = sorted(technologies, key=lambda item: str(item["key"]))
        surfaces.append(surface)
    return surfaces


VULN_CLASS_REGISTRY: tuple[VulnClassSpec, ...] = (
    VulnClassSpec("sqli", "sqli", "T1190", ("http_request", "http_history"), _sqli),
    VulnClassSpec("xss", "xss", "T1190", ("http_request", "http_history"), _xss),
    VulnClassSpec("idor", "idor", "T1190", ("http_request", "http_history"), _idor),
    VulnClassSpec(
        "ssrf",
        "ssrf",
        "T1190",
        ("http_request", "proxy_send_request"),
        _ssrf,
        effects=EffectClass.MUTATE,
    ),
    VulnClassSpec(
        "authn_jwt", "authn_jwt", "T1078, T1190", ("jwt_parse", "http_request"), _authn_jwt
    ),
    VulnClassSpec(
        "authz",
        "authz",
        "T1190",
        ("http_request", "http_history"),
        _authz,
        effects=EffectClass.MUTATE,
    ),
    VulnClassSpec("ssti", "ssti", "T1190", ("http_request",), _ssti),
    VulnClassSpec("xxe", "xxe", "T1190", ("http_request",), _xxe),
    VulnClassSpec("open_redirect", "open_redirect", "T1190", ("http_request",), _open_redirect),
    VulnClassSpec("graphql", "graphql", "T1190", ("graphql_plan", "http_request"), _graphql),
)

VULN_CLASSES: dict[str, VulnClassSpec] = {spec.name: spec for spec in VULN_CLASS_REGISTRY}


def applicable_vuln_classes(surface: Surface) -> tuple[str, ...]:
    """Return registered classes applicable to one normalized surface."""
    return tuple(spec.name for spec in VULN_CLASS_REGISTRY if spec.applies(surface))


def session_name_for_cell(cell_id: str) -> str:
    """Return a short deterministic session name unique to one matrix cell."""
    digest = hashlib.sha1(cell_id.encode("utf-8"), usedforsecurity=False).hexdigest()[:12]
    return f"se-{digest}"


# Technologies observed, in a real engagement, to wedge permanently under
# concurrent load — single-worker dev servers with no request queue, where
# one blocked request starves every sibling dispatch probing the same host
# (see docs/design/2026-10-12-p4-system-optimization-research.md, "self-DoS
# wedge"). Keep this list short and evidence-anchored: add an entry only
# after a real incident confirms it, never on suspicion that a technology
# is "probably" single-threaded.
FRAGILE_UNDER_CONCURRENCY: frozenset[str] = frozenset({"werkzeug"})

DEFAULT_RESILIENCE_CAP = 3
FRAGILE_RESILIENCE_CAP = 1


def independent_cell_count(cells: Sequence[Mapping[str, Any]]) -> int:
    """Count cells with no ``via_cell`` lineage (not chain-dependent).

    A cell carrying ``via_cell`` was produced by re-expanding a just-confirmed
    parent cell — it depends on that parent's outcome and must not be counted
    toward "independent work available to fan out".
    """
    return sum(1 for cell in cells if not cell.get("via_cell"))


def _surface_technology_names(surface: Surface) -> set[str]:
    props = _props(surface)
    raw = surface.get("technologies", props.get("technologies", []))
    if not isinstance(raw, (list, tuple)):
        return set()
    names: set[str] = set()
    for item in raw:
        label = item.get("label") if isinstance(item, Mapping) else item
        if label:
            names.add(str(label).lower())
    return names


def server_resilience_cap(surfaces: Sequence[Surface]) -> int:
    """Return the fan-out width a detected technology can safely tolerate.

    Narrow and evidence-anchored: only a technology in
    ``FRAGILE_UNDER_CONCURRENCY`` caps below the prior default of 3. Matching
    is substring-based (technology labels carry versions, e.g. "Werkzeug/3.0")
    rather than exact, but the fragile set itself stays short and specific.
    Unknown or unmatched technology is not assumed safe for wider fan-out —
    it stays at the default instead.
    """
    for surface in surfaces:
        names = _surface_technology_names(surface)
        if any(fragile in name for name in names for fragile in FRAGILE_UNDER_CONCURRENCY):
            return FRAGILE_RESILIENCE_CAP
    return DEFAULT_RESILIENCE_CAP


def recommended_in_flight(cells: Sequence[Mapping[str, Any]], surfaces: Sequence[Surface]) -> int:
    """Advisory fan-out width: independent cells, bounded by server resilience.

    Advisory only — ``DispatchMiddleware`` (ADR-0067) enforces the real
    per-engagement concurrency ceiling at the dispatch chokepoint regardless
    of this number; this value only tells the orchestrator whether building
    the coverage matrix is worth the coordination cost in the first place.
    """
    return min(independent_cell_count(cells), server_resilience_cap(surfaces))


def _surface_generation(surface: Surface) -> int:
    props = _props(surface)
    raw = surface.get("gen", props.get("gen", 0))
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return 0


def build_coverage_matrix(surfaces: Sequence[Surface]) -> list[dict[str, Any]]:
    """Expand normalized surfaces into deterministic coverage cells."""
    cells: list[dict[str, Any]] = []
    unique_surfaces: dict[str, Surface] = {}
    for surface in surfaces:
        props = _props(surface)
        surface_key = str(surface.get("key") or props.get("url") or props.get("path") or "surface")
        unique_surfaces.setdefault(surface_key, surface)
    for surface_key in sorted(unique_surfaces):
        surface = unique_surfaces[surface_key]
        props = _props(surface)
        for vuln_class in applicable_vuln_classes(surface):
            spec = VULN_CLASSES[vuln_class]
            cell_id = f"{vuln_class}::{surface_key}"
            cell = {
                "cell_id": cell_id,
                "vuln_class": vuln_class,
                "surface_key": surface_key,
                "skill_path": spec.skill_path,
                "mitre": spec.mitre,
                "tool_hints": list(spec.tool_hints),
                # ADR-0077 annotations: one shared resource per surface keeps
                # mutating classes serialized against same-surface siblings
                # while read classes overlap freely.
                "effects": spec.effects.value,
                "resources": [f"surface:{surface_key}"],
                "session": session_name_for_cell(cell_id),
                "session_name": session_name_for_cell(cell_id),
                "gen": _surface_generation(surface),
                "status": "pending",
            }
            for metadata_key in ("discovered_by", "via_cell"):
                metadata = surface.get(metadata_key, props.get(metadata_key))
                if metadata:
                    cell[metadata_key] = str(metadata)
            cells.append(cell)
    return cells


def build_objective_expand_payload(
    parent_id: str, cells: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    """Render coverage cells as deterministic ``objective_expand`` children."""
    children: list[dict[str, Any]] = []
    for priority, cell in enumerate(cells, start=1):
        cell_id = str(cell["cell_id"])
        vuln_class = str(cell["vuln_class"])
        surface_key = str(cell["surface_key"])
        session_name = str(cell.get("session_name") or cell.get("session") or "")
        mitre = cell.get("mitre", [])
        mitre_list = [item.strip() for item in str(mitre).split(",") if item.strip()]
        try:
            generation = max(0, int(cell.get("gen", 0)))
        except (TypeError, ValueError):
            generation = 0
        notes = [f"cell_id={cell_id}", f"session_name={session_name}", f"gen={generation}"]
        via_cell = cell.get("via_cell")
        if via_cell:
            notes.append(f"via_cell={via_cell}")
        children.append(
            {
                "title": f"Surface exploit: {vuln_class} @ {surface_key}",
                "phase": "initial-access",
                "description": (
                    f"Test coverage cell {cell_id} against exactly one normalized surface. "
                    f"Use session {session_name} and load {cell['skill_path']}."
                ),
                "acceptance_criteria": [
                    f"Use only the {vuln_class} methodology for {surface_key}.",
                    "Record confirmed, ruled_out, or open_proof_gap evidence in the KG.",
                ],
                "priority": priority,
                "mitre": mitre_list,
                "owner": "surface_exploit",
                "effects": str(cell.get("effects") or EffectClass.READ.value),
                "resources": [str(r) for r in (cell.get("resources") or [])],
                "notes": "; ".join(notes),
            }
        )
    return {"parent_id": parent_id, "children": children}
