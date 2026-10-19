# Raptix evidence language

Terms for interpreting engagement knowledge and its supporting sources.

## Language

**Recorded claim**: An assertion recorded during an engagement. Its presence or
author's confidence does not establish that it is true.

**Write attribution**: The actor and episode that recorded or updated a claim.
It is distinct from the execution that produced supporting evidence.

**Evidence reference**: An opaque identity for a retained capture or verification
record. A finding's identity identifies a claim, not its supporting evidence.

**Producer lineage**: The producing invocation behind referenced evidence.
Copies and aliases preserve that origin; counting distinct invocations does not
by itself establish independent corroboration.

**Agent instance**: One invocation of an AI agent assigned an objective. Multiple
instances can share the same role. An instance is distinct from a host executor
and from the model used to produce its responses.

**Spawn parent**: The instance that created another instance. This relationship
does not, by itself, establish a dependency or authorize intervention.

**Delivery path**: How an operator's message reaches its intended recipient:
directly or through an orchestrating agent. Observing an instance does not imply
that either delivery path is available.

**Scanner capture**: The exact scanner-output bytes retained for later inspection,
with the context needed to interpret them.

**Capture classification**: The access label attached to retained bytes: unclassified,
standard or sensitive. Classification is distinct from the file's media type and
from whether its digest matches.

**Capture integrity**: Whether retrieved bytes match the capture's recorded
identity and content digest. Integrity does not establish a security claim.

**Unclassified capture**: Retained bytes whose sensitivity has not been decided.
Its original content is unavailable until an authorized owner or reviewer assigns
a classification.

**Source consistency assessment**: Whether the retained scanner output produces
the recorded observation identity under the same parser version. Supported or
contradicted describes this relationship, not exploitability or current target state.

**Returned finding**: A curated finding sent back by an independent reviewer with
a reason. Editing it does not erase the return decision; it awaits resubmission.

**Retest observation**: A tester's recorded result, explanation and supporting
evidence after remediation. A resolved result is a claim about the observed fix,
not a general assertion that the engagement or asset is secure. Resolving a
finding requires a retest-stage observation supported by a classified retained
capture that the server authorizes for that actor.

**Suggestion disposition**: An operator's decision to dismiss or restore a producer
suggestion in their own review queue. It does not alter the producer's claim or
another operator's queue.
