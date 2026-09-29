import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/models.dart';
import '../outfits/outfit_history_screen.dart';
import '../outfits/outfit_planner_screen.dart';
import '../outfits/perfect_match_screen.dart';
import '../stylist/create_outfit_screen.dart';
import '../travel/travel_planner_screen.dart';

/// Frame 16 - saved outfits with Saved / History / Favorites tabs.
///
/// Grids load from the backend (`GET /outfits`) via [AppState].
class OutfitsScreen extends StatefulWidget {
  const OutfitsScreen({super.key});

  @override
  State<OutfitsScreen> createState() => _OutfitsScreenState();
}

class _OutfitsScreenState extends State<OutfitsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this);
  final _state = AppState.instance;

  @override
  void initState() {
    super.initState();
    _state.loadOutfits();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  void _open(BuildContext context, Outfit outfit) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => PerfectMatchScreen(outfit: outfit)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SwScreen(
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Insets.gutter,
              Insets.sm,
              Insets.gutter,
              0,
            ),
            child: Row(
              children: [
                Expanded(child: Text('Saved Outfits', style: AppText.h1)),
                SwIconButton(
                  icon: SwIconButtonKind.bag,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const TravelPlannerScreen(),
                    ),
                  ),
                ),
                const SizedBox(width: Insets.sm),
                SwIconButton(
                  icon: SwIconButtonKind.planner,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const OutfitPlannerScreen(),
                    ),
                  ),
                ),
                const SizedBox(width: Insets.sm),
                SwIconButton(
                  icon: SwIconButtonKind.plus,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const CreateOutfitScreen(),
                    ),
                  ),
                ),
              ],
            ),
          ),
          TabBar(
            controller: _tabs,
            labelColor: AppColors.primary,
            unselectedLabelColor: AppColors.textTertiary,
            indicatorColor: AppColors.primary,
            indicatorSize: TabBarIndicatorSize.label,
            indicatorWeight: 2,
            dividerColor: AppColors.border,
            labelStyle: AppText.bodyStrong.copyWith(fontSize: 14),
            unselectedLabelStyle: AppText.body.copyWith(fontSize: 14),
            onTap: (_) => setState(() {}),
            tabs: const [
              Tab(text: 'Saved'),
              Tab(text: 'History'),
              Tab(text: 'Favorites'),
            ],
          ),
          Expanded(
            child: ListenableBuilder(
              listenable: _state,
              builder: (context, _) {
                final saved = _state.savedOutfits;
                final favorites =
                    saved.where((o) => o.favorite).toList();
                return TabBarView(
                  controller: _tabs,
                  physics: const BouncingScrollPhysics(),
                  children: [
                    _SavedGrid(
                      outfits: saved,
                      onOpen: (o) => _open(context, o),
                    ),
                    OutfitHistoryScreen(embedded: true),
                    _FavoritesList(
                      outfits:
                          favorites.isNotEmpty ? favorites : saved.take(3).toList(),
                      onOpen: (o) => _open(context, o),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Two column grid of saved outfits.
class _SavedGrid extends StatelessWidget {
  const _SavedGrid({required this.outfits, required this.onOpen});

  final List<Outfit> outfits;
  final ValueChanged<Outfit> onOpen;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(
        Insets.gutter,
        Insets.lg,
        Insets.gutter,
        Insets.xxl,
      ),
      physics: const BouncingScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: Insets.md,
        crossAxisSpacing: Insets.md,
        childAspectRatio: 0.74,
      ),
      itemCount: outfits.length,
      itemBuilder: (context, i) =>
          OutfitCard(outfit: outfits[i], onTap: () => onOpen(outfits[i])),
    );
  }
}

/// Outfit card used by the saved grid and the favorites list.
class OutfitCard extends StatelessWidget {
  const OutfitCard({super.key, required this.outfit, required this.onTap});

  final Outfit outfit;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: SwCard(
        padding: EdgeInsets.zero,
        clip: true,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: SizedBox(
                width: double.infinity,
                child: SwPhoto(path: outfit.image),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(Insets.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    outfit.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.cardTitle.copyWith(fontSize: 14),
                  ),
                  const SizedBox(height: 5),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          outfit.occasion,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.caption.copyWith(fontSize: 11),
                        ),
                      ),
                      SwMatchBadge(match: outfit.match),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FavoritesList extends StatelessWidget {
  const _FavoritesList({required this.outfits, required this.onOpen});

  final List<Outfit> outfits;
  final ValueChanged<Outfit> onOpen;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(
        Insets.gutter,
        Insets.lg,
        Insets.gutter,
        Insets.xxl,
      ),
      physics: const BouncingScrollPhysics(),
      itemCount: outfits.length,
      separatorBuilder: (_, _) => const SizedBox(height: Insets.md),
      itemBuilder: (context, i) {
        final outfit = outfits[i];
        return SwCard(
          onTap: () => onOpen(outfit),
          padding: const EdgeInsets.all(Insets.md),
          child: Row(
            children: [
              SizedBox(
                width: 72,
                height: 72,
                child: SwProductImage(image: outfit.image),
              ),
              const SizedBox(width: Insets.lg),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(outfit.name, style: AppText.cardTitle),
                    const SizedBox(height: 3),
                    Text(outfit.occasion, style: AppText.caption),
                  ],
                ),
              ),
              SwMatchBadge(match: outfit.match),
            ],
          ),
        );
      },
    );
  }
}
