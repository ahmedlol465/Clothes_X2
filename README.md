# SmartWardrobe

Flutter implementation of the **SmartWardrobe – Your AI Personal Stylist** Figma
design (24 frames, iPhone 393 × 852).

## Design tokens

All values were sampled directly from the Figma artboards rather than guessed.

| Token | Value | Used for |
| --- | --- | --- |
| `background` | `#FAF9F5` | every screen |
| `surface` | `#FFFFFF` | cards, fields, sheets |
| `primary` | `#5E4B8B` | primary buttons, active states, charts |
| `primaryMid` | `#7B62B3` | donut segments |
| `primaryLight` | `#9D82D2` | lightest donut segment, overlines |
| `neutral` | `#99928C` | "Sporty" segment, disabled icons |
| `textPrimary` | `#1E1C1A` | headlines, values |
| `textSecondary` | `#6B6560` | body copy, meta lines |
| `textTertiary` | `#99928C` | placeholders, nav labels |
| `border` | `#E3E0DB` | card and field hairlines |
| `tint` | `#EAE6F4` | "why recommended" / info panels |
| `dangerSurface` | `#FFF4F4` | wardrobe-gap alert |

**Type** — `Playfair Display` for every headline and the wordmark, `Inter` for
all interface copy. Both ship as variable fonts and are driven through the
`wght` axis via `FontVariation`, so any weight is available without extra files.

## Frame → screen map

| # | Design frame | Screen |
| --- | --- | --- |
| 1 | Splash | `features/splash/splash_screen.dart` |
| 2–4 | Onboarding carousel | `features/onboarding/onboarding_screen.dart` |
| 5 | Welcome Back | `features/auth/login_screen.dart` |
| 6 | Create Account | `features/auth/login_screen.dart` |
| 7 | Home dashboard | `features/home/home_screen.dart` |
| 8 | My Wardrobe | `features/wardrobe/wardrobe_screen.dart` |
| 9 | Add New Clothing | `features/wardrobe/add_clothing_screen.dart` |
| 10 | AI is analyzing | `features/wardrobe/analyzing_screen.dart` |
| 11 | Item detail | `features/wardrobe/item_detail_screen.dart` |
| 12 | AI Stylist chat | `features/stylist/stylist_screen.dart` |
| 13 | Perfect Match | `features/outfits/perfect_match_screen.dart` |
| 14 | Style Avatar | `features/stylist/style_avatar_screen.dart` |
| 15 | Create Your Outfit | `features/stylist/create_outfit_screen.dart` |
| 16 | Saved Outfits (3 tabs) | `features/outfits/outfits_screen.dart` |
| 17 | Outfit History | `features/outfits/outfit_history_screen.dart` |
| 18 | Outfit Planner | `features/outfits/outfit_planner_screen.dart` |
| 19 | Travel Planner | `features/travel/travel_planner_screen.dart` |
| 20 | Your Style DNA | `features/insights/style_dna_screen.dart` |
| 21 | Wardrobe Insights | `features/insights/wardrobe_insights_screen.dart` |
| 22 | Smart Shopping | `features/shop/smart_shopping_screen.dart` |
| 23 | Discover | `features/discover/discover_screen.dart` |
| 24 | My Profile | `features/profile/profile_screen.dart` |

## Architecture

```
lib/
  app.dart                     MaterialApp + named routes
  main.dart
  core/
    icons/
      svg_path_parser.dart     SVG path data -> dart:ui Path (M L H V C S Q T A Z)
      sw_icon.dart             46-glyph outlined icon set drawn from that data
    theme/
      app_colors.dart          colour tokens
      app_typography.dart      type scale (variable-font aware)
      app_spacing.dart         spacing, radii, component sizes
      app_theme.dart           MaterialApp theme assembled from the tokens
    widgets/
      sw_screen.dart           scaffold, app bar, icon button, layout anchors
      sw_widgets.dart          button, field, card, chip, banner, avatar, image
  data/
    assets.dart                semantic asset paths
    models.dart                ClothingItem, Outfit, ChatMessage, ...
    mock_data.dart             every string and record from the design
  features/                    one folder per tab, screens grouped by area
```

