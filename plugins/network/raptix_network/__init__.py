"""Network domain-pack registration.

No owned analysis module: the network asset-map coverage (host/dns_name/
web_origin) is implemented by the core KG ingest writers
(``knowledge/ingest/parsers/{masscan,dnsx,subfinder}.py`` etc.), not by
this package. This registration exists so ``network`` resolves as a
known domain name for the asset-map coverage matrix.
"""

from raptix_sdk import DomainPack

DOMAIN_PACK = DomainPack("network", "raptix_network")
