# ADR 003: Mock Fallback as Demo Mode

## Status
Accepted

## Date
2026-11-24

## Context
The Python AI service requires a Google Gemini API key for vision analysis. Without it, or when the service is unreachable, the app would fail to analyze clothing — blocking core user flows (Add Clothing, Stylist photo match).

During demos, hackathons, and offline development, the backend must work without external dependencies.

## Decision
**Mock/local analysis is a first-class fallback mode, not an afterthought.**

The `AI_ANALYZER` config controls the analysis source:
| Value | Behavior |
|-------|----------|
| `local` | TypeScript heuristics only (filename/EXIF parsing) |
| `python` | Python service required; fail if unavailable |
| `auto` (default) | Try Python; on timeout/error, fall back to local |

The local analyzer (`aiEngine.filenameAnalysis`, `aiEngine.analyzeImageHeuristics`) extracts attributes from:
- Filename patterns (e.g., `red_silk_dress.jpg` → color=Red, material=Silk)
- EXIF metadata (if present)
- Deterministic hash-based pseudo-random for demo variety

## Consequences

### Positive
- Zero-config demos: `npm run dev` works without API keys
- Offline development: full wardrobe flow works on airplane mode
- Resilient production: Gemini outage degrades gracefully
- Clear UX: UI shows "AI vision analysis complete" vs "Analysis complete (offline heuristics)"

### Negative
- Local results less accurate than vision (mitigated: user can edit tags before save)
- Two code paths to maintain (mitigated: shared vocabulary in `legacy-vocabularies.ts`)
- Demo data can leak into real wardrobes if user doesn't edit (mitigated: tags editable pre-save)

## Implementation Notes
- `ClothingAnalyzerService.analyze()` implements the fallback chain
- `source` field in response: `clothing-vision`, `clothing-vision+gemini`, `filename`, `heuristic`
- Flutter `AnalyzingScreen` shows source badge: "AI vision analysis complete" vs "Analysis complete (offline heuristics)"
- `AI_ANALYZER=local` used in CI/CD for fast, deterministic tests

## Related
- ADR 001: NestJS as Canonical Backend
- ADR 002: Python AI Service as Analysis Source of Truth