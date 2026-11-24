# SmartWardrobe Documentation

Welcome to the SmartWardrobe documentation. This index provides navigation to all project documentation.

## Architecture & Design

- [Architecture Overview](architecture.md) - System architecture, data flow, and technology choices
- [ADR: NestJS as Canonical Backend](adr/001-nestjs-canonical-backend.md)
- [ADR: Python AI Service as Analysis Source of Truth](adr/002-python-ai-analysis-source.md)
- [ADR: Mock Fallback as Demo Mode](adr/003-mock-fallback-demo-mode.md)

## API Reference

- [API Overview](api/overview.md) - Base URL, authentication, error handling
- [Authentication](api/auth.md) - Login, register, token refresh
- [Users](api/users.md) - Profile, style blueprint, avatar
- [Wardrobe](api/wardrobe.md) - Items, upload, analysis, categories
- [AI](api/ai.md) - Clothing analysis, outfit generation, compatibility, stylist chat
- [Outfits](api/outfits.md) - Saved outfits, today's pick, history, favorites
- [Planner](api/planner.md) - Weekly plan, travel packing, recommendations
- [Shopping](api/shopping.md) - Recommendations, wishlist, gap analysis
- [Admin](api/admin.md) - Health, metrics, user management
- [Weather](api/weather.md) - Live conditions via keyless Open-Meteo

## Development

- [Getting Started](dev/getting-started.md) - Prerequisites, setup, running locally
- [Flutter App](dev/flutter-app.md) - Project structure, state management, theming
- [NestJS Backend](dev/nestjs-backend.md) - Module structure, DI, database, legacy adapters
- [Python AI Service](dev/python-ai.md) - Pipeline, vision, heuristics, contract tests
- [Testing](dev/testing.md) - Unit, integration, e2e, contract tests
- [Contributing](../CONTRIBUTING.md) - Code style, PR process, commit conventions

## Operations

- [Deployment](ops/deployment.md) - Docker, environment variables, migrations
- [Monitoring](ops/monitoring.md) - Health checks, logging, metrics
- [Troubleshooting](ops/troubleshooting.md) - Common issues and solutions

## Legacy

- [Legacy Adapters](legacy/adapters.md) - Wrapping old engines behind interfaces
- [Migration Guide](legacy/migration.md) - From Express to NestJS, SQLite to Postgres

---

*Last updated: 2026-11-24*