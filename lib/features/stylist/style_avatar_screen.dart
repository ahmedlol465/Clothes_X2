import 'package:flutter/material.dart';

import '../../core/app_copy.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/assets.dart';
import '../../data/controllers/outfits_controller.dart';
import '../../data/controllers/wardrobe_controller.dart';
import '../../data/models.dart';

/// Frame 14 - try a combination on the fitting room mannequin.
///
/// The top and bottom choices are garments from the database; there are no
/// bundled avatar items.
class StyleAvatarScreen extends StatefulWidget {
  const StyleAvatarScreen({
    super.key,
    this.wardrobeController,
    this.outfitsController,
  });

  final WardrobeController? wardrobeController;
  final OutfitsController? outfitsController;

  @override
  State<StyleAvatarScreen> createState() => _StyleAvatarScreenState();
}

class _StyleAvatarScreenState extends State<StyleAvatarScreen> {
  late final WardrobeController _wardrobe;
  late final OutfitsController _outfits;
  int _topIndex = 0;
  int _bottomIndex = 0;

  @override
  void initState() {
    super.initState();
    _wardrobe = widget.wardrobeController ?? AppState.instance.wardrobeController;
    _outfits = widget.outfitsController ?? AppState.instance.outfitsController;
    _wardrobe.load();
  }

  List<ClothingItem> get _tops => [
        for (final item in _wardrobe.items)
          if (item.category == 'Tops' || item.category == 'Outerwear') item,
      ];

  List<ClothingItem> get _bottoms => [
        for (final item in _wardrobe.items)
          if (item.category == 'Bottoms') item,
      ];

  Future<void> _saveLook() async {
    final tops = _tops;
    final bottoms = _bottoms;
    if (tops.isEmpty || bottoms.isEmpty) {
      _toast('Add at least one top and one bottom to your wardrobe first.');
      return;
    }
    final top = tops[_topIndex.clamp(0, tops.length - 1)];
    final bottom = bottoms[_bottomIndex.clamp(0, bottoms.length - 1)];
    try {
      await _outfits.api.createOutfit(
        '${top.name} + ${bottom.name}',
        [top.id, bottom.id],
        occasion: 'Casual',
      );
      await _outfits.loadSaved();
      if (!mounted) return;
      _toast('Outfit saved.');
    } catch (_) {
      if (!mounted) return;
      _toast('Could not save the look. Check the backend and try again.');
    }
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _wardrobe,
      builder: (context, _) {
        final tops = _tops;
        final bottoms = _bottoms;
        final top = tops.isEmpty
            ? null
            : tops[_topIndex.clamp(0, tops.length - 1)];
        final bottom = bottoms.isEmpty
            ? null
            : bottoms[_bottomIndex.clamp(0, bottoms.length - 1)];

        return SwScreen(
          scroll: true,
          padding: const EdgeInsets.only(bottom: Insets.xxl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SwAppBar(title: 'Style Avatar'),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (top == null && bottom == null)
                      Text(AppCopy.emptyWardrobe, style: AppText.caption)
                    else ...[
                      _FittingRoom(top: top, bottom: bottom),
                      const SizedBox(height: Insets.xl),
                      Text(
                        'CHOOSE TOP',
                        style: AppText.overline.copyWith(
                          color: AppColors.primary,
                          letterSpacing: 1.1,
                        ),
                      ),
                      const SizedBox(height: Insets.md),
                      _SwatchRow(
                        items: tops,
                        selected: _topIndex,
                        onSelect: (i) => setState(() => _topIndex = i),
                      ),
                      const SizedBox(height: Insets.xl),
                      Text(
                        'CHOOSE BOTTOM',
                        style: AppText.overline.copyWith(
                          color: AppColors.primary,
                          letterSpacing: 1.1,
                        ),
                      ),
                      const SizedBox(height: Insets.md),
                      _SwatchRow(
                        items: bottoms,
                        selected: _bottomIndex,
                        onSelect: (i) => setState(() => _bottomIndex = i),
                      ),
                      const SizedBox(height: Insets.xxxl),
                      SwButton(
                        label: 'Save Look',
                        onTap: _saveLook,
                      ),
                      const SizedBox(height: Insets.md),
                      SwOutlineButton(
                        label: 'AI Suggestions',
                        onTap: () => _toast(
                          'Use the AI Stylist tab to generate a look from your wardrobe.',
                        ),
                      ),
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

/// Mannequin panel with the selected garments and a "Fitting Room" chip.
class _FittingRoom extends StatelessWidget {
  const _FittingRoom({required this.top, required this.bottom});

  final ClothingItem? top;
  final ClothingItem? bottom;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      padding: EdgeInsets.zero,
      clip: true,
      child: AspectRatio(
        aspectRatio: 1.05,
        child: Stack(
          fit: StackFit.expand,
          children: [
            ColoredBox(
              color: AppColors.background,
              child: Padding(
                padding: const EdgeInsets.all(Insets.xl),
                child: Image.asset(
                  Img.avatarFittingRoom,
                  fit: BoxFit.contain,
                  alignment: Alignment.topCenter,
                ),
              ),
            ),
            if (top != null)
              Positioned(
                left: Insets.lg,
                bottom: Insets.lg,
                child: _AvatarThumb(item: top!),
              ),
            if (bottom != null)
              Positioned(
                right: Insets.lg,
                bottom: Insets.lg,
                child: _AvatarThumb(item: bottom!),
              ),
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: Align(
                alignment: Alignment.centerRight,
                child: Container(
                  margin: const EdgeInsets.all(Insets.md),
                  padding: const EdgeInsets.symmetric(
                    horizontal: Insets.md,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: Radii.pillRadius,
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Text('Fitting Room', style: AppText.label),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AvatarThumb extends StatelessWidget {
  const _AvatarThumb({required this.item});

  final ClothingItem item;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 72,
      height: 72,
      child: SwProductImage(image: item.image, radius: Radii.md),
    );
  }
}

/// Horizontal row of selectable garment thumbnails.
class _SwatchRow extends StatelessWidget {
  const _SwatchRow({
    required this.items,
    required this.selected,
    required this.onSelect,
  });

  final List<ClothingItem> items;
  final int selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return Text('No matching items yet.', style: AppText.caption);
    }
    return Row(
      children: [
        for (var i = 0; i < items.length; i++) ...[
          if (i > 0) const SizedBox(width: Insets.md),
          Expanded(
            child: GestureDetector(
              onTap: () => onSelect(i),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                height: 86,
                decoration: BoxDecoration(
                  borderRadius: Radii.tileRadius,
                  border: Border.all(
                    color: i == selected ? AppColors.primary : AppColors.border,
                    width: i == selected ? 2 : 1,
                  ),
                ),
                padding: const EdgeInsets.all(3),
                child: SwProductImage(image: items[i].image, radius: Radii.sm),
              ),
            ),
          ),
        ],
      ],
    );
  }
}
