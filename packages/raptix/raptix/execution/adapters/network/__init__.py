"""Binary-backed capability adapters (Wave T7).

Each module maps one (or two, for impacket) catalog capability to the
sandbox binary that implements it. Adapters build
:class:`~raptix_core.types.capability.ExecutionSpec` payloads only —
they never execute and never parse output.
"""
