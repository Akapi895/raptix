#!/bin/sh
# Target-lab entrypoint: write a fresh random verification flag, then start
# httpd in the foreground. The flag value goes to container logs (operator
# channel) and /flag.txt inside the target — the acceptance check in
# README.md matches the value read through the direct PoC against the value
# read through the C2 session.
set -eu
FLAG="FLAG{target-lab-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')}"
printf '%s\n' "$FLAG" > /flag.txt
chmod 0644 /flag.txt
echo "[target-lab] verification flag (operator-only channel): $FLAG"
exec httpd-foreground
