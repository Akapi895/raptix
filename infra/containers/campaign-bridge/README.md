# Isolated evilginx2 campaign-lab bridge

Build from repository root:

```powershell
docker build -f infra/containers/campaign-bridge/Dockerfile -t raptix-campaign-bridge:lab .
```

This image builds evilginx2 from source (pinned commit
`55579600ca826a94b328d5e0cb35740045a35b2e`) and packages a typed HTTP bridge
in front of its native console. evilginx2 is GPL-3.0; upstream source and
license are at https://github.com/kgretzky/evilginx2.

## Configuration

- Bridge: `EVILGINX_BRIDGE_TOKEN`, a private 32+ character secret with no
  CR/LF. The process refuses to start without one. Runs as UID 10001
  (non-root).
- Ports: `9000` (bridge HTTP API) and `8443` (evilginx2's own HTTPS listener
  that serves the lab proxy traffic to a lured target). Publish only what
  the caller actually needs.
- State: persistent volume at `/state` (campaign-ownership SQLite DB +
  native console config under `/state/native`).
- `/profiles/lab.yaml` is the pinned, synthetic-origin lab template
  (`origin.test` / `login.origin.test`) baked into the image at build time —
  it is not an operator-editable path inside the running container.
- There is no `apps/api` consumer wired up yet (unlike the sibling
  `sliver-bridge`, which `apps/api/src/adapters/c2/` already calls) — this
  bridge is a standalone lab tool, called directly over HTTP with the token
  above.
- Runtime containers must use a dedicated internal lab network, no
  published ports beyond what a caller needs, `cap_drop=ALL`,
  `no-new-privileges`, and memory/pid limits.

## API

`POST /v1/campaigns`, `Authorization: Bearer <EVILGINX_BRIDGE_TOKEN>`, a
bounded JSON body (16 KiB max):

```json
{"engagementId": "<id>", "campaignId": "<id>", "version": 1, "operation": "prepare"}
```

- `engagementId` / `campaignId`: `[A-Za-z0-9_-]{1,128}`.
- `version`: integer, `1`-`1000000`.
- `operation`: `prepare` (create or reuse a scoped phishlet+lure from
  `/profiles/lab.yaml`), `deploy` (enable it), or `inspect` (read current
  status without mutating).

A successful response is a manifest: `provider`, `phishlet`, `lureId`,
`url`, `providerId`, `providerStatus`, `version`, `fingerprint`. The same
`(engagementId, campaignId, version)` always resolves to the same
phishlet/lure — ownership is persisted in `/state/ownership.sqlite`, keyed
by a SHA-256 fingerprint of the baked-in `lab.yaml`. Calling `prepare`
again after the lab profile changed returns `409` ("Lab profile changed;
prepare a new version") instead of silently drifting onto stale assets.
Missing/invalid auth returns `401`; a malformed path or query returns
`404`; an unsupported HTTP method (anything but `POST`) returns `501`.

## Verified scope

Image build, missing-token startup failure, `prepare` -> `deploy` ->
`inspect` for one campaign identity, a second independent
`(engagementId, campaignId, version)` getting its own phishlet/lure,
wrong-token `401`, and the non-`POST`/bad-path error paths above have all
been exercised directly against a running container.

A `deploy` issued immediately after `prepare` can occasionally return a
transient `{"error": "Invalid JSON"}` — a race between evilginx2's own
console-driven config rewrite and the bridge's synchronous re-read of that
file — where retrying the same request succeeds. No other reliability
guarantee is claimed; back up `/state` after a clean shutdown if
campaign/lure ownership needs to survive a restart.
