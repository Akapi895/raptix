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

**Scanner capture**: The exact scanner-output bytes retained for later inspection,
with the context needed to interpret them.

**Capture integrity**: Whether retrieved bytes match the capture's recorded
identity and content digest. Integrity does not establish a security claim.

**Source consistency assessment**: Whether the retained scanner output produces
the recorded observation identity under the same parser version. Supported or
contradicted describes this relationship, not exploitability or current target state.
