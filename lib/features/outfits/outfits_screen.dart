import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
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

  /// Confirms, then un-saves [outfit]. The dialog makes the intent explicit and
  /// spells out that only the saved entry is removed — the look and its rating
  /// are kept. The card is only taken off the grid once [AppState.unsaveOutfit]
  /// confirms the server removed the relationship; otherwise the real error is
  /// reported and the outfit stays put.
  Future<void> _unsave(Outfit outfit) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove saved outfit?'),
        content: Text(
          '"${outfit.name}" will leave your Saved list. '
          'The outfit and its rating are kept.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    final removed = await _state.unsaveOutfit(outfit);
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            removed
                ? 'Removed from saved outfits.'
                : (_state.lastError ?? 'Could not remove outfit.'),
          ),
        ),
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
                    _OutfitsTab(
                      keyRoot: 'saved_outfits',
                      grid: true,
                      outfits: saved,
                      loading: _state.outfitsLoading,
                      settled: _state.outfitsSettled,
                      error: _state.outfitsError,
                      onRetry: _state.loadOutfits,
                      onOpen: (o) => _open(context, o),
                      onUnsave: _unsave,
                      emptyTitle: 'No saved outfits yet',
                      emptyMessage:
                          'Create your first look and it will show up here.',
                      emptyActionLabel: 'Create an outfit',
                      onEmptyAction: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => const CreateOutfitScreen(),
                        ),
                      ),
                    ),
                    OutfitHistoryScreen(embedded: true),
                    _OutfitsTab(
                      keyRoot: 'favorite_outfits',
                      grid: false,
                      outfits:
                          favorites.isNotEmpty ? favorites : saved.take(3).toList(),
                      loading: _state.outfitsLoading,
                      settled: _state.outfitsSettled,
                      error: _state.outfitsError,
                      onRetry: _state.loadOutfits,
                      onOpen: (o) => _open(context, o),
                      emptyTitle: 'No favorites yet',
                      emptyMessage:
                          'Tap the heart on an outfit to keep it in Favorites.',
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

/// One tab's content: the shared loading / error / empty / list states for the
/// Saved and Favorites tabs.
///
/// [outfits] is only ever [AppState.savedOutfits] (or its favorites subset) —
/// never [MockData] — so an empty grid means the backend really has nothing,
/// not that the request has not answered. While a request is in flight or has
/// not settled yet an empty list shows a spinner; a failure shows the real
/// message plus a Retry instead of an empty state that would hide the error.
class _OutfitsTab extends StatelessWidget {
  const _OutfitsTab({
    required this.keyRoot,
    required this.grid,
    required this.outfits,
    required this.loading,
    required this.settled,
    required this.error,
    required this.onRetry,
    required this.onOpen,
    required this.emptyTitle,
    required this.emptyMessage,
    this.onUnsave,
    this.emptyActionLabel,
    this.onEmptyAction,
  });

  final String keyRoot;
  final bool grid;
  final List<Outfit> outfits;
  final bool loading;
  final bool settled;
  final String? error;
  final Future<bool> Function() onRetry;
  final ValueChanged<Outfit> onOpen;

  /// Un-save action for the Saved grid. Null on tabs that do not offer it
  /// (e.g. Favorites), so those cards render without the control.
  final ValueChanged<Outfit>? onUnsave;
  final String emptyTitle;
  final String emptyMessage;
  final String? emptyActionLabel;
  final VoidCallback? onEmptyAction;

  @override
  Widget build(BuildContext context) {
    if (outfits.isEmpty && (loading || !settled)) {
      return _OutfitsLoading(key: ValueKey('${keyRoot}_loading'));
    }
    if (outfits.isEmpty && error != null) {
      return _OutfitsError(
        key: ValueKey('${keyRoot}_error'),
        message: error!,
        onRetry: onRetry,
      );
    }
    if (outfits.isEmpty) {
      return _OutfitsEmpty(
        key: ValueKey('${keyRoot}_empty'),
        title: emptyTitle,
        message: emptyMessage,
        actionLabel: emptyActionLabel,
        onAction: onEmptyAction,
      );
    }
    return grid
        ? _SavedGrid(
            key: ValueKey('${keyRoot}_grid'),
            outfits: outfits,
            onOpen: onOpen,
            onUnsave: onUnsave,
          )
        : _FavoritesList(
            key: ValueKey('${keyRoot}_list'),
            outfits: outfits,
            onOpen: onOpen,
          );
  }
}

/// Neutral spinner shown while saved outfits load (or before the first request
/// settles), so an empty list is never mistaken for "you have no outfits".
class _OutfitsLoading extends StatelessWidget {
  const _OutfitsLoading({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: SizedBox.square(
        dimension: 26,
        child: CircularProgressIndicator(strokeWidth: 2),
      ),
    );
  }
}

/// Failure state for a saved-outfits request: the real API message plus a Retry
/// that re-runs `AppState.loadOutfits`.
class _OutfitsError extends StatelessWidget {
  const _OutfitsError({super.key, required this.message, required this.onRetry});

  final String message;
  final Future<bool> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Insets.gutter),
        child: SwCard(
          padding: const EdgeInsets.all(Insets.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SwIconBadge(icon: SwIcon.alert, circle: true, size: 44),
              const SizedBox(height: Insets.md),
              Text(
                "Couldn't load saved outfits",
                textAlign: TextAlign.center,
                style: AppText.cardTitle,
              ),
              const SizedBox(height: Insets.xs),
              Text(message, textAlign: TextAlign.center, style: AppText.caption),
              const SizedBox(height: Insets.lg),
              SwButton(label: 'Retry', onTap: onRetry, expand: false),
            ],
          ),
        ),
      ),
    );
  }
}

