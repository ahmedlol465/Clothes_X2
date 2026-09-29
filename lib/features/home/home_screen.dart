import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/assets.dart';
import '../../data/mock_data.dart';
import '../../data/models.dart';
import '../outfits/outfit_planner_screen.dart';
import '../outfits/perfect_match_screen.dart';
import '../shell/main_shell.dart';
import '../wardrobe/add_clothing_screen.dart';
import '../wardrobe/item_detail_screen.dart';

/// Frame 7 - the dashboard shown after sign in.
///
/// The hero outfit and weather load from the backend
/// (`GET /outfits/recommended`, `GET /weather/current`) and fall back
/// to the bundled content offline.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.onOpenTab});

  final ValueChanged<ShellTab> onOpenTab;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _state = AppState.instance;

  @override
  void initState() {
    super.initState();
    _state.loadToday();
    _state.loadWardrobe();
  }

  void _push(BuildContext context, Widget screen) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
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
            const _Greeting(),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
              child: _WeatherPill(weather: _state.weather),
            ),
            const SizedBox(height: Insets.xl),

            // Today's AI selection -------------------------------------------
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
              child: Row(
                children: [
                  Expanded(
                    child: Text("Today's AI Selection", style: AppText.h4),
                  ),
                  SwMatchBadge(match: _state.todayOutfit.match),
                ],
              ),
            ),
            const SizedBox(height: Insets.md),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
              child: _SelectionCard(
                outfit: _state.todayOutfit,
                onView: () => _push(
                  context,
                  PerfectMatchScreen(outfit: _state.todayOutfit),
                ),
              ),
            ),
            const SizedBox(height: Insets.sectionGap),

            // Quick actions ---------------------------------------------------
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Quick Actions', style: AppText.h4),
                  const SizedBox(height: Insets.md),
                  GridView.count(
                    crossAxisCount: 2,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: Insets.md,
                    crossAxisSpacing: Insets.md,
                    childAspectRatio: 2.55,
                    children: [
                      _QuickAction(
                        icon: SwIcon.plus,
                        label: 'Add Clothes',
                        onTap: () => _push(context, const AddClothingScreen()),
                      ),
                      _QuickAction(
                        icon: SwIcon.sparkle,
                        label: 'AI Stylist',
                        onTap: () => widget.onOpenTab(ShellTab.stylist),
                      ),
                      _QuickAction(
                        icon: SwIcon.calendar,
                        label: 'Plan Outfit',
                        onTap: () => _push(context, const OutfitPlannerScreen()),
                      ),
                      _QuickAction(
                        icon: SwIcon.shirt,
                        label: 'My Wardrobe',
                        onTap: () => widget.onOpenTab(ShellTab.wardrobe),
                      ),
                    ],
                  ),
                  const SizedBox(height: Insets.md),
                  _UpcomingEvent(
                    onTap: () => _push(context, const OutfitPlannerScreen()),
                  ),
                ],
              ),
            ),
            const SizedBox(height: Insets.sectionGap),

            // Recently added -------------------------------------------------
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
              child: SwSectionHeader(
                title: 'Recently Added',
                actionLabel: 'See all',
                onAction: () => widget.onOpenTab(ShellTab.wardrobe),
              ),
            ),
            const SizedBox(height: Insets.xs),
            RecentlyAddedRail(items: _state.wardrobe),
          ],
        ),
      ),
    );
  }
}

class _Greeting extends StatelessWidget {
  const _Greeting();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Insets.gutter,
        Insets.md,
        Insets.gutter,
        Insets.lg,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Good morning,', style: AppText.caption),
                const SizedBox(height: 2),
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: MockData.userName),
                      const TextSpan(text: '  '),
                      const WidgetSpan(
                        alignment: PlaceholderAlignment.middle,
                        child: Text(
                          '\u{1F44B}',
                          style: TextStyle(fontSize: 18),
                        ),
                      ),
                    ],
                  ),
                  style: AppText.h1.copyWith(fontSize: 24),
                ),
              ],
            ),
          ),
          SwAvatar(image: Img.avatarKarim, size: 44, name: MockData.userName),
        ],
      ),
    );
  }
}

