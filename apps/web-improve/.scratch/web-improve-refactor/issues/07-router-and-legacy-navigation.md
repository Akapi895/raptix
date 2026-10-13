# 07: Router, route inventory and legacy navigation adapter

**What to build:** Introduce React Router, lazy route wrappers, auth/404/error handling and the `go()` compatibility adapter. Record all source route keys and their canonical URLs/tabs before changing routing. Shell and UI extraction follow separately.
**Blocked by:** 06.
**Status:** ready-for-agent
**Owner:** Router, route inventory and serialized manifest registration.
**Contract:** [execution.md](../execution.md).

- [ ] The inventory captures the source's 53 keys, entity IDs and tab aliases, with command-center home and no invented dashboard alias.
- [ ] Direct navigation/refresh, old hash links, browser back/forward and base-path deployment resolve consistently; unauthenticated access preserves a safe return destination.
- [ ] Legacy `go()` and route readers forward to the new router; no duplicate hash listeners or competing location writers remain.
- [ ] Lazy loading, route crashes, not-found, dirty-navigation blocking and project detail transitions have rendered smoke tests.
