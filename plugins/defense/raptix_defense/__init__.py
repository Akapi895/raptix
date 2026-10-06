"""Defense domain pack (Wave T13).

Owns the defense domain's offline analysis layer: CONOPS workspace
resolution and the SIEM/EDR detection builders (Defender XDR,
CrowdStrike, Elastic, Sentinel, Splunk). The blue_cell detection loop,
its tap/rule matcher, and the ``@tool`` wrapper layer remain in the
``raptix`` runtime — they are the runtime's execution path, not domain
analysis. No bundle entry points yet: the defense agent (``blue_cell``)
is a standard-bundle runtime agent; entry points land if/when the
defense domain gets its own declared specialist.
"""
