#!/bin/sh
# Lab entrypoint: start sliver-server, mint an operator config, run the bridge.
set -e
OPERATOR_CFG="/state/operator.cfg"
export HOME=/state
export SLIVER_ROOT_DIR=/state/sliver
export GOMAXPROCS=2
export GOFLAGS=-p=2
# Native compiler diagnostics may log its environment; exclude bridge auth.
env -u SLIVER_BRIDGE_TOKEN /usr/local/bin/sliver-server daemon >/state/daemon.log 2>&1 &
DAEMON_PID=$!
READY=0
for _ in $(seq 1 90); do
  if python -c "import socket; socket.create_connection(('127.0.0.1',31337),timeout=1).close()" 2>/dev/null; then
    READY=1
    break
  fi
  kill -0 "$DAEMON_PID" || exit 1
  sleep 2
done
[ "$READY" = 1 ] || exit 1
if [ ! -f "$OPERATOR_CFG" ]; then
  /usr/local/bin/sliver-server operator --name raptix --lhost 127.0.0.1 --permissions all --save "$OPERATOR_CFG"
fi
if [ -z "$SLIVER_BRIDGE_TOKEN" ]; then
  echo "SLIVER_BRIDGE_TOKEN is required" >&2
  kill $DAEMON_PID
  exit 1
fi
exec python /app/sliver_bridge.py
