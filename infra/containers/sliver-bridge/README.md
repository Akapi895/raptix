# IW-09 private Sliver lab bridge

Build from repository root:

```powershell
docker build -f infra/containers/sliver-bridge/Dockerfile -t raptix-iw09-sliver-bridge:lab .
```

This image packages the official Sliver 1.7.7 linux-amd64 release (SHA256
verified), pinned protobuf stubs, and a typed HTTP-to-gRPC/mTLS bridge.
Native tool/compiler assets are provided by the release binary. Sliver is
GPL-3.0; upstream source and license are at https://github.com/BishopFox/sliver.
Python gRPC/protobuf pins are isolated image dependencies, not additions to
the Raptix Python workspace.

## Configuration

- Bridge: `SLIVER_BRIDGE_TOKEN`, a private 32+ character secret; persistent
  named volume mounted at `/state`. Runs as UID 10001.
- Web API: paired `SLIVER_BRIDGE_URL` and `SLIVER_BRIDGE_TOKEN`. For the
  isolated Docker lab use `http://sliver-bridge:9000`; HTTPS otherwise. Neither
  URL nor key can be supplied in browser mutation input.
- Native operator gRPC is local to the bridge, CA-verified with native
  `multiplayer` certificate identity; operator config remains in `/state`.
- Runtime containers must use a dedicated internal lab network, no published
  operator/listener ports, `cap_drop=ALL`, no-new-privileges, memory/pid limits.
  Only the web API receives the additional loopback-facing control network.

Typed operations on authenticated `POST /v1/c2`: session list/get/execute,
command inspection, owned listener start/list/stop, and scoped HTTP profile
list/create. Unknown operations/fields are rejected. There is no HTTP implant
generation endpoint. Lab enrolment is a local harness operation inside the
isolated container, not a browser capability.

## Verified scope

Linux HTTP sessions in the isolated lab; HTTP profile cloning and application
to the enrolled implant; explicit argv execution, nonzero exit handling,
65,536-byte stdout/stderr bounds, idempotent audit identities, API restart,
bridge restart/reconnect, and cross-engagement isolation. Session ownership
requires an active owned listener, exact lab endpoint host/protocol/port and
first contact after listener creation, then an immutable session-ID/UUID binding.

Back up the private bridge state volume and web database together after clean
shutdown. Do not rotate the token/operator config on each boot. Loss of bridge
state loses authoritative listener and command ownership; it is not recovered
by inferring ownership from a hostname. No power-loss or hosted multi-user
durability certification is claimed. Deployment on the normal port-3000 stack
requires explicit configuration/network wiring and rebuilt API/UI images.
