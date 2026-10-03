"""Expose scoped lab asset operations through the native evilginx2 console."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import select
import sqlite3
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

STATE = Path("/state")
NATIVE = STATE / "native"
MAX_BODY = 16384
MAX_CONSOLE = 262144
TIMEOUT = 15
IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


class BridgeError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


class NativeConsole:
    def __init__(self) -> None:
        import fcntl
        import pty
        import struct
        import termios

        NATIVE.mkdir(parents=True, exist_ok=True)
        config = NATIVE / "config.json"
        if not config.exists():
            config.write_text(
                json.dumps(
                    {
                        "general": {
                            "domain": "lab.test",
                            "external_ipv4": "127.0.0.1",
                            "bind_ipv4": "0.0.0.0",
                            "https_port": 8443,
                            "dns_port": 5353,
                            "autocert": False,
                            "unauth_url": "https://login.origin.test/",
                        }
                    }
                )
            )
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 120, 0, 0))
        self.fd = master
        self.process = subprocess.Popen(
            [
                "/usr/local/bin/evilginx",
                "-developer",
                "-p",
                "/profiles",
                "-t",
                "/redirectors",
                "-c",
                str(NATIVE),
            ],
            stdin=slave,
            stdout=slave,
            stderr=slave,
            close_fds=True,
            start_new_session=True,
            env={"PATH": os.environ["PATH"], "HOME": str(STATE), "TERM": "dumb"},
        )
        os.close(slave)
        self._prompt()

    def _prompt(self) -> None:
        deadline = time.monotonic() + TIMEOUT
        output = b""
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise BridgeError(503, "Native console is not running")
            if select.select([self.fd], [], [], 0.1)[0]:
                output += os.read(self.fd, 8192)
                if len(output) > MAX_CONSOLE:
                    raise BridgeError(503, "Native console response exceeded its limit")
                text = (
                    ANSI.sub("", output.decode("utf-8", errors="replace"))
                    .replace("\r", "")
                    .replace("\x08", "")
                )
                if re.search(r"(?:^|\n):\s*$", text):
                    return
        raise BridgeError(503, "Native console operation timed out")

    def _command(self, command: str) -> None:
        os.write(self.fd, (command + "\n").encode())
        self._prompt()

    def config(self) -> dict[str, Any]:
        return json.loads((NATIVE / "config.json").read_text())

    def prepare(self, label: str) -> str:
        site = f"lab:{label}"
        if not any(child.get("name") == site for child in self.config().get("subphishlets", [])):
            self._command(f"phishlets create lab {label} label=lab")
        self._command(f"phishlets hostname {site} {label}.lab.test")
        if not any(lure.get("phishlet") == site for lure in self.config().get("lures", [])):
            self._command(f"lures create {site}")
        return site

    def enable(self, site: str) -> None:
        self._command(f"phishlets enable {site}")

    def inspect(self, site: str) -> dict[str, Any]:
        config = self.config()
        phishlet = config.get("phishlets", {}).get(site)
        if not phishlet:
            raise BridgeError(503, "Native lab phishlet was not observed")
        matches = [
            (index, lure)
            for index, lure in enumerate(config.get("lures", []))
            if lure.get("phishlet") == site
        ]
        if len(matches) != 1:
            raise BridgeError(503, "Native lab lure identity is missing or conflicting")
        index, lure = matches[0]
        hostname = phishlet["hostname"]
        if not hostname.endswith(".lab.test"):
            raise BridgeError(503, "Native lab hostname is outside the lab")
        # The native console URL omits the high lab listener port.
        url = urlunsplit(("https", f"login.{hostname}:8443", lure["path"], "", ""))
        return {
            "provider": "evilginx2",
            "phishlet": site,
            "lureId": index,
            "url": url,
            "providerId": f"{site}:{index}",
            "providerStatus": "enabled" if phishlet.get("enabled") else "disabled",
        }


class LabBridge:
    def __init__(self, native: NativeConsole) -> None:
        self.native = native
        self.lock = threading.Lock()
        with sqlite3.connect(STATE / "ownership.sqlite") as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS ownership (engagement TEXT, campaign TEXT, version INTEGER, site TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(engagement,campaign,version))"
            )

    def execute(self, payload: object) -> dict[str, Any]:
        if not isinstance(payload, dict) or set(payload) != {
            "engagementId",
            "campaignId",
            "version",
            "operation",
        }:
            raise BridgeError(400, "Typed campaign operation required")
        engagement, campaign, version, operation = (
            payload[key] for key in ("engagementId", "campaignId", "version", "operation")
        )
        if (
            not all(
                isinstance(value, str) and IDENTIFIER.fullmatch(value)
                for value in (engagement, campaign)
            )
            or type(version) is not int
            or not 1 <= version <= 1000000
        ):
            raise BridgeError(400, "Invalid scoped campaign identity")
        if operation not in ("prepare", "deploy", "inspect"):
            raise BridgeError(400, "Unsupported campaign operation")
        with self.lock, sqlite3.connect(STATE / "ownership.sqlite") as db:
            fingerprint = hashlib.sha256(Path("/profiles/lab.yaml").read_bytes()).hexdigest()
            owner = db.execute(
                "SELECT site,fingerprint FROM ownership WHERE engagement=? AND campaign=? AND version=?",
                (engagement, campaign, version),
            ).fetchone()
            if owner is None and operation != "prepare":
                raise BridgeError(404, "Owned campaign assets not found")
            if owner is None:
                label = hashlib.sha256(
                    json.dumps([engagement, campaign, version], separators=(",", ":")).encode()
                ).hexdigest()[:20]
                site = self.native.prepare(label)
                self.native.inspect(site)
                db.execute(
                    "INSERT INTO ownership VALUES(?,?,?,?,?)",
                    (engagement, campaign, version, site, fingerprint),
                )
            else:
                if owner[1] != fingerprint:
                    raise BridgeError(409, "Lab profile changed; prepare a new version")
                site = owner[0]
            if operation == "deploy":
                self.native.enable(site)
            manifest = self.native.inspect(site)
            if operation == "deploy" and manifest["providerStatus"] != "enabled":
                raise BridgeError(503, "Native proxy configuration was not enabled")
            manifest.update({"version": version, "fingerprint": fingerprint})
            return manifest


class Handler(BaseHTTPRequestHandler):
    bridge: LabBridge
    token: str

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, format: str, *args: object) -> None:
        return

    def do_POST(self) -> None:
        try:
            if urlsplit(self.path).path != "/v1/campaigns" or urlsplit(self.path).query:
                raise BridgeError(404, "Route not found")
            if not hmac.compare_digest(
                self.headers.get("Authorization", "").encode(), f"Bearer {self.token}".encode()
            ):
                raise BridgeError(401, "Bridge authentication required")
            if (
                self.headers.get("Transfer-Encoding")
                or not self.headers.get("Content-Length", "").isdigit()
            ):
                raise BridgeError(400, "Bounded JSON body required")
            size = int(self.headers["Content-Length"])
            if not 0 < size <= MAX_BODY:
                raise BridgeError(400, "Body size limit exceeded")
            payload = json.loads(self.rfile.read(size))
            response, status = self.bridge.execute(payload), 200
        except (json.JSONDecodeError, UnicodeDecodeError):
            response, status = {"error": "Invalid JSON"}, 400
        except BridgeError as error:
            response, status = {"error": str(error)}, error.status
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())


def main() -> None:
    token = os.environ.get("EVILGINX_BRIDGE_TOKEN", "")
    if len(token) < 32 or "\n" in token or "\r" in token:
        raise BridgeError(503, "A private bridge token is required")
    Handler.token = token
    Handler.bridge = LabBridge(NativeConsole())
    ThreadingHTTPServer(("0.0.0.0", 9000), Handler).serve_forever()


if __name__ == "__main__":
    main()
