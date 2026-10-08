# API mapping — web-raptix ↔ clients/web backend

> Phase 0 (W00) deliverable. Đường dẫn dùng URL runtime (Next route handlers dưới `clients/web/src/app/api`).
> Đã đối chiếu tree route.ts thực tế ngày 2026-10-01. Behavior dựa trên source đã đọc; contract capture thực tế (payload thật) thuộc P4.1.

## 1. Endpoints hiện có

| Method + endpoint | UI dùng | Response/behavior hiện có | Integration note |
|---|---|---|---|
| `GET /api/engagements` | Projects | Engagement array; **auto-import** CLI workspaces vào DB | Không polling như read-only; side effect phải được hiểu rõ |
| `POST /api/engagements` | New Project | Create record + planning dir | Bắt buộc `name` (slug), `targetType`, `targetValue`, `authorizationConfirmed` |
| `GET /api/engagements/:id` | Workspace | Engagement record | Map sang ProjectViewModel |
| `PATCH /api/engagements/:id` | Settings | Update allowed fields | `name` không rename filesystem; không full metadata schema |
| `DELETE /api/engagements/:id` | (chưa đưa vào UI) | Xóa DB record | Không xóa artifacts, không dừng runs |
| `GET /api/agents` | Agent catalog | Runtime registry hoặc static fallback | Catalog ≠ active instances |
| `GET /api/health` | Dependency status | Health route | Kiểm chứng exact payload ở P4 |
| `GET /api/engagements/:id/threads` | Session list | Thread metadata; limit 20; fallback DB threadId | Cần pagination khi mở rộng |
| `GET /api/engagements/:id/plan-docs` | Charter/RoE | 4 docs: `opplan`, `conops`, `roe`, `deconfliction` | Docs khác cần server extension |
| `GET /api/engagements/:id/opplan` | Objectives/phases | Parsed JSON hoặc `{ objectives: [] }` | Phân biệt missing/invalid |
| `GET /api/engagements/:id/findings` | Findings | Parse `FIND-*.md` | Không có mutation/review API |
| `GET /api/engagements/:id/timeline` | Recent activity | Artifact mtime timeline | Không phải durable tool-event log |
| `GET /api/engagements/:id/graph` | Graph/Assets | Scoped nodes/edges (React Flow-oriented) | Cần Neo4j password hợp lệ; normalize payload |
| `GET /api/engagements/:id/approvals` | HITL | Pending requests | Link theo `request_id` |
| `POST /api/engagements/:id/approvals` | HITL decision | Append decision; duplicate → 409 | Actions: `allow`/`deny`/`redirect` |
| `GET /api/workspace/:name/files` | Evidence/files | `{ folders: [...] }` | Folders cố định: `recon`, `exploit`, `post-exploit`, `findings`, `report`; non-recursive |
| `GET /api/workspace/:name/files/*path` | Artifact preview | UTF-8 text content | Không phải binary/image preview API |
| `GET /api/engagements/:id/export?format=json` | Reports | JSON attachment | Giữ filename/content-disposition |
| `GET /api/engagements/:id/export?format=markdown` | Reports | Markdown attachment | Validate supported formats |

## 2. Mutation contracts

**Create engagement** (POST /api/engagements):

```json
{
  "name": "acme-external-assessment",
  "targetType": "web_url",
  "targetValue": "http://authorized-local-target:3010",
  "authorizationConfirmed": true
}
```

- `targetType` enum Prisma hiện có: `web_url`, `ip_range`. Các lựa chọn khác trong design (domain, cloud, api...) **không được gửi** như supported.

**Approval decision** (POST /api/engagements/:id/approvals):

```json
{
  "request_id": "request-id-from-server",
  "action": "deny",
  "operator_note": "Operator decision"
}
```

- `redirect` yêu cầu `redirect_args` hợp lệ. UI không tự translate "Ask for detail" thành redirect.

## 3. Status mapping

| UI hiện tại | Backend engagement | Xử lý |
|---|---|---|
| `planning` | `planning` | Map 1-1 |
| `active` | `running` | Map; không dùng status PATCH làm pause/cancel |
| `paused` | — | Không có tương đương; run-state riêng, không phải engagement status |
| `completed` | `completed` | Map 1-1 |
| — | `draft`, `failed` | Thêm hiển thị; `failed` cần state riêng |

Run lifecycle (view-state, không ghi vào DB enum): `idle, submitting, pending, running, awaiting_approval, interrupted, completed, failed, cancelled, unknown`. Transport state (`disconnected/reconnecting/stale`) tách riêng.

## 4. Endpoints còn thiếu cho trải nghiệm chat trực tiếp (contract proposals — P4–P6)

| Capability | Proposed scoped API |
|---|---|
| Create thread | `POST /api/engagements/:id/threads` |
| Read thread/history/state | Scoped thread detail/state routes |
| Submit run/message | Scoped thread runs route |
| Observe run | Scoped SSE/streaming endpoint |
| Cancel run | Scoped run cancellation endpoint |
| Resume sau interrupt | Scoped resume endpoint theo LangGraph contract |
| Capabilities | Server capability response |

## 5. Gap map tóm tắt (P0.3)

1. Auto-import side effect ở `GET /api/engagements` — dùng workspace kiểm soát khi capture.
2. Slug (`name`) là workspace dir: rename metadata ≠ rename filesystem.
3. Threads limit 20, không pagination.
4. plan-docs chỉ 4/8 tài liệu planning.
5. Findings read-only Markdown parse; không review workflow.
6. Timeline dựa mtime; không thay thế event log.
7. File API: không có `evidence/`, `plan/` trong allowlist; text-only UTF-8; non-recursive.
8. Graph cần Neo4j; empty graph ≠ dependency failure (phải phân biệt).
9. Approvals file-backed; duplicate → 409; concurrency cần regression coverage.
10. Chưa có scoped run/stream/cancel/resume endpoints cho chat trực tiếp — P6 build trên ADR P4.5.
