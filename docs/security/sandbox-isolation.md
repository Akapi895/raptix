# Sandbox isolation

The sandbox provides the runtime's workspace and execution boundary. The base Compose service and launcher-generated project sandboxes use separate configuration paths. [Compose definition](../../docker-compose.yml) ? [Launcher sandbox template](../../apps/launcher/internal/sandboxes/sandboxes.go)

## Workspace scope

- The base Compose service mounts a workspace at `/workspace`. A named engagement can pin runtime access to its workspace. A path prefix on a shared mount is a runtime scope check. Review the actual mounts when assessing filesystem isolation.
- In the Web flow, the API resolves the project workspace and uses the sandbox controller when its URL and credential are configured. Files and approval records are reached through the sandbox associated with that project.
- The runtime validates an explicitly pinned engagement before shell execution. Use the workspace and deployment recorded with an evidence run when interpreting its results.

[Web sandbox routing](../../apps/api/src/adapters/sandbox/routing.ts) ? [Controller wiring](../../apps/api/src/main.ts) ? [Runtime scope check](../../packages/raptix/raptix/execution/tools/bash/bash.py)

## Container and network controls

The base Compose sandbox drops all capabilities before adding its configured set. It enables `no-new-privileges`, sets a 4 GiB memory limit and caps process count at 4096. The launcher template has its own resource and mount settings.

The host controller owns the container operations it permits. Keep its credential on the service side of the boundary. Network and action scope remain subject to the [runtime controls](security-controls.md) and [Rules of Engagement](roe-machine-enforcement.md).

## Verifying the hardening

- Compare the deployed mounts, capability set, security options and resource limits with the configuration used for that deployment.
- Check that a named workspace excludes peer project directories. Verify that an incompatible engagement is rejected.
- Check the sandbox and management networks against the Compose isolation test. A local HTTP test covers request handling, while a deployment check is needed for actual container mounts and limits. [Compose isolation test](../../tests/test_compose_network_isolation.py) ? [Sandbox client tests](../../apps/api/tests/adapters/sandbox-client.test.ts)

The shared-container design and the earlier per-engagement proposal are in Git at `8e5d356b` under this file's path.