### Notable implementation details

- **Custom icons.** The design uses thin outlined glyphs (t-shirt, sparkle,
  layers, thumbs-up…) that Material Icons does not provide, so the whole family
  is authored as SVG path data on a 24 × 24 grid and stroked by a `CustomPainter`.
  `svg_path_parser.dart` implements the SVG path grammar including arc-to-cubic
  conversion.
- **Per-tab navigation.** `features/shell/main_shell.dart` gives each bottom-nav
  destination its own `Navigator`, so pushed detail screens keep per-tab history
  and tapping the active tab pops that stack to its root.
- **Layout anchors.** `swTopAnchor(context, designY)` converts an absolute Y from
  the artboard into a spacer below the safe area, keeping the design's vertical
  rhythm on notched devices and on platforms with no system inset.
- **No third-party packages.** Only `flutter` and `cupertino_icons`.

## Assets

The 65 photographs were pulled from the Figma prototype's CDN at full
resolution and renamed to semantic names (`assets/images/`). Fonts live in
`assets/fonts/`.

## Team setup (fresh clone)

```bash
# A. Clone
git clone <repo-url>
cd <repo>

# B. Local AI models (one-time; ~255 MB, NOT committed to git)
cd backend
npm install
npm run setup:models        # downloads Marqo/marqo-fashionCLIP + all-MiniLM-L6-v2
                            # into backend/.model-cache (exists → skipped, never overwritten)

# C. Node backend (the app talks to this on :3001)
npm start                   # → http://localhost:3001  (endpoint index at GET /docs)

# D. Flutter app (second terminal, from the repo root)
flutter pub get
flutter run

# E. API URL
#   Chrome / desktop / iOS sim        → localhost:3001 (default)
#   Android emulator                 → flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001
#   Physical Android device (same Wi-Fi) → use YOUR PC's LAN IP, do NOT commit it:
#     flutter run --dart-define=API_BASE_URL=http://<your-pc-lan-ip>:3001
```

### The AI models behind `npm run setup:models`

