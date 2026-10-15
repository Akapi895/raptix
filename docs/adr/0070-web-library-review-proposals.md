# ADR-0070: Web library review proposals reference canonical skills

Status: Accepted

## Context

Integration ticket 14 requires persistent revision submission, diff and independent
review. Canonical Skill/Technique graph nodes already expose the git-owned corpus,
including skill body, content digest and build commit. Web approval cannot publish
or authorize execution of that corpus.

## Decision

Add engagement-scoped LibraryReviewProposal and LibraryProposalReview lifecycle
records. A proposal identifies a canonical skill by name and path and pins a
snapshot revision (SHA-256 of the canonical detail projection, including commit,
body and metadata). It retains base/proposed bodies solely for review and export.
These records are never read by the runtime skill loader or graph builder.

HTTP exposes exact skill/technique details and scoped proposal list/detail,
submission, version-checked amendment, independent review and reviewed JSON export.
Persisted membership authorizes reads, operator submission/amendment and reviewer
decisions. Only the original author can amend; every amendment increments the
version and resets approval. Decisions atomically compare status/version and retain
a separate version-pinned review record. Canonical drift blocks amendment, review
and export. Foreign proposal IDs return 404.

Approved means **approved proposed change**, never published canonical content.
Export contains a body-replacement proposal, base identity/revision, before/after
diff and review attribution for the existing git publication workflow. Publication
still requires preserving frontmatter and the existing corpus audit, graph and
OPSEC review gates. There is no corpus mutation API or automatic publication.

## Consequences

Review survives refresh/restart without creating a second executable corpus. A
canonical source outage is an explicit read failure, and drift requires a fresh
proposal based on current canonical content. Proposals support body revisions;
frontmatter/tool-policy changes continue through git. The Web database owns only
the proposal/review lifecycle, with no claim to runtime authorization or publication.
