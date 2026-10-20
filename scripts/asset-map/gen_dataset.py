import json
import os
import sys

out = sys.argv[1]
HOSTS = 1000
PER_FILE = 100
ENDPOINTS_TOTAL = 20000
HEAVY_HOST = 0  # host 0 carries the large sitemap used for paging
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
