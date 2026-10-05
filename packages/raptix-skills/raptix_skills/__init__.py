"""raptix_skills — the Raptix skill corpus (split out of the runtime in W9).

Pure knowledge/data package: ``SKILL.md`` definitions plus their
supporting YAML assets, organised by bundle (``standard/``,
``shared/``, ``plugins/``, ``benchmark/``). No code ships here.

The runtime keeps the skill loader/registry/selector/engine in
``raptix.skills`` and ``raptix.execution.tools.skills*``; it resolves
this corpus through ``raptix.execution.backends.SKILLS_LOCAL_PATH``.
Virtual ``/skills/<bundle>/...`` paths stay stable across the split —
they derive from the relative path under this package root.
"""
