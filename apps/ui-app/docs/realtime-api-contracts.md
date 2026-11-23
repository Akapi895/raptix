# Realtime transport

The [OpenAPI contract](openapi.yaml) describes HTTP requests and responses. Use the frontend sources below for stream processing and the [Web integration guide](../../../docs/architecture/web-integration.md) for service availability.

| Flow | Transport | Frontend source |
| --- | --- | --- |
| Streaming chat | Fetch with a server-sent event response | [Chat client](../src/api/clients/chat.ts) |
| Reattaching to a task | Fetch with a server-sent event response | [Task replay](../src/features/chat/replay/attach.ts) |
| C2 event view | Browser EventSource | [Event client](../src/platform/access-browser.ts) |
| Terminal session | WebSocket carrying terminal data and control frames | [Terminal client](../src/features/terminal/service.ts) |

## Event handling

The [SSE parser](../src/platform/sse.ts) decodes frames across response chunks and parses their JSON data. The [chat stream handler](../src/features/chat/stream/events.ts) applies events to the active conversation. The [shared streaming package](../../shared/streaming/src/) owns event normalization used by clients.

## Verification

The demo uses [local fixtures](../src/mock/). The [chat flow test](../tests/e2e/flows.spec.ts) and [production startup test](../tests/e2e/production.spec.ts) cover the frontend with controlled responses. Live transport availability depends on the Web API and connected services.
