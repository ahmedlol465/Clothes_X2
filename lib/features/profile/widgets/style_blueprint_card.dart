import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/sw_widgets.dart';
import '../../../data/models.dart';
import 'color_dot.dart';
import 'spec_tile.dart';

/// Colours, preferred styles and body measurements from the backend.
class StyleBlueprintCard extends StatelessWidget {
  const StyleBlueprintCard({
    super.key,
    required this.profile,
    required this.onEdit,
    required this.onDna,
  });

  final UserProfile profile;
  final VoidCallback onEdit;
  final VoidCallback onDna;

  @override
  Widget build(BuildContext context) {
    final colors = profile.favoriteColors;
    final styles = profile.preferredStyles;
    final size = profile.sizeLabel;
    final height = profile.heightLabel;

    return SwCard(
      padding: const EdgeInsets.all(Insets.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Favorite Styling Colors',
                  style: AppText.cardTitle.copyWith(fontSize: 14),
                ),
              ),
              GestureDetector(
                onTap: onDna,
                child: Text(
                  'View DNA',
                  style: AppText.labelStrong.copyWith(color: AppColors.primary),
                ),
              ),
            ],
          ),
          const SizedBox(height: Insets.md),
          if (colors.isEmpty)
            Text('No favorite colors yet', style: AppText.caption)
          else
            Wrap(
              spacing: Insets.md,
              runSpacing: Insets.md,
              children: [
                for (final name in colors) ColorDot(name: name),
              ],
            ),
          const SizedBox(height: Insets.lg),
          Text(
            'Styles Preferred',
            style: AppText.cardTitle.copyWith(fontSize: 14),
          ),
          const SizedBox(height: Insets.md),
          if (styles.isEmpty)
            Text('No preferred styles yet', style: AppText.caption)
          else
            Wrap(
              spacing: Insets.sm,
              runSpacing: Insets.sm,
              children: [
                for (final style in styles)
                  SwChip(label: style, dense: true, tone: SwChipTone.tinted),
              ],
            ),
          const SizedBox(height: Insets.lg),
          Text(
            'Body & Fit Specs',
            style: AppText.cardTitle.copyWith(fontSize: 14),
          ),
          const SizedBox(height: Insets.md),
          Row(
            children: [
              Expanded(
                child: SpecTile(
                  label: 'Size',
                  value: size ?? 'Not set',
                  muted: size == null,
                ),
              ),
              SizedBox(width: Insets.md),
              Expanded(
                child: SpecTile(
                  label: 'Height',
                  value: height ?? 'Not set',
                  muted: height == null,
                ),
              ),
            ],
          ),
          if (profile.weightLabel != null || profile.fitLabel != null) ...[
            const SizedBox(height: Insets.md),
            Row(
              children: [
                if (profile.weightLabel != null)
                  Expanded(
                    child: SpecTile(
                      label: 'Weight',
                      value: profile.weightLabel!,
                    ),
                  ),
                if (profile.weightLabel != null && profile.fitLabel != null)
                  const SizedBox(width: Insets.md),
                if (profile.fitLabel != null)
                  Expanded(
                    child: SpecTile(label: 'Fit', value: profile.fitLabel!),
                  ),
              ],
            ),
          ],
          const SizedBox(height: Insets.lg),
          FilledButton(
            onPressed: onEdit,
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(46),
              textStyle: AppText.button,
              shape: const RoundedRectangleBorder(
                borderRadius: Radii.pillRadius,
              ),
            ),
            child: const Text('Edit Style Profile'),
          ),
        ],
      ),
    );
  }
}