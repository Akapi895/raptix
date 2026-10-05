"""W10 compatibility exports for plugin-owned AWS analysis."""

from raptix_cloud import aws as _implementation
from raptix_cloud.aws import IAMFinding, analyze_iam_policy, scan_bucket_names, scan_user_data

__all__ = ["IAMFinding", "analyze_iam_policy", "scan_bucket_names", "scan_user_data"]
__getattr__ = _implementation.__getattribute__
