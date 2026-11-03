"""CVE / OSV / EPSS intelligence lookup.

Combines three authoritative sources into a single exploitability score:

- **NVD**       (nvd.nist.gov) — CVSS vector, CWE, publication dates
- **OSV**       (api.osv.dev)  — Package-level vulnerability data, fix versions
- **EPSS**      (api.first.org) — Exploit Prediction Scoring System (prob / percentile)

All lookups are rate-limited, cached (keyed on CVE ID / package@version),
and degrade gracefully when offline or API quota is exhausted. The final
score ranks vulnerabilities by *real-world* exploitability — not just
CVSS — so agents prioritise the chains that actually get exploited.

Design notes
------------
- ``httpx.AsyncClient`` is used so lookups can be fanned out in parallel
  from the analyst agent without blocking the event loop.
- Cache lives at ``/workspace/.cache/cve.json`` and is bounded to
  ``MAX_CACHE_ENTRIES``; least-recently-used entries are evicted on overflow.
- ``Exploitability`` is a dataclass (not pydantic) so the ranking core stays
  dependency-free and can be reused for synthetic / offline analysis.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import time
from collections import OrderedDict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import httpx
from langchain_core.tools import tool

from raptix.execution.tools.research._state import _json
from raptix_core.utils.logging import get_logger

log = get_logger("research.cve")

# ── Endpoints ───────────────────────────────────────────────────────────

NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
OSV_URL = "https://api.osv.dev/v1/query"
EPSS_URL = "https://api.first.org/data/v1/epss"


def _default_cache_path() -> Path:
    """Resolve the CVE JSON cache location.

    The cache must live **outside** the LLM-writable ``/workspace`` tree
    so a poisoned engagement cannot persist fake CVE records across
    Ralph iterations (the agent reads these records verbatim).
    Override via ``RAPTIX_CVE_CACHE`` for tests or alternate
    deployments.
    """
    override = os.environ.get("RAPTIX_CVE_CACHE")
    if override:
        return Path(override)
    return Path.home() / ".decepticon" / "cache" / "cve.json"


CACHE_PATH = _default_cache_path()
CACHE_TTL_SECONDS = 24 * 60 * 60  # 1 day
MAX_CACHE_ENTRIES = 2048
DEFAULT_TIMEOUT = 8.0


# ── Data types ──────────────────────────────────────────────────────────


@dataclass
class Exploitability:
    """Fused exploitability record for a single CVE.

    ``score`` ∈ [0, 10] blends CVSS base, EPSS probability, and KEV flag
    into one monotonic rank. Higher = more likely to actually get exploited.

    ``poc_links`` is populated from the local ``cve_poc_index`` when the
    ``trickest-cve`` / ``penetration-testing-poc`` reference caches have
    been hydrated. Empty otherwise — it's a pure enrichment field.
    """

    cve_id: str
    cvss: float | None = None
    cvss_vector: str | None = None
    cwe: list[str] = field(default_factory=list)
    epss: float | None = None
    epss_percentile: float | None = None
    kev: bool = False
    published: str | None = None
    summary: str = ""
    references: list[str] = field(default_factory=list)
    poc_links: list[str] = field(default_factory=list)
    source: str = "nvd+epss"
    fetched_at: float = field(default_factory=time.time)

    @property
    def score(self) -> float:
        """Composite rank in [0, 10].

        - Missing CVSS → neutral 5.0 baseline
        - EPSS lifts CVSS up to +2 for p100, -1 for very low prob
        - KEV override: minimum 9.0 (actively exploited in the wild)
        """
        base = self.cvss if self.cvss is not None else 5.0
        adj = 0.0
        if self.epss is not None:
            # log-scale EPSS: 0.01 → 0, 0.1 → +1, 0.9 → +1.95
            adj = max(-1.0, min(2.0, 3.0 * math.log10(self.epss + 0.001) + 3.0))
        composite = max(0.0, min(10.0, base + adj))
        if self.kev:
            composite = max(composite, 9.0)
        return round(composite, 2)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["score"] = self.score
        return d


# ── Cache ───────────────────────────────────────────────────────────────


class _Cache:
    """Tiny JSON cache with O(1) LRU eviction.

    Backed by ``collections.OrderedDict`` — promotion on ``get`` and
    eviction on ``set`` are both O(1), replacing the previous
    ``sorted()`` call that turned every write past the cap into an
    O(N log N) operation on the hot path of ``lookup_cves``.

    Writes to disk are **dirty-flag + explicit flush** instead of a
    synchronous ``write_text`` on every mutation — that sync write
    was blocking the async event loop during fan-out CVE lookups. A
    best-effort ``atexit.register(self._save)`` covers the common
    process-shutdown path; callers that need durability earlier can
    call :meth:`flush` explicitly.
    """

    def __init__(self, path: Path = CACHE_PATH, ttl: float = CACHE_TTL_SECONDS) -> None:
        self.path = path
        self.ttl = ttl
        self._data: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._dirty = False
        self._load()
        try:
            import atexit

            atexit.register(self._save_if_dirty)
        except Exception:  # pragma: no cover — atexit always available
            # If atexit registration ever fails (frozen interpreter,
            # finalizer-only mode), surface it at debug so cache
            # persistence loss has a trace.
            log.debug("cve._Cache: atexit.register failed", exc_info=True)

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            self._data = OrderedDict()
            return
        if isinstance(raw, dict):
            # Preserve insertion order so the oldest (least-recently-used)
            # entries surface first when we evict.
            self._data = OrderedDict(raw)

    def _save(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(self.path.suffix + ".tmp")
            # Compact JSON — this file is machine-read and can grow
            # to thousands of cached CVE records. No indent saves
            # ~30% on disk and parse time.
            tmp.write_text(
                json.dumps(self._data, separators=(",", ":"), ensure_ascii=False),
                encoding="utf-8",
            )
            tmp.replace(self.path)
            self._dirty = False
        except OSError as e:
            log.warning("cve cache save failed: %s", e)

    def _save_if_dirty(self) -> None:
        if self._dirty:
            self._save()

    def flush(self) -> None:
        """Force a synchronous write of the cache to disk."""
        self._save()

    def get(self, key: str) -> dict[str, Any] | None:
        entry = self._data.get(key)
        if entry is None:
            return None
        if time.time() - entry.get("_ts", 0.0) > self.ttl:
            self._data.pop(key, None)
            self._dirty = True
            return None
        # Promote to most-recently-used (O(1) on OrderedDict).
        self._data.move_to_end(key, last=True)
        entry["_lru"] = time.time()
        return entry.get("value")

    def set(self, key: str, value: dict[str, Any]) -> None:
        now = time.time()
        if key in self._data:
            self._data.move_to_end(key, last=True)
        self._data[key] = {
            "value": value,
            "_ts": now,
            "_lru": now,
        }
        # Evict least-recently-used entries (the head of the OrderedDict).
        while len(self._data) > MAX_CACHE_ENTRIES:
            self._data.popitem(last=False)
        self._dirty = True


# ── HTTP helpers ────────────────────────────────────────────────────────


async def _fetch_nvd(client: httpx.AsyncClient, cve_id: str) -> dict[str, Any]:
    try:
        resp = await client.get(
            NVD_URL,
            params={"cveId": cve_id},
            timeout=DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError) as e:
        log.debug("nvd lookup failed for %s: %s", cve_id, e)
        return {}


async def _fetch_epss(client: httpx.AsyncClient, cve_id: str) -> dict[str, Any]:
    try:
        resp = await client.get(EPSS_URL, params={"cve": cve_id}, timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError) as e:
        log.debug("epss lookup failed for %s: %s", cve_id, e)
        return {}


async def _fetch_osv(
    client: httpx.AsyncClient, package: str, version: str, ecosystem: str
) -> dict[str, Any]:
    try:
        resp = await client.post(
            OSV_URL,
            json={
                "version": version,
                "package": {"name": package, "ecosystem": ecosystem},
            },
            timeout=DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError) as e:
        log.debug("osv lookup failed for %s@%s: %s", package, version, e)
        return {}


async def _fetch_nvd_keyword(
    client: httpx.AsyncClient, keyword: str, *, results_per_page: int = 20
) -> dict[str, Any]:
    try:
        resp = await client.get(
            NVD_URL,
            params={"keywordSearch": keyword, "resultsPerPage": results_per_page},
            timeout=DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError) as e:
        log.debug("nvd keyword lookup failed for %r: %s", keyword, e)
        return {}


# ── Parsers ─────────────────────────────────────────────────────────────


def _parse_nvd(data: dict[str, Any]) -> dict[str, Any]:
    """Extract CVSS, CWE, summary, publication from NVD response."""
    out: dict[str, Any] = {
        "cvss": None,
        "cvss_vector": None,
        "cwe": [],
        "summary": "",
        "published": None,
        "references": [],
    }
    vulns = data.get("vulnerabilities") or []
    if not vulns:
        return out
    cve = vulns[0].get("cve", {})
    out["published"] = cve.get("published")
    # Descriptions (prefer en)
    for desc in cve.get("descriptions", []):
        if desc.get("lang") == "en":
            out["summary"] = desc.get("value", "")
            break
    # CVSS — prefer v3.1, fall back to v3.0, then v2
    metrics = cve.get("metrics") or {}
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        items = metrics.get(key) or []
        if items:
            cvss_data = items[0].get("cvssData") or {}
            out["cvss"] = cvss_data.get("baseScore")
            out["cvss_vector"] = cvss_data.get("vectorString")
            break
    # CWE
    for weak in cve.get("weaknesses", []) or []:
        for d in weak.get("description", []):
            val = d.get("value")
            if isinstance(val, str) and val.startswith("CWE-"):
                out["cwe"].append(val)
    # References (first 10)
    refs = cve.get("references") or []
    out["references"] = [r.get("url") for r in refs[:10] if r.get("url")]
    return out


def _parse_nvd_candidates(data: dict[str, Any]) -> list[dict[str, str]]:
    """Extract every CVE id + English summary from an NVD keyword-search response.

    Unlike ``_parse_nvd`` (a single-CVE lookup, reads only
    ``vulnerabilities[0]``), a keyword search can match many CVEs —
    callers need the full list to pick candidates for ``cve_lookup``
    scoring.
    """
    out: list[dict[str, str]] = []
    for vuln in data.get("vulnerabilities") or []:
        cve = vuln.get("cve") or {}
        cve_id = cve.get("id")
        if not cve_id:
            continue
        summary = ""
        for desc in cve.get("descriptions", []):
            if desc.get("lang") == "en":
                summary = desc.get("value", "")
                break
        out.append({"cve_id": cve_id, "summary": summary})
    return out


def _parse_epss(data: dict[str, Any]) -> dict[str, Any]:
    """Extract EPSS probability + percentile."""
    items = data.get("data") or []
    if not items:
        return {"epss": None, "epss_percentile": None}
    item = items[0]
    try:
        epss = float(item.get("epss", 0.0))
    except (TypeError, ValueError):
        epss = None
    try:
        pct = float(item.get("percentile", 0.0))
    except (TypeError, ValueError):
        pct = None
    return {"epss": epss, "epss_percentile": pct}


# ── Local enrichment (PoC link index) ──────────────────────────────────


def _resolve_poc_links(cve_id: str) -> list[str]:
    """Return PoC URLs for ``cve_id`` from the local index, if present.

    Deferred import so the ``research`` package stays importable when
    ``raptix.references`` is not yet on the path (e.g. smaller
    library installs or tests that stub the references package).
    """
    try:
        from raptix.execution.tools.references.cve_poc_index import lookup_poc
    except ImportError:  # pragma: no cover
        return []
    try:
        return lookup_poc(cve_id)
    except Exception as e:  # pragma: no cover — defensive
        log.debug("cve_poc_index lookup failed for %s: %s", cve_id, e)
        return []


def _rehydrate(cached: dict[str, Any]) -> Exploitability:
    """Reconstruct an ``Exploitability`` from a cache dict, tolerating
    missing or extra keys across schema evolutions.
    """
    allowed = {f.name for f in Exploitability.__dataclass_fields__.values()}
    clean: dict[str, Any] = {k: v for k, v in cached.items() if k in allowed}
    return Exploitability(**clean)


# ── Public API ──────────────────────────────────────────────────────────


async def lookup_cve(
    cve_id: str,
    *,
    kev_set: set[str] | None = None,
    client: httpx.AsyncClient | None = None,
    cache: _Cache | None = None,
) -> Exploitability:
    """Look up a single CVE across NVD + EPSS and return an ``Exploitability``.

    ``kev_set`` is an optional set of CISA KEV CVE IDs the caller has loaded;
    if a CVE is in the set, ``kev=True`` and the composite score jumps.

    Network failures degrade to a best-effort record rather than raising.
    """
    cve_id = cve_id.strip().upper()
    cache = cache or _Cache()
    cached = cache.get(f"cve:{cve_id}")
    if cached is not None:
        exp = _rehydrate(cached)
        # poc_links are derived locally — refresh from index so a
        # newly-hydrated reference cache is picked up immediately.
        exp.poc_links = _resolve_poc_links(cve_id)
        return exp

    own_client = client is None
    # NVD's public API is intermittently slow (rate-limit windows, regional
    # CDN slow paths). httpx's 5s default per-stage timeout was tripping
    # false-negatives on legitimate CVE lookups. 30s end-to-end is the
    # documented NVD service-level expectation. EPSS is faster but on the
    # same client so we use the larger envelope.
    client = client or httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))
    try:
        nvd_task = asyncio.create_task(_fetch_nvd(client, cve_id))
        epss_task = asyncio.create_task(_fetch_epss(client, cve_id))
        nvd_data, epss_data = await asyncio.gather(nvd_task, epss_task)
    finally:
        if own_client:
            await client.aclose()

    nvd = _parse_nvd(nvd_data)
    epss = _parse_epss(epss_data)

    exp = Exploitability(
        cve_id=cve_id,
        cvss=nvd["cvss"],
        cvss_vector=nvd["cvss_vector"],
        cwe=nvd["cwe"],
        epss=epss["epss"],
        epss_percentile=epss["epss_percentile"],
        kev=bool(kev_set and cve_id in kev_set),
        published=nvd["published"],
        summary=nvd["summary"],
        references=nvd["references"],
        poc_links=_resolve_poc_links(cve_id),
    )
    cache.set(f"cve:{cve_id}", exp.to_dict())
    return exp


async def lookup_cves(
    cve_ids: list[str],
    *,
    kev_set: set[str] | None = None,
    concurrency: int = 8,
) -> list[Exploitability]:
    """Fan out CVE lookups with bounded concurrency. Always ranked highest-first."""
    cache = _Cache()
    semaphore = asyncio.Semaphore(concurrency)

    # See lookup_cve for the timeout rationale — NVD is slow under load.
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:

        async def _one(cve_id: str) -> Exploitability:
            async with semaphore:
                return await lookup_cve(cve_id, kev_set=kev_set, client=client, cache=cache)

        results = await asyncio.gather(*(_one(c) for c in cve_ids))

    results.sort(key=lambda r: r.score, reverse=True)
    return results


async def lookup_package(
    package: str,
    version: str,
    ecosystem: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> list[str]:
    """Query OSV for CVEs affecting package@version in a given ecosystem.

    ecosystem examples: ``PyPI``, ``npm``, ``crates.io``, ``Go``, ``Maven``.
    Returns a list of CVE/GHSA IDs (may contain both). Empty list on failure.
    """
    own_client = client is None
    # OSV is reliably fast but we still cap so a network hiccup doesn't
    # hang the caller indefinitely.
    client = client or httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0))
    try:
        data = await _fetch_osv(client, package, version, ecosystem)
    finally:
        if own_client:
            await client.aclose()

    ids: list[str] = []
    for vuln in data.get("vulns") or []:
        vid = vuln.get("id")
        if vid:
            ids.append(vid)
        for alias in vuln.get("aliases") or []:
            if alias.startswith("CVE-") and alias not in ids:
                ids.append(alias)
    return ids


async def lookup_product(
    product: str,
    version: str,
    *,
    client: httpx.AsyncClient | None = None,
    cache: _Cache | None = None,
) -> list[dict[str, str]]:
    """Search NVD by free-text product name + version (no ecosystem needed).

    Unlike ``lookup_package`` (OSV, requires an exact package-manager
    ecosystem — PyPI/npm/Go/...), this works for anything NVD has
    catalogued: self-hosted web apps, network appliances, OS packages.
    It uses NVD's keyword search against CVE descriptions rather than an
    exact CPE match, so results are candidates, not a verdict — many CVE
    descriptions state an affected *range* instead of repeating the exact
    version string, so a version-qualified query can under-match.

    Returns up to 20 ``{"cve_id", "summary"}`` candidates in NVD's own
    ranking order. Empty list on no match or network failure.
    """
    cache = cache or _Cache()
    key = f"product:{product.strip().lower()}@{version.strip()}"
    cached = cache.get(key)
    if cached is not None:
        return list(cached.get("candidates", []))

    own_client = client is None
    client = client or httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))
    try:
        data = await _fetch_nvd_keyword(client, f"{product} {version}")
    finally:
        if own_client:
            await client.aclose()

    candidates = _parse_nvd_candidates(data)
    cache.set(key, {"candidates": candidates})
    return candidates


def rank_exploitability(records: list[Exploitability]) -> list[Exploitability]:
    """Return a copy sorted by composite exploitability score, highest first."""
    return sorted(records, key=lambda r: r.score, reverse=True)


# ── Agent-facing tools ───────────────────────────────────────────────────


@tool
async def cve_lookup(cve_ids: str) -> str:
    """Look up CVEs against NVD + EPSS with real-world exploitability scoring.

    WHEN TO USE: Whenever you find a service version (nmap -sV),
    dependency (package.json, requirements.txt, Cargo.lock), or CVE ID
    from any source. Returns a ranked list: CVEs with high CVSS *and*
    high EPSS (or KEV listing) bubble to the top.

    The composite ``score`` blends:
    - CVSS base (0-10)
    - EPSS probability (log-scaled)
    - CISA KEV membership (floors score at 9.0)

    Args:
        cve_ids: Comma-separated CVE IDs, e.g. ``"CVE-2024-12345,CVE-2023-99999"``.

    Returns:
        JSON list of exploitability records, highest score first.
    """
    ids = [c.strip() for c in cve_ids.split(",") if c.strip()]
    if not ids:
        return _json({"error": "no CVE IDs provided"})
    records = await lookup_cves(ids)
    return _json([r.to_dict() for r in records])


@tool
async def cve_by_package(package: str, version: str, ecosystem: str = "PyPI") -> str:
    """Query OSV for CVEs affecting ``package@version`` in an ecosystem.

    WHEN TO USE: After reading a manifest file (requirements.txt,
    package.json, go.sum, Cargo.lock). Pair with ``cve_lookup`` to score
    the results and prioritise bounty-worthy targets.

    Args:
        package: Package name (exact, case-sensitive).
        version: Installed version string.
        ecosystem: One of PyPI, npm, crates.io, Go, Maven, RubyGems,
            NuGet, Packagist, Pub, Hex.

    Returns:
        JSON list of vulnerability IDs (CVE/GHSA). Empty if the package
        version is clean (or the OSV API was unreachable).
    """
    ids = await lookup_package(package, version, ecosystem)
    return _json({"package": package, "version": version, "ecosystem": ecosystem, "ids": ids})


@tool
async def cve_by_product(product: str, version: str) -> str:
    """Search NVD by product name + version when no package-manager ecosystem applies.

    WHEN TO USE: After fingerprinting a technology (e.g. via
    ``detect_tech_stack`` or a service banner) that is NOT installed
    through a package manager — self-hosted web apps, CMSs, network
    appliances, OS-level software. ``cve_by_package`` needs an OSV
    ecosystem (PyPI/npm/Go/...); this needs only a product name.

    Matching is NVD free-text keyword search against CVE descriptions,
    not an exact CPE/version-range match — treat the result as
    CANDIDATES. Pair with ``cve_lookup`` on the returned ids to get
    CVSS/EPSS scoring and confirm relevance. If this returns nothing,
    retry with just the product name: some CVE descriptions state an
    affected range rather than your exact version string.

    Args:
        product: Product/application name, e.g. "Flowise", "nginx".
        version: Observed version string, e.g. "3.0.5".

    Returns:
        JSON list of up to 20 candidate {"cve_id", "summary"} records,
        in NVD's own ranking order.
    """
    candidates = await lookup_product(product, version)
    return _json({"product": product, "version": version, "candidates": candidates})