The Express runtime performs clothing analysis **locally** with
[transformers.js](https://huggingface.co/docs/transformers.js) (ONNX), so no
API key is needed for the core pipeline:

| Model | Purpose | Loaded by |
| --- | --- | --- |
| `Marqo/marqo-fashionCLIP` (dtype `q8`) | clothing / non-clothing + all attributes | `backend/src/clothing-vision/encoder.js` |
| `Xenova/all-MiniLM-L6-v2` (dtype `q8`) | semantic wardrobe retrieval | `backend/src/retrieval.js` |

Files are cached in `backend/.model-cache/` — the same directory the server
reads at runtime, and the only directory ever touched. Weights are **excluded
from git** (`/backend/.model-cache/` in `.gitignore`). Harmless to re-run:
existing files are never re-downloaded or overwritten.

> **Model reproducibility note.** Both models are resolved from the Hugging Face
> Hub at their default `main` revision (exactly what the audited, tested cache
> uses). transformers.js stores a flat cache that does not record the original
> commit SHA, so we deliberately do **not** guess and hard-code one; if the Hub
> revision ever advances, pin it explicitly later in
> `backend/src/clothing-vision/prompts.js` (`MODEL.revision`) and
> `backend/src/retrieval.js` (`EMBED_MODEL` options). Current `main` SHAs at the
> time of writing: `Marqo/marqo-fashionCLIP` → `44f4c655124ed71e90cbf528d82f508d69d8a81b`,
> `Xenova/all-MiniLM-L6-v2` → `751bff37182d3f1213fa05d7196b954e230abad9`.

### AI Stylist (all optional, keyless core)

The stylist needs **no key**: it answers from a rule engine with 11-factor
scoring, conversation memory, remixes and style learning, and it reads live
weather from Open-Meteo keylessly. `GET /ai/capabilities` shows what is on.
**Clothing analysis itself never requires a key** — it is the local ONNX
pipeline above.

```bash
# backend/.env — copy from backend/.env.example
GEMINI_API_KEY=…    # free, no card: https://aistudio.google.com/apikey
                    # or GROQ_API_KEY / OPENROUTER_API_KEY / OPENAI_API_KEY
```

Add a key to unlock streamed chat replies, LLM vision ("match a photo of an
outfit to your wardrobe") and semantic retrieval (already on with MiniLM).
Without a key these specific capabilities degrade as documented in
`backend/README.md` — the local clothing analysis and wardrobe CRUD are
unaffected.

### Test Add Clothes from your phone (same Wi-Fi)
1. Find your PC's LAN IP (`ipconfig` → IPv4, e.g. `192.168.1.5`).
2. Keep the backend running (`npm start` in `backend/`).
3. Run: `flutter run --dart-define=API_BASE_URL=http://192.168.1.5:3001`
4. Open **Add** → Take Photo / Gallery / Upload Multiple → Save.
   Photos upload to `backend/storage/` (gitignored) and are analyzed on
   their real pixels: Gemini vision when `GEMINI_API_KEY` is set in
   `backend/.env`, filename heuristics otherwise.

The app opens on the splash screen, then onboarding → sign in. **Explore the
demo** on the login screen skips straight into the tabbed app.

Login with the seeded account `karim@fashiontech.com` / `wardrobe2024`.
Every screen reads from the backend and falls back to the bundled catalogue
when it is unreachable, so the app works with or without `npm start` —
but start it to get real wardrobe CRUD, AI chat, outfit scores, planner,
packing, shopping gaps and insights.

## Backend

```
backend/
  server.js          REST API — §8.1 auth, §8.2 users, §8.3 wardrobe
                     (+ POST /wardrobe/upload; files in backend/storage/,
                     served at GET /storage/*), §8.4 AI, §8.5 outfits,
                     §8.6 planner, §8.7 shopping, §8.8 admin, plus
                     GET /weather/current, /health, /docs
  src/taxonomy.js    colour harmony, formality scale, occasion targets,
                     fabric warmth, season fit, garment slots
  src/scoring.js     the 11 match factors with signal-aware weights, the
                     completeness gate, and the explanation generator
  src/style-memory.js  learns taste from ratings and chat, exposes it as
                     factor weights and a Style DNA summary
  src/retrieval.js   semantic retrieval (optional local MiniLM embeddings)
                     with a lexical fallback
  src/weather.js     keyless live weather (Open-Meteo) + seasonal estimate
  src/vision.js      "advanced clothes": photo of a look → matched to the
                     wardrobe, with an explicit list of what is missing
  src/llm.js         LLM providers — structured chat, SSE streaming, vision
  src/ai-engine.js   AI pipeline §9 — beam search over the wardrobe, remixes,
                     occasion detection, offline chat, gaps, packing
  src/store.js       file-backed store (backend/data/db.json, seeded from mock data)
ai-service/
  main.py            FastAPI mirror of POST /ai/* (§6.3). Optional:
                     AI_SERVICE_URL=http://localhost:8000 npm start
lib/core/api/        Flutter side: ApiConfig, ApiClient (package:http +
                     multipart upload, works on mobile + web),
                     SmartWardrobeApi (typed §8 wrapper)
lib/data/app_state.dart  central ChangeNotifier store with offline fallback
```

## Tests

```bash
flutter test
```

`test/svg_path_parser_test.dart` covers the path grammar (absolute/relative
commands, implicit lineto, arc sweep direction, radius scaling, error handling).
`test/sw_icon_test.dart` asserts every glyph in the set is centred on the
24 × 24 grid, fits within it, and draws something.
