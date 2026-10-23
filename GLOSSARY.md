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

**Asset**: A thing in an engagement's attack surface that can be targeted, such as a
host, a web origin, a DNS name or an address range. An asset is not a claim and not
evidence; a finding may relate to an asset without the asset being proven vulnerable.

**Managed asset**: An asset an operator recorded in the engagement's inventory. It
exists in the inventory whether or not a run has observed it.

**Observed asset**: An asset that a run's recorded observations show. An observation
does not put the asset in scope, and an observed asset may be absent from the inventory.

**Scope classification**: An asset's authorization for targeting: in scope, out of
scope or pending review. It gates target selection and is independent of whether the
asset was managed, observed or both.

**Access**: An actor's time-limited grant to act on one C2 session. It is separate from the session's connection: a session
can stay connected while the actor's access has expired, and losing access does not disconnect the session.

**Single-shot command**: One execution on a C2 session. It keeps no shell state, so the working directory and environment do
not carry over to the next command.

**Interactive console**: An operator-driven shell on a C2 session that keeps shell state (working directory, environment,
running programs) between inputs. It is distinct from a single-shot command, which is an independent execution.

**Controller**: The one party allowed to send input to an interactive console at a time: an operator or an agent. A console
with no controller accepts no input.

**Controller lease**: A time-limited record that names the controller of an interactive console. It ends when the holder
releases it, its time runs out without renewal, or the access or the console that it depends on ends.

**Dispatching run**: The runtime run that issued a C2 command. A command that an agent dispatches names its dispatching run;
a command an operator dispatches from the console names none.
