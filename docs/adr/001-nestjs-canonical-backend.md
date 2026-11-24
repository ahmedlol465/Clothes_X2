# ADR 001: NestJS as Canonical Backend

## Status
Accepted — superseded in part (see note)

> **Note (database migration phase):** the Express entry point described
> below has since been deleted, along with the file-backed JSON store. NestJS
> is now the *only* runtime, so `start:legacy` and `server.js` no longer exist.
> The historical context below is kept as the rationale for that decision.

## Date
2026-11-24

## Context
The SmartWardrobe backend began as a monolithic Express server (`server.js`) with inline route handlers, business logic, and database access. Over time, NestJS modules were added incrementally (`auth`, `users`, `wardrobe`, `outfits`, `planner`, `shop`, `stylist`, `admin`, `weather`, `ai`) but the Express entry point remained active for legacy routes.

This created a dual-maintenance burden:
- Two routing systems (Express + NestJS)
- Inconsistent middleware (auth, validation, error handling)
- No single source of truth for business logic
- Difficult testing and type safety

## Decision
**NestJS is the canonical backend.** The Express `server.js` is retained only as a legacy entry point (`npm run start:legacy`) for emergency rollback. All new development targets NestJS modules. Legacy Express routes are wrapped behind NestJS-compatible interfaces and migrated incrementally.

## Consequences

### Positive
- Single framework for DI, validation, guards, pipes, interceptors
- Type-safe modules with clear boundaries
- Consistent error handling via `AllExceptionsFilter`
- Swagger/OpenAPI generation from decorators
- Easier testing with NestJS testing utilities

### Negative
- Express `server.js` remains in repo (dead code until removed)
- Legacy engines (`ai-engine`, `llm`, `vision`, etc.) still exported from `common/legacy/legacy-modules.ts` and wrapped behind interfaces rather than removed
- Migration effort for remaining Express-only routes

## Implementation Notes
- `package.json`: `start = nest start`, `dev = nest start --watch`, `start:prod = node dist/main.js`, `start:legacy = node server.js`
- `main.ts`: Bootstrap with global prefix `/api`, ValidationPipe, Helmet, CORS, rate limiting
- Legacy modules accessed via `common/legacy/legacy-modules.ts` barrel export
- TypeOrmModule.forFeature in each feature module for repository injection

## Related
- ADR 002: Python AI Service as Analysis Source of Truth
- ADR 003: Mock Fallback as Demo Mode