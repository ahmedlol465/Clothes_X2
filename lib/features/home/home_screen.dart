import 'package:flutter/material.dart';

import '../../app.dart';
import '../../core/app_copy.dart';
import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/controllers/account_controller.dart';
import '../../data/controllers/outfits_controller.dart';
import '../../data/controllers/planner_controller.dart';
import '../../data/controllers/wardrobe_controller.dart';
import '../../data/backend_status.dart';
import '../../data/assets.dart';
import '../../data/models.dart';
import '../shell/main_shell.dart';

/// Frame 7 - the dashboard shown after sign in.
///
/// The hero outfit and weather load from the backend
/// (`GET /outfits/recommended`, `GET /weather/current`). Nothing is invented
/// when those calls fail; the cards show an honest empty state.
class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.onOpenTab,
    this.outfitsController,
    this.wardrobeController,
    this.plannerController,
    this.accountController,
    this.backendStatus,
  });

  final ValueChanged<ShellTab> onOpenTab;
  final OutfitsController? outfitsController;
  final WardrobeController? wardrobeController;
  final PlannerController? plannerController;
  final AccountController? accountController;
  final BackendStatus? backendStatus;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final OutfitsController _outfitsController;
  late final WardrobeController _wardrobeController;
  late final PlannerController _plannerController;
  late final AccountController _accountController;
  late final BackendStatus _backendStatus;

  @override
  void initState() {
    super.initState();
    _outfitsController = widget.outfitsController ?? AppState.instance.outfitsController;
    _wardrobeController = widget.wardrobeController ?? AppState.instance.wardrobeController;
    _plannerController = widget.plannerController ?? AppState.instance.plannerController;
    _accountController = widget.accountController ?? AppState.instance.accountController;
    _backendStatus = widget.backendStatus ?? AppState.instance.backendStatus;
    _outfitsController.loadToday();
    _wardrobeController.load();
    _plannerController.loadEvents();
  }

  void _push(BuildContext context, String routeName, {Object? arguments}) {
    Navigator.of(context).pushNamed(routeName, arguments: arguments);
  }

@override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([
        _outfitsController,
        _wardrobeController,
        _plannerController,
        _accountController,
        _backendStatus,
      ]),
      builder: (context, _) {
        final profile = _accountController.profile;
        final today = _outfitsController.today;
        final event = _plannerController.events.isEmpty
            ? null
            : _plannerController.events.first;
        return SwScreen(
          scroll: true,
          padding: const EdgeInsets.only(bottom: Insets.xxl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Greeting(
                name: profile?.name ?? 'there',
                avatarUrl: profile?.avatarUrl,
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
                child: _WeatherPill(
                  weather: _outfitsController.weather,
                  online: _backendStatus.online,
                  onRetry: _outfitsController.loadToday,
                ),
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
                    if (today != null) SwMatchBadge(match: today.match),
                  ],
                ),
              ),
              const SizedBox(height: Insets.md),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
                child: _SelectionCard(
                  outfit: today,
                  onView: today == null
                      ? null
                      : () => _push(
                            context,
                            Routes.perfectMatch,
                            arguments: today,
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
                          onTap: () => _push(context, Routes.addClothing),
                        ),
                        _QuickAction(
                          icon: SwIcon.sparkle,
                          label: 'AI Stylist',
                          onTap: () => widget.onOpenTab(ShellTab.stylist),
                        ),
                        _QuickAction(
                          icon: SwIcon.calendar,
                          label: 'Plan Outfit',
                          onTap: () => _push(context, Routes.outfitPlanner),
                        ),
                        _QuickAction(
                          icon: SwIcon.shirt,
                          label: 'My Wardrobe',
                          onTap: () => widget.onOpenTab(ShellTab.wardrobe),
                        ),
                      ],
                    ),
                    const SizedBox(height: Insets.md),
                    if (event != null)
                      _UpcomingEvent(
                        event: event,
                        onTap: () => _push(context, Routes.outfitPlanner),
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
              if (_wardrobeController.items.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
                  child: Text(AppCopy.emptyWardrobe, style: AppText.caption),
                )
              else
                RecentlyAddedRail(
                  items: _wardrobeController.items,
                  onTap: (item) =>
                      _push(context, Routes.itemDetail, arguments: item),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _Greeting extends StatelessWidget {
  const _Greeting({required this.name, this.avatarUrl});

  final String name;
  final String? avatarUrl;

  static String _greetingFor(DateTime now) {
    final hour = now.hour;
    if (hour >= 5 && hour < 12) return 'Good morning,';
    if (hour >= 12 && hour < 17) return 'Good afternoon,';
    if (hour >= 17 && hour < 22) return 'Good evening,';
    return 'Good night,';
  }

  @override
  Widget build(BuildContext context) {
    final firstName = name.trim().isEmpty ? 'there' : name.trim().split(' ').first;
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
                Text(_greetingFor(DateTime.now()), style: AppText.caption),
                const SizedBox(height: 2),
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: firstName),
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
          SwAvatar(
            image: avatarUrl == null || avatarUrl!.trim().isEmpty
                ? Img.avatarKarim
                : avatarUrl!,
            size: 44,
            name: firstName,
          ),
        ],
      ),
    );
  }
}

