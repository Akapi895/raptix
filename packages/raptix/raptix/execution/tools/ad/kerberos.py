"""W10 compatibility exports for plugin-owned Kerberos analysis."""

from raptix_active_directory import kerberos as _implementation
from raptix_active_directory.kerberos import KerberosTicket, classify_hashcat_hash, parse_ticket

__all__ = ["KerberosTicket", "classify_hashcat_hash", "parse_ticket"]
__getattr__ = _implementation.__getattribute__
