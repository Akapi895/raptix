import json
import os
import sys

"""Synthetic asset-map dataset: nmap XML (hosts, five services each) and katana JSONL (endpoints).

    python -I scripts/asset-map/gen_dataset.py <outdir> [hosts=1000] [endpoints=20000]

Host 0 carries half of the endpoints, so sitemap paging is exercised at depth. Services are
five per host (22, 80, 443, 3306, 8080); each host has two web entrypoints.
"""

out = sys.argv[1]
HOSTS = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
ENDPOINTS_TOTAL = int(sys.argv[3]) if len(sys.argv) > 3 else 20000
PER_FILE = 100
HEAVY_HOST = 0
os.makedirs(out, exist_ok=True)

def ip(i):
    return f"10.1.{i // 250}.{i % 250 + 1}"

for chunk in range(HOSTS // PER_FILE):
    hosts_xml = []
    for i in range(chunk * PER_FILE, (chunk + 1) * PER_FILE):
        addr = ip(i)
        ports = []
        for port, service in [(22, "ssh"), (80, "http"), (443, "https"), (3306, "mysql"), (8080, "http-proxy")]:
            ports.append(f'<port portid="{port}" protocol="tcp"><state state="open"/><service name="{service}"/></port>')
        hosts_xml.append(
            f'<host><status state="up"/><address addr="{addr}" addrtype="ipv4"/>'
            f'<hostnames><hostname name="h{i}.lab.local"/></hostnames><ports>{"".join(ports)}</ports></host>'
        )
    with open(os.path.join(out, f"nmap-{chunk:02d}.xml"), "w", encoding="utf-8") as fh:
        fh.write('<?xml version="1.0"?><nmaprun>' + "".join(hosts_xml) + "</nmaprun>")

# endpoints: host 0 gets half of the total, the rest share the remainder
per_other = (ENDPOINTS_TOTAL // 2) // (HOSTS - 1)
lines = []
for i in range(HOSTS):
    count = ENDPOINTS_TOTAL // 2 if i == HEAVY_HOST else per_other
    for n in range(count):
        lines.append(json.dumps({"request": {"method": "GET", "endpoint": f"http://{ip(i)}:80/p/{n}?id={n}"}, "status_code": 200}))
chunk_size = 5000
for part in range(0, len(lines), chunk_size):
    with open(os.path.join(out, f"katana-{part // chunk_size:02d}.jsonl"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines[part:part + chunk_size]) + "\n")
print("hosts", HOSTS, "endpoints", len(lines))
