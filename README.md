# Raptix

Raptix is a multi-agent research platform for authorized red team exercises in isolated lab environments. It connects engagement plans, agent activity and recorded evidence so operators can review how a finding was reached.

## How the system fits together

- The web console presents projects, conversations and findings. [Web app](apps/ui-app/README.md)
- The Web API translates between the console's contract and the Raptix runtime. It stores Web application records in PostgreSQL via Prisma. [API](apps/api/README.md)
- The Python runtime tracks engagement objectives and agent runs. It uses LangGraph checkpoints for run state and Neo4j for the engagement knowledge graph. [Runtime boundaries](docs/architecture/runtime-boundaries.md)

## Documentation

- Run the Web demo or configure its API connection. [Web setup](apps/ui-app/README.md)
- Read the architecture and security documentation. [Documentation index](docs/README.md)
- Report a security issue privately. [Security reporting](docs/security/threat-model.md#reporting)

## Credits

Raptix builds on the Decepticon runtime and adapts a frontend originally extracted from CyberStrikeAI. [Web integration](docs/architecture/web-integration.md)
