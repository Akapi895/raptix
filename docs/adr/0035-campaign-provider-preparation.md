# ADR-0035: Versioned campaign provider asset preparation

Status: Proposed (IW-08 implementation in progress)

## Decision

The operator confirmed on 2026-10-03 that Generate prepares provider assets,
rather than asking the AI runtime to author new campaign content. GoPhish uses
its native REST API; evilginx2 requires a separate typed console bridge. Neither
an accepted request nor a prepared asset manifest means delivered.

Start with GoPhish asset selection by native template, landing-page, group and
SMTP-profile IDs. Preparation reads those native resources and persists a
versioned, credential-free manifest in the owning campaign. Missing resources,
authentication failures, malformed provider responses and network failures
produce durable failed jobs; no successful preparation is fabricated.

Provider credentials and endpoints are server configuration. Browser requests
cannot choose them. TLS verification stays enabled; plaintext HTTP is allowed
only for loopback or the explicitly named isolated `gophish` Docker lab service.
Provider redirects are rejected and response size/time are bounded. Native SMTP
passwords, landing-page contents and recipient records are not public DTOs.

## Scope and threat model

This initial slice wires asset preparation through the existing scoped campaign
routes. It does not dispatch mail or invoke a proxy console. Engagement ownership
and confirmed authorization precede any provider access. Prepared manifest writes
and successful job records are atomic, with campaign-version conflict detection.
Unknown database failures propagate rather than being disguised as provider jobs.

Deployment must subsequently persist operation/provider IDs, reserve idempotent
dispatch, revalidate the prepared bundle, enforce authorized delivery scope and
reconcile uncertain outcomes. The evilginx2 bridge must accept typed operations,
not shell text, and must not expose credential/session captures. These remain
IW-08 acceptance requirements, not capabilities delivered by preparation.

## Verification

Focused tests must exercise the real HTTP client and existing campaign route,
including cross-engagement denial, failed preparation, secret redaction and
persisted bundle reload. A native GoPhish container probe is required in addition
to HTTP environment fixtures. IW-08 remains open until deployment and evilginx2
also pass their native lab gates.

Observed locally: GoPhish 0.12.1, a dedicated PostgreSQL lab, compiled new API
container and real-mode browser passed 20 checks without API interception.
Evidence is `clients/web-raptix/test-results-deployed/iw08/preparation/native.json`
and `native-ui-prepared.png`. The GoPhish source image is pinned by digest; its
lab derivative removes the binary's low-port file capability so the process can
run as `app` on high ports with `cap_drop=ALL` and no-new-privileges. Native
provider and PostgreSQL have only an internal lab network and no published
ports. Only the API has an additional control network and loopback test port.
Lab containers/networks/DB volume are removed after the probe. Dispatch and
evilginx2 remain unimplemented; the normal port-3000 deployment is not cut over.
