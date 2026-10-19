"""Planner contract stays in sync: committed web schemas and soundwave skill wording match the runtime models."""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

from raptix_core.types.engagement import DANGEROUS_METHOD_LABELS

REPO = Path(__file__).resolve().parents[5]
GENERATOR = REPO / "apps/web/tools/generate-planning-schemas.py"
COMMITTED_SCHEMAS = REPO / "apps/web/server/src/services/planning-schemas.json"
SOUNDWAVE_SOURCES = [
    REPO / "packages/raptix-skills/raptix_skills/defs/standard/soundwave",
    REPO / "packages/raptix/raptix/intelligence/prompts/standard/soundwave.md",
    REPO / "packages/raptix/raptix/intelligence/prompts/workflows/soundwave.md",
]
UPPERCASE_SEVERITY = re.compile(r"(?<![\w-])(EMERGENCY|CRITICAL|WARNING|INFO)(?!\w)")


def _load_generator():
    spec = importlib.util.spec_from_file_location("generate_planning_schemas", GENERATOR)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_committed_planning_schemas_match_runtime_models() -> None:
    generator = _load_generator()
    fresh = {name: generator.schema_with_factory_defaults(model) for name, model in generator.MODELS.items()}

    committed = json.loads(COMMITTED_SCHEMAS.read_text(encoding="utf-8"))

    assert committed == fresh, "run: python apps/web/tools/generate-planning-schemas.py"


def test_soundwave_guidance_uses_lowercase_severity_values() -> None:
    offenders = []
    for source in SOUNDWAVE_SOURCES:
        files = [source] if source.is_file() else sorted(source.rglob("*.md"))
        for path in files:
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                if UPPERCASE_SEVERITY.search(line):
                    offenders.append(f"{path.relative_to(REPO)}:{number}")

    assert offenders == []


ROE_TEMPLATE = REPO / "packages/raptix-skills/raptix_skills/defs/standard/soundwave/roe-template/SKILL.md"
SOUNDWAVE_PROMPT = REPO / "packages/raptix/raptix/intelligence/prompts/standard/soundwave.md"


def test_roe_template_asks_for_every_dangerous_method_label() -> None:
    text = ROE_TEMPLATE.read_text(encoding="utf-8")

    assert [label for label in DANGEROUS_METHOD_LABELS.values() if label not in text] == []


def test_soundwave_prompt_makes_the_dangerous_method_confirmation_mandatory() -> None:
    text = SOUNDWAVE_PROMPT.read_text(encoding="utf-8")

    assert [label for label in DANGEROUS_METHOD_LABELS.values() if label not in text] == []
    assert "Never skip it" in text
    assert "Never drop a listed method" in text
