"""Guard rails for the W6 ``raptix.{tools,backends,sandbox_*}`` compat shims.

The execution implementations moved to ``raptix.execution.*`` in W6. The
old import paths stay as deprecated re-export shims until W11 retires the
compatibility layer. Because all in-tree callers now import the new
paths, these tests are the only thing exercising the shims — keeping
them honest until removal.
"""

import importlib
import pkgutil

import raptix.backends as backends_shim
import raptix.sandbox_kernel as kernel_shim
import raptix.sandbox_server as server_shim
import raptix.sandbox_web as web_shim
import raptix.tools as tools_shim


def test_shim_packages_ship_the_expected_top_level_modules() -> None:
    assert {m.name for m in pkgutil.iter_modules(backends_shim.__path__)} == {
        "factory",
        "http_sandbox",
    }
    assert {m.name for m in pkgutil.iter_modules(kernel_shim.__path__)} == {
        "base",
        "daemon",
        "egress",
        "jobs",
        "tmux",
    }
    assert {m.name for m in pkgutil.iter_modules(server_shim.__path__)} == {"app", "__main__"}
    assert {
        "executor",
        "fetch_chain",
        "providers",
        "transport",
        "validators",
        "waf_detector",
    } <= {m.name for m in pkgutil.iter_modules(web_shim.__path__)}
    tools_top = {m.name for m in pkgutil.iter_modules(tools_shim.__path__)}
    assert {"filesystem", "opplan", "skills", "skills_registry", "verification"} <= tools_top
    assert {"ad", "bash", "research", "web"} <= tools_top


def test_shim_symbols_are_identity_imports() -> None:
    # Star-imports re-export the *same* objects: patching or subclassing
    # through the old path (e.g. downstream unittest.mock.patch) must
    # reach the canonical module, not a copy.
    pairs = (
        ("raptix.backends", "make_agent_backend", "raptix.execution.backends"),
        ("raptix.backends.factory", "build_sandbox_backend", "raptix.execution.backends.factory"),
        ("raptix.backends.http_sandbox", "HTTPSandbox", "raptix.execution.backends.http_sandbox"),
        ("raptix.sandbox_kernel", "BackgroundJob", "raptix.execution.sandbox.kernel"),
        ("raptix.sandbox_kernel.daemon", "DaemonSandbox", "raptix.execution.sandbox.kernel.daemon"),
        ("raptix.sandbox_kernel.egress", "EgressPolicy", "raptix.execution.sandbox.kernel.egress"),
        ("raptix.sandbox_web.fetch_chain", "Attempt", "raptix.execution.sandbox.web.fetch_chain"),
        (
            "raptix.tools.research._state",
            "graph_transaction",
            "raptix.execution.tools.research._state",
        ),
        (
            "raptix.tools.filesystem",
            "filesystem_tools_without_execute",
            "raptix.execution.tools.filesystem",
        ),
    )
    for old_name, symbol, new_name in pairs:
        old = importlib.import_module(old_name)
        new = importlib.import_module(new_name)
        assert getattr(old, symbol, None) is getattr(new, symbol), (
            f"{old_name}.{symbol} diverged between shim and canonical module"
        )