/// Warm forecast strip under the greeting (live via GET /weather/current).
///
/// Honest about its state: live conditions show the city, a seasonal estimate
/// is marked approximate, and a failed load says so with a tap-to-retry
/// instead of faking a sunny 28°C.
class _WeatherPill extends StatelessWidget {
  const _WeatherPill({this.weather, required this.online, this.onRetry});

  final Map<String, dynamic>? weather;
  final bool online;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final summary = weather?['summary']?.toString();
    final city = weather?['city']?.toString();
    final isEstimate = weather?['source'] == 'estimate';
    // No data at all: never invent conditions — say so and offer a retry.
    final title = summary == null
        ? 'Weather unavailable'
        : (city == null || city.isEmpty || summary.contains(city)
            ? summary
            : '$summary • $city');
    final subtitle = summary == null
        ? (online
            ? 'Could not load conditions — tap to retry'
            : 'Backend offline — tap to retry')
        : isEstimate
            ? '${_advice(weather)} • approximate'
            : _advice(weather);
    return GestureDetector(
      onTap: summary == null ? onRetry : null,
      child: Container(
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
                  Text(title, style: AppText.cardTitle),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: AppText.caption,
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

/// One-line outfit advice derived from live conditions — never hardcoded.
String _advice(Map<String, dynamic>? weather) {
  final tags = (weather?['tags'] ?? weather?['condition'] ?? '').toString();
  final temp = (weather?['tempC'] as num?)?.toDouble();
  if (RegExp(r'rain|drizzle|shower|storm|thunder|snow', caseSensitive: false)
      .hasMatch(tags)) {
    return 'Grab a waterproof layer';
  }
  if (temp != null && temp >= 30) return 'Perfect for lightweight layering';
  if (temp != null && temp <= 18) return 'Time to layer up';
  return 'Perfect for lightweight layering';
}

/// Large hero card for the outfit the AI picked today.
class _SelectionCard extends StatelessWidget {
  const _SelectionCard({required this.outfit, required this.onView});

  final Outfit? outfit;
  final VoidCallback? onView;

  @override
  Widget build(BuildContext context) {
    final outfit = this.outfit;
    if (outfit == null) {
      return SwCard(
        padding: const EdgeInsets.all(Insets.lg),
        child: Row(
          children: [
            const SwIconBadge(icon: SwIcon.sparkle, size: 38, iconSize: 18),
            const SizedBox(width: Insets.md),
            Expanded(
              child: Text(
                'No recommendation yet. Add a few garments and pull to refresh.',
                style: AppText.caption,
              ),
            ),
          ],
        ),
      );
    }

    return SwCard(
      padding: EdgeInsets.zero,
      clip: true,
      onTap: onView,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 1.94,
            child: SwPhoto(path: outfit.image),
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
  const _UpcomingEvent({required this.event, required this.onTap});

  final Map<String, dynamic> event;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final title = '${event['title'] ?? 'Upcoming event'}';
    final when = '${event['startsAtRaw'] ?? event['startsAt'] ?? ''}';
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
                Text(title, style: AppText.cardTitle),
                if (when.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(when, style: AppText.caption),
                ],
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
  const RecentlyAddedRail({super.key, required this.items, required this.onTap});

  final List<ClothingItem> items;
  final void Function(ClothingItem) onTap;

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
            onTap: () => onTap(item),
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
