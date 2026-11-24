# ADR 002: Python AI Service as Analysis Source of Truth

## Status
Accepted

## Date
2026-11-24

## Context
Clothing analysis (attribute extraction from images) was originally implemented in TypeScript within the NestJS `AiModule` using a local heuristic engine (`ai-engine`). When Google Gemini vision became available, a Python FastAPI service was added for higher-accuracy vision analysis.

This created two competing analysis paths:
1. TypeScript `AiService.analyzeClothing()` → local heuristics
2. Python `POST /analyze-clothing` → Gemini vision + heuristics fallback

No clear ownership: both could be called, results differed, and configuration was scattered.

## Decision
**Python AI Service is the single source of truth for clothing analysis.**

The NestJS `ClothingAnalyzerService` delegates to Python via HTTP. The `AI_ANALYZER` environment variable controls behavior:
- `local` — TypeScript heuristics only (offline/demo)
- `python` — Python service required (production)
- `auto` — Python preferred, falls back to local on failure (default)

## Consequences

### Positive
- Single analysis pipeline with consistent results
- Python owns vision models, taxonomy, heuristics — easier to iterate
- NestJS remains thin orchestration layer
- Clear fallback chain for demos/offline use
- Python service independently deployable and scalable

### Negative
- Additional network hop for analysis (mitigated: 20s timeout, local fallback)
- Python service must be running for full accuracy (CI runs in `local` mode)
- Version coupling: Python Pydantic models ↔ NestJS DTOs need contract tests

## Implementation Notes
- `ClothingAnalyzerService` (NestJS) → `HttpService.post('/analyze-clothing')` → Python FastAPI
- Python `main.py` routes: `/analyze-clothing`, `/generate-outfit`, `/calculate-compatibility`, `/remix`, `/match-outfit`, `/describe-outfit`, `/style-dna`
- Shared vocabulary in `ai-service/taxonomy/normalizer.py` and `backend/src/common/legacy/legacy-vocabularies.ts`
- Timeout: 20s for vision, 10s for heuristics
- Contract tests needed (see Item 10 in handoff)

## Related
- ADR 001: NestJS as Canonical Backend
- ADR 003: Mock Fallback as Demo Mode