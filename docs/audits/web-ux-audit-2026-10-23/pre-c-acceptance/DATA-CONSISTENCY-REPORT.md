# Data consistency report

Each state change in the workflow scripts was read back from the test database (`psql` in the stack's own container) and, where a screen shows it, from the page. A screen figure is compared with the API that feeds it.

## Persisted state checked

| Record | Transition checked | Database result | Where |
|---|---|---|---|
| `BusinessPlan` | draft created | `draft` | WF-04 |
| `BusinessPlan` | proposed (pinned to the approved ROE) | `proposed` after reload | WF-04 |
| `BusinessPlan` | refused decision by the author | still `proposed` | WF-04, AUTH |
| `BusinessPlan` | approved by the independent reviewer | `approved`, `decidedBy` set | WF-04 |
| `ScopeRevision` | submitted by the operator | `pending` | WF-05 |
| `ScopeRevision` | approved by the reviewer | `approved` | WF-05 |
| `ScopeRevision` | decision by its author | refused (403), still `pending` | WF-05 |
| `ScopeRevision` | a newer submission | older approved revision becomes `superseded` | inspection probe (see below) |
| `ScopeRevision` | approval of a newer one | previous approved becomes `superseded` | inspection probe |
| `WebNotice` | plan decision, to the requester | notice exists for the operator | WF-05 (dismiss check) |
| `ReportRecord` | finding snapshot selected | one snapshot, finding version recorded | WF-08 |

The inspection probe (a held stack run after the decisions script) listed the revisions as v1 `superseded`, v2 `superseded`, v3 `pending`. v2 was approved by the reviewer during the run and then superseded when the author submitted v3. That is the designed rule: a submission supersedes the approved revision at once, so the ROE in force is missing until the new revision is decided. OPEN-ISSUES OI-02 records it.

## Counts: the figure on screen against the endpoint

| Figure | Source | Check | Result |
|---|---|---|---|
| Overview "Awaiting decisions" | `GET /api/tasks`, decisions only (emergency stops and tool approvals excluded) | Compared with the endpoint's decision count for the reviewer | Matches; "26+" with 26 from the endpoint |
| Capped inbox | Endpoint returns at most 25 rows per kind and sets `limited` and `limitedKinds` | 26 pending scope revisions in one project | Endpoint returns 25 scope rows and `limitedKinds: ["scope-revision"]`; Overview shows "26+" (lower bound) |
| Per-role counts | Endpoint, filtered to the shared project | One new decision moves each of the reviewer, viewer and operator counts by exactly one | PASS |
| Approval | Endpoint and Overview after the reviewer's approval | Count returns to the baseline | PASS |
| Dismiss a notice | Endpoint, operator | Decision count unchanged; revision still `pending` | PASS |

Two observations about these figures (both in OPEN-ISSUES.md):

- The Overview figure counts **all** projects the signed-in member can see, not the selected project. The label does not say so. A reviewer working on one project sees the total across all of them.
- The app keeps the task read for 30 seconds during in-app navigation. A hash-only change in the same page reuses that read, so a figure can lag by up to that long. The Overview shows a read-time label; the acceptance script now forces a full page load before reading the figure (BF-08).

## Exports

For each of markdown, json, pdf and docx:

- The response digest equals the SHA-256 of the bytes returned (PASS for all four).
- The media type is the expected one (PASS for all four).
- markdown and json carry the report title, the summary and the selected finding title (PASS).
- docx: the zip contains `word/document.xml`, and the text includes the title, the summary and the finding title (PASS; read with the Windows bsdtar).
- pdf: the structure is read (`%PDF-` header and `%%EOF` trailer). The text streams are compressed, so the report text is **not** read: PARTIAL.
- The markdown names the finding version recorded in the stored snapshot (PASS).
- An outsider gets 404 and no report text; an unknown format gets 400 (PASS).
- The export is supposed to read stored snapshots, not live finding state. A live change to the finding after the report was built was not exercised: NV.

## Consistency gaps found

- A scope revision decision does not create a notice for its author. Notices are written for plan decisions, closures, C2 grant decisions and emergency-stop resolutions only (`createNotice` call sites). OI-04.
- A viewer's decision count includes a scope revision that a viewer cannot decide (the server answers 403 to a viewer's decision, AUTHORIZATION-TEST-REPORT). The count may be intended as awareness; the label does not say so. OI-05.
- An approved scope revision without emergency contacts or time windows is accepted by the server, and then the preflight reports that the approved ROE has no contact. OI-01.
