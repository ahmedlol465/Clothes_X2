import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/assets.dart';
import '../../core/icons/sw_icon.dart';

/// Frame 15 - build an outfit slot by slot.
class CreateOutfitScreen extends StatefulWidget {
  const CreateOutfitScreen({super.key});

  @override
  State<CreateOutfitScreen> createState() => _CreateOutfitScreenState();
}

class _CreateOutfitScreenState extends State<CreateOutfitScreen> {
  String _tone = 'Casual';

  static const _tones = [
    'Casual',
    'Formal',
    'Summer',
    'Date Night',
    'University',
    'Winter',
  ];

  static const _slots = <(String, String, String, String?)>[
    ('TOP', 'Tailored Blazer', Img.blazerTailored, 'Beige Linen Blazer'),
    ('BOTTOM', 'Choose bottom item', '', null),
    ('SHOES', 'Choose shoes', '', null),
    ('ACCESSORIES', 'Choose accessory', '', null),
  ];

  @override
  Widget build(BuildContext context) {
    return SwScreen(
      scroll: true,
      padding: const EdgeInsets.only(bottom: Insets.xxl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SwAppBar(title: 'Create Your Outfit'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var i = 0; i < _slots.length; i++) ...[
                  _SlotRow(
                    slot: _slots[i],
                    onTap: () => _fillSlot(context, _slots[i].$1),
                  ),
                  if (i != _slots.length - 1) const SizedBox(height: Insets.md),
                ],
                const SizedBox(height: Insets.xl),
                Text(
                  'STYLE TONE INSPIRATION',
                  style: AppText.overline.copyWith(
                    color: AppColors.primary,
                    letterSpacing: 1.1,
                  ),
                ),
                const SizedBox(height: Insets.md),
                Wrap(
                  spacing: Insets.sm,
                  runSpacing: Insets.sm,
                  children: [
                    for (final tone in _tones)
                      SwChip(
                        label: tone,
                        selected: tone == _tone,
                        onTap: () => setState(() => _tone = tone),
                      ),
                  ],
                ),
                const SizedBox(height: Insets.xxxl),
                SwOutlineButton(
                  label: 'Get AI Suggestions',
                  foreground: AppColors.primary,
                  onTap: () => ScaffoldMessenger.of(context)
                    ..hideCurrentSnackBar()
                    ..showSnackBar(
                      SnackBar(content: Text('$_tone looks coming up.')),
                    ),
                ),
                const SizedBox(height: Insets.md),
                SwButton(
                  label: 'Save Outfit',
                  onTap: () => ScaffoldMessenger.of(context)
                    ..hideCurrentSnackBar()
                    ..showSnackBar(
                      const SnackBar(content: Text('Outfit saved.')),
                    ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _fillSlot(BuildContext context, String slot) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text('Pick an item for $slot.')));
  }
}

/// One outfit slot: thumbnail or plus sign, label, value and chevron.
class _SlotRow extends StatelessWidget {
  const _SlotRow({required this.slot, required this.onTap});

  final (String, String, String, String?) slot;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (label, value, image, _) = slot;
    final empty = image.isEmpty;

    return SwCard(
      onTap: onTap,
      padding: const EdgeInsets.all(Insets.md),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: AppColors.background,
              borderRadius: Radii.tileRadius,
            ),
            child: empty
                ? const Center(
                    child: SwIconView(
                      SwIcon.plus,
                      size: 18,
                      color: AppColors.textSecondary,
                    ),
                  )
                : SwPhoto(path: image),
          ),
          const SizedBox(width: Insets.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: AppText.overline.copyWith(fontSize: 9)),
                const SizedBox(height: 3),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.bodyStrong,
                ),
              ],
            ),
          ),
          const SwIconView(
            SwIcon.chevronRight,
            size: 16,
            color: AppColors.textTertiary,
          ),
        ],
      ),
    );
  }
}
