"""Guard rails for the W5 ``raptix.agents`` / ``raptix.llm`` compat shims.

The agent, prompt and LLM implementations moved to
``raptix.intelligence.*`` in W5. The old import paths stay as deprecated
re-export shims until W11 retires the compatibility layer. Because all
in-tree callers now import the new paths, these tests are the only thing
exercising the shims — keeping them honest until removal.
"""

import importlib
import pkgutil

import raptix.agents as agents_shim
import raptix.llm as llm_shim


def test_agents_shim_ships_the_expected_modules() -> None:
    top_level = {"_benchmark_mode", "build", "middleware_slots", "task_spec"}
    packages = {"plugins", "prompts", "standard"}
    listed = {mod.name for mod in pkgutil.iter_modules(agents_shim.__path__)}
    assert listed == top_level | packages


def test_llm_shim_ships_the_expected_modules() -> None:
    listed = {mod.name for mod in pkgutil.iter_modules(llm_shim.__path__)}
    assert listed == {"factory", "models", "router"}


def test_shim_symbols_are_identity_imports() -> None:
    # Star-imports re-export the *same* objects: patching or subclassing
    # through the old path (e.g. downstream unittest.mock.patch) must
    # reach the canonical module, not a copy.
    pairs = (
        ("raptix.agents.build", "build_middleware", "raptix.intelligence.agents.build"),
        ("raptix.agents.build", "build_tools", "raptix.intelligence.agents.build"),
        ("raptix.agents.build", "resolve_role_model", "raptix.intelligence.agents.build"),
        (
            "raptix.agents.middleware_slots",
            "MiddlewareSlot",
            "raptix.intelligence.agents.middleware_slots",
        ),
        (
            "raptix.agents.middleware_slots",
            "DEFAULT_SLOT_FACTORIES",
            "raptix.intelligence.agents.middleware_slots",
        ),
        ("raptix.agents.task_spec", "SubAgentTaskSpec", "raptix.intelligence.agents.task_spec"),
        (
            "raptix.agents._benchmark_mode",
            "benchmark_skill_sources",
            "raptix.intelligence.agents._benchmark_mode",
        ),
        ("raptix.agents.prompts", "load_prompt", "raptix.intelligence.prompts"),
        ("raptix.agents.prompts.builder", "PromptBuilder", "raptix.intelligence.prompts.builder"),
        (
            "raptix.agents.prompts.claude4_compat",
            "apply_compat_for_role",
            "raptix.intelligence.prompts.claude4_compat",
        ),
        (
            "raptix.agents.standard.recon",
            "create_recon_agent",
            "raptix.intelligence.agents.standard.recon",
        ),
        (
            "raptix.agents.standard._surface_registry",
            "build_objective_expand_payload",
            "raptix.intelligence.agents.standard._surface_registry",
        ),
        (
            "raptix.agents.plugins.scanner",
            "create_scanner_agent",
            "raptix.intelligence.agents.plugins.scanner",
        ),
        ("raptix.llm", "LLMFactory", "raptix.intelligence.llm"),
        ("raptix.llm.factory", "create_llm", "raptix.intelligence.llm.factory"),
        ("raptix.llm.router", "ModelRouter", "raptix.intelligence.llm.router"),
    )
    for old_name, symbol, new_name in pairs:
        old = importlib.import_module(old_name)
        new = importlib.import_module(new_name)
        assert getattr(old, symbol, None) is getattr(new, symbol), (
            f"{old_name}.{symbol} diverged between shim and canonical module"
        )


def test_llm_models_shim_preserves_pep562_delegation() -> None:
    # ``raptix.llm.models`` is a shim-of-a-shim: it forwards dynamic
    # attribute access to ``raptix.intelligence.llm.models``, which itself
    # forwards to ``raptix_core.types.llm`` with a DeprecationWarning.
    from raptix_core.types.llm import ModelProfile as canonical

    legacy = importlib.import_module("raptix.llm.models")
    assert legacy.ModelProfile is canonical
