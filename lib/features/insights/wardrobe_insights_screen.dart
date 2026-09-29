import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/models.dart';
import '../stylist/stylist_screen.dart';

/// Frame 21 - data driven overview of the closet.
///
/// Stats, most-worn and never-worn rows are computed from the live wardrobe.
class WardrobeInsightsScreen extends StatefulWidget {
  const WardrobeInsightsScreen({super.key});

  @override
  State<WardrobeInsightsScreen> createState() => _WardrobeInsightsScreenState();
}

class _WardrobeInsightsScreenState extends State<WardrobeInsightsScreen> {
  final _state = AppState.instance;

  @override
  void initState() {
    super.initState();
    _state.loadWardrobe();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _state,
      builder: (context, _) => SwScreen(
        scroll: true,
        padding: const EdgeInsets.only(bottom: Insets.xxl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
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
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Wardrobe Insights', style: AppText.h1),
                        const SizedBox(height: 2),
                        Text(
                          'Data driven analysis of your closet',
                          style: AppText.caption,
                        ),
                      ],
                    ),
                  ),
                  const SwIconButton(icon: SwIconButtonKind.bag),
                ],
              ),
            ),
            const SizedBox(height: Insets.lg),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _StatStrip(items: _state.wardrobe),
                  const SizedBox(height: Insets.sectionGap),
                  Text('Most Worn Items', style: AppText.h4),
                  const SizedBox(height: Insets.md),
                  _MostWornRow(items: _state.wardrobe),
                  const SizedBox(height: Insets.lg),
                  const SwBanner(
                    tone: SwBannerTone.warning,
                    icon: SwIcon.alert,
                    message:
                        'You own 4 casual jackets but very few formal pieces. '
                        'Try adding structured items for formal occasions.',
                  ),
                  const SizedBox(height: Insets.sectionGap),
                  Text('Never Worn', style: AppText.h4),
                  const SizedBox(height: Insets.md),
                  _NeverWornCard(
                    items: _state.wardrobe,
                    onAsk: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const StylistScreen()),
                    ),
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

/// Five count tiles across the top of the insights screen.
class _StatStrip extends StatelessWidget {
  const _StatStrip({required this.items});

  final List<ClothingItem> items;

  @override
  Widget build(BuildContext context) {
    int count(String category) =>
        items.where((i) => i.category == category).length;
    final stats = [
      ('Items', '${items.length}'),
      ('Tops', '${count('Tops')}'),
      ('Bottoms', '${count('Bottoms')}'),
      ('Shoes', '${count('Shoes')}'),
      ('Acc.', '${count('Accessories')}'),
    ];
    return Row(
      children: [
        for (var i = 0; i < stats.length; i++) ...[
          if (i > 0) const SizedBox(width: Insets.sm),
          Expanded(
            child: SwCard(
              padding: const EdgeInsets.symmetric(vertical: Insets.md),
              child: Column(
                children: [
                  Text(
                    stats[i].$2,
                    style: AppText.statValue,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    stats[i].$1,
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.statLabel,
                  ),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _MostWornRow extends StatelessWidget {
  const _MostWornRow({required this.items});

  final List<ClothingItem> items;

  @override
  Widget build(BuildContext context) {
    final top = [...items]
      ..sort((a, b) => b.timesWorn.compareTo(a.timesWorn));
    final row = top.take(3).toList();
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < row.length; i++) ...[
          if (i > 0) const SizedBox(width: Insets.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AspectRatio(
                  aspectRatio: 1,
                  child: SwProductImage(
                    image: row[i].image,
                    radius: Radii.md,
                  ),
                ),
                const SizedBox(height: Insets.sm),
                Text(
                  row[i].name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.labelStrong.copyWith(fontSize: 11),
                ),
                Text(
                  '${row[i].timesWorn} wears',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.caption.copyWith(
                    fontSize: 10,
                    color: AppColors.primary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _NeverWornCard extends StatelessWidget {
  const _NeverWornCard({required this.items, required this.onAsk});

  final List<ClothingItem> items;
  final VoidCallback onAsk;

  @override
  Widget build(BuildContext context) {
    final unworn = [...items]..sort((a, b) => a.timesWorn.compareTo(b.timesWorn));
    final item = unworn.isNotEmpty ? unworn.first : null;
    if (item == null) return const SizedBox.shrink();
    return SwCard(
      padding: const EdgeInsets.all(Insets.md),
      child: Row(
        children: [
          SizedBox(
            width: 44,
            height: 44,
            child: SwProductImage(image: item.image, radius: Radii.sm),
          ),
          const SizedBox(width: Insets.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.name, style: AppText.cardTitle),
                Text(
                  item.lastWornLabel ?? 'Unworn',
                  style: AppText.caption.copyWith(color: AppColors.danger),
                ),
              ],
            ),
          ),
          SwChip(
            label: 'Ask Stylist',
            dense: true,
            tone: SwChipTone.tinted,
            onTap: onAsk,
          ),
        ],
      ),
    );
  }
}
