# SmartWardrobe

## Quick start

Prerequisites: Node.js 22 LTS, MySQL 8 or MariaDB 10.6+, Flutter 3.50.x
(stable), Chrome.

```
git clone https://github.com/ahmedlol465/Clothes_X2.git
```

```
cd Clothes_X2 && git checkout feature/creative-round
```

```
bash setup.sh
```

```
bash start.sh
```

(start.sh runs `flutter run -d web-server --web-port=8080 --release` plus
the backend; open http://localhost:8080 in your browser yourself)

Backend runs at http://localhost:3002/api, the web app at
http://localhost:8080. Demo login: karim@fashiontech.com / wardrobe2024.
Both scripts print one line per step; details land in `setup.log` and
`logs/`. Keep `DB_SYNCHRONIZE=false` in `backend/.env`. The full guide
with manual steps, the scraper trigger and common errors is in
[RUNNING.md](RUNNING.md).

## Photo analysis: setup and what to expect

The photo analysis (add clothes from a picture) runs on local models only. No
API key is needed for it.

| Role | Model | Licence | Runs in |
| --- | --- | --- | --- |
| Garment detector | `yainage90/fashion-object-detection` (commit `fb0a4ff2`) | MIT | `ai-service` (Python) |
| Cutout | `facebook/sam2.1-hiera-tiny` (commit `de431c40`) | Apache-2.0 | `ai-service` |
| Type, style, season, pattern, material, gender | `Marqo/marqo-fashionSigLIP` (commit `c56244cc`) | Apache-2.0 | `ai-service` and the Node backend (`backend/.model-cache`) |
| Stylist text search | `Xenova/all-MiniLM-L6-v2` | Apache-2.0 | Node backend |

The pins are in `ai-service/clothing_ai/config/pins.py`; check them with
`python -m clothing_ai.config.pins`.

First run downloads about 550 MB of models (about 330 MB for `ai-service`,
about 230 MB for the backend). The backend builds a label bank on its first
start (about a minute, in the background) and caches it in
`backend/.model-cache`, so wait a minute before the first photo.

1. Copy `backend/.env.example` to `backend/.env` and `ai-service/.env.example`
   to `ai-service/.env`. Set the DB values and your own JWT secrets.
2. `GEMINI_API_KEY` is optional and belongs to each developer. It only powers
   the AI stylist chat. It never touches the photo analysis, which is local
   models only, so everyone gets the same result for the same photo.
3. Pending database migrations run on backend start (they add
   `wardrobe_items.gender`). Keep `DB_SYNCHRONIZE=false`.
4. Uploaded photos are saved in `backend/storage` (ignored by git) and served
   at `/storage`.

Measured honestly (local models only, small test sets, not a guarantee):
colour right on 45 of 57 worn photos; on a varied 30-photo set about 18 of 30
(product photos 10/12, casual 5/10, street 3/8). Worn and street photos are
the weak point. Gender and season are guesses from the photo. Not verified:
Flutter changes were not compiled by the author before review, and the speed
of the first photo on other laptops is not measured.

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
    dto/mappers.dart           JSON -> model mapping for every API payload
    controllers/               per-feature state loaded from the backend API
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

# C. Node backend (the app talks to this on :3002)
npm run dev                 # NestJS, watches src/ → http://localhost:3002/api
                            # Swagger UI: http://localhost:3002/docs

# D. Flutter app (second terminal, from the repo root)
flutter pub get
flutter run

# E. API URL
#   Chrome / desktop / iOS sim        → localhost:3002 (default)
#   Android emulator                 → flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3002
#   Physical Android device (same Wi-Fi) → use YOUR PC's LAN IP, do NOT commit it:
#     flutter run --dart-define=API_BASE_URL=http://<your-pc-lan-ip>:3002
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
2. Keep the backend running (`npm run dev` in `backend/`).
3. Run: `flutter run --dart-define=API_BASE_URL=http://192.168.1.5:3002`
4. Open **Add** → Take Photo / Gallery / Upload Multiple → Save.
   Photos upload to `backend/storage/` (gitignored) and are analyzed on
   their real pixels: Gemini vision when `GEMINI_API_KEY` is set in
   `backend/.env`, filename heuristics otherwise.

The app opens on the splash screen, then onboarding → sign in. **Explore the
demo** on the login screen skips straight into the tabbed app.

Login with the seeded account `karim@fashiontech.com` / `wardrobe2024`
(inserted by the idempotent seed on an empty database, or with `npm run seed`).
Every screen loads its data from the backend API, which reads TypeORM — there
is no bundled catalogue and no mock fallback. With the backend down the app
shows honest offline/empty states instead of demo records.

## Backend

The canonical API is the NestJS app in `backend/src/` (port 3002), backed by
TypeORM. All application data lives in **MySQL** (the only datastore; the
API refuses to boot without a reachable server). Only uploaded binary images
live in file storage (`backend/storage/`).

```
backend/
  src/
    main.ts              bootstrap: validation, Swagger, CORS, rate limit
    app.module.ts        module composition + global auth guards
    modules/             one folder per API area
      auth/              §8.1 register, login, refresh, logout
      users/             §8.2 profile, avatar, style profile
      wardrobe/          §8.3 CRUD, uploads, batch import
      ai/                §8.4 Python clothing-analysis client
      outfits/           §8.5 recommendations, feedback, favorites
      planner/           §8.6 weekly plan, events, travel packing
      shop/              §8.7 recommendations, wishlist, before-you-buy
      admin/             §8.8 dashboard, users, AI performance
      stylist/           chat, streaming, photo match, remix, Style DNA
      weather/           live Open-Meteo conditions
    common/              guards, filters, interceptors, cache, storage, DTOs
    database/            TypeORM entities, migrations, seed (MySQL)
    config/              typed configuration factories
  test/                  unit specs + HTTP e2e smoke test
ai-service/
  main.py                FastAPI clothing-analysis sidecar
                         (AI_SERVICE_URL=http://localhost:8000; optional)
lib/core/api/            Flutter side: ApiConfig, ApiClient (package:http +
                         multipart upload, works on mobile + web),
                         SmartWardrobeApi (typed §8 wrapper)
lib/data/                models, DTO mappers, repositories, AppState facade
```

## Tests

```bash
flutter test
```

`test/svg_path_parser_test.dart` covers the path grammar (absolute/relative
commands, implicit lineto, arc sweep direction, radius scaling, error handling).
`test/sw_icon_test.dart` asserts every glyph in the set is centred on the
24 × 24 grid, fits within it, and draws something.
