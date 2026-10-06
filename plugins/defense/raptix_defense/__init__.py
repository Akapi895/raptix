"""Defense domain pack (Wave T13).

Owns the defense domain's offline analysis layer: CONOPS workspace
resolution. The SIEM/EDR detection pushers (Defender XDR, CrowdStrike,
Elastic, Sentinel, Splunk) stay in the ``raptix`` runtime — they POST
over HTTP (``requests``) and plugin packs import stdlib + SDK/core only;
so do the blue_cell detection loop, its tap/rule matcher, and the
``@tool`` wrapper layer. No bundle entry points yet: the defense agent
(``blue_cell``) is a standard-bundle runtime agent; entry points land
if/when the defense domain gets its own declared specialist.
"""
