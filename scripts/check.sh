#!/usr/bin/env bash
# Raptix check helper: vet + build + test. Run from repo root.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd backend

echo "==> go vet ./..."
go vet ./...

echo "==> go build ./..."
go build ./...

echo "==> go test -mod=readonly ./..."
go test -mod=readonly ./...

echo "OK"
