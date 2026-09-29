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

## Run

```bash
# 1. Backend API (new — implements spec §8, persists to backend/data/db.json)
cd backend
npm install
npm start          # → http://localhost:3001  (endpoint index at GET /docs)

# 2. Flutter app (in a second terminal, from the repo root)
flutter pub get
flutter run        # physical device? add --dart-define=API_BASE_URL=http://<your-lan-ip>:3001
```

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
  server.js          REST API — §8.1 auth, §8.2 users, §8.3 wardrobe,
                     §8.4 AI, §8.5 outfits, §8.6 planner, §8.7 shopping,
                     §8.8 admin, plus GET /weather/current, /health, /docs
  src/ai-engine.js   AI pipeline §9 — compatibility scoring, outfit ranking,
                     explanation generator, wardrobe-aware chat, gap analysis,
                     packing optimisation, clothing analysis heuristics
  src/store.js       file-backed store (backend/data/db.json, seeded from mock data)
ai-service/
  main.py            FastAPI mirror of POST /ai/* (§6.3). Optional:
                     AI_SERVICE_URL=http://localhost:8000 npm start
lib/core/api/        Flutter side: ApiConfig, ApiClient (dart:io, no new deps),
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