/// Honest empty state for a tab that has a settled, empty result from the
/// backend. The optional action is the real way to create content (the existing
/// [CreateOutfitScreen]).
class _OutfitsEmpty extends StatelessWidget {
  const _OutfitsEmpty({
    super.key,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Insets.gutter),
        child: SwCard(
          padding: const EdgeInsets.all(Insets.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SwIconBadge(icon: SwIcon.shirt, circle: true, size: 44),
              const SizedBox(height: Insets.md),
              Text(title, textAlign: TextAlign.center, style: AppText.cardTitle),
              const SizedBox(height: Insets.xs),
              Text(message, textAlign: TextAlign.center, style: AppText.caption),
              if (actionLabel != null && onAction != null) ...[
                const SizedBox(height: Insets.lg),
                SwOutlineButton(
                  label: actionLabel!,
                  onTap: onAction!,
                  expand: false,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Two column grid of saved outfits.
class _SavedGrid extends StatelessWidget {
  const _SavedGrid({
    super.key,
    required this.outfits,
    required this.onOpen,
    this.onUnsave,
  });

  final List<Outfit> outfits;
  final ValueChanged<Outfit> onOpen;
  final ValueChanged<Outfit>? onUnsave;

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
      itemBuilder: (context, i) => OutfitCard(
        outfit: outfits[i],
        onTap: () => onOpen(outfits[i]),
        onUnsave: onUnsave == null ? null : () => onUnsave!(outfits[i]),
      ),
    );
  }
}

/// Outfit card used by the saved grid and the favorites list.
///
/// [onUnsave], when supplied, adds a small bookmark control over the photo that
/// removes the outfit from the user's saved list. It is omitted wherever an
/// unsave would be meaningless (for example the Home recommendation rail), so
/// those cards stay pixel-identical to before.
class OutfitCard extends StatelessWidget {
  const OutfitCard({
    super.key,
    required this.outfit,
    required this.onTap,
    this.onUnsave,
  });

  final Outfit outfit;
  final VoidCallback onTap;
  final VoidCallback? onUnsave;

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
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    SwPhoto(path: outfit.image),
                    if (onUnsave != null)
                      Positioned(
                        top: Insets.sm,
                        right: Insets.sm,
                        child: _UnsaveButton(
                          key: ValueKey('unsave_${outfit.id}'),
                          onTap: onUnsave!,
                        ),
                      ),
                  ],
                ),
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
                      SwMatchBadge(match: outfit.displayMatch),
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

/// The bookmark control that removes a saved outfit from the grid.
///
/// A plain circular button rather than [SwIconButton] because that widget only
/// renders the fixed header glyphs; the bookmark belongs to the outfit card's
/// own vocabulary. The visible tap target is kept comfortable while the icon
/// stays light.
class _UnsaveButton extends StatelessWidget {
  const _UnsaveButton({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Remove from saved outfits',
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: AppColors.surface,
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.border),
          ),
          child: const Center(
            child: SwIconView(
              SwIcon.bookmark,
              size: 17,
              color: AppColors.textPrimary,
            ),
          ),
        ),
      ),
    );
  }
}

class _FavoritesList extends StatelessWidget {
  const _FavoritesList({super.key, required this.outfits, required this.onOpen});

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
              SwMatchBadge(match: outfit.displayMatch),
            ],
          ),
        );
      },
    );
  }
}
