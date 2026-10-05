"""Guard rails for the ``raptix.middleware.kg_internal`` compat shims.

The KG implementation moved to ``raptix.knowledge.graph`` in W4. The old
``raptix.middleware.kg_internal`` import path stays as a deprecated
re-export shim until W11 retires the compatibility layer. Because all
in-tree callers now import the new path, these tests are the only thing
exercising the shims — keeping them honest until removal.
"""

import importlib
import pkgutil

import raptix.middleware.kg_internal as kg_shim


def test_kg_internal_shim_reexports_every_module() -> None:
    shipped = {
        "ai_surface",
        "ingest",
        "migration_runner",
        "operational_state",
        "state",
        "store",
        "summary",
        "tools",
    }
    assert {mod.name for mod in pkgutil.iter_modules(kg_shim.__path__)} == shipped


def test_kg_internal_shim_symbols_are_identity_imports() -> None:
    # Star-imports re-export the *same* objects: patching or subclassing
    # through the old path (e.g. downstream unittest.mock.patch) must
    # reach the canonical module, not a copy.
    pairs = (
        ("store", "KGStore"),
        ("store", "KGStoreConfig"),
        ("state", "KGState"),
        ("ingest", "ingest"),
        ("summary", "build_summary"),
        ("tools", "build_kg_tools"),
        ("ai_surface", "technology_for_port"),
        ("migration_runner", "apply_migrations"),
    )
    for module_name, symbol in pairs:
        old = importlib.import_module(f"raptix.middleware.kg_internal.{module_name}")
        new = importlib.import_module(f"raptix.knowledge.graph.{module_name}")
        assert getattr(old, symbol, None) is getattr(new, symbol), (
            f"{module_name}.{symbol} diverged between shim and canonical module"
        )
