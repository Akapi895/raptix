"""W10 compatibility exports for plugin-owned recon generators."""

from raptix_reversing import scripts as _implementation
from raptix_reversing.scripts import ghidra_recon_script, r2_recon_script

__all__ = ["ghidra_recon_script", "r2_recon_script"]
__getattr__ = _implementation.__getattribute__
