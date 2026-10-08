"""Expose scoped lab C2 operations through the native Sliver gRPC operator API."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sqlite3
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

sys.path.insert(0, "/app/gen")

import grpc
from clientpb import client_pb2
from commonpb import common_pb2
from rpcpb import services_pb2_grpc
from sliverpb import sliver_pb2

STATE = Path("/state")
OPERATOR_CFG = STATE / "operator.cfg"
IMPLANTS = STATE / "implants"
MAX_BODY = 16384
OUTPUT_CAP = 65536
EXECUTE_DEADLINE = 90
DEFAULT_DEADLINE = 20
EXPECTED_VERSION = (1, 7, 7)
IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
PROFILE_NAME = re.compile(r"[a-z0-9-]{1,48}\Z")
PRINTABLE_PATH = re.compile(r"(?:/|[A-Za-z]:\\)[\x20-\x7e]{1,511}\Z")
MTLS_PORTS = range(18888, 19000)
HTTP_PORTS = range(18080, 18100)


class BridgeError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def _auth_metadata(token: str) -> list[tuple[str, str]]:
    return [("authorization", f"Bearer {token}")]


class Operator:
    def __init__(self, receive_limit: int = 1048576) -> None:
        config = json.loads(OPERATOR_CFG.read_text())
        for key in ("lport", "token", "ca_certificate", "certificate", "private_key"):
            if not config.get(key):
                raise BridgeError(503, "Operator configuration is incomplete")
        credentials = grpc.ssl_channel_credentials(
            root_certificates=config["ca_certificate"].encode(),
            private_key=config["private_key"].encode(),
            certificate_chain=config["certificate"].encode(),
        )
        channel = grpc.secure_channel(
            f"127.0.0.1:{config['lport']}",
            credentials,
            options=[
                ("grpc.ssl_target_name_override", "multiplayer"),
                ("grpc.max_receive_message_length", receive_limit),
            ],
        )
        self.token = config["token"]
        self.rpc = services_pb2_grpc.SliverRPCStub(channel)
        version = self.rpc.GetVersion(
            common_pb2.Empty(), metadata=_auth_metadata(self.token), timeout=DEFAULT_DEADLINE
        )
        if (version.Major, version.Minor, version.Patch) != EXPECTED_VERSION:
            raise BridgeError(503, "Native server version is not supported")

    def _metadata(self) -> list[tuple[str, str]]:
        return _auth_metadata(self.token)

    def sessions(self) -> list[Any]:
        try:
            response = self.rpc.GetSessions(
                common_pb2.Empty(), metadata=self._metadata(), timeout=DEFAULT_DEADLINE
            )
        except grpc.RpcError:
            raise BridgeError(503, "Native session registry is unreachable")
        return list(response.Sessions)

    def execute(self, session_id: str, path: str, args: list[str]) -> dict[str, Any]:
        request = sliver_pb2.ExecuteReq(
            Path=path,
            Args=args,
            Output=True,
            EnvInheritance=False,
            Background=False,
            Request=common_pb2.Request(SessionID=session_id, Timeout=EXECUTE_DEADLINE * 1000000000),
        )
        try:
            response = self.rpc.Execute(
                request, metadata=self._metadata(), timeout=EXECUTE_DEADLINE
            )
        except grpc.RpcError as error:
            if error.code() == grpc.StatusCode.DEADLINE_EXCEEDED:
                raise BridgeError(504, "Native command execution timed out")
            raise BridgeError(503, "Native command execution was not confirmed")
        if response.Response.Err:
            raise BridgeError(502, "Native implant reported a command failure")
        return {
            "status": response.Status,
            "pid": response.Pid,
            "stdout": _bound(response.Stdout),
            "stderr": _bound(response.Stderr),
        }

    def http_profiles(self) -> list[Any]:
        try:
            response = self.rpc.GetHTTPC2Profiles(
                common_pb2.Empty(), metadata=self._metadata(), timeout=DEFAULT_DEADLINE
            )
        except grpc.RpcError:
            raise BridgeError(503, "Native profile registry is unreachable")
        return list(response.configs)

    def http_profile(self, name: str) -> Any:
        try:
            return self.rpc.GetHTTPC2ProfileByName(
                client_pb2.C2ProfileReq(Name=name),
                metadata=self._metadata(),
                timeout=DEFAULT_DEADLINE,
            )
        except grpc.RpcError:
            raise BridgeError(503, "Native profile lookup was not confirmed")

    def save_http_profile(self, profile: Any) -> None:
        try:
            self.rpc.SaveHTTPC2Profile(
                client_pb2.HTTPC2ConfigReq(overwrite=False, C2Config=profile),
                metadata=self._metadata(),
                timeout=DEFAULT_DEADLINE,
            )
        except grpc.RpcError:
            raise BridgeError(503, "Native profile save was not confirmed")

    def start_mtls(self, port: int) -> int:
        try:
            job = self.rpc.StartMTLSListener(
                client_pb2.MTLSListenerReq(Host="0.0.0.0", Port=port),
                metadata=self._metadata(),
                timeout=DEFAULT_DEADLINE,
            )
        except grpc.RpcError:
            raise BridgeError(503, "Native listener start was not confirmed")
        return job.JobID

    def start_http(self, port: int) -> int:
        try:
            job = self.rpc.StartHTTPListener(
                client_pb2.HTTPListenerReq(Host="0.0.0.0", Port=port, Secure=False),
                metadata=self._metadata(),
                timeout=DEFAULT_DEADLINE,
            )
        except grpc.RpcError:
            raise BridgeError(503, "Native listener start was not confirmed")
        return job.JobID

    def kill_job(self, job_id: int) -> None:
        try:
            result = self.rpc.KillJob(
                client_pb2.KillJobReq(ID=job_id),
                metadata=self._metadata(),
                timeout=DEFAULT_DEADLINE,
            )
            if not result.Success:
                raise BridgeError(503, "Native listener stop was not confirmed")
        except grpc.RpcError:
            raise BridgeError(503, "Native job kill was not confirmed")

    def jobs(self) -> list[Any]:
        try:
            return list(
                self.rpc.GetJobs(
                    common_pb2.Empty(), metadata=self._metadata(), timeout=DEFAULT_DEADLINE
                ).Active
            )
        except grpc.RpcError:
            raise BridgeError(503, "Native listener registry is unreachable")

    def generate_implant(self, name: str, c2_url: str, profile_name: str = "default") -> Path:
        scheme = urlsplit(c2_url).scheme
        if scheme == "mtls":
            config = client_pb2.ImplantConfig(
                GOOS="linux", GOARCH="amd64", Format=client_pb2.EXECUTABLE, IncludeMTLS=True
            )
        elif scheme in ("http", "https"):
            config = client_pb2.ImplantConfig(
                GOOS="linux", GOARCH="amd64", Format=client_pb2.EXECUTABLE, IncludeHTTP=True
            )
        else:
            raise BridgeError(400, "Lab implant requires an mtls or http lab URL")
        config.C2.append(client_pb2.ImplantC2(Priority=0, URL=c2_url))
        config.ReconnectInterval = 5
        config.MaxConnectionErrors = 1000
        config.TemplateName = "sliver"
        config.HTTPC2ConfigName = profile_name
        config.NetGoEnabled = True
        try:
            build = self.rpc.Generate(
                client_pb2.GenerateReq(Config=config, Name=name),
                metadata=self._metadata(),
                timeout=300,
            )
        except grpc.RpcError:
            raise BridgeError(503, "Native implant generation was not confirmed")
        IMPLANTS.mkdir(parents=True, exist_ok=True)
        path = IMPLANTS / f"{name}.bin"
        path.write_bytes(build.File.Data)
        path.chmod(0o755)
        return path


def _bound(data: bytes) -> dict[str, Any]:
    if len(data) > OUTPUT_CAP:
        return {"text": data[:OUTPUT_CAP].decode("utf-8", errors="replace"), "truncated": True}
    return {"text": data.decode("utf-8", errors="replace"), "truncated": False}


def _project_session(session: Any) -> dict[str, Any]:
    return {
        "id": session.ID,
        "name": session.Name,
        "hostname": session.Hostname,
        "username": session.Username,
        "os": session.OS,
        "arch": session.Arch,
        "transport": session.Transport,
        "remoteAddress": session.RemoteAddress,
        "lastCheckin": int(session.LastCheckin),
        "activeC2": session.ActiveC2,
        "isDead": bool(session.IsDead),
        "version": session.Version,
        "pid": int(session.PID),
    }


def _project_profile(profile: Any) -> dict[str, Any]:
    implant = profile.ImplantConfig
    return {
        "name": profile.Name,
        "created": int(profile.Created),
        "userAgent": implant.UserAgent,
        "headerCount": len(implant.Headers),
        "cookieCount": len(profile.ServerConfig.Cookies),
        "parameterCount": len(implant.ExtraURLParameters),
        "pathSegmentCount": len(implant.PathSegments),
    }


class LabBridge:
    def __init__(self, operator: Operator) -> None:
        self.operator = operator
        self.lock = threading.Lock()
        with sqlite3.connect(STATE / "ownership.sqlite") as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS listeners (engagement TEXT, protocol TEXT, port INTEGER UNIQUE, job_id INTEGER NOT NULL, created INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(engagement, protocol, port))"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS session_owner (session TEXT PRIMARY KEY, engagement TEXT NOT NULL, uuid TEXT NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS commands (engagement TEXT, request TEXT, hash TEXT NOT NULL, state TEXT NOT NULL, outcome TEXT, PRIMARY KEY(engagement,request))"
            )
        self._restore_listeners()

    def execute(self, payload: object) -> dict[str, Any]:
        if not isinstance(payload, dict) or "op" not in payload:
            raise BridgeError(400, "Typed C2 operation required")
        op = payload["op"]
        fields = {
            "version": {"op"},
            "sessions.list": {"op", "engagementId"},
            "sessions.get": {"op", "engagementId", "sessionId"},
            "sessions.execute": {"op", "engagementId", "sessionId", "requestId", "path", "args"},
            "commands.get": {"op", "engagementId", "requestId"},
            "profiles.list": {"op", "engagementId"},
            "profiles.create": {"op", "engagementId", "name"},
            "listeners.start": {"op", "engagementId", "protocol"},
            "listeners.list": {"op", "engagementId"},
            "listeners.stop": {"op", "engagementId", "jobId"},
        }
        if not isinstance(op, str) or op not in fields or set(payload) != fields[op]:
            raise BridgeError(400, "Unsupported operation or fields")
        if op == "version":
            return {"version": "1.7.7"}
        if op == "sessions.list":
            engagement = _identifier(payload, "engagementId")
            with self.lock:
                return {"sessions": self._sessions(engagement)}
        if op == "sessions.get":
            engagement = _identifier(payload, "engagementId")
            session_id = _identifier(payload, "sessionId")
            return {"session": self._owned_session(engagement, session_id)}
        if op == "sessions.execute":
            engagement = _identifier(payload, "engagementId")
            session_id = _identifier(payload, "sessionId")
            path, args = _command(payload)
            request_id = _identifier(payload, "requestId")
            digest = hashlib.sha256(
                json.dumps([session_id, path, args], separators=(",", ":")).encode()
            ).hexdigest()
            with self.lock, sqlite3.connect(STATE / "ownership.sqlite") as db:
                previous = db.execute(
                    "SELECT hash,state,outcome FROM commands WHERE engagement=? AND request=?",
                    (engagement, request_id),
                ).fetchone()
                if previous:
                    if previous[0] != digest:
                        raise BridgeError(409, "Command identity was reused with different input")
                    return {
                        "state": previous[1],
                        "outcome": json.loads(previous[2]) if previous[2] else None,
                    }
                session = self._owned_session(engagement, session_id)
                if session["isDead"] or time.time() - session["lastCheckin"] > 90:
                    raise BridgeError(409, "Session is stale or disconnected")
                db.execute(
                    "INSERT INTO commands VALUES(?,?,?,?,NULL)",
                    (engagement, request_id, digest, "creating"),
                )
            try:
                result = self.operator.execute(session_id, path, args)
                state = "succeeded" if result["status"] == 0 else "failed"
            except BridgeError:
                state, result = "uncertain", None
            with sqlite3.connect(STATE / "ownership.sqlite") as db:
                db.execute(
                    "UPDATE commands SET state=?,outcome=? WHERE engagement=? AND request=?",
                    (
                        state,
                        json.dumps(result) if result is not None else None,
                        engagement,
                        request_id,
                    ),
                )
            return {"state": state, "outcome": result}
        if op == "commands.get":
            engagement, request_id = (
                _identifier(payload, "engagementId"),
                _identifier(payload, "requestId"),
            )
            with sqlite3.connect(STATE / "ownership.sqlite") as db:
                row = db.execute(
                    "SELECT state,outcome FROM commands WHERE engagement=? AND request=?",
                    (engagement, request_id),
                ).fetchone()
            if not row:
                raise BridgeError(404, "Owned command not found")
            return {"state": row[0], "outcome": json.loads(row[1]) if row[1] else None}
        if op == "profiles.list":
            engagement = _identifier(payload, "engagementId")
            prefix = f"raptix-{hashlib.sha256(engagement.encode()).hexdigest()[:20]}-"
            with self.lock:
                return {
                    "profiles": [
                        _project_profile(self.operator.http_profile(profile.Name))
                        for profile in self.operator.http_profiles()
                        if profile.Name.startswith(prefix)
                    ]
                }
        if op == "profiles.create":
            engagement = _identifier(payload, "engagementId")
            name = payload.get("name")
            if not isinstance(name, str) or not PROFILE_NAME.fullmatch(name):
                raise BridgeError(
                    400, "Profile name requires 1-48 lowercase letters, digits or hyphens"
                )
            full_name = f"raptix-{hashlib.sha256(engagement.encode()).hexdigest()[:20]}-{name}"
            with self.lock:
                existing = next(
                    (p for p in self.operator.http_profiles() if p.Name == full_name), None
                )
                if existing is not None:
                    return {"profile": _project_profile(self.operator.http_profile(full_name))}
                template = self.operator.http_profile("default")
                template.Name = full_name
                template.ID = ""
                template.ServerConfig.ID = ""
                template.ImplantConfig.ID = ""
                for collection in (
                    template.ServerConfig.Headers,
                    template.ServerConfig.Cookies,
                    template.ImplantConfig.Headers,
                    template.ImplantConfig.ExtraURLParameters,
                    template.ImplantConfig.PathSegments,
                ):
                    for entry in collection:
                        entry.ID = ""
                self.operator.save_http_profile(template)
                return {"profile": _project_profile(self.operator.http_profile(full_name))}
        if op == "listeners.start":
            engagement = _identifier(payload, "engagementId")
            protocol = payload.get("protocol")
            if protocol not in ("mtls", "http"):
                raise BridgeError(400, "Listener protocol must be mtls or http")
            with self.lock:
                owned = self._listeners(engagement)
                existing = next(
                    (entry for entry in owned if entry["protocol"] == protocol and entry["active"]),
                    None,
                )
                if existing:
                    return {"listener": existing}
                port = self._allocate(protocol, engagement)
                job_id = (
                    self.operator.start_mtls(port)
                    if protocol == "mtls"
                    else self.operator.start_http(port)
                )
                with sqlite3.connect(STATE / "ownership.sqlite") as db:
                    db.execute(
                        "INSERT INTO listeners VALUES(?,?,?,?,?,1)",
                        (engagement, protocol, port, job_id, int(time.time())),
                    )
                return {
                    "listener": {
                        "engagementId": engagement,
                        "protocol": protocol,
                        "port": port,
                        "jobId": job_id,
                        "active": True,
                    }
                }
        if op == "listeners.list":
            engagement = _identifier(payload, "engagementId")
            with self.lock:
                return {"listeners": self._listeners(engagement)}
        if op == "listeners.stop":
            engagement = _identifier(payload, "engagementId")
            job_id = payload.get("jobId")
            if type(job_id) is not int or job_id < 1:
                raise BridgeError(400, "Listener job identity is invalid")
            with self.lock:
                owned = [entry for entry in self._listeners(engagement) if entry["jobId"] == job_id]
                if not owned:
                    raise BridgeError(404, "Owned listener job not found")
                self.operator.kill_job(job_id)
                with sqlite3.connect(STATE / "ownership.sqlite") as db:
                    db.execute(
                        "UPDATE listeners SET active=0 WHERE engagement=? AND job_id=?",
                        (engagement, job_id),
                    )
                return {"stopped": job_id}
        raise BridgeError(400, "Unsupported C2 operation")

    def _listeners(self, engagement: str) -> list[dict[str, Any]]:
        with sqlite3.connect(STATE / "ownership.sqlite") as db:
            rows = db.execute(
                "SELECT protocol, port, job_id, created, active FROM listeners WHERE engagement=?",
                (engagement,),
            ).fetchall()
        return [
            {
                "engagementId": engagement,
                "protocol": protocol,
                "port": port,
                "jobId": job_id,
                "created": created,
                "active": bool(active),
            }
            for protocol, port, job_id, created, active in rows
        ]

    def _allocate(self, protocol: str, engagement: str) -> int:
        pool = MTLS_PORTS if protocol == "mtls" else HTTP_PORTS
        with sqlite3.connect(STATE / "ownership.sqlite") as db:
            taken = {row[0] for row in db.execute("SELECT port FROM listeners").fetchall()}
        taken.update(job.Port for job in self.operator.jobs())
        digest = int(hashlib.sha256(f"{engagement}:{protocol}".encode()).hexdigest(), 16)
        ports = list(pool)
        for offset in range(len(ports)):
            port = ports[(digest + offset) % len(ports)]
            if port not in taken:
                return port
        raise BridgeError(409, "No lab listener ports remain")

    def _restore_listeners(self) -> None:
        jobs = self.operator.jobs()
        with sqlite3.connect(STATE / "ownership.sqlite") as db:
            rows = db.execute(
                "SELECT engagement,protocol,port FROM listeners WHERE active=1"
            ).fetchall()
            for engagement, protocol, port in rows:
                match = next(
                    (job for job in jobs if job.Port == port and job.Name.lower() == protocol), None
                )
                if match is None:
                    job_id = (
                        self.operator.start_mtls(port)
                        if protocol == "mtls"
                        else self.operator.start_http(port)
                    )
                else:
                    job_id = match.ID
                db.execute(
                    "UPDATE listeners SET job_id=? WHERE engagement=? AND protocol=? AND port=?",
                    (job_id, engagement, protocol, port),
                )

    def _owned_session(self, engagement: str, session_id: str) -> dict[str, Any]:
        owned = self._sessions(engagement)
        for session in owned:
            if session["id"] == session_id:
                return session
        raise BridgeError(404, "Owned session not found")

    def _sessions(self, engagement: str) -> list[dict[str, Any]]:
        native_sessions = self.operator.sessions()
        sessions = _owned(native_sessions, self._listeners(engagement))
        safe = []
        with sqlite3.connect(STATE / "ownership.sqlite") as db:
            for session in sessions:
                native = next(s for s in native_sessions if s.ID == session["id"])
                db.execute(
                    "INSERT OR IGNORE INTO session_owner VALUES(?,?,?)",
                    (session["id"], engagement, native.UUID),
                )
                owner = db.execute(
                    "SELECT engagement,uuid FROM session_owner WHERE session=?", (session["id"],)
                ).fetchone()
                if owner == (engagement, native.UUID):
                    safe.append(session)
        return safe


def _owned(sessions: list[Any], listeners: list[dict[str, Any]]) -> list[dict[str, Any]]:
    owned: list[dict[str, Any]] = []
    for session in sessions:
        try:
            parts = urlsplit(
                session.ActiveC2 if "://" in session.ActiveC2 else f"unknown://{session.ActiveC2}"
            )
            endpoint_port = parts.port
        except ValueError:
            continue
        for entry in listeners:
            if (
                entry["active"]
                and parts.hostname in ("sliver", "sliver-bridge", "localhost", "127.0.0.1")
                and parts.scheme == entry["protocol"]
                and endpoint_port == entry["port"]
                and session.FirstContact >= entry["created"]
            ):
                projected = _project_session(session)
                projected["listenerPort"] = entry["port"]
                owned.append(projected)
                break
    return owned


def _identifier(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise BridgeError(400, f"Invalid {key}")
    return value


def _command(payload: dict[str, Any]) -> tuple[str, list[str]]:
    path = payload.get("path")
    args = payload.get("args", [])
    if not isinstance(path, str) or not PRINTABLE_PATH.fullmatch(path):
        raise BridgeError(400, "Command path must be an absolute printable path")
    if (
        not isinstance(args, list)
        or len(args) > 16
        or not all(
            isinstance(arg, str)
            and len(arg) <= 512
            and not any(c in arg for c in ("\x00", "\r", "\n"))
            for arg in args
        )
    ):
        raise BridgeError(400, "Command args must be at most 16 printable values")
    return path, list(args)


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
            if urlsplit(self.path).path != "/v1/c2" or urlsplit(self.path).query:
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
    token = os.environ.get("SLIVER_BRIDGE_TOKEN", "")
    if len(token) < 32 or "\n" in token or "\r" in token:
        raise BridgeError(503, "A private bridge token is required")
    Handler.token = token
    Handler.bridge = LabBridge(Operator())
    ThreadingHTTPServer(("0.0.0.0", 9000), Handler).serve_forever()


if __name__ == "__main__":
    main()
