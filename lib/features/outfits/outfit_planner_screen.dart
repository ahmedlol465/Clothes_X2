import 'package:flutter/material.dart';

import '../../app.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/assets.dart';
import '../../data/controllers/planner_controller.dart';
import '../../data/models.dart';

/// Frame 18 - week strip plus the recommended look for each day.
///
/// The week loads from the backend (`GET /planner/weekly`).
class OutfitPlannerScreen extends StatefulWidget {
  const OutfitPlannerScreen._(this._plannerController);

  factory OutfitPlannerScreen({Key? key, PlannerController? plannerController}) {
    return OutfitPlannerScreen._(
      plannerController ?? AppState.instance.plannerController,
    );
  }

  final PlannerController _plannerController;

  @override
  State<OutfitPlannerScreen> createState() => _OutfitPlannerScreenState();
}

class _OutfitPlannerScreenState extends State<OutfitPlannerScreen> {
  int _selected = 2;

  @override
  void initState() {
    super.initState();
    widget._plannerController.loadWeek();
  }

  List<PlanDay> get _week => [
        for (final d in widget._plannerController.week)
          PlanDay(
            weekday: '${d['weekday'] ?? ''}',
            date: '${d['date'] ?? ''}',
            occasion: '${d['occasion'] ?? ''}',
            outfitName: '${d['outfitName'] ?? ''}',
            image: '${d['image'] ?? Img.outfitFlatlayBeige}',
            isToday: d['isToday'] as bool? ?? false,
          ),
      ];

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget._plannerController,
      builder: (context, _) {
        final week = _week;
        final selected = _selected.clamp(0, week.length - 1);
        return SwScreen(
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
                          Text('Outfit Planner', style: AppText.h1),
                          const SizedBox(height: 2),
                          Text(
                            'Schedule your style for the week',
                            style: AppText.caption,
                          ),
                        ],
                      ),
                    ),
                    SwIconButton(icon: SwIconButtonKind.filter),
                  ],
                ),
              ),
              const SizedBox(height: Insets.lg),
              _WeekStrip(
                week: week,
                selected: selected,
                onSelect: (i) => setState(() => _selected = i),
              ),
              const SizedBox(height: Insets.lg),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
                child: Text('Weekly Recommendations', style: AppText.h4),
              ),
              const SizedBox(height: Insets.md),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
                child: Column(
                  children: [
                    for (final day in week) ...[
                      _DayCard(
                        day: day,
                        onUse: () => Navigator.of(context).pushNamed(Routes.perfectMatch),
                      ),
                      const SizedBox(height: Insets.md),
                    ],
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Mon - Sun selector; the active day is filled with the brand purple.
class _WeekStrip extends StatelessWidget {
  const _WeekStrip({
    required this.week,
    required this.selected,
    required this.onSelect,
  });

  final List<PlanDay> week;
  final int selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 68,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
        physics: const BouncingScrollPhysics(),
        itemCount: week.length,
        separatorBuilder: (_, _) => const SizedBox(width: Insets.sm),
        itemBuilder: (context, i) {
          final day = week[i];
          final active = i == selected;

          return GestureDetector(
            onTap: () => onSelect(i),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: 44,
              padding: const EdgeInsets.symmetric(vertical: Insets.sm),
              decoration: BoxDecoration(
                color: active ? AppColors.primary : AppColors.surface,
                borderRadius: Radii.tileRadius,
                border: Border.all(
                  color: active ? AppColors.primary : AppColors.border,
                ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    day.weekday,
                    style: AppText.overline.copyWith(
                      fontSize: 9,
                      letterSpacing: 0,
                      color: active ? Colors.white : AppColors.textTertiary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    day.date,
                    style: AppText.cardTitle.copyWith(
                      fontSize: 15,
                      color: active ? Colors.white : AppColors.textPrimary,
                    ),
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

/// Recommendation card for one day of the week.
class _DayCard extends StatelessWidget {
  const _DayCard({required this.day, required this.onUse});

  final PlanDay day;
  final VoidCallback onUse;

  @override
  Widget build(BuildContext context) {
    final title = day.isToday ? '${day.weekday} (Today)' : day.weekday;

    return SwCard(
      padding: const EdgeInsets.all(Insets.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: AppText.cardTitle),
                    const SizedBox(height: 2),
                    Text(day.occasion, style: AppText.caption),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: Insets.md,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: AppColors.tint,
                  borderRadius: Radii.pillRadius,
                ),
                child: Text(
                  'Recommended',
                  style: AppText.labelStrong.copyWith(
                    color: AppColors.primary,
                    fontSize: 11,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: Insets.lg),
          Row(
            children: [
              SizedBox(
                width: 56,
                height: 56,
                child: SwProductImage(image: day.image, radius: Radii.sm),
              ),
              const SizedBox(width: Insets.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      day.outfitName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.bodyStrong,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Styled from your active pieces',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.caption,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: Insets.lg),
          FilledButton(
            onPressed: onUse,
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(46),
              textStyle: AppText.button,
              shape: const RoundedRectangleBorder(
                borderRadius: Radii.pillRadius,
              ),
            ),
            child: const Text('Use This Outfit'),
          ),
        ],
      ),
    );
  }
}