/// Warm forecast strip under the greeting (live via GET /weather/current).
class _WeatherPill extends StatelessWidget {
  const _WeatherPill({this.weather});

  final Map<String, dynamic>? weather;

  @override
  Widget build(BuildContext context) {
    final summary = weather?['summary']?.toString() ?? 'Sunny • 28°C';
    return Container(
      padding: const EdgeInsets.all(Insets.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: Radii.cardRadius,
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          const SwIconView(
            SwIcon.sun,
            size: 30,
            color: AppColors.sun,
            strokeWidth: 1.6,
          ),
          const SizedBox(width: Insets.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(summary, style: AppText.cardTitle),
                const SizedBox(height: 2),
                Text(
                  'Perfect for lightweight layering',
                  style: AppText.caption,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Large hero card for the outfit the AI picked today.
class _SelectionCard extends StatelessWidget {
  const _SelectionCard({required this.outfit, required this.onView});

  final Outfit outfit;
  final VoidCallback onView;

  @override
  Widget build(BuildContext context) {
    final outfit = this.outfit;

    return SwCard(
      padding: EdgeInsets.zero,
      clip: true,
      onTap: onView,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 1.94,
            child: Image.asset(outfit.image, fit: BoxFit.cover),
          ),
          Padding(
            padding: const EdgeInsets.all(Insets.lg),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(outfit.name, style: AppText.cardTitle),
                      const SizedBox(height: 3),
                      Text(
                        outfit.summary ?? outfit.pieces.join(' + '),
                        style: AppText.caption,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: Insets.md),
                FilledButton(
                  onPressed: onView,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, 40),
                    padding: const EdgeInsets.symmetric(horizontal: Insets.lg),
                    textStyle: AppText.labelStrong,
                  ),
                  child: const Text('View Outfit'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final SwIcon icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      padding: const EdgeInsets.symmetric(horizontal: Insets.md),
      onTap: onTap,
      child: Row(
        children: [
          SwIconBadge(icon: icon, size: 34, iconSize: 17),
          const SizedBox(width: Insets.sm),
          Expanded(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.bodyStrong.copyWith(fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

/// Highlighted next event card.
class _UpcomingEvent extends StatelessWidget {
  const _UpcomingEvent({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      onTap: onTap,
      padding: const EdgeInsets.all(Insets.md),
      child: Row(
        children: [
          const SwIconBadge(icon: SwIcon.calendar, size: 40, iconSize: 19),
          const SizedBox(width: Insets.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('University Presentation', style: AppText.cardTitle),
                const SizedBox(height: 2),
                Text('Tomorrow • 10:00 AM', style: AppText.caption),
              ],
            ),
          ),
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: AppColors.surface,
              shape: BoxShape.circle,
            ),
            child: const SwIconView(
              SwIcon.chevronRight,
              size: 14,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

/// Horizontal rail of newly catalogued garments.
class RecentlyAddedRail extends StatelessWidget {
  const RecentlyAddedRail({super.key, required this.items});

  final List<ClothingItem> items;

  @override
  Widget build(BuildContext context) {
    final rail = items.take(4).toList();
    return SizedBox(
      height: 190,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
        physics: const BouncingScrollPhysics(),
        itemCount: rail.length,
        separatorBuilder: (_, _) => const SizedBox(width: Insets.md),
        itemBuilder: (context, i) {
          final ClothingItem item = rail[i];
          return GestureDetector(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => ItemDetailScreen(item: item)),
            ),
            child: SizedBox(
              width: 132,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    height: 132,
                    width: 132,
                    child: SwProductImage(image: item.image, radius: Radii.md),
                  ),
                  const SizedBox(height: Insets.sm),
                  Text(
                    item.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.labelStrong.copyWith(fontSize: 11),
                  ),
                  Text(
                    item.category,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.overline.copyWith(letterSpacing: 0),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
