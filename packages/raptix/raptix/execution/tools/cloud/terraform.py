"""W10 compatibility exports for plugin-owned Terraform analysis."""

from raptix_cloud import terraform as _implementation
from raptix_cloud.terraform import TFStateFinding, TFStateReport, analyze_tfstate

__all__ = ["TFStateFinding", "TFStateReport", "analyze_tfstate"]
__getattr__ = _implementation.__getattribute__
