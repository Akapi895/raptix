---
name: bloodhound-query
description: BloodHound ingestion + canonical Cypher queries for AD attack-path enumeration. Run after collector dumps zip; promotes findings into the knowledge graph.
metadata:
  subdomain: active-directory
  when_to_use: "bloodhound cypher query shortest path kerberoastable unconstrained delegation"
  mitre_attack:
    - T1087.002
    - T1018
    - T1482
---

# BloodHound Query Playbook

## 1. Collect
```bash
# Python collector (works from Linux attacker box)
bloodhound-python -u USER -p 'PASS' -d DOMAIN -c all --zip --dns-tcp \
  -ns DC_IP -o /workspace/bh.zip

# Or SharpHound from a Windows beachhead
# Invoke-BloodHound -CollectionMethod All -ZipFileName bh.zip
```
If `bloodhound-python` errors on TLS, add `-gc gc.domain.local` for the
global catalog FQDN.

## 2. Ingest into Raptix KG
```
bh_ingest_zip("/workspace/bh.zip")
```
This populates User / Computer / Group / GPO / OU nodes with attribute
properties (hasspn, dontreqpreauth, enabled, admincount, sidhistory).

## 3. Canonical Cypher queries
Run via `bhce_cypher("<query>")` (BloodHound CE server):

| Goal | Cypher |
|---|---|
| Owned principals | `MATCH (u) WHERE u.owned=true RETURN u.name` |
| Shortest path to DA | `MATCH p=shortestPath((u {owned:true})-[*1..]->(g:Group {name:'DOMAIN ADMINS@DOM'})) RETURN p` |
| Kerberoastable users | `MATCH (u:User {hasspn:true, enabled:true}) RETURN u.name,u.spns` |
| AS-REP roastable | `MATCH (u:User {dontreqpreauth:true, enabled:true}) RETURN u.name` |
| DCSync candidates | `MATCH (n)-[:GetChanges|GetChangesAll]->(:Domain) RETURN n.name` |
| Unconstrained delegation | `MATCH (c:Computer {unconstraineddelegation:true}) RETURN c.name` |
| RBCD targets | `MATCH (n)-[:AddAllowedToAct]->(c:Computer) RETURN n.name,c.name` |
| GenericAll on user | `MATCH (n)-[:GenericAll]->(u:User) WHERE NOT n=u RETURN n.name,u.name` |
| ACL path to high-value | `MATCH p=shortestPath((u {owned:true})-[:GenericAll|GenericWrite|WriteOwner|WriteDacl*1..]->(t {highvalue:true})) RETURN p` |
| Sessions on DC | `MATCH (u:User)-[:HasSession]->(c:Computer) WHERE c.name CONTAINS 'DC' RETURN u.name,c.name` |
| Computers w/ admin from owned | `MATCH (u {owned:true})-[:AdminTo*1..2]->(c:Computer) RETURN c.name` |
| GPO abuse | `MATCH (n)-[:GpLink]->(:OU)-[:Contains*1..]->(c:Computer) WHERE n.name CONTAINS 'unsafe' RETURN n.name,c.name` |

## 4. Auto-prioritize attack paths
Rank the shortestPath results from the table above: AdminTo /
GenericAll / GenericWrite chains first, then single-hop sessions.
Graph-side chain planning is not on your tool surface — the ranking
is yours to do from the query output.

## 5. Promote findings
For each materialized path, record it (your KG slot provides
`kg_record`):
```
kg_record('[{"kind": "AttackPath",
  "key": "attack-path::<owned-user>-<high-value>",
  "label": "<owned-user> → <high-value>",
  "props": {"hops": <n>, "edges": "<edge-types>", "severity": "critical"},
  "edges_out": [{"to_key": "crown-jewel::<target>", "kind": "REACHES",
                 "weight": 1.0}]}]')
```

## 6. Common collector failures
| Symptom | Fix |
|---|---|
| LDAP bind error | Wrong creds or password expired — try `-p '<empty>'` for null bind |
| Sessions: 0 | RPC blocked — add `--computerfile <list>` to skip enum |
| ACL: 0 | Account lacks `RIGHT_DS_READ_PROPERTY` — try diff user |
| ZIP empty | Collector crashed mid-run — check `--workers 1 -d <domain>` |

## CVSS / impact

| Path discovered | Severity |
|---|---|
| Owned → DA shortest path ≤ 3 hops | Critical (10.0) — engagement-ending |
| Owned → server admin | High (8.0) |
| GenericAll on high-value user | High (8.0) — single ACL = takeover |
| Kerberoastable + offline-crackable hash | Medium-High (6-8) — needs crack |
| Unconstrained delegation on non-DC | High (8.0) — TGT capture |
