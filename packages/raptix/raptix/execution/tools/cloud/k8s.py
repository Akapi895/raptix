"""W10 compatibility exports for plugin-owned Kubernetes analysis."""

from raptix_cloud import k8s as _implementation
from raptix_cloud.k8s import K8sFinding, analyze_k8s_manifest

__all__ = ["K8sFinding", "analyze_k8s_manifest"]
__getattr__ = _implementation.__getattribute__
