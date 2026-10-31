# Raptix Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Scope and Confirmation

This record governs the standalone Raptix frontend in `ui-app/`. The primary
audience, product priority, user-facing name, and preservation baseline were
confirmed during initialization. Implementation details below are grounded in
this app's code and documentation.

## Users

Pentesters and red teams conducting authorized security assessments. They need
to direct AI-assisted operations, work across projects and targets, inspect
execution, and investigate findings within one workspace.

The current deployment target is a single local operator. Platform member,
platform-role, and resource-grant administration are not frontend workflows.
Authentication and backend resource authorization remain part of the product;
AI agent roles are separate from platform user roles.

## Product Purpose

This package is the standalone Raptix UI for a single-user, locally deployed
Autonomous AI Red Team platform. It connects projects, assets,
vulnerabilities, knowledge, and security operations. Its primary product
priority is bringing these activities together so practitioners can organize
assessment work and move between execution and findings with relevant context.

Success means practitioners can carry out and review their assessment work
across these connected workflows. Quantitative success measures are undecided.

## Positioning

The implementation combines conversational AI-assisted security work with
agent and tool configuration, reusable workflows, execution monitoring, and
project-linked findings. No exclusive market claim or competitive advantage
has been established.

## Operating Context

- The frontend retains an authenticated browser console and API permission gates.
  There is no platform member or role administration workflow.
- Projects provide context for conversations and related assessment work.
- Chat connects instructions, attachments, agent/tool execution, progress,
  human-in-the-loop decisions, and retained conversation history.
- Assets and vulnerabilities support investigation and maintenance of findings;
  attack-chain views provide another way to inspect connected assessment facts.
- Tasks, workflows, monitoring, knowledge, agents, roles, and tools support
  repeatable operations and administration.
- Desktop and mobile-web workflows are part of the existing product.

## Capabilities and Constraints

- The real Raptix backend is not available in this repository. Existing API
  interfaces are an export boundary, not a verified Raptix integration contract.
- Preserve existing workflows, permission gates, localization infrastructure, and
  mobile-web support when changing the frontend.
- The existing app uses strict TypeScript, DOM-based UI, and Vite; backend
  boundaries belong to the platform/API adapters.
- Production and demo modes are distinct. Production uses configured API transports;
  development with `--mode demo` and demo builds use the local demo API.
  Demo data is not evidence of production activity.
- Production builds go to `dist/`; demo builds go to `dist-demo/`.
- English (`en-US`) is the only currently bundled locale, with i18next and
  translation-key infrastructure. Additional locale commitments are undecided.
- Existing capabilities also include terminal, WebShell, C2, storage, audit,
  authenticated API access, settings, and API documentation. Their presence does not
  change the primary audience or product priority above.
- Assessment and execution capabilities are intended for systems users own
  or are authorized to test.

## Brand Commitments

- Raptix is the confirmed user-facing name for this frontend.
- Existing frontend assets include `public/static/logo.png`,
  `public/static/favicon.png`, and `public/static/site.webmanifest`.
- No additional voice or personality commitments were established during init.

## Evidence on Hand

- `README.md`: app setup, demo/production behavior, and verification commands.
- `src/features/`: implemented product domains and workflows.
- `src/api/` and `src/platform/`: API and browser integration boundaries.
- `src/i18n/index.ts` and `src/i18n/resources/en-US.json`: current locale and
  presentation copy.
- `index.html` and `api-docs.html`: app and API-documentation entry points.
- `src/mock/`: demo transport and data, not customer results.
- `tests/` and feature-local tests: behavioral verification sources.
- No customer testimonials, case studies, adoption figures, or performance
  claims were confirmed during initialization.

## Product Principles

1. Keep project context connected across operations, assets, and findings.
2. Prioritize practitioners' assessment work when making product tradeoffs.
3. Preserve users' ability to understand execution and exercise the controls
   available to their permissions.
4. Maintain API compatibility and distinguish demo activity from real work.
5. Preserve established workflows across supported browser sizes and the
   existing English-language presentation.

## Open Decisions

- Quantitative product success measures and prioritized assessment scenarios.
- Deployment and browser-support commitments beyond the existing app setup.
- Additional locales and product-specific accessibility requirements.
