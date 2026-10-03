"""Export the runtime-owned planning schemas for the independent API validator."""

import json
import sys
from pathlib import Path
from typing import Any

from raptix_core.types import engagement
from raptix_core.types.engagement import (
    CONOPS,
    OPPLAN,
    AbortPlan,
    CleanupPlan,
    ContactPlan,
    DataHandlingPlan,
    DeconflictionPlan,
    RoE,
    ThreatProfile,
)

MODELS = {
    "roe": RoE,
    "conops": CONOPS,
    "deconfliction": DeconflictionPlan,
    "opplan": OPPLAN,
    "threat-profile": ThreatProfile,
    "contact": ContactPlan,
    "data-handling": DataHandlingPlan,
    "abort": AbortPlan,
    "cleanup": CleanupPlan,
}


def schema_with_factory_defaults(model: Any) -> dict[str, Any]:
    schema = model.model_json_schema()
    sections = [(model, schema)] + [
        (getattr(engagement, name, None), definition)
        for name, definition in schema.get("$defs", {}).items()
    ]
    for owner, section in sections:
        for name, field in getattr(owner, "model_fields", {}).items():
            if field.default_factory is None:
                continue
            default = field.default_factory()
            if isinstance(default, (list, dict)):
                section["properties"][name]["default"] = json.loads(
                    json.dumps(default, default=lambda value: value.model_dump(mode="json"))
                )
    return schema


if __name__ == "__main__":
    destination = Path(__file__).resolve().parents[1] / "server/src/services/planning-schemas.json"
    exported = (
        json.dumps(
            {name: schema_with_factory_defaults(model) for name, model in MODELS.items()}, indent=2
        )
        + "\n"
    )
    if "--check" in sys.argv:
        if destination.read_text(encoding="utf-8") != exported:
            raise SystemExit("Planning schemas differ from the runtime models")
    else:
        destination.write_text(exported, encoding="utf-8")
