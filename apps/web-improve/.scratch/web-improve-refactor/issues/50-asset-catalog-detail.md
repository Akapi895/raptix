# 50: Asset catalog and detail

**What to build:** Migrate asset inventory/detail and scope-classification reads through typed services, keeping import/scope mutations bridged until 51.
**Blocked by:** 13.
**Status:** ready-for-agent
**Owner:** Asset read models and catalog/detail surfaces.
**Contract:** [execution.md](../execution.md).

- [ ] Search/type/scope filters/pagination and detail links show only accessible assets with loading/empty/error states.
- [ ] Ports, findings, evidence and ROE relationships remain scoped; sensitive data respects role masking.
- [ ] Pending/out/unclassified assets are visibly distinct from execution-eligible in-scope assets.
- [ ] Operation/project mutations update asset relationships across the shared authority; compatibility import links remain usable.
