# Raptix Web console

The TypeScript and Vite frontend is adapted from CyberStrikeAI. It presents projects, conversations, findings and evidence. [Web integration](../../docs/architecture/web-integration.md)

## Run

For the local demo, use Node.js 22.12 or later and run these commands from the repository root.

```sh
npm ci
npm run build --workspace=@raptix/web-contracts
npm run dev --workspace=@raptix/ui-app -- --mode demo
```

Open the URL printed by Vite, usually `http://127.0.0.1:5173/`. Demo mode uses sample data. For Web API development, run without `--mode demo`, leave `VITE_MOCK` off and configure the API base and proxy target. [UI environment template](.env.example)

## Docker

Use the repository's [.env template](../../.env.example) for the deployment configuration. From the repository root, build the UI and start it with its Compose dependencies.

```sh
docker compose up -d --build ui
```

Open `http://127.0.0.1:5173/`, or use the port set by `UI_PORT`. Nginx serves the built frontend and forwards `/api` requests to the Web API, including SSE and WebSockets. See the [Web API setup](../api/README.md#dev) and [model settings](../../docs/model-settings.md) for backend configuration.

## Verification

After installing dependencies and building the shared contracts, run the frontend checks from the repository root.

```sh
npx playwright install chromium
npm run check --workspace=@raptix/ui-app
```

The checks include type checking, linting, unit tests and browser tests of both builds. Playwright needs ports 4173 and 4174 free for its preview servers. Its demo cases exercise UI behavior with sample data. The [Web integration guide](../../docs/architecture/web-integration.md#verification) describes deployment checks.

## Frontend structure

- `src/features/` contains screen and feature code.
- `src/api/` owns the browser-facing API client and contracts.
- `src/main.ts` initializes the application, router and session handling.

[OpenAPI contract](docs/openapi.yaml) · [Realtime transport](docs/realtime-api-contracts.md)
